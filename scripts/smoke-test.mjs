import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPasswordHash } from "../backend/utils/password.mjs";
import { todayDate } from "../backend/utils/dates.mjs";

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
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { ok: false, error: { code: "NON_JSON_RESPONSE", message: text.slice(0, 160) } };
        }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on("error", reject);
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
  const suffix = Date.now().toString(36);
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
  assert(publicHome.text.includes('rel="manifest" href="/manifest.webmanifest"') && publicHome.text.includes('data-pwa-install'), "PWA install affordance is missing from the page");
  assert(publicHome.text.includes('class="offer-row-mobile-pickup"'), "Mobile pickup window is missing from offer rows");
  assert(!publicHome.text.includes("Фото сделано сегодня") && !publicHome.text.includes("Фото сегодня"), "Public home claims that a photo was made today without evidence");
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
  const partnerLoginPage = await request(port, "/partner/login", { auth: null });
  assert(partnerLoginPage.status === 200, "Partner login page must open without a second Basic Auth prompt");
  assertFormsUsePost(partnerLoginPage.text, "Partner page");
  const anonymousAdminMe = await request(port, "/api/admin/auth/me", { auth: "adminBasic" });
  assert(anonymousAdminMe.status === 200 && anonymousAdminMe.json.data.authenticated === false, "Anonymous admin session probe failed");
  const anonymousPartnerMe = await request(port, "/api/partner/auth/me", { auth: "partnerBasic" });
  assert(anonymousPartnerMe.status === 200 && anonymousPartnerMe.json.data.authenticated === false, "Anonymous partner session probe failed");
  const adminGate = await request(port, "/api/admin/dashboard", { auth: "adminBasic" });
  assert(adminGate.status === 401, "Admin dashboard must require app session");

  const adminLogin = await request(port, "/api/admin/auth/login", {
    auth: "adminBasic",
    method: "POST",
    body: adminApp
  });
  assert(adminLogin.status === 200 && adminLogin.json.ok && cookieFrom(adminLogin), "Admin app login failed");
  const adminCookie = cookieFrom(adminLogin);
  const adminMe = await request(port, "/api/admin/auth/me", { auth: "adminBasic", cookie: adminCookie });
  assert(adminMe.status === 200 && adminMe.json.data.authenticated === true, "Admin session probe failed");
  const safeAuditLog = await request(port, "/api/admin/audit-log", { auth: "adminBasic", cookie: adminCookie });
  assert(safeAuditLog.status === 200 && safeAuditLog.json.data.length > 0, "Admin audit log is unavailable");
  assert(safeAuditLog.json.data.every((row) => row.actorRole && row.action && row.entityType && row.createdAt && !row.metadata_json && !row.entity_id && !row.actor_id), "Admin audit log exposes unsafe internal fields");

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

  const partnerLogin = await request(port, "/api/partner/auth/login", {
    auth: "partnerBasic",
    method: "POST",
    body: { login: "partner1", password: seededPartnerPassword }
  });
  assert(partnerLogin.status === 200 && partnerLogin.json.ok && cookieFrom(partnerLogin), "Partner login failed");
  const partnerCookie = cookieFrom(partnerLogin);
  const partnerMe = await request(port, "/api/partner/auth/me", { auth: "partnerBasic", cookie: partnerCookie });
  assert(partnerMe.status === 200 && partnerMe.json.data.authenticated === true, "Partner session probe failed");
  const partnerIntoAdmin = await request(port, "/api/admin/dashboard", { auth: null, cookie: partnerCookie });
  assert(partnerIntoAdmin.status === 403, "Partner session gained access to admin API");
  const adminIntoPartner = await request(port, "/api/partner/profile", { auth: null, cookie: adminCookie });
  assert(adminIntoPartner.status === 403, "Admin session was accepted as a partner session");

  const managerLogin = await request(port, "/api/partner/auth/login", {
    auth: "partnerBasic",
    method: "POST",
    body: { login: `smoke-${suffix}`, password: managerPassword }
  });
  assert(managerLogin.status === 200 && managerLogin.json.data.userRole === "manager", "Manager login or role exposure failed");
  const managerCookie = cookieFrom(managerLogin);
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
