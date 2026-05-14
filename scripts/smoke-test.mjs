import http from "node:http";
import https from "node:https";

const base = new URL(process.env.APP_BASE_URL || "http://localhost:3010");
const suffix = Date.now().toString(36);
const client = base.protocol === "https:" ? https : http;
const port = base.port || (base.protocol === "https:" ? 443 : 80);

const credentials = {
  preview: `${process.env.TEST_SITE_ACCESS_USER || "demo"}:${process.env.TEST_SITE_ACCESS_PASSWORD || "demo-preview"}`,
  adminBasic: `${process.env.TEST_ADMIN_ACCESS_USER || "admin"}:${process.env.TEST_ADMIN_ACCESS_PASSWORD || "admin-preview"}`,
  partnerBasic: `${process.env.TEST_PARTNER_ACCESS_USER || "partner"}:${process.env.TEST_PARTNER_ACCESS_PASSWORD || "partner-preview"}`
};

function request(path, { method = "GET", body, auth = "preview", cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (auth && credentials[auth]) headers.Authorization = `Basic ${Buffer.from(credentials[auth]).toString("base64")}`;
    if (cookie) headers.Cookie = cookie;
    const req = client.request({ hostname: base.hostname, port, path, method, headers }, (res) => {
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieFrom(response) {
  return (response.headers["set-cookie"] || [""])[0];
}

const adminGate = await request("/api/admin/dashboard", { auth: "adminBasic" });
assert(adminGate.status === 401, "Admin dashboard must require app session");

const adminLogin = await request("/api/admin/auth/login", {
  auth: "adminBasic",
  method: "POST",
  body: {
    login: process.env.TEST_ADMIN_APP_LOGIN || "admin",
    password: process.env.TEST_ADMIN_APP_PASSWORD || "admin-app-preview"
  }
});
assert(adminLogin.status === 200 && adminLogin.json.ok && cookieFrom(adminLogin), "Admin app login failed");
const adminCookie = cookieFrom(adminLogin);

const partner = await request("/api/admin/partners", {
  auth: "adminBasic",
  cookie: adminCookie,
  method: "POST",
  body: { name: `Тестовый партнёр ${suffix}`, type: "other", status: "active" }
});
assert(partner.status === 201 && partner.json.ok, "Admin create partner failed");

const address = await request(`/api/admin/partners/${partner.json.data.id}/addresses`, {
  auth: "adminBasic",
  cookie: adminCookie,
  method: "POST",
  body: { title: "Тестовая точка", city: "Армавир", address: "Армавир, тестовый адрес" }
});
assert(address.status === 201 && address.json.ok, "Admin create partner address failed");

const user = await request(`/api/admin/partners/${partner.json.data.id}/users`, {
  auth: "adminBasic",
  cookie: adminCookie,
  method: "POST",
  body: { name: "Тестовый пользователь", login: `smoke-${suffix}`, password: "partner1-preview", role: "manager", status: "active" }
});
assert(user.status === 201 && user.json.ok && !user.json.data.password_hash, "Admin create partner user failed");

const offer = await request("/api/admin/offers", {
  auth: "adminBasic",
  cookie: adminCookie,
  method: "POST",
  body: {
    partnerId: partner.json.data.id,
    addressId: address.json.data.id,
    title: `Тестовое предложение ${suffix}`,
    category: "lunch",
    price: 199,
    pickupWindow: "15:00-16:00",
    totalQuantity: 2,
    remainingQuantity: 2,
    status: "active",
    ctaLabel: "Получить код"
  }
});
assert(offer.status === 201 && offer.json.ok, "Admin create offer failed");

const dashboard = await request("/api/admin/dashboard", { auth: "adminBasic", cookie: adminCookie });
assert(dashboard.status === 200 && dashboard.json.ok, "Admin dashboard failed");
for (const path of ["/api/admin/partners", "/api/admin/offers", "/api/admin/bookings", "/api/admin/partner-applications", "/api/admin/contact-requests"]) {
  const response = await request(path, { auth: "adminBasic", cookie: adminCookie });
  assert(response.status === 200 && response.json.ok, `${path} failed`);
}

const publicOffers = await request("/api/public/offers");
assert(publicOffers.status === 200 && publicOffers.json.ok && publicOffers.json.data.some((item) => item.id === offer.json.data.id), "Public offers failed");

const booking = await request("/api/public/bookings", {
  method: "POST",
  body: { offerId: offer.json.data.id, customerName: "Тест", customerPhone: "+7 900 000-00-00" }
});
assert(booking.status === 201 && /^BS-\d{4}$/.test(booking.json.data.code), "Public booking failed");

const offerAfterBooking = (await request("/api/public/offers")).json.data.find((item) => item.id === offer.json.data.id);
assert(offerAfterBooking && offerAfterBooking.remaining === 1, "Offer remaining quantity was not decremented");

const application = await request("/api/public/partner-applications", {
  method: "POST",
  body: {
    venueName: `Тестовая заявка ${suffix}`,
    venueType: "other",
    city: "Армавир",
    firstAddress: "Армавир, тестовый адрес",
    contactName: "Тест",
    phone: "+7 900 000-00-00",
    email: "test@example.test",
    offerFormats: ["Готовые обеды"],
    locationsCount: "1",
    comment: "Smoke test"
  }
});
assert(application.status === 201 && application.json.ok, "Partner application failed");

const contact = await request("/api/public/contact-requests", {
  method: "POST",
  body: { name: "Тест", phone: "+7 900 000-00-00", email: "test@example.test", type: "service_question", message: "Smoke test" }
});
assert(contact.status === 201 && contact.json.ok, "Contact request failed");

const partnerLogin = await request("/api/partner/auth/login", {
  auth: "partnerBasic",
  method: "POST",
  body: {
    login: process.env.TEST_PARTNER_LOGIN || "partner1",
    password: process.env.TEST_PARTNER_PASSWORD || "partner1-preview"
  }
});
assert(partnerLogin.status === 200 && partnerLogin.json.ok && cookieFrom(partnerLogin), "Partner login failed");
const partnerCookie = cookieFrom(partnerLogin);

for (const path of ["/api/partner/auth/me", "/api/partner/dashboard", "/api/partner/profile", "/api/partner/addresses", "/api/partner/offers", "/api/partner/bookings"]) {
  const response = await request(path, { auth: "partnerBasic", cookie: partnerCookie });
  assert(response.status === 200 && response.json.ok, `${path} failed`);
}

const ownOffers = await request("/api/partner/offers", { auth: "partnerBasic", cookie: partnerCookie });
assert(ownOffers.json.data.every((item) => item.partner_id === "partner-1"), "Partner can see another partner's offers");

console.log("Smoke test passed");
