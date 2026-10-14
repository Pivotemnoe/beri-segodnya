import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Script } from "node:vm";

export function runClientAdminPartnerChecks(source, page) {
  const helpers = source.match(/function orderedAdminPartners\([\s\S]*?(?=\nfunction setupTableFilters)/)?.[0];
  const escape = source.match(/function escapeHtml\([\s\S]*?(?=\nasync function api)/)?.[0];
  assert.ok(helpers && escape, "Admin partner helpers are missing");
  const { orderedAdminPartners, workingAdminPartners, canConfirmPartnerDeletion, adminPartnerCard } = new Script(
    `${escape}\n${helpers}\n({orderedAdminPartners,workingAdminPartners,canConfirmPartnerDeletion,adminPartnerCard})`
  ).runInNewContext({ statusLabel: value => ({active:"Активен", disabled:"Отключён", archived:"В архиве"}[value] || value), typeLabel: () => "Пекарня" });
  const partners = [
    { id: "old", name: "Заведение 1", status: "active", created_at: "2026-01-01", updated_at: "2026-10-14", canDelete: false },
    { id: "archive", name: "Заведение 2", status: "archived", created_at: "2026-10-02", canDelete: true },
    { id: "new", name: "Тестовая пекарня", status: "active", created_at: "2026-10-13", canDelete: true },
    { id: "disabled", name: "Тестовое кафе", status: "disabled", created_at: "2026-10-03", canDelete: true }
  ];
  assert.deepEqual(Array.from(orderedAdminPartners(partners), row => row.id), ["new", "disabled", "archive", "old"]);
  assert.deepEqual(Array.from(workingAdminPartners(partners), row => row.id), ["new", "disabled", "old"]);
  assert.equal(partners[0].id, "old", "Sorting mutated the API data");
  for (const value of ["", "Тестовая", "ТЕСТОВАЯ ПЕКАРНЯ", null, {}, undefined]) assert.equal(canConfirmPartnerDeletion(partners[2], value), false);
  assert.equal(canConfirmPartnerDeletion(partners[2], "  Тестовая пекарня  "), true);
  assert.equal(canConfirmPartnerDeletion({ ...partners[2], canDelete: false }, partners[2].name), false, "Stale confirmation can delete a partner with history");
  assert.equal(canConfirmPartnerDeletion(undefined, partners[2].name), false);
  const users = [{partner_id:"new", role:"owner", login:"bakery-demo"}, {partner_id:"old", role:"owner", login:"other-owner"}];
  const addresses = [{partner_id:"new", title:"Учебная точка", address:"Учебный адрес"}];
  const card = adminPartnerCard(partners[2], users, addresses);
  assert.ok(card.includes('data-filter-card data-filter-status="active"') && card.includes("bakery-demo") && !card.includes("other-owner"));
  assert.ok(card.includes('data-admin-partner-workspace="new"') && card.includes('data-admin-partner-delete="new"'));
  const history = adminPartnerCard(partners[0], users, addresses);
  assert.ok(!history.includes("data-admin-partner-delete") && history.includes("Есть история"));
  const archive = adminPartnerCard(partners[1], users, addresses);
  assert.ok(!archive.includes("data-admin-partner-workspace") && !archive.includes("data-admin-partner-archive") && archive.includes("Вернуть из архива"));
  assert.ok(archive.includes("отдельно включите"), "Archive restore promises automatic staff/address activation");
  const hostile = '<img src=x onerror="alert(1)">';
  const escaped = adminPartnerCard({ ...partners[2], id: hostile, name: hostile }, [{partner_id:hostile,role:"owner",login:hostile}], [{partner_id:hostile,title:hostile,address:hostile}]);
  assert.ok(!escaped.includes("<img") && escaped.includes("&lt;img") && escaped.includes("&quot;"), "Card content/attributes allow injection");
  const filterSource = source.match(/function applyTableFilter\([\s\S]*?(?=\nfunction orderedAdminPartners)/)?.[0];
  const rows = partners.map(row => ({dataset:{filterStatus:row.status},textContent:row.id === "new" ? "Тестовая пекарня bakery-demo" : row.name, hidden:false}));
  const empty = {hidden:true};
  const applyFilter = new Script(`${filterSource}\napplyTableFilter`).runInNewContext({document:{querySelector:()=>({querySelectorAll:()=>rows,querySelector:()=>empty})}});
  let query = "", status = "working";
  const group = {dataset:{filterTarget:"partners"},querySelector:selector=>({value:selector.includes("query")?query:status})};
  const visible = () => rows.filter(row => !row.hidden).map(row => row.dataset.filterStatus);
  applyFilter(group); assert.deepEqual(visible(), ["active", "active", "disabled"]);
  status="archived"; applyFilter(group); assert.deepEqual(visible(), ["archived"]);
  status=""; applyFilter(group); assert.equal(visible().length, 4);
  status="working"; query="BAKERY-DEMO"; applyFilter(group); assert.equal(visible().length, 1); assert.equal(rows[2].hidden,false);
  query="нет такого магазина"; applyFilter(group); assert.equal(empty.hidden,false);
  assert.ok(page.includes('<option value="working" selected>Без архива</option>') && page.includes('<option value="archived">Архив</option>'));
  assert.ok(page.indexOf('data-admin-partners') < page.indexOf('data-admin-onboarding'), "Onboarding obscures the existing shops");
  assert.ok(page.includes('data-admin-stats data-tab-panel="overview"'), "Global stats obscure the store list on a phone");
  assert.ok(/<details[^>]*data-admin-onboarding>/.test(page), "Onboarding is not collapsed by default");
  assert.ok(page.includes('type="submit" disabled>Удалить навсегда') && source.includes('partnerDeleteDialog.showModal()'), "Delete confirmation is not explicit");
  assert.ok(source.includes('body: { confirmation }') && !source.includes('body: { confirmation: partner.name }'), "Deletion auto-fills the safety confirmation");
  assert.ok(source.includes('ownUsers = users.filter(row => row.partner_id === partnerId)') && source.includes('ownAddresses = addresses.filter(row => row.partner_id === partnerId)'), "Workspace displays unrelated staff/addresses");
  assert.ok(source.includes('workingPartners.filter(row => row.status === "active")'), "Offer picker includes archived/disabled shops");
  assert.ok(source.includes('document.querySelector("[data-admin-onboarding]").open = true'), "Application prefill leaves its form hidden");
}

export async function runAdminPartnerArchiveScenario(port, request, { adminCookie, dbFile, suffix }) {
  const fs = await import("node:fs");
  const admin = (route, options={}) => request(port, route, {auth:"adminBasic",cookie:adminCookie,...options});
  const onboard = async (label) => {
    const response = await admin("/api/admin/partners/onboard", {method:"POST",body:{partnerName:`Тестовая пекарня ${label}`,partnerType:"bakery",contactName:"Тестовый владелец",phone:"9001234567",email:"owner@example.test",addressTitle:"Учебная точка",city:"Армавир",address:"Учебный адрес",userName:"Тестовый владелец",login:`archive-${label}-${suffix}`,password:"isolated-archive-fixture-password"}});
    assert.equal(response.status,201); return response.json.data;
  };
  const empty = await onboard("1");
  let shops = (await admin("/api/admin/partners")).json.data;
  assert.equal(shops.find(row => row.id === empty.partner.id).canDelete,true);
  const wrong = await admin(`/api/admin/partners/${empty.partner.id}`, {method:"DELETE",body:{confirmation:"не то название"}});
  assert.equal(wrong.status,400); assert.equal(wrong.json.error.code,"PARTNER_DELETE_CONFIRMATION_REQUIRED");
  assert.ok((await admin("/api/admin/partners")).json.data.some(row => row.id === empty.partner.id));
  assert.equal((await admin(`/api/admin/partners/${empty.partner.id}`, {method:"PATCH",body:{status:"archived"}})).status,200);
  assert.equal((await admin(`/api/admin/partners/${empty.partner.id}/users`)).json.data[0].status,"disabled");
  assert.equal((await admin(`/api/admin/partners/${empty.partner.id}/addresses`)).json.data[0].is_active,false);
  assert.equal((await admin(`/api/admin/partners/${empty.partner.id}`, {method:"DELETE",body:{confirmation:empty.partner.name}})).status,200);
  const afterDelete = JSON.parse(fs.readFileSync(dbFile,"utf8"));
  for (const key of ["partners","partnerUsers","partnerAddresses","sessions"]) assert.ok(!afterDelete[key].some(row => row.id === empty.partner.id || row.partner_id === empty.partner.id));
  const history = await onboard("2");
  const offer = await admin("/api/admin/offers", {method:"POST",body:{partnerId:history.partner.id,addressId:history.address.id,title:"Учебный набор",category:"bakery",price:100,contents:"Учебный состав",allergens:"Уточните в магазине",pickupWindow:"00:00–23:59",totalQuantity:2,status:"active"}});
  assert.equal(offer.status,201);
  const booking = await request(port,"/api/public/bookings",{method:"POST",body:{offerId:offer.json.data.id,customerName:"Тестовый покупатель",customerPhone:"9001234567",personalDataConsent:true,requestId:crypto.randomUUID()}});
  assert.equal(booking.status,201);
  shops=(await admin("/api/admin/partners")).json.data; assert.equal(shops.find(row => row.id === history.partner.id).canDelete,false);
  const protectedDelete = await admin(`/api/admin/partners/${history.partner.id}`, {method:"DELETE",body:{confirmation:history.partner.name}});
  assert.equal(protectedDelete.status,409); assert.equal(protectedDelete.json.error.code,"PARTNER_HAS_HISTORY");
  const before = JSON.parse(fs.readFileSync(dbFile,"utf8"));
  assert.equal((await admin(`/api/admin/partners/${history.partner.id}`, {method:"PATCH",body:{status:"archived"}})).status,200);
  const after = JSON.parse(fs.readFileSync(dbFile,"utf8"));
  assert.deepEqual(after.bookings,before.bookings,"Archiving altered booking history");
  assert.equal(after.offers.find(row => row.id === offer.json.data.id).status,"paused");
  assert.equal((await admin(`/api/admin/partners/${history.partner.id}`, {method:"PATCH",body:{status:"active"}})).status,200);
  assert.equal((await admin(`/api/admin/partners/${history.partner.id}/users`)).json.data[0].status,"disabled");
  assert.equal((await admin(`/api/admin/partners/${history.partner.id}/addresses`)).json.data[0].is_active,false);
  console.log("Admin partner list/archive/delete checks: PASS (isolated database)");
}
