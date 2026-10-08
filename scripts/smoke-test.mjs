import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPasswordHash, LEGACY_PASSWORD_ITERATIONS } from "../backend/utils/password.mjs";
import { todayDate } from "../backend/utils/dates.mjs";
import { validatePhone } from "../backend/utils/validation.mjs";
import { runPilotHardeningScenario } from "./pilot-hardening-scenario.mjs";
import { runClientPhotoChecks } from "./client-photo-checks.mjs";
import { runClientPhoneChecks } from "./client-phone-checks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FREEZE_CLOCK_MODULE = pathToFileURL(path.join(ROOT, "scripts", "freeze-clock.mjs")).href;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beri-smoke-"));
const dbFile = path.join(tempDir, "db.json");
const uploadDir = path.join(tempDir, "uploads");
const credentials = {
  preview: { user: "smoke-site", password: "smoke-site-password" }
};
const adminApp = { login: "smoke-admin-app", password: "smoke-admin-app-password" };
const adminHash = createPasswordHash(adminApp.password);
const seededPartnerPassword = crypto.randomBytes(18).toString("base64url");
const managerPassword = crypto.randomBytes(18).toString("base64url");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertFormsUsePost(markup, pageName) {
  const forms = markup.match(/<form\b[^>]*>/g) || [];
  assert(forms.length > 0, `${pageName} has no testable forms`);
  assert(forms.every((form) => /\smethod="post"/i.test(form)), `${pageName} contains a form that can expose submitted data in the URL`);
}

function cookieFrom(response) {
  return (response.headers["set-cookie"] || [""])[0];
}

function request(port, route, { method = "GET", body, auth = "preview", cookie, headers: extraHeaders = {}, confirmRequest = true } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && confirmRequest) {
      if (!headers["X-BS-Request"]) headers["X-BS-Request"] = "1";
      if (!headers.Origin) headers.Origin = `http://127.0.0.1:${port}`;
    }
    if (auth && credentials[auth]) {
      const value = `${credentials[auth].user}:${credentials[auth].password}`;
      headers.Authorization = `Basic ${Buffer.from(value).toString("base64")}`;
    }
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ hostname: "127.0.0.1", port, path: route, method, headers }, (res) => {
      const chunks = [];
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("Response aborted")));
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        const text = responseBody.toString("utf8");
        let json = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { ok: false, error: { code: "NON_JSON_RESPONSE", message: text.slice(0, 160) } };
        }
        resolve({ status: res.statusCode, json, text, body: responseBody, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("Request timed out")));
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function waitForServer(port, child, logs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Smoke server stopped early: ${logs.join("").slice(-500)}`);
    try {
      const response = await request(port, "/api/public/offers");
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Smoke server did not become ready");
}

async function runScenario(port) {
  assert(validatePhone("+7 (900) 123-45-67") === "+7 (900) 123-45-67", "Canonical Russian phone was changed unexpectedly");
  assert(validatePhone("8 900 123-45-67") === "+7 (900) 123-45-67", "Phone beginning with 8 was not normalized to +7");
  assert(validatePhone("9001234567") === "+7 (900) 123-45-67", "Ten-digit phone was not normalized to +7");
  let invalidPhoneRejected = false;
  try { validatePhone("+7 (900) 123"); } catch (error) { invalidPhoneRejected = error?.status === 400; }
  assert(invalidPhoneRejected, "Incomplete Russian phone was accepted");
  let nonNumericPhoneRejected = false;
  try { validatePhone("телефон 9001234567"); } catch (error) { nonNumericPhoneRejected = error?.status === 400; }
  assert(nonNumericPhoneRejected, "Phone with letters was accepted");

  const suffix = Date.now().toString(36);
  const health = await request(port, "/api/public/health");
  assert(
    health.status === 200
      && health.json.data?.status === "ready"
      && Object.keys(health.json.data).join(",") === "status",
    "Public health endpoint is unavailable or exposes unnecessary runtime metadata"
  );
  const manifest = await request(port, "/manifest.webmanifest", { auth: null });
  assert(manifest.status === 200 && manifest.json.display === "standalone" && manifest.json.scope === "/", "PWA manifest is unavailable or incomplete");
  assert(manifest.headers["content-type"]?.includes("application/manifest+json"), "PWA manifest has the wrong content type");
  const serviceWorker = await request(port, "/sw.js", { auth: null });
  assert(serviceWorker.status === 200 && serviceWorker.headers["service-worker-allowed"] === "/", "Service worker is unavailable at the application scope");
  assert(serviceWorker.text.includes("PRIVATE_PATH.test(url.pathname)") && serviceWorker.text.includes('request.method !== "GET"'), "Service worker private-data bypass is missing");
  const offlinePage = await request(port, "/offline.html", { auth: null });
  assert(offlinePage.status === 200 && offlinePage.text.includes("Сейчас нет соединения"), "Offline page is unavailable");
  assert(!/<style\b|\son[a-z]+\s*=/i.test(offlinePage.text), "Offline page contains inline code blocked by the Content Security Policy");
  const offlineCss = await request(port, "/offline.css", { auth: null });
  assert(offlineCss.status === 200 && offlineCss.headers["content-type"]?.includes("text/css"), "Offline stylesheet is unavailable");
  const offlineScript = await request(port, "/offline.js", { auth: null });
  assert(offlineScript.status === 200 && offlineScript.headers["content-type"]?.includes("text/javascript"), "Offline script is unavailable");
  const publicScript = await request(port, "/public.js", { auth: null });
  assert(publicScript.status === 200 && publicScript.headers["content-type"]?.includes("text/javascript"), "Public browser script is unavailable");
  assert(publicScript.text.includes("setupRussianPhoneInputs") && publicScript.text.includes("data-russian-phone"), "Russian phone mask is missing from the public browser script");
  const appScript = await request(port, "/app.js", { auth: null });
  assert(appScript.status === 200 && appScript.text.includes("setupPasswordVisibility") && appScript.text.includes("data-password-toggle"), "Password visibility controls are missing from the application script");
  new Script(publicScript.text, { filename: "served-public.js" });
  runClientPhoneChecks(publicScript.text);
  new Script(appScript.text, { filename: "served-app.js" });
  await runClientPhotoChecks(appScript.text);
  const presentationSource = publicScript.text.match(/function publicBookingPresentation\([\s\S]*?(?=\n  var bookingPageRoot)/)?.[0];
  assert(presentationSource, "Status-specific booking presentation is missing");
  const presentation = new Script(presentationSource + "; publicBookingPresentation;").runInNewContext();
  assert(presentation("created").helpHtml.includes("Оплатите набор в магазине") && presentation("created").priceLabel === "К оплате", "Active booking lost pickup instructions");
  for (const status of ["issued", "no_show", "cancelled"]) {
    const view = presentation(status);
    assert(!view.helpHtml.includes("Приходите") && !view.helpHtml.includes("Оплатите") && !view.helpHtml.includes("Покажите код"), "Completed booking still asks for pickup: " + status);
    assert(view.priceLabel === "Цена в брони" && view.priceSuffix === " ₽" && !view.caption.includes("Оплата"), "Completed booking invents an amount still owed");
  }
  assert(!presentation("issued").helpHtml.includes("Оплачено"), "Handover is presented as verified payment");
  const auditLabelsSource = appScript.text.match(/const STATUS_LABELS[\s\S]*?(?=\nfunction auditActorLabel)/)?.[0];
  const escapeSource = appScript.text.match(/function escapeHtml\([\s\S]*?(?=\nasync function api)/)?.[0];
  const tableSource = appScript.text.match(/function table\([\s\S]*?(?=\nfunction applyTableFilter)/)?.[0];
  const actorLabelsSource = appScript.text.match(/function auditActorLabel\([\s\S]*?(?=\nfunction dateTimeLabel)/)?.[0];
  assert(auditLabelsSource && escapeSource && tableSource, "Audit presentation helpers are missing");
  assert(actorLabelsSource, "Audit actor presentation is missing");
  const auditView = new Script(auditLabelsSource + actorLabelsSource + escapeSource + tableSource + "; ({ auditDetailsLabel, auditActionLabel, auditEntityLabel, auditActorNameLabel, table });").runInNewContext();
  assert(auditView.auditActorNameLabel({actorRole: "partner", actorName: "Тестовый продавец"}) === "Тестовый продавец", "Staff name is not shown");
  assert(auditView.auditActorNameLabel({actorRole: "partner", actorName: null}) === "Сотрудник не указан", "Old audit row invents a staff name");
  const actorMarkup = auditView.table([{actorName: '<img src=x onerror="alert(1)">'}], [{label: "Кто выполнил", value: auditView.auditActorNameLabel}]);
  assert(!actorMarkup.includes("<img") && actorMarkup.includes("&lt;img"), "Audit actor name can inject markup");
  const auditDetails = auditView.auditDetailsLabel({ previousStatus: "issued", status: "no_show", reason: '<img src=x onerror="alert(1)">' });
  assert(auditDetails.startsWith("Выдано → Не пришёл. Причина:"), "Audit status correction is not explained in human language");
  assert(auditView.auditDetailsLabel({ status: "closed" }) === "Новый статус: Закрыто", "Contact status was lost from the audit");
  assert(auditView.auditActionLabel("patch_contactRequests") === "Изменён статус обращения", "Contact actions still have generic labels");
  const renderedAudit = auditView.table([{ detail: auditDetails }], [{ label: "Подробности", value: "detail" }]);
  assert(!renderedAudit.includes("<img") && renderedAudit.includes("&lt;img"), "Audit reasons can inject markup into the table");
  const confirmationSource = appScript.text.match(/function confirmRiskyAction\([\s\S]*?(?=\nfunction trapAppFocus)/)?.[0];
  assert(confirmationSource, "Two-step confirmation helper is missing");
  const confirmationTimers = [];
  const confirmAction = new Script(confirmationSource + "; confirmRiskyAction;").runInNewContext({
    notify: () => {}, window: { setTimeout: (callback) => confirmationTimers.push(callback) }
  });
  const confirmationButton = {
    dataset: { confirmLabel: "BS-1234: Не пришёл?" }, textContent: "Сохранить корректировку", isConnected: true,
    hasAttribute: () => false, classList: { add: () => {}, remove: () => {} }
  };
  assert(confirmAction(confirmationButton) === true, "Unmarked ordinary buttons changed behavior");
  assert(confirmAction(confirmationButton, true) === false, "First correction click executed immediately");
  assert(confirmationButton.textContent === "BS-1234: Не пришёл?", "Confirmation lost the specific booking code");
  assert(confirmAction(confirmationButton, true) === true, "Second correction click did not execute");
  assert(!confirmationButton.dataset.confirmed && confirmationButton.textContent === "Сохранить корректировку", "Confirmation state was not cleared");
  assert(confirmAction(confirmationButton, true) === false, "Next correction did not require a new confirmation");
  confirmationTimers.at(-1)();
  assert(!confirmationButton.dataset.confirmed, "Expired confirmation remained armed");
  assert(appScript.text.includes("confirmRiskyAction(button, true)"), "Correction form bypasses forced confirmation");
  const filterSource = appScript.text.match(/function applyTableFilter\([\s\S]*?(?=\nfunction setupTableFilters)/)?.[0];
  const filterRows = [
    { dataset: {filterStatus:"Забронировано"}, textContent:"BS-1234 Выдан Не пришёл Отменить", hidden:false },
    { dataset: {filterStatus:"Выдано"}, textContent:"BS-5678 Выдано", hidden:false }
  ];
  const filterEmpty = {hidden:true};
  const applyFilter = new Script(filterSource + "; applyTableFilter;").runInNewContext({document:{querySelector:()=>({querySelectorAll:()=>filterRows,querySelector:()=>filterEmpty})}});
  const group={dataset:{filterTarget:"bookings"},querySelector:(selector)=>({value:selector.includes("query")?"":"Выдано"})};
  applyFilter(group);
  assert(filterRows[0].hidden && !filterRows[1].hidden, "Booking filter matches action buttons instead of actual status");
  group.querySelector=(selector)=>({value:selector.includes("query")?"BS-1234":""});
  applyFilter(group);
  assert(!filterRows[0].hidden && filterRows[1].hidden, "Booking card code search failed");
  assert(appScript.text.includes('button[data-close-record-dialog]') && appScript.text.includes('recordOpener.focus') && appScript.text.includes('event.key === "Escape"'), "Record dialog close/focus behavior regressed");
  assert(appScript.text.includes('if (mutationInFlight) return;') && appScript.text.includes('Действие выполнено, но список не обновился'), "Admin retry feedback or duplicate-save protection missing");
  const pwaIcon = await request(port, "/icons/icon-192.png", { auth: null });
  assert(pwaIcon.status === 200 && pwaIcon.headers["content-type"] === "image/png", "PWA icon is unavailable");
  const assetLinks = await request(port, "/.well-known/assetlinks.json", { auth: null });
  assert(assetLinks.status === 200 && assetLinks.json[0]?.target?.package_name === "ru.berisegodnya.app", "Android Digital Asset Links are unavailable");
  const publicGate = await request(port, "/", { auth: null });
  assert(publicGate.status === 401, "Public preview must remain behind Basic Auth");
  const privatePageConfig = await request(port, "/page-config.js", { auth: null });
  assert(privatePageConfig.status === 401, "Page data configuration bypassed preview access control");
  const pageConfig = await request(port, "/page-config.js");
  assert(pageConfig.status === 200 && pageConfig.text.includes("window.PUBLIC_CONFIG="), "Page data configuration is unavailable");
  const publicHome = await request(port, "/");
  assert(publicHome.status === 200, "Public home did not render");
  const contentSecurityPolicy = publicHome.headers["content-security-policy"] || "";
  assert(contentSecurityPolicy.includes("form-action 'self'") && !contentSecurityPolicy.includes("unsafe-inline"), "HTML Content Security Policy permits unsafe inline code or unrestricted forms");
  for (const header of ["cross-origin-embedder-policy", "cross-origin-opener-policy", "cross-origin-resource-policy", "origin-agent-cluster"]) {
    assert(publicHome.headers[header], `HTML security header is missing: ${header}`);
  }
  assertFormsUsePost(publicHome.text, "Public home");
  assert(publicHome.text.includes('role="dialog" aria-modal="true" aria-label="Карточка предложения"'), "Offer dialog semantics are missing");
  assert(publicHome.text.includes('aria-label="Закрыть форму бронирования"'), "Booking dialog close button has no accessible label");
  assert(publicHome.text.includes('rel="manifest" href="/manifest.webmanifest"') && publicHome.text.includes('class="footer-app-status" href="/android"') && publicHome.text.includes('href="/android">Приложение</a>') && publicHome.text.includes('class="button button-outline home-app-button" href="/android">Скачать приложение</a>') && !publicHome.text.includes("Приложение в разработке") && !publicHome.text.includes('data-pwa-install'), "Android application links or PWA status are inconsistent");
  assert(publicHome.text.includes('class="offer-row-mobile-pickup"'), "Mobile pickup window is missing from offer rows");
  assert(publicHome.text.includes("Пример брони"), "Synthetic booking preview is not identified as an example");
  assert(!publicHome.text.includes("Фото сделано сегодня") && !publicHome.text.includes("Фото сегодня"), "Public home claims that a photo was made today without evidence");
  const publicStyles = await request(port, "/styles.css", { auth: null });
  assert(publicStyles.status === 200 && publicStyles.text.includes("scroll-margin-top: 92px"), "Sticky-header anchor offset is missing");
  const partnersPage = await request(port, "/partners");
  assert(partnersPage.status === 200 && partnersPage.text.includes("Пример интерфейса"), "Synthetic partner dashboard is not identified as an example");
  assert(partnersPage.text.includes('placeholder="Название заведения"') && partnersPage.text.includes('placeholder="Улица и номер дома"'), "Partner application is missing neutral field hints");
  assert(!partnersPage.text.includes("Например: Заведение 1") && !partnersPage.text.includes("Например: ул. Тестовая, 1"), "Old partner application examples are still rendered");
  const androidPage = await request(port, "/android");
  assert(androidPage.status === 200 && androidPage.text.includes("Приложение «Бери сегодня»") && androidPage.text.includes('src="/icons/android-download-qr.svg"') && androidPage.text.includes('href="/downloads/beri-segodnya-android-0.1.0-pilot.apk"') && androidPage.text.includes("Скачать приложение"), "Android download page is unavailable or incomplete");
  for (const technicalCopy of ["Официальная тестовая сборка", "Версия 0.1.0-pilot", "Проверить SHA-256", "Как установить приложение", "Что важно знать"]) {
    assert(!androidPage.text.includes(technicalCopy), `Android download page still exposes technical copy: ${technicalCopy}`);
  }
  const publishedApk = await request(port, "/downloads/beri-segodnya-android-0.1.0-pilot.apk");
  assert(publishedApk.status === 200 && publishedApk.headers["content-type"] === "application/vnd.android.package-archive", "Published APK is unavailable or has the wrong content type");
  assert(publishedApk.headers["content-disposition"] === 'attachment; filename="beri-segodnya-android-0.1.0-pilot.apk"' && publishedApk.body.length > 1024 * 1024, "Published APK download headers or body are invalid");
  const publishedChecksum = await request(port, "/downloads/beri-segodnya-android-0.1.0-pilot.apk.sha256");
  assert(publishedChecksum.status === 200 && publishedChecksum.text.trim() === `${sha256(publishedApk.body)}  beri-segodnya-android-0.1.0-pilot.apk`, "Published APK checksum endpoint is inconsistent");
  const injectionMarker = `<img src=x onerror=alert-${suffix}>`;
  const reflectedQuery = await request(port, `/contacts?type=${encodeURIComponent(injectionMarker)}`);
  assert(reflectedQuery.status === 200 && !reflectedQuery.text.includes(injectionMarker), "Query input was reflected into public HTML");
  const reflectedBody = await request(port, "/contacts", {
    method: "POST",
    body: { type: injectionMarker, name: injectionMarker }
  });
  assert(reflectedBody.status === 200 && !reflectedBody.text.includes(injectionMarker), "Form body input was reflected into public HTML");
  const unknownPublicAction = await request(port, "/api/public/not-a-real-action");
  assert(
    unknownPublicAction.status === 404
      && !/(?:API|endpoint|JSON|undefined|null)/i.test(unknownPublicAction.json.error.message),
    "Unknown actions expose technical text"
  );
  const adminPage = await request(port, "/admin", { auth: null });
  assert(adminPage.status === 200, "Admin login page must open without a second Basic Auth prompt");
  assertFormsUsePost(adminPage.text, "Admin page");
  assert(!adminPage.text.includes("Тестовая кулинария") && !adminPage.text.includes("По регламенту"), "Admin still exposes test copy or unverified backup status");
  for (const attr of ["data-admin-create-offer", "data-admin-create-address", "data-admin-create-user", "data-admin-reset-user-password"]) {
    const body = adminPage.text.match(new RegExp("<form[^>]*" + attr + ">([\\s\\S]*?)</form>"))?.[1];
    assert(body && !body.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g, "").match(/<(?:input|select)\b[^>]*name=/), attr + " has an unlabelled field");
  }
  const partnerLoginPage = await request(port, "/partner/login", { auth: null });
  assert(partnerLoginPage.status === 200, "Partner login page must open without a second Basic Auth prompt");
  assertFormsUsePost(partnerLoginPage.text, "Partner page");
  const partnerDashboardPage = await request(port, "/partner/dashboard", { auth: null });
  assert(partnerDashboardPage.status === 200, "Partner dashboard shell is unavailable");
  const photoInputs = partnerDashboardPage.text.match(/<input\b[^>]*data-wizard-photo-input[^>]*>/g) || [];
  assert(photoInputs.length === 2, "Camera and file selection need separate controls");
  const cameraInput = photoInputs.find(input => /capture="environment"/.test(input));
  const fileInput = photoInputs.find(input => !/\scapture=/.test(input));
  assert(cameraInput?.includes('aria-label="Сделать фото"') && !/\smultiple\b/.test(cameraInput), "Camera control is not single-capture or labelled");
  assert(fileInput?.includes('aria-label="Выбрать фото"') && /\smultiple\b/.test(fileInput), "Ready photos still force camera access or cannot be selected together");
  assert(appScript.text.includes('wizard.querySelectorAll("[data-wizard-photo-input]").forEach((input) => input.addEventListener("change"'), "Only one photo source is wired to preparation");
  const passwordInputCount = [adminPage.text, partnerLoginPage.text, partnerDashboardPage.text]
    .reduce((count, markup) => count + (markup.match(/type="password"/g) || []).length, 0);
  assert(passwordInputCount === 14, `Expected 14 password inputs to receive visibility controls, found ${passwordInputCount}`);
  const anonymousAdminMe = await request(port, "/api/admin/auth/me", { auth: "adminBasic" });
  assert(anonymousAdminMe.status === 200 && anonymousAdminMe.json.data.authenticated === false, "Anonymous admin session probe failed");
  const anonymousPartnerMe = await request(port, "/api/partner/auth/me", { auth: "partnerBasic" });
  assert(anonymousPartnerMe.status === 200 && anonymousPartnerMe.json.data.authenticated === false, "Anonymous partner session probe failed");
  const adminGate = await request(port, "/api/admin/dashboard", { auth: "adminBasic" });
  assert(adminGate.status === 401, "Admin dashboard must require app session");
  assert((await request(port, "/api/admin/audit-log", { auth: "adminBasic" })).status === 401, "Anonymous visitor can read the audit log");

  const adminLogin = await request(port, "/api/admin/auth/login", {
    auth: "adminBasic",
    method: "POST",
    body: adminApp
  });
  assert(adminLogin.status === 200 && adminLogin.json.ok && adminLogin.json.data.passwordChangeRequired === true && cookieFrom(adminLogin), "Admin app login or first-login password gate failed");
  let adminCookie = cookieFrom(adminLogin);
  const adminMe = await request(port, "/api/admin/auth/me", { auth: "adminBasic", cookie: adminCookie });
  assert(adminMe.status === 200 && adminMe.json.data.authenticated === true && adminMe.json.data.passwordChangeRequired === true, "Admin session probe failed");
  assert(adminMe.json.data.login === adminApp.login && Object.keys(adminMe.json.data).sort().join(",") === "authenticated,login,passwordChangeRequired,role", "Admin session identity missing or unsafe fields exposed");
  const gatedAdminDashboard = await request(port, "/api/admin/dashboard", { auth: "adminBasic", cookie: adminCookie });
  assert(gatedAdminDashboard.status === 403 && gatedAdminDashboard.json.error.code === "PASSWORD_CHANGE_REQUIRED", "Admin bypassed required password change");
  const changedAdminPassword = "smoke-admin-permanent-password";
  const adminPasswordChange = await request(port, "/api/admin/auth/change-password", {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "POST",
    body: { currentPassword: adminApp.password, newPassword: changedAdminPassword, confirmPassword: changedAdminPassword }
  });
  assert(adminPasswordChange.status === 200 && cookieFrom(adminPasswordChange), "Admin password change failed");
  adminCookie = cookieFrom(adminPasswordChange);
  const partnersForDeletion = await request(port, "/api/admin/partners", { auth: "adminBasic", cookie: adminCookie });
  assert(partnersForDeletion.json.data.every((row) => row.canDelete === false), "Partners with offer history must not have deletion enabled");
  const safeAuditLog = await request(port, "/api/admin/audit-log", { auth: "adminBasic", cookie: adminCookie });
  assert(safeAuditLog.status === 200 && safeAuditLog.json.data.length > 0, "Admin audit log is unavailable");
  assert(safeAuditLog.json.data.every((row) => row.actorRole && row.action && row.entityType && row.createdAt && !row.metadata_json && !row.entity_id && !row.actor_id), "Admin audit log exposes unsafe internal fields");
  assert(safeAuditLog.json.data.every((row) => Object.keys(row).sort().join(",") === "action,actorName,actorRole,createdAt,entityType,previousStatus,reason,referenceLabel,status"), "Audit DTO contains unapproved fields");

  const onboarded = await request(port, "/api/admin/partners/onboard", {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "POST",
    body: {
      partnerName: `Тестовое подключение ${suffix}`,
      partnerType: "culinary",
      contactName: "Тестовый владелец",
      phone: "+7 900 000-00-00",
      email: "owner@example.test",
      addressTitle: "Основная точка",
      city: "Армавир",
      address: "Армавир, тестовый адрес",
      userName: "Тестовый владелец",
      login: `onboard-${suffix}`,
      password: "onboard-preview"
    }
  });
  assert(onboarded.status === 201 && onboarded.json.ok, "Atomic partner onboarding failed");
  assert(onboarded.json.data.partner.id && onboarded.json.data.address.partner_id === onboarded.json.data.partner.id, "Onboarding address is not linked to partner");
  assert(onboarded.json.data.user.partner_id === onboarded.json.data.partner.id && !onboarded.json.data.user.password_hash, "Onboarding user is unsafe or not linked");

  const createdPartner = await request(port, "/api/admin/partners", {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "POST",
    body: { name: `Тестовый партнёр ${suffix}`, type: "other", status: "active" }
  });
  assert(createdPartner.status === 201 && createdPartner.json.ok, "Admin create partner failed");

  const address = await request(port, `/api/admin/partners/${createdPartner.json.data.id}/addresses`, {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "POST",
    body: { title: "Тестовая точка", city: "Армавир", address: "Армавир, тестовый адрес" }
  });
  assert(address.status === 201 && address.json.ok, "Admin create address failed");

  const user = await request(port, `/api/admin/partners/${createdPartner.json.data.id}/users`, {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "POST",
    body: { name: "Тестовый пользователь", login: `smoke-${suffix}`, password: managerPassword, role: "manager", status: "active" }
  });
  assert(user.status === 201 && user.json.ok && !user.json.data.password_hash, "Admin create partner user failed");

  const managerSessionBeforeReset = await request(port, "/api/partner/auth/login", {
    auth: "partnerBasic",
    method: "POST",
    body: { login: `smoke-${suffix}`, password: managerPassword }
  });
  assert(managerSessionBeforeReset.status === 200 && cookieFrom(managerSessionBeforeReset), "Manager pre-reset login failed");
  const resetManagerPassword = "smoke-manager-reset-password";
  const resetManager = await request(port, `/api/admin/partners/${createdPartner.json.data.id}/users/${user.json.data.id}`, {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "PATCH",
    body: { password: resetManagerPassword }
  });
  assert(resetManager.status === 200 && resetManager.json.data.must_change_password === true && !resetManager.json.data.password_hash, "Admin password reset failed or exposed credentials");
  const revokedManagerSessionAfterReset = await request(port, "/api/partner/auth/me", { auth: "partnerBasic", cookie: cookieFrom(managerSessionBeforeReset) });
  assert(revokedManagerSessionAfterReset.status === 200 && revokedManagerSessionAfterReset.json.data.authenticated === false, "Password reset did not revoke the previous manager session");
  const oldManagerPassword = await request(port, "/api/partner/auth/login", {
    auth: "partnerBasic",
    method: "POST",
    body: { login: `smoke-${suffix}`, password: managerPassword }
  });
  assert(oldManagerPassword.status === 401, "Old manager password remained valid after reset");
  const resetManagerLogin = await request(port, "/api/partner/auth/login", {
    auth: "partnerBasic",
    method: "POST",
    body: { login: `smoke-${suffix}`, password: resetManagerPassword }
  });
  assert(resetManagerLogin.status === 200 && resetManagerLogin.json.data.passwordChangeRequired === true, "Reset manager password did not require first-login rotation");

  const offer = await request(port, "/api/admin/offers", {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "POST",
    body: {
      partnerId: createdPartner.json.data.id,
      addressId: address.json.data.id,
      title: `Тестовое предложение ${suffix}`,
      category: "lunch",
      price: 199,
      oldPrice: 399,
      pickupWindow: "00:00–23:59",
      totalQuantity: 2,
      remainingQuantity: 2,
      status: "active",
      ctaLabel: "Получить код"
    }
  });
  assert(offer.status === 201 && offer.json.ok, "Admin create offer failed");

  const publicOffers = await request(port, "/api/public/offers");
  assert(publicOffers.status === 200 && publicOffers.json.data.some((item) => item.id === offer.json.data.id), "Public offer missing");
  assert(publicOffers.headers["content-security-policy"]?.includes("default-src 'none'"), "JSON responses have no restrictive Content Security Policy");
  assert(publicOffers.headers["cross-origin-resource-policy"] === "same-origin", "JSON responses have no same-origin resource policy");

  const booking = await request(port, "/api/public/bookings", {
    method: "POST",
    body: { offerId: offer.json.data.id, customerName: "Тест", customerPhone: "+7 900 000-00-00", personalDataConsent: true }
  });
  assert(booking.status === 201 && /^BS-\d{4}$/.test(booking.json.data.code), "Public booking failed");
  assert(booking.json.data.publicToken && booking.json.data.bookingUrl, "Persistent booking link missing");

  const bookingView = await request(port, `/api/public/bookings/${booking.json.data.publicToken}`);
  assert(bookingView.status === 200 && bookingView.json.data.code === booking.json.data.code, "Public booking view failed");

  const offerAfterBooking = (await request(port, "/api/public/offers")).json.data.find((item) => item.id === offer.json.data.id);
  assert(offerAfterBooking?.remaining === 1, "Offer quantity was not decremented");

  const cancelled = await request(port, `/api/public/bookings/${booking.json.data.publicToken}/cancel`, { method: "POST" });
  assert(cancelled.status === 200 && cancelled.json.ok, "Public booking cancellation failed");
  const offerAfterCancel = (await request(port, "/api/public/offers")).json.data.find((item) => item.id === offer.json.data.id);
  assert(offerAfterCancel?.remaining === 2, "Cancelled booking did not restore quantity");

  const application = await request(port, "/api/public/partner-applications", {
    method: "POST",
    body: { venueName: `Тестовая заявка ${suffix}`, venueType: "other", city: "Армавир", firstAddress: "Армавир, тестовый адрес", contactName: "Тест", phone: "+7 900 000-00-00", email: "test@example.test", offerFormats: ["Готовые обеды"], locationsCount: "1", comment: "Изолированный smoke test", personalDataConsent: true, partnerTermsConsent: true }
  });
  assert(application.status === 201 && application.json.ok, "Partner application failed");

  const contact = await request(port, "/api/public/contact-requests", {
    method: "POST",
    body: { name: "Тест", phone: "+7 900 000-00-00", email: "test@example.test", type: "service_question", message: "Изолированный smoke test", personalDataConsent: true }
  });
  assert(contact.status === 201 && contact.json.ok, "Contact request failed");
  const contactStatusChange = await request(port, `/api/admin/contact-requests/${contact.json.data.id}/status`, { auth: "adminBasic", cookie: adminCookie, method: "PATCH", body: { status: "in_progress" } });
  assert(contactStatusChange.status === 200, "Admin contact status change failed");
  const contactAudit = (await request(port, "/api/admin/audit-log", { auth: "adminBasic", cookie: adminCookie })).json.data.find((row) => row.action === "patch_contactRequests" && row.referenceLabel === "Тест");
  assert(contactAudit?.entityType === "contact_request" && contactAudit.status === "in_progress" && contactAudit.previousStatus === null && contactAudit.reason === null, "Contact audit lost safe context or invented a previous status");

  const partnerLogin = await request(port, "/api/partner/auth/login", {
    auth: "partnerBasic",
    method: "POST",
    body: { login: "partner1", password: seededPartnerPassword }
  });
  assert(partnerLogin.status === 200 && partnerLogin.json.ok && partnerLogin.json.data.passwordChangeRequired === true && cookieFrom(partnerLogin), "Partner login or first-login password gate failed");
  let partnerCookie = cookieFrom(partnerLogin);
  const partnerMe = await request(port, "/api/partner/auth/me", { auth: "partnerBasic", cookie: partnerCookie });
  assert(partnerMe.status === 200 && partnerMe.json.data.authenticated === true && partnerMe.json.data.passwordChangeRequired === true, "Partner session probe failed");
  const gatedPartnerProfile = await request(port, "/api/partner/profile", { auth: "partnerBasic", cookie: partnerCookie });
  assert(gatedPartnerProfile.status === 403 && gatedPartnerProfile.json.error.code === "PASSWORD_CHANGE_REQUIRED", "Partner bypassed required password change");
  const changedPartnerPassword = "smoke-partner-permanent-password";
  const partnerPasswordChange = await request(port, "/api/partner/auth/change-password", {
    auth: "partnerBasic",
    cookie: partnerCookie,
    method: "POST",
    body: { currentPassword: seededPartnerPassword, newPassword: changedPartnerPassword, confirmPassword: changedPartnerPassword }
  });
  assert(partnerPasswordChange.status === 200 && cookieFrom(partnerPasswordChange), "Partner password change failed");
  partnerCookie = cookieFrom(partnerPasswordChange);
  const partnerIntoAdmin = await request(port, "/api/admin/dashboard", { auth: null, cookie: partnerCookie });
  assert(partnerIntoAdmin.status === 403, "Partner session gained access to admin API");
  const adminIntoPartner = await request(port, "/api/partner/profile", { auth: null, cookie: adminCookie });
  assert(adminIntoPartner.status === 403, "Admin session was accepted as a partner session");

  const legacyManagerCredentials = createPasswordHash(managerPassword, LEGACY_PASSWORD_ITERATIONS);
  const beforeLegacyLogin = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  const legacyManager = beforeLegacyLogin.partnerUsers.find((item) => item.id === user.json.data.id);
  Object.assign(legacyManager, {
    password_hash: legacyManagerCredentials.hash,
    password_salt: legacyManagerCredentials.salt,
    password_iterations: legacyManagerCredentials.iterations,
    must_change_password: true
  });
  fs.writeFileSync(dbFile, `${JSON.stringify(beforeLegacyLogin, null, 2)}\n`, { mode: 0o600 });

  const managerLogin = await request(port, "/api/partner/auth/login", {
    auth: "partnerBasic",
    method: "POST",
    body: { login: `smoke-${suffix}`, password: managerPassword }
  });
  assert(managerLogin.status === 200 && managerLogin.json.data.userRole === "manager" && managerLogin.json.data.passwordChangeRequired === true, "Manager login, role exposure, or first-login password gate failed");
  let managerCookie = cookieFrom(managerLogin);
  const changedManagerPassword = "smoke-manager-permanent-password";
  const managerPasswordChange = await request(port, "/api/partner/auth/change-password", {
    auth: "partnerBasic",
    cookie: managerCookie,
    method: "POST",
    body: { currentPassword: managerPassword, newPassword: changedManagerPassword, confirmPassword: changedManagerPassword }
  });
  assert(managerPasswordChange.status === 200 && cookieFrom(managerPasswordChange), "Manager password change failed");
  managerCookie = cookieFrom(managerPasswordChange);
  const managerProfile = await request(port, "/api/partner/profile", { auth: "partnerBasic", cookie: managerCookie });
  assert(managerProfile.status === 200, "Manager lost read access to partner profile");
  const forbiddenManagerProfilePatch = await request(port, "/api/partner/profile", {
    auth: "partnerBasic",
    cookie: managerCookie,
    method: "PATCH",
    body: { name: "Недопустимое изменение" }
  });
  assert(forbiddenManagerProfilePatch.status === 403 && forbiddenManagerProfilePatch.json.error.code === "PARTNER_PERMISSION_DENIED", "Manager changed owner-only partner profile");
  const forbiddenManagerAddress = await request(port, "/api/partner/addresses", {
    auth: "partnerBasic",
    cookie: managerCookie,
    method: "POST",
    body: { title: "Недопустимая точка", city: "Армавир", address: "Армавир, тестовый адрес" }
  });
  assert(forbiddenManagerAddress.status === 403 && forbiddenManagerAddress.json.error.code === "PARTNER_PERMISSION_DENIED", "Manager changed owner-only addresses");
  const managerOffers = await request(port, "/api/partner/offers", { auth: "partnerBasic", cookie: managerCookie });
  assert(managerOffers.status === 200, "Manager lost operational offer access");
  const disabledManager = await request(port, `/api/admin/partners/${createdPartner.json.data.id}/users/${user.json.data.id}`, {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "PATCH",
    body: { status: "disabled" }
  });
  assert(disabledManager.status === 200 && disabledManager.json.data.status === "disabled", "Admin could not disable manager");
  const revokedManagerSession = await request(port, "/api/partner/profile", { auth: "partnerBasic", cookie: managerCookie });
  assert(revokedManagerSession.status === 401, "Disabled manager session remained active");

  for (const route of ["/api/partner/auth/me", "/api/partner/dashboard", "/api/partner/profile", "/api/partner/addresses", "/api/partner/offers", "/api/partner/bookings"]) {
    const response = await request(port, route, { auth: "partnerBasic", cookie: partnerCookie });
    assert(response.status === 200 && response.json.ok, `${route} failed`);
  }

  const ownOffers = await request(port, "/api/partner/offers", { auth: "partnerBasic", cookie: partnerCookie });
  assert(ownOffers.json.data.every((item) => item.partner_id === "partner-1"), "Partner can see another partner's offers");
  const ownOffer = ownOffers.json.data[0];
  const protectedPatch = await request(port, `/api/partner/offers/${ownOffer.id}`, {
    auth: "partnerBasic",
    cookie: partnerCookie,
    method: "PATCH",
    body: { partner_id: "partner-2", address_id: "partner-2-address-1", title: "Обновлённое тестовое предложение" }
  });
  assert(protectedPatch.status === 200 && protectedPatch.json.data.partner_id === "partner-1", "Partner changed protected ownership fields");

  const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const upload = await request(port, "/api/partner/uploads", {
    auth: "partnerBasic",
    cookie: partnerCookie,
    method: "POST",
    body: { images: [{ dataUrl: onePixelPng, capturedAt: new Date().toISOString() }] }
  });
  assert(upload.status === 201 && upload.json.data.images.length === 1, "Partner photo upload failed");
  const uploadedUrl = upload.json.data.images[0].url;
  assert(uploadedUrl.startsWith("/uploads/partner-1/"), "Uploaded photo is not scoped to partner folder");
  const uploadedPath = path.join(uploadDir, "partner-1", path.basename(uploadedUrl));
  assert(fs.existsSync(uploadedPath), "Uploaded photo was not persisted on server disk");
  const protectedAsset = await request(port, uploadedUrl, { auth: null });
  assert(protectedAsset.status === 401, "Uploaded photo bypassed preview access gate");
  const partnerAsset = await request(port, uploadedUrl, { auth: null, cookie: partnerCookie });
  assert(partnerAsset.status === 200, "Partner could not read uploaded photo");
  const foreignFolder = path.join(uploadDir, "partner-2");
  fs.mkdirSync(foreignFolder, { recursive: true });
  const foreignAssetPath = path.join(foreignFolder, path.basename(uploadedUrl));
  fs.copyFileSync(uploadedPath, foreignAssetPath);
  const foreignAsset = await request(port, `/uploads/partner-2/${path.basename(uploadedUrl)}`, { auth: null, cookie: partnerCookie });
  assert(foreignAsset.status === 401, "Partner session could read another partner's uploaded photo");

  const photoOffer = await request(port, "/api/partner/offers", {
    auth: "partnerBasic",
    cookie: partnerCookie,
    method: "POST",
    body: {
      addressId: "partner-1-address-1",
      title: `Фото-набор ${suffix}`,
      category: "lunch",
      description: "Изолированная проверка фото-публикации",
      contents: "Тестовый состав",
      price: 199,
      oldPrice: 299,
      pickupWindow: "00:00–23:59",
      totalQuantity: 3,
      remainingQuantity: 3,
      status: "active",
      date: todayDate(),
      imageUrls: [uploadedUrl],
      photoCapturedAt: new Date().toISOString(),
      sourceType: "quick_photo"
    }
  });
  assert(photoOffer.status === 201 && photoOffer.json.data.image_urls[0] === uploadedUrl, "Photo offer creation failed");
  const photoPublic = (await request(port, "/api/public/offers")).json.data.find((item) => item.id === photoOffer.json.data.id);
  assert(photoPublic?.imageUrls?.[0] === uploadedUrl && photoPublic.sourceType === "quick_photo", "Photo offer is missing from public API");

  const template = await request(port, "/api/partner/offer-templates", {
    auth: "partnerBasic",
    cookie: partnerCookie,
    method: "POST",
    body: {
      addressId: "partner-1-address-1",
      title: `Шаблон ${suffix}`,
      category: "lunch",
      description: "Шаблон smoke-test",
      contents: "Тестовый состав",
      price: 199,
      oldPrice: 299,
      pickupWindow: "00:00–23:59",
      totalQuantity: 3,
      imageUrls: [uploadedUrl]
    }
  });
  assert(template.status === 201 && template.json.data.partner_id === "partner-1", "Partner template creation failed");
  const templates = await request(port, "/api/partner/offer-templates", { auth: "partnerBasic", cookie: partnerCookie });
  assert(templates.status === 200 && templates.json.data.some((item) => item.id === template.json.data.id), "Partner template list failed");

  const foreignImage = await request(port, "/api/partner/offers", {
    auth: "partnerBasic",
    cookie: partnerCookie,
    method: "POST",
    body: {
      addressId: "partner-1-address-1",
      title: "Чужое фото",
      category: "lunch",
      price: 199,
      pickupWindow: "00:00–23:59",
      totalQuantity: 1,
      status: "active",
      imageUrls: ["/uploads/partner-2/00000000-0000-0000-0000-000000000000.jpg"],
      sourceType: "quick_photo"
    }
  });
  assert(foreignImage.status === 403 && foreignImage.json.error.code === "IMAGE_ACCESS_DENIED", "Partner could use another partner's uploaded image");

  const invalidOffer = await request(port, "/api/admin/offers", {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "POST",
    body: {
      partnerId: createdPartner.json.data.id,
      addressId: address.json.data.id,
      title: "Некорректный интервал",
      category: "lunch",
      price: 150,
      pickupWindow: "вечером",
      totalQuantity: 1,
      status: "active"
    }
  });
  assert(invalidOffer.status === 400 && invalidOffer.json.error.code === "INVALID_PICKUP_WINDOW", "Pickup window validation failed");

  const staleDate = new Date();
  staleDate.setUTCDate(staleDate.getUTCDate() - 2);
  const staleOffer = await request(port, "/api/admin/offers", {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "POST",
    body: {
      partnerId: createdPartner.json.data.id,
      addressId: address.json.data.id,
      title: "Предложение прошлой даты",
      category: "lunch",
      price: 150,
      pickupWindow: "00:00–23:59",
      totalQuantity: 1,
      remainingQuantity: 1,
      date: todayDate(staleDate),
      status: "active"
    }
  });
  assert(staleOffer.status === 201 && staleOffer.json.ok, "Stale offer fixture was not created");
  const currentPublicOffers = await request(port, "/api/public/offers");
  assert(!currentPublicOffers.json.data.some((item) => item.id === staleOffer.json.data.id), "Stale offer leaked into public API");

  const missingConfirmation = await request(port, "/api/public/contact-requests", {
    method: "POST",
    confirmRequest: false,
    body: { name: "Тест", phone: "+7 900 000-00-00", type: "other", message: "Нет подтверждающего заголовка", personalDataConsent: true }
  });
  assert(missingConfirmation.status === 403 && missingConfirmation.json.error.code === "REQUEST_CONFIRMATION_REQUIRED", "State-changing request bypassed confirmation header");

  const missingConsent = await request(port, "/api/public/contact-requests", {
    method: "POST",
    body: { name: "Тест", phone: "+7 900 000-00-00", type: "other", message: "Нет согласия" }
  });
  assert(missingConsent.status === 400 && missingConsent.json.error.code === "PERSONAL_DATA_CONSENT_REQUIRED", "Personal-data request was accepted without consent");

  const csrf = await request(port, "/api/public/contact-requests", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
    body: { name: "Тест", phone: "+7 900 000-00-00", type: "other", message: "Запрещённый источник", personalDataConsent: true }
  });
  assert(csrf.status === 403 && csrf.json.error.code === "ORIGIN_NOT_ALLOWED", "Origin validation failed");

  const malformed = await request(port, "/api/public/contact-requests", { method: "POST", body: "{" });
  assert(malformed.status === 400 && malformed.json.error.code === "BAD_JSON", "Malformed JSON handling failed");
  assert(!/(?:JSON|parse|syntax|token|stack)/i.test(malformed.json.error.message), "Malformed request exposes technical text");

  const largeBody = await request(port, "/api/public/contact-requests", { method: "POST", body: JSON.stringify({ message: "x".repeat(40_000) }) });
  assert(largeBody.status === 413 && largeBody.json.error.code === "BODY_TOO_LARGE", "Request body limit is not enforced");

  const persisted = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  await runPilotHardeningScenario(port, request, { adminCookie, partnerCookie, dbFile, suffix });
  assert(persisted.sessions.length >= 2, "Server sessions were not persisted");
  assert(persisted.sessions.every((session) => session.id_hash && !session.id), "Raw session token was persisted");
  const storedBooking = persisted.bookings.find((item) => item.id === booking.json.data.bookingId);
  assert(storedBooking?.consent_version === "smoke-legal-v1" && storedBooking.consent_given_at, "Booking consent receipt was not persisted");
  const storedApplication = persisted.partnerApplications.find((item) => item.id === application.json.data.id);
  assert(storedApplication?.partner_terms_version === "smoke-legal-v1" && storedApplication.consent_given_at, "Partner terms receipt was not persisted");
  const storedContact = persisted.contactRequests.find((item) => item.id === contact.json.data.id);
  assert(storedContact?.consent_version === "smoke-legal-v1" && storedContact.consent_given_at, "Contact consent receipt was not persisted");
  if (process.platform !== "win32") {
    assert((fs.statSync(dbFile).mode & 0o777) === 0o600, "Database file permissions must remain 0600");
  }

  const disabledPartner = await request(port, "/api/admin/partners/partner-1", {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "PATCH",
    body: { status: "disabled" }
  });
  assert(disabledPartner.status === 200 && disabledPartner.json.data.status === "disabled", "Admin could not disable partner");
  const disabledSession = await request(port, "/api/partner/profile", { auth: "partnerBasic", cookie: partnerCookie });
  assert(disabledSession.status === 401, "Disabled partner session still has access");

  const adminLogout = await request(port, "/api/admin/auth/logout", { auth: "adminBasic", cookie: adminCookie, method: "POST" });
  assert(adminLogout.status === 200, "Admin logout failed");
  const loggedOutAdmin = await request(port, "/api/admin/dashboard", { auth: "adminBasic", cookie: adminCookie });
  assert(loggedOutAdmin.status === 401, "Admin session survived logout");

  let throttledLogin;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    throttledLogin = await request(port, "/api/admin/auth/login", {
      auth: "adminBasic",
      method: "POST",
      body: { login: "not-the-admin", password: "not-the-password" }
    });
  }
  assert(throttledLogin.status === 429 && throttledLogin.json.error.code === "RATE_LIMIT", "Admin login rate limit failed");
}

const port = await freePort();
const logs = [];
const child = spawn(process.execPath, ["--import", FREEZE_CLOCK_MODULE, "server.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    APP_ENV: "test",
    APP_TEST_NOW_ISO: `${todayDate()}T12:00:00+03:00`,
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    PORT: String(port),
    DB_DRIVER: "json",
    DB_FILE: dbFile,
    UPLOAD_DIR: uploadDir,
    SITE_ACCESS_ENABLED: "true",
    SITE_ACCESS_USER: credentials.preview.user,
    SITE_ACCESS_PASSWORD_SHA256: sha256(credentials.preview.password),
    ADMIN_ACCESS_ENABLED: "false",
    PARTNER_ACCESS_ENABLED: "false",
    ADMIN_APP_LOGIN: adminApp.login,
    ADMIN_APP_PASSWORD_HASH: adminHash.hash,
    ADMIN_APP_PASSWORD_SALT: adminHash.salt,
    ADMIN_APP_PASSWORD_ITERATIONS: String(adminHash.iterations),
    SESSION_SECRET: "smoke-session-secret-with-at-least-32-characters",
    LEGAL_OPERATOR_READY: "true",
    LEGAL_OPERATOR_NAME: "Тестовый оператор",
    LEGAL_OPERATOR_ID: "TEST-000000",
    LEGAL_OPERATOR_ADDRESS: "Армавир, тестовый адрес",
    LEGAL_PRIVACY_EMAIL: "privacy@example.test",
    LEGAL_DOCUMENT_VERSION: "smoke-legal-v1",
    SEED_PARTNER_1_PASSWORD: seededPartnerPassword,
    SEED_PARTNER_2_PASSWORD: crypto.randomBytes(18).toString("base64url"),
    SEED_PARTNER_3_PASSWORD: crypto.randomBytes(18).toString("base64url"),
    NEXT_PUBLIC_DEMO_MODE: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

try {
  await waitForServer(port, child, logs);
  await runScenario(port);
  console.log("Smoke test passed against an isolated temporary database");
} catch (error) {
  const serverOutput = logs.join("").trim();
  if (serverOutput) console.error(`Smoke server output:\n${serverOutput.slice(-4_000)}`);
  throw error;
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 2_000).unref();
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
}
