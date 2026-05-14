import http from "node:http";

const base = new URL(process.env.APP_BASE_URL || "http://127.0.0.1:3010");
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
    const req = http.request({ hostname: base.hostname, port: base.port, path, method, headers }, (res) => {
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

const offers = await request("/api/public/offers");
assert(offers.status === 200 && offers.json.ok && offers.json.data.length > 0, "GET /api/public/offers failed");
const firstOffer = offers.json.data.find((offer) => offer.remaining > 0);
assert(firstOffer, "No offer with remaining quantity");

const booking = await request("/api/public/bookings", {
  method: "POST",
  body: { offerId: firstOffer.id, customerName: "Тест", customerPhone: "+7 900 000-00-00" }
});
assert(booking.status === 201 && booking.json.data.code, "POST /api/public/bookings failed");

const application = await request("/api/public/partner-applications", {
  method: "POST",
  body: {
    venueName: "Тестовое кафе",
    venueType: "other",
    city: "Армавир",
    firstAddress: "Армавир, тестовый адрес",
    contactName: "Тест",
    phone: "+7 900 000-00-00",
    email: "test@example.test",
    offerFormats: ["Готовые обеды"],
    locationsCount: "1",
    comment: "Тестовая заявка"
  }
});
assert(application.status === 201 && application.json.ok, "POST /api/public/partner-applications failed");

const contact = await request("/api/public/contact-requests", {
  method: "POST",
  body: { name: "Тест", phone: "+7 900 000-00-00", email: "test@example.test", type: "service_question", message: "Тестовое обращение" }
});
assert(contact.status === 201 && contact.json.ok, "POST /api/public/contact-requests failed");

const adminGate = await request("/api/admin/dashboard", { auth: "adminBasic" });
assert(adminGate.status === 401, "Admin dashboard should require app session");

const adminLogin = await request("/api/admin/auth/login", {
  auth: "adminBasic",
  method: "POST",
  body: { login: "admin", password: "admin-app-preview" }
});
assert(adminLogin.status === 200 && adminLogin.headers["set-cookie"], "Admin login failed");
const adminCookie = adminLogin.headers["set-cookie"][0];

const createdUser = await request("/api/admin/partners/partner-1/users", {
  auth: "adminBasic",
  cookie: adminCookie,
  method: "POST",
  body: { name: "Тестовый пользователь", login: `test-user-${Date.now()}`, password: "partner1-preview", role: "manager", status: "active" }
});
assert(createdUser.status === 201 && createdUser.json.ok && !createdUser.json.data.password_hash, "Admin create partner user failed");

const patchedUser = await request(`/api/admin/partners/partner-1/users/${createdUser.json.data.id}`, {
  auth: "adminBasic",
  cookie: adminCookie,
  method: "PATCH",
  body: { status: "disabled" }
});
assert(patchedUser.status === 200 && patchedUser.json.data.status === "disabled" && !patchedUser.json.data.password_hash, "Admin patch partner user failed");

const deletedUser = await request(`/api/admin/partners/partner-1/users/${createdUser.json.data.id}`, {
  auth: "adminBasic",
  cookie: adminCookie,
  method: "DELETE"
});
assert(deletedUser.status === 200 && deletedUser.json.data.deleted === true, "Admin delete partner user failed");

const partnerLogin = await request("/api/partner/auth/login", {
  auth: "partnerBasic",
  method: "POST",
  body: { login: "partner1", password: "partner1-preview" }
});
assert(partnerLogin.status === 200 && partnerLogin.headers["set-cookie"], "Partner login failed");
const partnerCookie = partnerLogin.headers["set-cookie"][0];

const partnerOffers = await request("/api/partner/offers", { auth: "partnerBasic", cookie: partnerCookie });
assert(partnerOffers.status === 200 && partnerOffers.json.ok && partnerOffers.json.data.length > 0, "Partner offers failed");

const duplicatedOffer = await request(`/api/partner/offers/${partnerOffers.json.data[0].id}/duplicate`, {
  auth: "partnerBasic",
  cookie: partnerCookie,
  method: "POST"
});
assert(duplicatedOffer.status === 201 && duplicatedOffer.json.data.status === "paused", "Partner duplicate offer failed");

const pausedOffer = await request(`/api/partner/offers/${duplicatedOffer.json.data.id}/status`, {
  auth: "partnerBasic",
  cookie: partnerCookie,
  method: "PATCH",
  body: { status: "active" }
});
assert(pausedOffer.status === 200 && pausedOffer.json.data.status === "active", "Partner offer status failed");

console.log("API smoke test passed");
