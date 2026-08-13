import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPasswordHash } from "../backend/utils/password.mjs";
import { todayDate } from "../backend/utils/dates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beri-smoke-"));
const dbFile = path.join(tempDir, "db.json");
const uploadDir = path.join(tempDir, "uploads");
const credentials = {
  preview: { user: "smoke-site", password: "smoke-site-password" },
  adminBasic: { user: "smoke-admin", password: "smoke-admin-password" },
  partnerBasic: { user: "smoke-partner", password: "smoke-partner-password" }
};
const adminApp = { login: "smoke-admin-app", password: "smoke-admin-app-password" };
const adminHash = createPasswordHash(adminApp.password);

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

function cookieFrom(response) {
  return (response.headers["set-cookie"] || [""])[0];
}

function request(port, route, { method = "GET", body, auth = "preview", cookie, headers: extraHeaders = {} } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
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
        resolve({ status: res.statusCode, json, headers: res.headers });
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
    body: { name: "Тестовый пользователь", login: `smoke-${suffix}`, password: "partner1-preview", role: "manager", status: "active" }
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

  const booking = await request(port, "/api/public/bookings", {
    method: "POST",
    body: { offerId: offer.json.data.id, customerName: "Тест", customerPhone: "+7 900 000-00-00" }
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
    body: { venueName: `Тестовая заявка ${suffix}`, venueType: "other", city: "Армавир", firstAddress: "Армавир, тестовый адрес", contactName: "Тест", phone: "+7 900 000-00-00", email: "test@example.test", offerFormats: ["Готовые обеды"], locationsCount: "1", comment: "Изолированный smoke test" }
  });
  assert(application.status === 201 && application.json.ok, "Partner application failed");

  const contact = await request(port, "/api/public/contact-requests", {
    method: "POST",
    body: { name: "Тест", phone: "+7 900 000-00-00", email: "test@example.test", type: "service_question", message: "Изолированный smoke test" }
  });
  assert(contact.status === 201 && contact.json.ok, "Contact request failed");

  const partnerLogin = await request(port, "/api/partner/auth/login", {
    auth: "partnerBasic",
    method: "POST",
    body: { login: "partner1", password: "partner1-preview" }
  });
  assert(partnerLogin.status === 200 && partnerLogin.json.ok && cookieFrom(partnerLogin), "Partner login failed");
  const partnerCookie = cookieFrom(partnerLogin);
  const partnerMe = await request(port, "/api/partner/auth/me", { auth: "partnerBasic", cookie: partnerCookie });
  assert(partnerMe.status === 200 && partnerMe.json.data.authenticated === true, "Partner session probe failed");

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
  const partnerAsset = await request(port, uploadedUrl, { auth: "partnerBasic" });
  assert(partnerAsset.status === 200, "Partner could not read uploaded photo");

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

  const csrf = await request(port, "/api/public/contact-requests", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
    body: { name: "Тест", phone: "+7 900 000-00-00", type: "other", message: "Запрещённый источник" }
  });
  assert(csrf.status === 403 && csrf.json.error.code === "ORIGIN_NOT_ALLOWED", "Origin validation failed");

  const malformed = await request(port, "/api/public/contact-requests", { method: "POST", body: "{" });
  assert(malformed.status === 400 && malformed.json.error.code === "BAD_JSON", "Malformed JSON handling failed");

  const largeBody = await request(port, "/api/public/contact-requests", { method: "POST", body: JSON.stringify({ message: "x".repeat(40_000) }) });
  assert(largeBody.status === 413 && largeBody.json.error.code === "BODY_TOO_LARGE", "Request body limit is not enforced");

  const persisted = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  assert(persisted.sessions.length >= 2, "Server sessions were not persisted");
  assert(persisted.sessions.every((session) => session.id_hash && !session.id), "Raw session token was persisted");

  const disabledPartner = await request(port, "/api/admin/partners/partner-1", {
    auth: "adminBasic",
    cookie: adminCookie,
    method: "PATCH",
    body: { status: "disabled" }
  });
  assert(disabledPartner.status === 200 && disabledPartner.json.data.status === "disabled", "Admin could not disable partner");
  const disabledSession = await request(port, "/api/partner/profile", { auth: "partnerBasic", cookie: partnerCookie });
  assert(disabledSession.status === 403 && disabledSession.json.error.code === "PARTNER_DISABLED", "Disabled partner session still has access");

  const adminLogout = await request(port, "/api/admin/auth/logout", { auth: "adminBasic", cookie: adminCookie, method: "POST" });
  assert(adminLogout.status === 200, "Admin logout failed");
  const loggedOutAdmin = await request(port, "/api/admin/dashboard", { auth: "adminBasic", cookie: adminCookie });
  assert(loggedOutAdmin.status === 401, "Admin session survived logout");
}

const port = await freePort();
const logs = [];
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    APP_ENV: "test",
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    PORT: String(port),
    DB_DRIVER: "json",
    DB_FILE: dbFile,
    UPLOAD_DIR: uploadDir,
    SITE_ACCESS_ENABLED: "true",
    SITE_ACCESS_USER: credentials.preview.user,
    SITE_ACCESS_PASSWORD_SHA256: sha256(credentials.preview.password),
    ADMIN_ACCESS_ENABLED: "true",
    ADMIN_ACCESS_USER: credentials.adminBasic.user,
    ADMIN_ACCESS_PASSWORD_SHA256: sha256(credentials.adminBasic.password),
    PARTNER_ACCESS_ENABLED: "true",
    PARTNER_ACCESS_USER: credentials.partnerBasic.user,
    PARTNER_ACCESS_PASSWORD_SHA256: sha256(credentials.partnerBasic.password),
    ADMIN_APP_LOGIN: adminApp.login,
    ADMIN_APP_PASSWORD_HASH: adminHash.hash,
    ADMIN_APP_PASSWORD_SALT: adminHash.salt,
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
