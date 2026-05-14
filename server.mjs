import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDb } from "./backend/storage/jsonStore.mjs";
import { handleApiRequest } from "./backend/routes/apiRouter.mjs";
import { listPublicOffers } from "./backend/repositories/databaseRepository.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(".env.local");
loadEnvFile(".env");

const PORT = Number(process.env.PORT || 3010);
ensureDb();
const config = {
  siteAccessEnabled: readEnv("SITE_ACCESS_ENABLED", "false") === "true",
  siteAccessUser: readEnv("SITE_ACCESS_USER", ""),
  siteAccessPasswordHash: readEnv("SITE_ACCESS_PASSWORD_SHA256", ""),
  adminAccessEnabled: readEnv("ADMIN_ACCESS_ENABLED", "true") === "true",
  adminAccessUser: readEnv("ADMIN_ACCESS_USER", ""),
  adminAccessPasswordHash: readEnv("ADMIN_ACCESS_PASSWORD_SHA256", ""),
  partnerAccessEnabled: readEnv("PARTNER_ACCESS_ENABLED", "true") === "true",
  partnerAccessUser: readEnv("PARTNER_ACCESS_USER", ""),
  partnerAccessPasswordHash: readEnv("PARTNER_ACCESS_PASSWORD_SHA256", ""),
  appName: readEnv("NEXT_PUBLIC_APP_NAME", "Бери сегодня"),
  appCity: readEnv("NEXT_PUBLIC_APP_CITY", "Армавир"),
  demoMode: readEnv("NEXT_PUBLIC_DEMO_MODE", "true") === "true"
};

const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
  "X-Robots-Tag": "noindex, nofollow",
  "Connection": "close"
};

function loadEnvFile(fileName) {
  const filePath = path.join(ROOT, fileName);
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function readEnv(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

function parseBasicAuth(request) {
  const header = request.headers.authorization || "";
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const splitAt = decoded.indexOf(":");
    if (splitAt === -1) return null;
    return {
      user: decoded.slice(0, splitAt),
      password: decoded.slice(splitAt + 1)
    };
  } catch {
    return null;
  }
}

function isAuthorized(request, user, passwordHash) {
  const credentials = parseBasicAuth(request);
  if (!credentials || !user || !passwordHash) return false;
  return credentials.user === user && safeEqualHex(sha256(credentials.password), passwordHash);
}

function authRequirement(pathname) {
  if (config.adminAccessEnabled && (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/"))) {
    return {
      realm: "Beri Segodnya Admin",
      user: config.adminAccessUser,
      hash: config.adminAccessPasswordHash
    };
  }

  if (config.partnerAccessEnabled && (pathname === "/partner" || pathname.startsWith("/partner/") || pathname.startsWith("/api/partner/"))) {
    return {
      realm: "Beri Segodnya Partner",
      user: config.partnerAccessUser,
      hash: config.partnerAccessPasswordHash
    };
  }

  if (config.siteAccessEnabled) {
    return {
      realm: "Beri Segodnya Preview",
      user: config.siteAccessUser,
      hash: config.siteAccessPasswordHash
    };
  }

  return null;
}

function sendUnauthorized(response, realm) {
  sendText(response, 401, "Требуется доступ к закрытому MVP «Бери сегодня».", {
    ...securityHeaders,
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
    "Cache-Control": "no-store"
  });
}

function sendText(response, status, body, headers = {}) {
  const text = String(body);
  response.writeHead(status, {
    ...headers,
    "Content-Length": Buffer.byteLength(text),
    "Connection": "close"
  });
  response.end(text);
}

const offers = [
  {
    id: "test-lunch-1",
    partnerId: "partner-1",
    partnerName: "Заведение 1",
    title: "Готовый обед сегодня",
    category: "lunch",
    address: "ул. Тестовая, 1",
    price: 299,
    oldPrice: 420,
    pickupWindow: "15:30–18:00",
    remaining: 8,
    imageAlt: "Готовый обед",
    ctaLabel: "Получить код",
    status: "active"
  },
  {
    id: "test-bakery-1",
    partnerId: "partner-2",
    partnerName: "Заведение 2",
    title: "Набор выпечки",
    category: "bakery",
    address: "ул. Примерная, 10",
    price: 249,
    oldPrice: 500,
    pickupWindow: "19:00–20:00",
    remaining: 5,
    imageAlt: "Набор выпечки",
    ctaLabel: "Забронировать",
    status: "active"
  },
  {
    id: "test-evening-1",
    partnerId: "partner-3",
    partnerName: "Заведение 3",
    title: "Вечерний набор",
    category: "evening",
    address: "Армавир, тестовый адрес",
    price: 349,
    oldPrice: 650,
    pickupWindow: "19:30–21:00",
    remaining: 6,
    imageAlt: "Вечерний набор еды",
    ctaLabel: "Получить код",
    status: "active"
  },
  {
    id: "test-bakery-2",
    partnerId: "partner-4",
    partnerName: "Тестовая пекарня",
    title: "Хлеб + выпечка",
    category: "bakery",
    address: "Армавир, тестовый адрес",
    price: 199,
    oldPrice: 400,
    pickupWindow: "20:00–21:00",
    remaining: 4,
    imageAlt: "Хлеб и выпечка",
    ctaLabel: "Забронировать",
    status: "active"
  },
  {
    id: "test-lunch-2",
    partnerId: "partner-1",
    partnerName: "Заведение 1",
    title: "Сэндвич + напиток",
    category: "lunch",
    address: "ул. Тестовая, 1",
    price: 259,
    oldPrice: 390,
    pickupWindow: "16:00–18:00",
    remaining: 7,
    imageAlt: "Сэндвич и напиток",
    ctaLabel: "Получить код",
    status: "active"
  },
  {
    id: "test-evening-2",
    partnerId: "partner-5",
    partnerName: "Тестовая кулинария",
    title: "Набор ужин",
    category: "evening",
    address: "Армавир, тестовый адрес",
    price: 399,
    oldPrice: 700,
    pickupWindow: "18:30–20:30",
    remaining: 3,
    imageAlt: "Набор готовой еды на ужин",
    ctaLabel: "Забронировать",
    status: "active"
  }
];

const nav = [
  { href: "/#offers", path: "/", label: "Предложения сегодня" },
  { href: "/how-it-works", path: "/how-it-works", label: "Как это работает" },
  { href: "/partners", path: "/partners", label: "Партнёрам" },
  { href: "/contacts", path: "/contacts", label: "Контакты" }
];

const icon = {
  search: "⌕",
  ticket: "⌁",
  shop: "▤",
  card: "▭",
  phone: "▧",
  clock: "◷",
  wallet: "▰",
  bolt: "ϟ",
  chart: "▥",
  bag: "▢",
  doc: "▨",
  plus: "+",
  help: "?",
  mail: "✉",
  pin: "⌖"
};

function json(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function header(pathname) {
  return `<header class="site-header">
    <a class="brand" href="/" aria-label="Бери сегодня">
      <span class="brand-text"><strong>Бери сегодня</strong><small>Армавир</small></span>
    </a>
    <nav class="site-nav" aria-label="Основная навигация">
      ${nav
        .map((item) => {
          const active = item.path === "/" ? pathname === "/" : pathname === item.path;
          return `<a class="${active ? "active" : ""}" href="${item.href}">${item.label}</a>`;
        })
        .join("")}
    </nav>
    <a class="button button-primary header-cta" href="/partners#partner-application">Стать партнёром</a>
  </header>`;
}

function footer() {
  return `<footer class="site-footer">
    <div>
      <a class="footer-logo" href="/">Бери сегодня</a>
      <p>Локальный сервис выгодных предложений еды в Армавире</p>
    </div>
    <nav class="footer-links" aria-label="Ссылки в подвале">
      <a href="/">О проекте</a>
      <a href="/partners">Партнёрам</a>
      <a href="/privacy">Политика</a>
      <a href="/contacts">Контакты</a>
    </nav>
    <div class="footer-contacts">
      <a href="mailto:hello@berisegodnya.ru">hello@berisegodnya.ru</a>
      <a href="tel:+79000000000">+7 (900) 000-00-00</a>
    </div>
    <nav class="footer-legal" aria-label="Юридические документы">
      <a href="/personal-data-consent">Согласие на обработку ПДн</a>
      <a href="/terms">Правила сервиса</a>
      <a href="/partner-terms">Партнёрские условия</a>
    </nav>
  </footer>`;
}

function foodImage(className = "") {
  return `<img class="${className}" src="/images/offer-food.jpg" alt="Нейтральное изображение готового набора еды" loading="lazy" />`;
}

function badge(text, extra = "") {
  return `<span class="badge ${extra}">${text}</span>`;
}

function sectionTitle(kicker, title, text = "") {
  return `<div class="section-title">
    ${kicker ? `<p class="kicker">${kicker}</p>` : ""}
    <h2>${title}</h2>
    ${text ? `<p>${text}</p>` : ""}
  </div>`;
}

function legalIntro() {
  return `<p class="demo-notice">Черновой шаблон для MVP. Перед публичным запуском документ должен быть проверен юристом и заполнен реквизитами оператора.</p>`;
}

function legalBlock(title, items) {
  return `<article class="panel-card legal-block"><h3>${title}</h3><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></article>`;
}

function miniIcon(name) {
  return `<span class="line-icon" aria-hidden="true">${icon[name] || "•"}</span>`;
}

function featureCard(title, text, name = "shop") {
  return `<article class="info-card">${miniIcon(name)}<div><h3>${title}</h3><p>${text}</p></div></article>`;
}

function steps(items) {
  return `<div class="steps-grid">
    ${items
      .map(
        (item, index) => `<article class="step-card">
          <span class="step-number">${index + 1}</span>
          ${miniIcon(item.icon)}
          <h3>${item.title}</h3>
          <p>${item.text}</p>
        </article>`
      )
      .join("")}
  </div>`;
}

function faq(items) {
  return `<div class="faq-grid">
    ${items
      .map(
        (item, index) => `<details class="faq-item" ${index === 0 ? "open" : ""}>
          <summary><span>${item.q}</span><b aria-hidden="true">+</b></summary>
          <p>${item.a}</p>
        </details>`
      )
      .join("")}
  </div>`;
}

function offerVisualCard() {
  const offer = getPageOffers()[0] || offers[0];
  return `<article class="featured-offer">
    <div class="featured-photo">${foodImage("")}</div>
    <div class="featured-copy">
      <p class="partner-name">${offer.partnerName}</p>
      <h2>${offer.title}</h2>
      <p class="meta">⌖ ${offer.partnerName} · ${offer.address}</p>
      <div class="price-line"><strong>${offer.price} ₽</strong><span>вместо ${offer.oldPrice} ₽</span></div>
      <p class="meta">◷ Забрать сегодня: ${offer.pickupWindow}</p>
      <span class="stock-badge">Осталось ${offer.remaining}</span>
      <button class="button button-primary js-open-booking" data-offer-id="${offer.id}">${offer.ctaLabel}</button>
      <p class="cash-note">Оплата на кассе</p>
    </div>
  </article>`;
}

function getPageOffers() {
  try {
    return listPublicOffers();
  } catch {
    return offers;
  }
}

function offerCardMarkup(offer) {
  const remaining = offer.remaining ?? offer.remaining_quantity ?? 0;
  const oldPrice = offer.oldPrice ?? offer.old_price;
  const pickupWindow = offer.pickupWindow ?? offer.pickup_window;
  const ctaLabel = offer.ctaLabel ?? offer.cta_label ?? "Получить код";
  const soldOut = Number(remaining) <= 0 || offer.status === "sold_out";
  return `<article class="offer-card" data-offer-card data-category="${offer.category}">
    <div class="offer-image">${foodImage(offer.imageAlt || offer.image_alt || offer.title)}</div>
    <div class="offer-body">
      <p class="partner-name">${offer.partnerName || "Заведение"}</p>
      <h3>${offer.title}</h3>
      <div class="price-line"><strong>${offer.price} ₽</strong>${oldPrice ? `<span>вместо ${oldPrice} ₽</span>` : ""}</div>
      <p class="meta">◷ ${pickupWindow}</p>
      <span class="stock-badge">${soldOut ? "Распродано" : `Осталось ${remaining}`}</span>
      <button class="button button-primary js-open-booking" data-offer-id="${offer.id}" ${soldOut ? "disabled" : ""}>${soldOut ? "Распродано" : ctaLabel}</button>
    </div>
  </article>`;
}

function codePreview() {
  return `<div class="booking-preview">
    <div class="browser-dots"><span></span><span></span><span></span></div>
    <div class="code-card">
      <p>Ваш код бронирования</p>
      <strong>BS-1042</strong>
      <span>Покажите код в заведении и оплатите на кассе.</span>
      <small>◷ Сегодня, до 18:00</small>
      <small>⌖ Заведение 1, ул. Тестовая, 1</small>
      ${badge("Осталось 8 наборов", "success")}
    </div>
    <div class="code-photo">${foodImage("")}</div>
    <div class="float-badge">${miniIcon("card")}<b>Оплата<br/>на кассе</b></div>
  </div>`;
}

function offerGridSection() {
  const pageOffers = getPageOffers();
  return `<section class="section section-white" id="offers">
    ${sectionTitle("", "Предложения сегодня")}
    <div class="filters" role="group" aria-label="Фильтры предложений">
      <button class="filter active" data-filter="all">Все</button>
      <button class="filter" data-filter="bakery">Выпечка</button>
      <button class="filter" data-filter="lunch">Обеды после пика</button>
      <button class="filter" data-filter="evening">Вечерние предложения</button>
    </div>
    <div class="offers-grid" id="offers-grid">${pageOffers.map(offerCardMarkup).join("")}</div>
    <p class="empty-state" id="offers-empty" ${pageOffers.length ? "hidden" : ""}>Пока нет активных предложений</p>
  </section>`;
}

function homePage() {
  return `<section class="hero home-hero">
    <div class="hero-copy">
      <h1>Выгодные предложения еды, которые можно забрать сегодня</h1>
      <p>Готовые наборы, выпечка и обеды после пика от заведений Армавира. Бронируйте на сайте, получайте код и забирайте в точке.</p>
      <div class="actions">
        <a class="button button-primary" href="#offers">Смотреть предложения</a>
        <a class="button button-outline" href="/how-it-works">Как это работает</a>
      </div>
      <div class="hero-badges">
        ${badge("Самовывоз")}${badge("Только сегодня")}${badge("Оплата в заведении")}${badge("По коду")}
      </div>
    </div>
    ${offerVisualCard()}
  </section>
  ${offerGridSection()}
  <section class="section compact-section">
    ${sectionTitle("", "Как это работает")}
    ${steps([
      { title: "Выберите предложение", text: "Найдите готовый обед, выпечку или вечерний набор.", icon: "search" },
      { title: "Получите код", text: "Оставьте имя и телефон и получите код бронирования.", icon: "ticket" },
      { title: "Приходите в заведение", text: "Заберите заказ в указанное время в точке партнёра.", icon: "shop" },
      { title: "Покажите код и заберите", text: "Оплатите на кассе и получите своё предложение.", icon: "phone" }
    ])}
    <p class="center-note">Без приложения. Без звонков. Только актуальные предложения на сегодня.</p>
  </section>
  <section class="partner-strip">
    <div class="strip-photo">${foodImage("")}</div>
    <div>
      <h2>Есть готовые предложения, которые нужно продать сегодня?</h2>
      <p>Пекарни, кулинарии, кофейни и кафе могут размещать ограниченные предложения и получать новых клиентов без сложной интеграции.</p>
    </div>
    <div class="strip-cards">
      ${featureCard("Дополнительная выручка", "", "chart")}
      ${featureCard("Без онлайн-оплаты на старте", "", "card")}
      ${featureCard("Отчёт по выданным кодам", "", "doc")}
    </div>
    <a class="button button-primary" href="/partners#partner-application">Оставить заявку</a>
  </section>`;
}

function howItWorksPage() {
  return `<section class="hero split-hero">
    <div class="hero-copy">
      <h1>Как работает Бери сегодня</h1>
      <p>Сервис помогает быстро забронировать выгодные предложения еды на сегодня. Без звонков, без приложения, с оплатой прямо в заведении.</p>
      <div class="actions">
        <a class="button button-primary" href="/#offers">Смотреть предложения</a>
        <a class="button button-outline" href="/partners">Стать партнёром</a>
      </div>
    </div>
    ${codePreview()}
  </section>
  <section class="section">
    ${sectionTitle("", "4 простых шага")}
    ${steps([
      { title: "Выберите предложение", text: "Найдите готовый обед, выпечку или вечерний набор, который доступен сегодня.", icon: "search" },
      { title: "Получите код", text: "Оставьте имя и телефон на сайте и получите код бронирования.", icon: "ticket" },
      { title: "Приходите в заведение", text: "Заберите заказ в указанное время в точке партнёра.", icon: "shop" },
      { title: "Покажите код и оплатите", text: "Покажите код сотруднику, оплатите на кассе и получите своё предложение.", icon: "card" }
    ])}
    <p class="center-note">Все предложения ограничены по количеству и действуют только сегодня.</p>
  </section>
  <section class="section">
    ${sectionTitle("", "Для покупателя")}
    <div class="info-grid">
      ${featureCard("Без приложения", "Бронь и коды работают прямо на сайте. Ничего скачивать не нужно.", "phone")}
      ${featureCard("Только актуальные предложения", "Видите только то, что доступно сегодня здесь и сейчас.", "clock")}
      ${featureCard("Оплата в заведении", "Оплачивайте удобным способом на кассе при получении заказа.", "wallet")}
      ${featureCard("Быстро и понятно", "Несколько шагов — и ваш заказ забронирован. Всё просто и прозрачно.", "bolt")}
    </div>
  </section>
  <section class="section">
    ${sectionTitle("", "Для партнёров")}
    <div class="partner-explain">
      <div class="large-photo">${foodImage("")}</div>
      <article class="panel-card">
        <h3>Как это работает для заведений</h3>
        <ul class="check-list">
          <li>Размещаете ограниченные предложения на сегодня</li>
          <li>Получаете брони и коды</li>
          <li>Выдаёте заказ в своей точке</li>
          <li>Отмечаете выданные коды</li>
          <li>Получаете дополнительную выручку</li>
        </ul>
        <a class="button button-primary" href="/partners">Стать партнёром</a>
      </article>
      <div class="mini-stack">
        ${featureCard("Без сложной интеграции", "Подключение быстрое, инструменты простые.", "plus")}
        ${featureCard("Самовывоз на старте", "Фокус на самовывозе — минимум процессов.", "bag")}
        ${featureCard("Отчёт по выданным кодам", "Следите за статистикой продаж и выданных заказов.", "chart")}
      </div>
    </div>
  </section>
  <section class="section">
    ${sectionTitle("", "Частые вопросы")}
    ${faq([
      { q: "Нужно ли приложение?", a: "Нет, приложение не требуется. Всё работает прямо на сайте: выбираете предложение, получаете код и забираете заказ." },
      { q: "Как происходит оплата?", a: "Оплата происходит в заведении при получении заказа. Сервис на старте не принимает онлайн-оплату." },
      { q: "Можно ли отменить бронь?", a: "В первой версии отмена может быть доступна через контакт с сервисом. В следующих версиях будет отдельная кнопка отмены брони." },
      { q: "Что если я не успел забрать заказ?", a: "Предложения действуют только в указанное время. Если клиент не приходит, бронь считается неиспользованной." },
      { q: "Как заведению стать партнёром?", a: "Нужно оставить заявку на странице «Партнёрам». Мы свяжемся и поможем запустить пилот." },
      { q: "Почему предложения ограничены?", a: "Сервис работает только с предложениями на сегодня. Количество задаёт само заведение." }
    ])}
  </section>
  ${bottomCta("Готовы попробовать?", "Выберите предложение на сегодня или оставьте заявку на подключение заведения.", "Смотреть предложения", "/#offers", "Оставить заявку", "/partners")}`;
}

function partnerDashboardCard() {
  return `<article class="partner-dashboard">
    <h2>Панель партнёра</h2>
    <div class="stats-row">
      <span><small>Сегодняшние предложения</small><b>4</b></span>
      <span><small>Получено кодов</small><b>28</b></span>
      <span><small>Выдано заказов</small><b>22</b></span>
      <span><small>Доп. выручка</small><b>12 340 ₽</b></span>
    </div>
    <div class="dashboard-main">
      <div class="dash-offer">
        ${foodImage("")}
        <div>
          <h3>Готовый обед сегодня</h3>
          <strong>299 ₽</strong>
          <dl><dt>Время выдачи</dt><dd>15:30–18:00</dd><dt>Осталось</dt><dd>8 наборов</dd></dl>
          ${badge("Активно", "success")}
        </div>
      </div>
      <div class="dash-photo">${foodImage("")}</div>
    </div>
    <div class="float-badge dash-badge">${miniIcon("plus")}<b>Без сложной<br/>интеграции</b></div>
  </article>`;
}

function partnersPage() {
  return `<section class="hero split-hero">
    <div class="hero-copy">
      <h1>Партнёрам Бери сегодня</h1>
      <p>Помогаем кафе, пекарням, буфетам и кулинариям продавать ограниченные предложения на сегодня. Клиенты бронируют по коду, оплачивают на месте, а вы получаете дополнительную выручку без лишних затрат.</p>
      <div class="actions">
        <a class="button button-primary" href="#partner-application">Оставить заявку</a>
        <a class="button button-outline" href="/how-it-works">Как это работает</a>
      </div>
    </div>
    ${partnerDashboardCard()}
  </section>
  <section class="section">
    ${sectionTitle("", "Почему это выгодно заведению")}
    <div class="info-grid">
      ${featureCard("Дополнительная выручка", "Продавайте ограниченные предложения на сегодня и увеличивайте выручку без лишних процессов.", "chart")}
      ${featureCard("Продажа предложений на сегодня", "Вы сами решаете, что предложить, по какой цене и в каком количестве.", "clock")}
      ${featureCard("Самовывоз без сложной логистики", "Клиенты забирают заказ в вашей точке в выбранное время.", "bag")}
      ${featureCard("Простое подключение и отчётность", "Быстрый старт, понятная панель и отчёты по выданным кодам.", "doc")}
    </div>
  </section>
  <section class="section">
    ${sectionTitle("", "Как это работает для партнёров")}
    ${steps([
      { title: "Добавьте предложение", text: "Укажите название, цену, время выдачи и количество на сегодня.", icon: "plus" },
      { title: "Получайте брони и коды", text: "Клиенты бронируют предложение на сайте и получают код.", icon: "ticket" },
      { title: "Выдавайте заказ в своей точке", text: "Клиент приходит к вам, показывает код и получает заказ после оплаты.", icon: "bag" },
      { title: "Смотрите статистику и выручку", text: "Следите за кодами, заказами и дополнительной выручкой.", icon: "chart" }
    ])}
    <p class="center-note">Вы сами решаете, какие предложения доступны на сегодня. Оплата всегда происходит у вас на кассе.</p>
  </section>
  <section class="section">
    ${sectionTitle("", "Кому подходит")}
    <div class="category-grid">
      ${["Пекарни", "Кофейни", "Кулинарии", "Буфеты", "Кафе с готовой едой"].map((name) => `<article>${miniIcon("shop")}<h3>${name}</h3><div class="food-strip">${foodImage("")}</div></article>`).join("")}
    </div>
  </section>
  <section class="section pilot-grid">
    <article class="panel-card">
      <h2>Что входит в пилот</h2>
      <ul class="check-list two-columns">
        <li>14 дней теста</li><li>1 точка на старте</li><li>Ограниченные предложения на сегодня</li><li>Бронь по коду</li><li>Оплата на кассе</li><li>Отчёт по выданным кодам</li><li>Поддержка при запуске</li>
      </ul>
    </article>
    <article class="accent-card"><span class="calendar-mark">14</span><div><h2>Первые 14 дней — без комиссии</h2><p>Протестируйте сервис и оцените результат без рисков.</p></div></article>
  </section>
  <section class="section form-section" id="partner-application">
    ${sectionTitle("", "Оставить заявку на подключение", "Расскажите о заведении — мы свяжемся с вами и поможем запустить пилот.")}
      ${config.demoMode ? `<p class="demo-notice">Демо-режим: заявка сохраняется в серверном MVP-хранилище. Не вводите реальные персональные данные.</p>` : ""}
    <form class="smart-form" data-form="partner">
      <label>Название заведения<input name="venueName" required maxlength="120" placeholder="Например: Заведение 1" /></label>
      <label>Тип заведения<select name="venueType" required><option value="">Выберите тип</option><option value="bakery">Пекарня</option><option value="coffee">Кофейня</option><option value="culinary">Кулинария</option><option value="buffet">Буфет</option><option value="ready_food_cafe">Кафе с готовой едой</option><option value="other">Другое</option></select></label>
      <label>Город<input name="city" required maxlength="80" value="Армавир" /></label>
      <label>Адрес первой точки<input name="firstAddress" required maxlength="160" placeholder="Например: ул. Тестовая, 1" /></label>
      <label>Контактное лицо<input name="contactName" required maxlength="80" placeholder="Ваше имя" /></label>
      <label>Телефон<input name="phone" required minlength="7" maxlength="30" pattern="[+0-9 ()-]{7,30}" placeholder="+7 (___) ___-__-__" /></label>
      <label>Email<input name="email" type="email" maxlength="120" placeholder="email@example.ru" /></label>
      <label>Сколько точек<select name="locationsCount"><option value="1">1</option><option value="2-3">2–3</option><option value="4+">4+</option><option value="unknown">пока не знаю</option></select></label>
      <label class="full">Что хотите размещать<input name="offerFormats" maxlength="240" placeholder="Готовые обеды, выпечка, вечерние наборы" /></label>
      <label class="full">Комментарий<textarea name="comment" maxlength="1000" placeholder="Опишите формат предложений или вопросы по запуску"></textarea></label>
      <label class="consent full"><input type="checkbox" name="personalDataConsent" required /><span>Я согласен на <a href="/personal-data-consent" target="_blank" rel="noopener">обработку персональных данных</a> и принимаю <a href="/privacy" target="_blank" rel="noopener">Политику обработки персональных данных</a></span></label>
      <label class="consent full"><input type="checkbox" name="partnerTermsConsent" required /><span>Я принимаю <a href="/partner-terms" target="_blank" rel="noopener">Условия подключения партнёров</a></span></label>
      <p class="form-error" hidden></p>
      <button class="button button-primary" type="submit">Отправить заявку</button>
    </form>
    <div class="success-box" data-success="partner" hidden><h3>Заявка сохранена</h3><p>${config.demoMode ? "Демо-заявка сохранена на сервере." : "Заявка отправлена. Мы свяжемся с вами в течение рабочего дня."}</p><button class="button button-outline" data-reset-form="partner">Отправить ещё одну заявку</button></div>
  </section>
  <section class="section">
    ${sectionTitle("", "Частые вопросы")}
    ${faq([
      { q: "Нужна ли интеграция с кассой?", a: "Нет, интеграция не требуется. Выдача заказа и оплата происходят у вас на кассе." },
      { q: "Кто принимает оплату?", a: "Оплату принимает заведение. Клиент оплачивает заказ у вас на кассе при получении." },
      { q: "Можно ли подключить одну точку?", a: "Да. Для пилота лучше начать с одной точки, проверить спрос и потом масштабировать." },
      { q: "Какие предложения можно размещать?", a: "Ограниченные предложения на сегодня: готовые обеды, выпечку, вечерние наборы и предложения после пика." },
      { q: "Как считается результат?", a: "Мы считаем полученные коды, выданные заказы, неиспользованные брони и примерную дополнительную выручку." },
      { q: "Можно ли не размещать предложения каждый день?", a: "Да. Партнёр сам решает, в какие дни и какие предложения размещать." }
    ])}
  </section>
  ${bottomCta("Готовы подключить заведение?", "Оставьте заявку — мы свяжемся с вами и поможем запустить пилот уже сегодня.", "Оставить заявку", "#partner-application", "Связаться с нами", "/contacts")}`;
}

function contactCard() {
  return `<article class="contact-card">
    <div class="contact-list">
      <p>${miniIcon("phone")}<span><b>Телефон</b>+7 (900) 000-00-00</span></p>
      <p>${miniIcon("mail")}<span><b>Email</b>hello@berisegodnya.ru</span></p>
      <p>${miniIcon("pin")}<span><b>Город</b>Армавир</span></p>
      <p>${miniIcon("clock")}<span><b>Время ответа</b>в течение рабочего дня</span></p>
      ${badge("На связи по запуску пилота", "success")}
    </div>
    <div class="contact-photo">${foodImage("")}</div>
  </article>`;
}

function contactsPage() {
  return `<section class="hero split-hero">
    <div class="hero-copy">
      <h1>Контакты Бери сегодня</h1>
      <p>Свяжитесь с нами, чтобы подключить заведение, задать вопрос о сервисе или обсудить запуск пилота в Армавире.</p>
      <div class="actions">
        <a class="button button-primary" href="#contact-form">Оставить заявку</a>
        <a class="button button-outline" href="#contact-form">Написать нам</a>
      </div>
    </div>
    ${contactCard()}
  </section>
  <section class="section">
    <div class="info-grid contact-options">
      ${featureCard("Подключить заведение", "Расскажите о заведении — мы поможем запустить пилот и разместить первые предложения.", "shop")}
      ${featureCard("Вопрос по заказу", "Поможем с кодом, бронью, временем выдачи или другим вопросом по предложению.", "mail")}
      ${featureCard("Партнёрский пилот", "Обсудим тестовый запуск, формат предложений и критерии результата.", "bolt")}
      ${featureCard("Общий вопрос", "Любой другой вопрос о сервисе, условиях работы и возможностях платформы.", "help")}
    </div>
  </section>
  <section class="section contact-form-layout" id="contact-form">
    <div>
      ${sectionTitle("", "Как с нами связаться")}
      ${config.demoMode ? `<p class="demo-notice">Демо-режим: обращение сохраняется в серверном MVP-хранилище. Не вводите реальные персональные данные.</p>` : ""}
      <form class="smart-form" data-form="contact">
        <label>Имя<input name="name" required maxlength="80" placeholder="Ваше имя" /></label>
        <label>Телефон<input name="phone" required minlength="7" maxlength="30" pattern="[+0-9 ()-]{7,30}" placeholder="+7 (___) ___-__-__" /></label>
        <label>Email<input name="email" type="email" maxlength="120" placeholder="email@example.ru" /></label>
        <label class="full">Тип обращения<select name="type" required><option value="venue_connection">Подключение заведения</option><option value="service_question">Вопрос по сервису</option><option value="partner_pilot">Партнёрский пилот</option><option value="order_question">Вопрос по заказу</option><option value="other">Другое</option></select></label>
        <label class="full">Сообщение<textarea name="message" required maxlength="1000" placeholder="Опишите ваш вопрос или оставьте комментарий"></textarea></label>
        <label class="consent full"><input type="checkbox" name="personalDataConsent" required /><span>Я согласен на <a href="/personal-data-consent" target="_blank" rel="noopener">обработку персональных данных</a> и принимаю <a href="/privacy" target="_blank" rel="noopener">Политику обработки персональных данных</a></span></label>
        <p class="form-error" hidden></p>
        <button class="button button-primary" type="submit">Отправить заявку</button>
      </form>
      <div class="success-box" data-success="contact" hidden><h3>Обращение сохранено</h3><p>${config.demoMode ? "Демо-обращение сохранено на сервере." : "Мы получили ваше обращение и свяжемся с вами в течение рабочего дня."}</p><button class="button button-outline" data-reset-form="contact">Отправить ещё одно обращение</button></div>
    </div>
    <aside class="side-stack">
      <article class="panel-card">
        <h3>Кому мы помогаем</h3>
        ${featureCard("Для заведений", "Подключаем кафе, пекарни, кулинарии, буфеты и другие форматы от одной точки.", "shop")}
        ${featureCard("Для клиентов", "Помогаем с кодами, бронями и вопросами по предложениям на сегодня.", "phone")}
        ${featureCard("Где работаем", "Запускаем сервис в Армавире и фокусируемся на локальных предложениях города.", "pin")}
        ${featureCard("Как проходит запуск", "Пилот можно начать с одной точки и ограниченного количества предложений.", "bolt")}
      </article>
      <article class="city-card"><h3>Армавир</h3><p>Локальный сервис для города, его жителей и заведений.</p><div class="city-lines"></div></article>
    </aside>
  </section>
  <section class="section">
    ${sectionTitle("", "Частые вопросы")}
    ${faq([
      { q: "Как быстро вы отвечаете?", a: "Мы на связи в течение рабочего дня и обычно отвечаем в течение 1–2 часов." },
      { q: "Можно ли подключить одну точку?", a: "Да. Для пилота можно подключить одну точку, проверить спрос и потом масштабировать." },
      { q: "Нужна ли интеграция с кассой?", a: "Нет. Клиент оплачивает заказ у вас на кассе, а сервис фиксирует код бронирования." },
      { q: "Сколько длится пилот?", a: "Стандартный тестовый период — 14 дней. После него можно оценить результат." },
      { q: "Кто принимает оплату?", a: "Оплату принимает заведение. Сервис на старте не принимает онлайн-оплату." },
      { q: "В каких форматах можно работать?", a: "Можно размещать готовые обеды, выпечку, вечерние наборы и предложения после пика." }
    ])}
  </section>
  ${bottomCta("Готовы обсудить запуск?", "Оставьте контакты — мы свяжемся с вами и поможем запустить пилот для вашего заведения.", "Оставить заявку", "#contact-form", "Позвонить нам", "tel:+79000000000")}`;
}

function bottomCta(title, text, primaryLabel, primaryHref, secondaryLabel, secondaryHref) {
  return `<section class="bottom-cta">
    <div class="cta-photo">${foodImage("")}</div>
    <div><h2>${title}</h2><p>${text}</p></div>
    <div class="cta-actions">
      <a class="button button-primary" href="${primaryHref}">${primaryLabel}</a>
      <a class="button button-outline" href="${secondaryHref}">${secondaryLabel}</a>
    </div>
    <div class="shop-line" aria-hidden="true"></div>
  </section>`;
}

function privacyPage() {
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", "Политика обработки персональных данных", "Черновая политика для MVP сервиса «Бери сегодня».")}
    ${legalIntro()}
    <div class="legal-doc">
      ${legalBlock("1. Оператор", [
        "Оператор персональных данных: [Полное наименование оператора].",
        "Реквизиты: [ИНН/ОГРН/ОГРНИП].",
        "Адрес: [Адрес].",
        "Email для обращений по персональным данным: privacy@berisegodnya.ru."
      ])}
      ${legalBlock("2. Какие данные обрабатываются", [
        "Для клиентов: имя, телефон, код бронирования, выбранное предложение, дата и время обращения, технические данные запроса.",
        "Для партнёров: название заведения, контактное лицо, телефон, email, адрес точки, комментарий к заявке, данные пользователя партнёрского кабинета.",
        "Для обращений: имя, телефон, email и текст сообщения."
      ])}
      ${legalBlock("3. Цели обработки", [
        "Создание и обработка брони.",
        "Связь с пользователем.",
        "Подключение партнёров.",
        "Обработка обращений.",
        "Администрирование сервиса.",
        "Обеспечение безопасности.",
        "Ведение статистики работы сервиса."
      ])}
      ${legalBlock("4. Правовые основания", [
        "Согласие субъекта персональных данных.",
        "Исполнение пользовательских или партнёрских условий.",
        "Законные обязанности оператора, если они применимы."
      ])}
      ${legalBlock("5. Сроки хранения", [
        "Заявки и обращения хранятся до достижения цели обработки или отзыва согласия.",
        "Брони хранятся в срок, необходимый для обработки заказа и внутренней отчётности.",
        "Технические логи хранятся ограниченный срок, определяемый оператором."
      ])}
      ${legalBlock("6. Передача третьим лицам", [
        "Данные могут быть доступны техническому хостинг-провайдеру.",
        "Данные партнёра видны администратору сервиса.",
        "Данные клиента по конкретной брони могут быть видны соответствующему партнёру.",
        "Данные не продаются третьим лицам."
      ])}
      ${legalBlock("7. Локализация", [
        "Персональные данные граждан РФ должны храниться в базах данных на территории РФ.",
        "При выборе хостинга использовать сервер или базу данных в РФ."
      ])}
      ${legalBlock("8. Права субъекта персональных данных", [
        "Запросить информацию об обработке данных.",
        "Уточнить данные.",
        "Отозвать согласие.",
        "Потребовать прекращения обработки.",
        "Направить обращение на email оператора."
      ])}
      ${legalBlock("9. Меры защиты", [
        "HTTPS при публичном запуске.",
        "Серверная авторизация.",
        "Разделение доступа admin/partner.",
        "Хранение паролей в виде hash/salt.",
        "Резервное копирование.",
        "Ограничение доступа к серверу."
      ])}
      ${legalBlock("10. Контакты", [
        "Email для обращений по персональным данным: privacy@berisegodnya.ru.",
        "Почтовый адрес оператора: [Адрес]."
      ])}
    </div>
  </section>`;
}

function personalDataConsentPage() {
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", "Согласие на обработку персональных данных", "Черновой шаблон согласия для форм сайта и партнёрского подключения.")}
    ${legalIntro()}
    <div class="legal-doc">
      ${legalBlock("1. Кто даёт согласие", [
        "Пользователь сайта или представитель партнёра, заполняющий форму на сайте."
      ])}
      ${legalBlock("2. Кому даётся согласие", [
        "Оператору персональных данных: [Полное наименование оператора].",
        "Реквизиты оператора: [ИНН/ОГРН/ОГРНИП].",
        "Адрес оператора: [Адрес].",
        "Email для обращений: privacy@berisegodnya.ru."
      ])}
      ${legalBlock("3. Какие данные обрабатываются", [
        "Имя.",
        "Телефон.",
        "Email.",
        "Сообщение.",
        "Данные заявки.",
        "Данные брони."
      ])}
      ${legalBlock("4. Цели обработки", [
        "Обработка брони.",
        "Связь с пользователем.",
        "Подключение партнёров.",
        "Поддержка.",
        "Администрирование сервиса."
      ])}
      ${legalBlock("5. Действия с данными", [
        "Сбор, запись, систематизация, хранение, уточнение и использование.",
        "Передача в пределах сервиса.",
        "Обезличивание, блокирование и удаление."
      ])}
      ${legalBlock("6. Срок действия согласия", [
        "Согласие действует до достижения целей обработки или до отзыва согласия."
      ])}
      ${legalBlock("7. Как отозвать согласие", [
        "Направить письмо на privacy@berisegodnya.ru с указанием данных, по которым нужно прекратить обработку."
      ])}
      ${legalBlock("8. Чекбокс на формах", [
        "Отправка формы означает, что пользователь отметил чекбокс согласия и ознакомился с политикой обработки персональных данных."
      ])}
    </div>
  </section>`;
}

function termsPage() {
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", "Правила использования сервиса", "Черновые правила MVP сервиса «Бери сегодня».")}
    ${legalIntro()}
    <div class="legal-doc">
      ${legalBlock("Оператор сервиса", [
        "Оператор: [Полное наименование оператора].",
        "Реквизиты: [ИНН/ОГРН/ОГРНИП].",
        "Адрес: [Адрес].",
        "Email для обращений: privacy@berisegodnya.ru."
      ])}
      ${legalBlock("1. Что такое «Бери сегодня»", [
        "«Бери сегодня» — локальный сервис ограниченных предложений еды на сегодня."
      ])}
      ${legalBlock("2. Роль сервиса", [
        "Сервис предоставляет информационную витрину предложений и бронирование кода."
      ])}
      ${legalBlock("3. Важное ограничение", [
        "На текущем этапе сервис не является продавцом товара, не принимает оплату за еду и не выдаёт кассовый чек за товар."
      ])}
      ${legalBlock("4. Оплата", [
        "Оплата происходит в заведении-партнёре при получении предложения."
      ])}
      ${legalBlock("5. Код бронирования", [
        "Код подтверждает интерес или бронь предложения на ограниченное время.",
        "Код не гарантирует наличие предложения после истечения времени выдачи или при нарушении правил сервиса."
      ])}
      ${legalBlock("6. Ограниченность предложений", [
        "Предложения действуют только сегодня, в указанное время и в пределах доступного количества."
      ])}
      ${legalBlock("7. Ответственность за товар", [
        "Качество, состав, хранение, срок годности и выдачу товара обеспечивает заведение-партнёр."
      ])}
      ${legalBlock("8. Жалобы", [
        "Пользователь может обратиться через страницу /contacts."
      ])}
      ${legalBlock("9. Запрещено", [
        "Использовать чужие данные.",
        "Злоупотреблять бронированиями.",
        "Создавать массовые фейковые брони.",
        "Пытаться получить доступ к чужим кабинетам."
      ])}
      ${legalBlock("10. Изменение правил", [
        "Оператор может обновлять правила. Актуальная версия размещается на сайте."
      ])}
    </div>
  </section>`;
}

function partnerTermsPage() {
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", "Условия подключения партнёров", "Черновые условия для MVP-пилота с заведениями.")}
    ${legalIntro()}
    <div class="legal-doc">
      ${legalBlock("Оператор сервиса", [
        "Оператор: [Полное наименование оператора].",
        "Реквизиты: [ИНН/ОГРН/ОГРНИП].",
        "Адрес: [Адрес].",
        "Email для обращений: privacy@berisegodnya.ru."
      ])}
      ${legalBlock("1. Кто может подключиться", [
        "Пекарни, кулинарии, кофейни, буфеты и кафе с готовой едой."
      ])}
      ${legalBlock("2. Что можно размещать", [
        "Готовые обеды.",
        "Наборы выпечки.",
        "Вечерние предложения.",
        "Обеды после пика.",
        "Ограниченные предложения на сегодня."
      ])}
      ${legalBlock("3. Что запрещено", [
        "Просроченная продукция.",
        "Продукция с нарушенными условиями хранения.",
        "Продукция без права реализации.",
        "Предложения, вводящие пользователя в заблуждение."
      ])}
      ${legalBlock("4. Как работает выдача", [
        "Клиент получает код на сайте.",
        "Клиент приходит в точку партнёра.",
        "Клиент оплачивает заказ на кассе партнёра.",
        "Партнёр выдаёт заказ и отмечает код в кабинете."
      ])}
      ${legalBlock("5. Ответственность партнёра", [
        "Партнёр отвечает за качество товара, срок годности, условия хранения и соответствие предложения.",
        "Партнёр отвечает за чек, оплату и работу сотрудников при выдаче."
      ])}
      ${legalBlock("6. Роль сервиса", [
        "Сервис предоставляет размещение предложения, код бронирования, кабинет партнёра и отчётность по кодам."
      ])}
      ${legalBlock("7. Пилот", [
        "Первые 14 дней могут быть тестовыми, если это предусмотрено отдельной договорённостью."
      ])}
      ${legalBlock("8. Отключение партнёра", [
        "Сервис может отключить партнёра за жалобы, просрочку, обман по составу или систематические ошибки выдачи."
      ])}
    </div>
  </section>`;
}

function hiddenPage(title, text) {
  return `<section class="hero hidden-hero">
    <div class="hero-copy"><h1>${title}</h1><p>${text}</p><div class="actions"><a class="button button-primary" href="/">На главную</a></div></div>
    <article class="panel-card"><h2>MVP-раздел</h2><p>Раздел скрыт из публичной навигации и защищён серверным Basic Auth.</p>${config.demoMode ? `<p class="demo-notice">MVP-режим: данные хранятся в server-side JSON. Для боевого запуска потребуется SQLite/PostgreSQL.</p>` : ""}${badge("server-side JSON")}${badge("без внешнего backend")}</article>
  </section>`;
}

function adminPage() {
  return `<section class="section app-panel" data-admin-app>
    ${sectionTitle("Админка", "Панель администратора", "Данные хранятся на сервере. MVP-хранилище: server-side JSON. Для продакшена рекомендуется SQLite/PostgreSQL.")}
    <div class="auth-box" data-admin-login>
      <h3>Вход администратора</h3>
      <form class="smart-form auth-form" data-admin-login-form>
        <label>Логин<input name="login" required maxlength="80" autocomplete="username" /></label>
        <label>Пароль<input name="password" required maxlength="120" type="password" autocomplete="current-password" /></label>
        <p class="form-error" hidden></p>
        <button class="button button-primary" type="submit">Войти</button>
      </form>
    </div>
    <div data-admin-dashboard hidden>
      <div class="admin-actions"><button class="button button-outline" data-admin-refresh>Обновить</button><button class="button button-outline" data-admin-logout>Выйти</button></div>
      <nav class="tab-nav" data-tabs="admin" aria-label="Разделы админки">
        <a data-tab-link="overview" href="/admin?tab=overview">Обзор</a>
        <a data-tab-link="partners" href="/admin?tab=partners">Партнёры</a>
        <a data-tab-link="offers" href="/admin?tab=offers">Предложения</a>
        <a data-tab-link="bookings" href="/admin?tab=bookings">Брони и коды</a>
        <a data-tab-link="partner-applications" href="/admin?tab=partner-applications">Заявки партнёров</a>
        <a data-tab-link="contact-requests" href="/admin?tab=contact-requests">Обращения</a>
        <a data-tab-link="settings" href="/admin?tab=settings">Настройки</a>
      </nav>
      <div class="stats-row admin-stats" data-admin-stats></div>
      <div class="admin-grid">
        <article class="panel-card tab-panel" data-tab-panel="overview"><h3>Обзор</h3><p class="empty-state">Все операции идут через backend API. Рабочие данные хранятся на сервере.</p><div class="table-wrap" data-admin-service></div></article>
        <article class="panel-card tab-panel" data-tab-panel="partners"><h3>Партнёры</h3><form class="mini-form" data-admin-create-partner><input name="name" required maxlength="120" placeholder="Название партнёра" /><select name="type"><option value="culinary">Кулинария</option><option value="bakery">Пекарня</option><option value="coffee">Кофейня</option><option value="cafe">Кафе</option><option value="buffet">Буфет</option><option value="other">Другое</option></select><button class="button button-primary" type="submit">Добавить партнёра</button></form><div class="table-wrap" data-admin-partners></div></article>
        <article class="panel-card tab-panel" data-tab-panel="partners"><h3>Адреса партнёров</h3><form class="mini-form" data-admin-create-address><input name="partnerId" required placeholder="partner id" /><input name="title" required placeholder="Название точки" /><input name="city" required value="Армавир" /><input name="address" required placeholder="Армавир, ул. Тестовая, 1" /><button class="button button-primary" type="submit">Добавить адрес</button></form><div class="table-wrap" data-admin-addresses></div></article>
        <article class="panel-card tab-panel" data-tab-panel="partners"><h3>Пользователи партнёров</h3><form class="mini-form" data-admin-create-user><input name="partnerId" required placeholder="partner id" /><input name="name" required placeholder="Имя" /><input name="login" required placeholder="login" /><input name="password" required type="password" placeholder="password" /><select name="role"><option value="owner">Владелец</option><option value="manager">Менеджер</option></select><button class="button button-primary" type="submit">Добавить пользователя</button></form><div class="table-wrap" data-admin-users></div></article>
        <article class="panel-card tab-panel" data-tab-panel="offers"><h3>Предложения</h3><form class="mini-form" data-admin-create-offer><input name="partnerId" required placeholder="partner id" /><input name="addressId" required placeholder="address id" /><input name="title" required maxlength="120" placeholder="Название" /><select name="category"><option value="lunch">Обед</option><option value="bakery">Выпечка</option><option value="evening">Вечернее</option></select><input name="price" required type="number" min="1" placeholder="Цена" /><input name="oldPrice" type="number" min="1" placeholder="Старая цена" /><input name="pickupWindow" required maxlength="40" placeholder="15:30–18:00" /><input name="totalQuantity" required type="number" min="0" placeholder="Количество" /><input name="remainingQuantity" type="number" min="0" placeholder="Остаток" /><select name="status"><option value="active">Активно</option><option value="paused">Пауза</option><option value="sold_out">Распродано</option><option value="expired">Истекло</option></select><button class="button button-primary" type="submit">Добавить предложение</button></form><div class="table-wrap" data-admin-offers></div></article>
        <article class="panel-card tab-panel" data-tab-panel="bookings"><h3>Брони и коды</h3><div class="table-wrap" data-admin-bookings></div></article>
        <article class="panel-card tab-panel" data-tab-panel="partner-applications"><h3>Заявки партнёров</h3><div class="table-wrap" data-admin-applications></div></article>
        <article class="panel-card tab-panel" data-tab-panel="contact-requests"><h3>Обращения</h3><div class="table-wrap" data-admin-contacts></div></article>
        <article class="panel-card tab-panel" data-tab-panel="settings"><h3>Настройки и экспорт</h3><p class="empty-state">Перед деплоем проверьте env, backup server-side storage и noindex. Экспорт: файл data/db.json на сервере.</p></article>
      </div>
    </div>
  </section>`;
}

function partnerLoginPage() {
  return `<section class="section app-panel" data-partner-login-app>
    ${sectionTitle("Кабинет партнёра", "Вход партнёра", "Введите логин и пароль пользователя партнёра. Данные кабинета синхронизируются с сервером.")}
    <form class="smart-form auth-form" data-partner-login-form>
      <label>Логин<input name="login" required maxlength="80" autocomplete="username" placeholder="partner1" /></label>
      <label>Пароль<input name="password" required maxlength="120" type="password" autocomplete="current-password" placeholder="partner1-preview" /></label>
      <p class="form-error" hidden></p>
      <button class="button button-primary" type="submit">Войти</button>
    </form>
  </section>`;
}

function partnerDashboardPage() {
  return `<section class="section app-panel" data-partner-dashboard-app>
    ${sectionTitle("Кабинет партнёра", "Панель партнёра", "Данные кабинета синхронизируются с сервером. Партнёр видит только свои адреса, предложения и коды.")}
    <div class="admin-actions"><a class="button button-outline" href="/partner/login">Войти</a><button class="button button-outline" data-partner-logout>Выйти</button></div>
    <nav class="tab-nav" data-tabs="partner" aria-label="Разделы кабинета партнёра">
      <a data-tab-link="overview" href="/partner/dashboard?tab=overview">Обзор</a>
      <a data-tab-link="addresses" href="/partner/dashboard?tab=addresses">Адреса</a>
      <a data-tab-link="offers" href="/partner/dashboard?tab=offers">Предложения</a>
      <a data-tab-link="bookings" href="/partner/dashboard?tab=bookings">Коды и брони</a>
      <a data-tab-link="profile" href="/partner/dashboard?tab=profile">Профиль</a>
      <a data-tab-link="help" href="/partner/dashboard?tab=help">Помощь</a>
    </nav>
    <div class="stats-row admin-stats" data-partner-stats></div>
    <div class="admin-grid">
      <article class="panel-card tab-panel" data-tab-panel="overview"><h3>Обзор</h3><p class="empty-state">В кабинете показаны только данные партнёра из текущей сессии.</p></article>
      <article class="panel-card tab-panel" data-tab-panel="addresses"><h3>Адреса</h3><form class="mini-form" data-partner-create-address><input name="title" required placeholder="Основная точка" /><input name="city" required value="Армавир" /><input name="address" required placeholder="Армавир, ул. Тестовая, 1" /><button class="button button-primary" type="submit">Добавить адрес</button></form><div class="table-wrap" data-partner-addresses></div></article>
      <article class="panel-card tab-panel" data-tab-panel="offers"><h3>Предложения</h3><form class="mini-form" data-partner-create-offer><input name="addressId" required placeholder="address id" /><input name="title" required maxlength="120" placeholder="Название" /><select name="category"><option value="lunch">Обед</option><option value="bakery">Выпечка</option><option value="evening">Вечернее</option></select><input name="price" required type="number" min="1" placeholder="Цена" /><input name="oldPrice" type="number" min="1" placeholder="Старая цена" /><input name="pickupWindow" required maxlength="40" placeholder="15:30–18:00" /><input name="totalQuantity" required type="number" min="0" placeholder="Количество" /><input name="remainingQuantity" type="number" min="0" placeholder="Остаток" /><select name="status"><option value="active">Активно</option><option value="paused">Пауза</option></select><button class="button button-primary" type="submit">Добавить предложение</button></form><div class="table-wrap" data-partner-offers></div></article>
      <article class="panel-card tab-panel" data-tab-panel="bookings"><h3>Коды и брони</h3><div class="table-wrap" data-partner-bookings></div></article>
      <article class="panel-card tab-panel" data-tab-panel="profile"><h3>Профиль</h3><form class="mini-form" data-partner-profile-form><input name="name" maxlength="120" placeholder="Название партнёра" /><input name="contactName" maxlength="80" placeholder="Контактное лицо" /><input name="phone" maxlength="30" placeholder="+7 900 000-00-00" /><input name="email" maxlength="120" placeholder="email@example.test" /><button class="button button-primary" type="submit">Сохранить профиль</button></form><div class="table-wrap" data-partner-profile></div></article>
      <article class="panel-card tab-panel" data-tab-panel="help"><h3>Помощь</h3><p class="empty-state">Если код не находится, проверьте дату предложения и статус брони. Для доступа используйте partner Basic Auth и логин пользователя партнёра.</p></article>
    </div>
  </section>`;
}

function renderBody(pathname) {
  if (pathname === "/") return homePage();
  if (pathname === "/how-it-works") return howItWorksPage();
  if (pathname === "/partners") return partnersPage();
  if (pathname === "/contacts") return contactsPage();
  if (pathname === "/privacy") return privacyPage();
  if (pathname === "/personal-data-consent") return personalDataConsentPage();
  if (pathname === "/terms") return termsPage();
  if (pathname === "/partner-terms") return partnerTermsPage();
  if (pathname === "/admin") return adminPage();
  if (pathname === "/partner/login") return partnerLoginPage();
  if (pathname === "/partner/dashboard") return partnerDashboardPage();
  return "";
}

function renderPage(pathname) {
  const titles = {
    "/": "Бери сегодня",
    "/how-it-works": "Как это работает",
    "/partners": "Партнёрам",
    "/contacts": "Контакты",
    "/privacy": "Политика",
    "/personal-data-consent": "Согласие на обработку ПДн",
    "/terms": "Правила сервиса",
    "/partner-terms": "Условия партнёров",
    "/admin": "Админ",
    "/partner/login": "Вход партнёра",
    "/partner/dashboard": "Панель партнёра"
  };
  const isAppPage = pathname === "/admin" || pathname.startsWith("/partner/");
  const pageOffers = getPageOffers();

  return `<!doctype html>
  <html lang="ru">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex,nofollow" />
      <title>${titles[pathname] || "Бери сегодня"} · Бери сегодня</title>
      <link rel="stylesheet" href="/styles.css" />
      <script>window.DEFAULT_OFFERS=${json(pageOffers)};</script>
      <script>window.PUBLIC_CONFIG=${json({ demoMode: config.demoMode, appName: config.appName, appCity: config.appCity })};</script>
    </head>
    <body>
      ${header(pathname)}
      <main>${renderBody(pathname)}</main>
      ${footer()}
      ${bookingModal()}
      ${isAppPage ? `<script src="/app.js"></script>` : `<script>${PUBLIC_JS}</script>`}
    </body>
  </html>`;
}

function bookingModal() {
  return `<div class="modal" id="booking-modal" hidden>
    <div class="modal-backdrop" data-close-modal></div>
    <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <button class="modal-close" type="button" data-close-modal>×</button>
      <div data-booking-step="form">
        <h2 id="booking-title">Получить код</h2>
        <div class="booking-summary" id="booking-summary"></div>
        <form class="booking-form" id="booking-form">
          <label>Имя<input name="customerName" required maxlength="80" placeholder="Ваше имя" /></label>
          <label>Телефон<input name="customerPhone" required minlength="7" maxlength="30" pattern="[+0-9 ()-]{7,30}" placeholder="+7 (___) ___-__-__" /></label>
          <label class="consent"><input type="checkbox" name="personalDataConsent" required /><span>Я согласен на <a href="/personal-data-consent" target="_blank" rel="noopener">обработку персональных данных</a> и принимаю <a href="/privacy" target="_blank" rel="noopener">Политику обработки персональных данных</a></span></label>
          <p class="form-error" hidden></p>
          <button class="button button-primary" type="submit">Получить код</button>
        </form>
      </div>
      <div class="booking-success" data-booking-step="success" hidden>
        <h2>Ваш код</h2>
        <strong id="booking-code">BS-1042</strong>
        <p>Покажите код в заведении и оплатите заказ на кассе.</p>
        <button class="button button-outline" type="button" data-close-modal>Закрыть</button>
      </div>
    </section>
  </div>`;
}

const PUBLIC_JS = `
(function () {
  var offers = window.DEFAULT_OFFERS || [];
  var selectedOffer = null;

  function api(path, options) {
    options = options || {};
    return fetch(path, {
      credentials: "same-origin",
      headers: Object.assign({ "Content-Type": "application/json" }, options.headers || {}),
      method: options.method || "GET",
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      return response.json().catch(function () {
        return { ok: false, error: { message: "Некорректный ответ сервера" } };
      }).then(function (payload) {
        if (!response.ok || !payload.ok) {
          var error = new Error((payload.error && payload.error.message) || "Ошибка сервера");
          error.status = response.status;
          throw error;
        }
        return payload.data;
      });
    });
  }

  function formObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function setFilter(category) {
    var visibleCount = 0;
    document.querySelectorAll("[data-offer-card]").forEach(function (card) {
      var visible = category === "all" || card.dataset.category === category;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    var empty = document.getElementById("offers-empty");
    if (empty) empty.hidden = visibleCount > 0;
  }

  document.addEventListener("click", function (event) {
    var filter = event.target.closest(".filter");
    if (filter) {
      event.preventDefault();
      document.querySelectorAll(".filter").forEach(function (item) { item.classList.remove("active"); });
      filter.classList.add("active");
      setFilter(filter.dataset.filter || "all");
      return;
    }

    var opener = event.target.closest(".js-open-booking");
    if (opener) {
      event.preventDefault();
      selectedOffer = offers.find(function (offer) { return offer.id === opener.dataset.offerId; });
      if (!selectedOffer) return;
      var modal = document.getElementById("booking-modal");
      var form = document.getElementById("booking-form");
      var summary = document.getElementById("booking-summary");
      if (!modal || !form || !summary) return;
      var pickupWindow = selectedOffer.pickupWindow || selectedOffer.pickup_window || "";
      summary.innerHTML = "<h3>" + selectedOffer.title + "</h3><p>" + (selectedOffer.partnerName || "Заведение") + " · " + (selectedOffer.address || "") + "</p><p><b>" + selectedOffer.price + " ₽</b> · " + pickupWindow + "</p>";
      document.querySelector('[data-booking-step="form"]').hidden = false;
      document.querySelector('[data-booking-step="success"]').hidden = true;
      form.reset();
      modal.hidden = false;
      return;
    }

    if (event.target.closest("[data-close-modal]")) {
      var modalClose = document.getElementById("booking-modal");
      if (modalClose) modalClose.hidden = true;
    }
  });

  var bookingForm = document.getElementById("booking-form");
  if (bookingForm) {
    bookingForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!selectedOffer) return;
      if (!bookingForm.checkValidity()) {
        bookingForm.reportValidity();
        return;
      }
      var error = bookingForm.querySelector(".form-error");
      if (error) error.hidden = true;
      var data = formObject(bookingForm);
      api("/api/public/bookings", {
        method: "POST",
        body: { offerId: selectedOffer.id, customerName: data.customerName, customerPhone: data.customerPhone }
      }).then(function (result) {
        document.getElementById("booking-code").textContent = result.code;
        document.querySelector('[data-booking-step="form"]').hidden = true;
        document.querySelector('[data-booking-step="success"]').hidden = false;
      }).catch(function (err) {
        if (error) {
          error.textContent = err.status === 409 ? "Предложение уже закончилось." : err.message;
          error.hidden = false;
        }
      });
    });
  }

  document.querySelectorAll(".smart-form[data-form]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      var type = form.dataset.form;
      var error = form.querySelector(".form-error");
      if (error) error.hidden = true;
      var data = formObject(form);
      var request = type === "partner"
        ? api("/api/public/partner-applications", { method: "POST", body: Object.assign({}, data, { offerFormats: String(data.offerFormats || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean) }) })
        : api("/api/public/contact-requests", { method: "POST", body: data });
      request.then(function () {
        form.hidden = true;
        var success = document.querySelector('[data-success="' + type + '"]');
        if (success) success.hidden = false;
      }).catch(function (err) {
        if (error) {
          error.textContent = err.message || "Не удалось отправить данные. Попробуйте позже.";
          error.hidden = false;
        }
      });
    });
  });
})();
`;

const APP_JS = `
let offersState = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({ ok: false, error: { message: "Некорректный ответ сервера" } }));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error?.message || "Ошибка сервера");
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function loadOffers(category = "all") {
  const grid = document.getElementById("offers-grid");
  if (!grid) return;
  try {
    const query = category === "all" ? "" : "?category=" + encodeURIComponent(category);
    offersState = await api("/api/public/offers" + query);
    renderOffers(offersState);
  } catch {
    grid.innerHTML = '<p class="empty-state">Не удалось загрузить предложения. Попробуйте обновить страницу.</p>';
  }
}

function renderOffers(offers) {
  const grid = document.getElementById("offers-grid");
  if (!grid) return;
  const empty = document.getElementById("offers-empty");
  grid.innerHTML = offers.map((offer) => {
    const soldOut = Number(offer.remaining) <= 0 || offer.status === "sold_out";
    return '<article class="offer-card">' +
      '<div class="offer-image"><img src="/images/offer-food.jpg" alt="' + escapeHtml(offer.imageAlt) + '" loading="lazy" /></div>' +
      '<div class="offer-body"><p class="partner-name">' + escapeHtml(offer.partnerName) + '</p>' +
      '<h3>' + escapeHtml(offer.title) + '</h3>' +
      '<div class="price-line"><strong>' + offer.price + ' ₽</strong>' + (offer.oldPrice ? '<span>вместо ' + offer.oldPrice + ' ₽</span>' : '') + '</div>' +
      '<p class="meta">◷ ' + escapeHtml(offer.pickupWindow) + '</p>' +
      '<span class="stock-badge">' + (soldOut ? 'Распродано' : 'Осталось ' + offer.remaining) + '</span>' +
      '<button class="button button-primary js-open-booking" data-offer-id="' + offer.id + '"' + (soldOut ? ' disabled' : '') + '>' + (soldOut ? 'Распродано' : escapeHtml(offer.ctaLabel)) + '</button></div></article>';
  }).join("");
  if (empty) empty.hidden = offers.length > 0;
}

function setupFilters() {
  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      loadOffers(button.dataset.filter || "all");
    });
  });
}

function setupBooking() {
  const modal = document.getElementById("booking-modal");
  const form = document.getElementById("booking-form");
  if (!modal || !form) return;
  let selectedOffer = null;
  document.addEventListener("click", (event) => {
    const opener = event.target.closest(".js-open-booking");
    if (!opener) return;
    selectedOffer = offersState.find((offer) => offer.id === opener.dataset.offerId);
    if (!selectedOffer) return;
    document.querySelector('[data-booking-step="form"]').hidden = false;
    document.querySelector('[data-booking-step="success"]').hidden = true;
    document.getElementById("booking-summary").innerHTML =
      '<h3>' + escapeHtml(selectedOffer.title) + '</h3><p>' + escapeHtml(selectedOffer.partnerName) + ' · ' + escapeHtml(selectedOffer.address) + '</p><p><b>' + selectedOffer.price + ' ₽</b> · ' + escapeHtml(selectedOffer.pickupWindow) + '</p>';
    form.reset();
    modal.hidden = false;
  });
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => { modal.hidden = true; }));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const error = form.querySelector(".form-error");
    error.hidden = true;
    try {
      const data = formObject(form);
      const result = await api("/api/public/bookings", { method: "POST", body: { offerId: selectedOffer.id, customerName: data.customerName, customerPhone: data.customerPhone } });
      document.getElementById("booking-code").textContent = result.code;
      document.querySelector('[data-booking-step="form"]').hidden = true;
      document.querySelector('[data-booking-step="success"]').hidden = false;
      await loadOffers(document.querySelector(".filter.active")?.dataset.filter || "all");
    } catch (err) {
      error.textContent = err.status === 409 ? "Предложение уже закончилось." : err.message;
      error.hidden = false;
    }
  });
}

function setupPublicForms() {
  document.querySelectorAll(".smart-form[data-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const type = form.dataset.form;
      const error = form.querySelector(".form-error");
      error.hidden = true;
      try {
        const data = formObject(form);
        if (type === "partner") {
          await api("/api/public/partner-applications", {
            method: "POST",
            body: { ...data, offerFormats: String(data.offerFormats || "").split(",").map((item) => item.trim()).filter(Boolean) }
          });
        }
        if (type === "contact") await api("/api/public/contact-requests", { method: "POST", body: data });
        form.hidden = true;
        const success = document.querySelector('[data-success="' + type + '"]');
        if (success) success.hidden = false;
      } catch (err) {
        error.textContent = err.message || "Не удалось отправить данные. Попробуйте позже.";
        error.hidden = false;
      }
    });
  });
  document.querySelectorAll("[data-reset-form]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.resetForm;
      const form = document.querySelector('[data-form="' + type + '"]');
      const success = document.querySelector('[data-success="' + type + '"]');
      if (form) { form.reset(); form.hidden = false; }
      if (success) success.hidden = true;
    });
  });
}

function table(rows, columns, actions) {
  if (!rows || !rows.length) return '<p class="empty-state">Пока нет данных</p>';
  return '<table class="data-table"><thead><tr>' + columns.map((col) => '<th>' + col.label + '</th>').join('') + (actions ? '<th>Действия</th>' : '') + '</tr></thead><tbody>' +
    rows.map((row) => '<tr>' + columns.map((col) => '<td>' + escapeHtml(typeof col.value === "function" ? col.value(row) : row[col.value]) + '</td>').join('') + (actions ? '<td>' + actions(row) + '</td>' : '') + '</tr>').join('') + '</tbody></table>';
}

function setupTabs(rootSelector, validTabs) {
  const root = document.querySelector(rootSelector);
  if (!root) return () => {};
  const fallback = validTabs[0];
  const activate = (nextTab, replace = false) => {
    const params = new URLSearchParams(location.search);
    const tab = validTabs.includes(nextTab || params.get("tab")) ? (nextTab || params.get("tab")) : fallback;
    root.querySelectorAll("[data-tab-panel]").forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== tab; });
    root.querySelectorAll("[data-tab-link]").forEach((link) => { link.classList.toggle("active", link.dataset.tabLink === tab); });
    params.set("tab", tab);
    const nextUrl = location.pathname + "?" + params.toString();
    if (replace) history.replaceState(null, "", nextUrl);
    else if (location.search !== "?" + params.toString()) history.pushState(null, "", nextUrl);
  };
  root.querySelectorAll("[data-tab-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      activate(link.dataset.tabLink);
    });
  });
  window.addEventListener("popstate", () => activate(null, true));
  activate(null, true);
  return activate;
}

async function setupAdmin() {
  if (!document.querySelector("[data-admin-app]")) return;
  const loginBox = document.querySelector("[data-admin-login]");
  const dashboard = document.querySelector("[data-admin-dashboard]");
  const activateTabs = setupTabs("[data-admin-app]", ["overview", "partners", "offers", "bookings", "partner-applications", "contact-requests", "settings"]);
  const render = async () => {
    const data = await api("/api/admin/dashboard");
    loginBox.hidden = true; dashboard.hidden = false;
    document.querySelector("[data-admin-stats]").innerHTML = [
      ["Активные предложения", data.activeOffersCount], ["Получено кодов", data.bookingsCount], ["Выдано заказов", data.issuedBookingsCount], ["Новые заявки", data.newPartnerApplicationsCount], ["Новые обращения", data.newContactRequestsCount], ["Выручка", data.estimatedPartnerRevenue + " ₽"]
    ].map(([label, value]) => '<span><small>' + label + '</small><b>' + value + '</b></span>').join('');
    const partners = await api("/api/admin/partners");
    const offers = await api("/api/admin/offers");
    const bookings = await api("/api/admin/bookings");
    const applications = await api("/api/admin/partner-applications");
    const contacts = await api("/api/admin/contact-requests");
    const addresses = (await Promise.all(partners.map(async (partner) => (await api("/api/admin/partners/" + partner.id + "/addresses")).map((item) => ({ ...item, partnerName: partner.name }))))).flat();
    const users = (await Promise.all(partners.map(async (partner) => (await api("/api/admin/partners/" + partner.id + "/users")).map((item) => ({ ...item, partnerName: partner.name }))))).flat();
    document.querySelector("[data-admin-service]").innerHTML = table([{ name: "Storage", value: "server-side JSON" }, { name: "Public API", value: "enabled" }, { name: "Admin/Partner API", value: "Basic Auth + session" }], [{ label: "Проверка", value: "name" }, { label: "Статус", value: "value" }]);
    document.querySelector("[data-admin-partners]").innerHTML = table(partners, [{ label: "ID", value: "id" }, { label: "Название", value: "name" }, { label: "Тип", value: "type" }, { label: "Статус", value: "status" }]);
    document.querySelector("[data-admin-addresses]").innerHTML = table(addresses, [{ label: "ID", value: "id" }, { label: "Партнёр", value: "partnerName" }, { label: "Название", value: "title" }, { label: "Адрес", value: "address" }]);
    document.querySelector("[data-admin-users]").innerHTML = table(users, [{ label: "ID", value: "id" }, { label: "Партнёр", value: "partnerName" }, { label: "Логин", value: "login" }, { label: "Роль", value: "role" }, { label: "Статус", value: "status" }]);
    document.querySelector("[data-admin-offers]").innerHTML = table(offers, [{ label: "ID", value: "id" }, { label: "Название", value: "title" }, { label: "Партнёр", value: "partner_id" }, { label: "Осталось", value: "remaining_quantity" }, { label: "Статус", value: "status" }]);
    document.querySelector("[data-admin-bookings]").innerHTML = table(bookings, [{ label: "Код", value: "code" }, { label: "Предложение", value: "offerTitle" }, { label: "Клиент", value: "customer_name" }, { label: "Статус", value: "status" }], (row) => '<button data-booking-status="' + row.id + '" data-status="issued">Выдан</button> <button data-booking-status="' + row.id + '" data-status="no_show">Не пришёл</button> <button data-booking-status="' + row.id + '" data-status="cancelled">Отменён</button>');
    document.querySelector("[data-admin-applications]").innerHTML = table(applications, [{ label: "Заведение", value: "venue_name" }, { label: "Телефон", value: "phone" }, { label: "Статус", value: "status" }], (row) => '<button data-create-partner="' + row.id + '">Создать партнёра</button>');
    document.querySelector("[data-admin-contacts]").innerHTML = table(contacts, [{ label: "Имя", value: "name" }, { label: "Телефон", value: "phone" }, { label: "Тип", value: "type" }, { label: "Статус", value: "status" }], (row) => '<button data-contact-status="' + row.id + '" data-status="in_progress">В работу</button> <button data-contact-status="' + row.id + '" data-status="closed">Закрыть</button>');
    activateTabs(null, true);
  };
  document.querySelector("[data-admin-login-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = event.currentTarget.querySelector(".form-error");
    try { await api("/api/admin/auth/login", { method: "POST", body: formObject(event.currentTarget) }); await render(); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
  });
  document.querySelector("[data-admin-refresh]")?.addEventListener("click", render);
  document.querySelector("[data-admin-logout]")?.addEventListener("click", async () => { await api("/api/admin/auth/logout", { method: "POST" }); location.reload(); });
  document.querySelector("[data-admin-create-partner]")?.addEventListener("submit", async (event) => { event.preventDefault(); await api("/api/admin/partners", { method: "POST", body: formObject(event.currentTarget) }); event.currentTarget.reset(); await render(); });
  document.querySelector("[data-admin-create-address]")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); await api("/api/admin/partners/" + data.partnerId + "/addresses", { method: "POST", body: data }); event.currentTarget.reset(); await render(); });
  document.querySelector("[data-admin-create-user]")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); await api("/api/admin/partners/" + data.partnerId + "/users", { method: "POST", body: data }); event.currentTarget.reset(); await render(); });
  document.querySelector("[data-admin-create-offer]")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); await api("/api/admin/offers", { method: "POST", body: { ...data, totalQuantity: Number(data.totalQuantity), remainingQuantity: Number(data.totalQuantity), price: Number(data.price), ctaLabel: "Получить код", status: "active" } }); event.currentTarget.reset(); await render(); });
  document.addEventListener("click", async (event) => {
    const booking = event.target.closest("[data-booking-status]");
    const createPartner = event.target.closest("[data-create-partner]");
    const contact = event.target.closest("[data-contact-status]");
    if (booking) { await api("/api/admin/bookings/" + booking.dataset.bookingStatus + "/status", { method: "PATCH", body: { status: booking.dataset.status } }); await render(); }
    if (createPartner) { await api("/api/admin/partner-applications/" + createPartner.dataset.createPartner + "/create-partner", { method: "POST" }); await render(); }
    if (contact) { await api("/api/admin/contact-requests/" + contact.dataset.contactStatus + "/status", { method: "PATCH", body: { status: contact.dataset.status } }); await render(); }
  });
  try { await api("/api/admin/auth/me"); await render(); } catch {}
}

async function setupPartnerLogin() {
  const form = document.querySelector("[data-partner-login-form]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = form.querySelector(".form-error");
    try { await api("/api/partner/auth/login", { method: "POST", body: formObject(form) }); location.href = "/partner/dashboard"; }
    catch (err) { error.textContent = err.message; error.hidden = false; }
  });
}

async function setupPartnerDashboard() {
  if (!document.querySelector("[data-partner-dashboard-app]")) return;
  const activateTabs = setupTabs("[data-partner-dashboard-app]", ["overview", "addresses", "offers", "bookings", "profile", "help"]);
  const render = async () => {
    const data = await api("/api/partner/dashboard");
    const profile = await api("/api/partner/profile");
    document.querySelector("[data-partner-stats]").innerHTML = [
      ["Активные предложения", data.activeOffersCount], ["Коды", data.bookingsCount], ["Выдано", data.issuedBookingsCount], ["Не пришли", data.noShowBookingsCount], ["Выручка", data.estimatedRevenue + " ₽"]
    ].map(([label, value]) => '<span><small>' + label + '</small><b>' + value + '</b></span>').join('');
    document.querySelector("[data-partner-addresses]").innerHTML = table(await api("/api/partner/addresses"), [{ label: "ID", value: "id" }, { label: "Название", value: "title" }, { label: "Адрес", value: "address" }]);
    document.querySelector("[data-partner-offers]").innerHTML = table(await api("/api/partner/offers"), [{ label: "ID", value: "id" }, { label: "Название", value: "title" }, { label: "Осталось", value: "remaining_quantity" }, { label: "Статус", value: "status" }]);
    document.querySelector("[data-partner-bookings]").innerHTML = table(await api("/api/partner/bookings"), [{ label: "Код", value: "code" }, { label: "Предложение", value: "offerTitle" }, { label: "Статус", value: "status" }], (row) => '<button data-partner-booking="' + row.id + '" data-status="issued">Выдан</button> <button data-partner-booking="' + row.id + '" data-status="no_show">Не пришёл</button> <button data-partner-booking="' + row.id + '" data-status="cancelled">Отменён</button>');
    document.querySelector("[data-partner-profile]").innerHTML = table([profile], [{ label: "ID", value: "id" }, { label: "Название", value: "name" }, { label: "Тип", value: "type" }, { label: "Статус", value: "status" }]);
    const profileForm = document.querySelector("[data-partner-profile-form]");
    if (profileForm && !profileForm.dataset.loaded) {
      profileForm.name.value = profile.name || "";
      profileForm.contactName.value = profile.contact_name || "";
      profileForm.phone.value = profile.phone || "";
      profileForm.email.value = profile.email || "";
      profileForm.dataset.loaded = "true";
    }
    activateTabs(null, true);
  };
  document.querySelector("[data-partner-create-address]")?.addEventListener("submit", async (event) => { event.preventDefault(); await api("/api/partner/addresses", { method: "POST", body: formObject(event.currentTarget) }); event.currentTarget.reset(); await render(); });
  document.querySelector("[data-partner-create-offer]")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); await api("/api/partner/offers", { method: "POST", body: { ...data, totalQuantity: Number(data.totalQuantity), remainingQuantity: Number(data.totalQuantity), price: Number(data.price), ctaLabel: "Получить код", status: "active" } }); event.currentTarget.reset(); await render(); });
  document.querySelector("[data-partner-profile-form]")?.addEventListener("submit", async (event) => { event.preventDefault(); await api("/api/partner/profile", { method: "PATCH", body: formObject(event.currentTarget) }); await render(); });
  document.querySelector("[data-partner-logout]")?.addEventListener("click", async () => { await api("/api/partner/auth/logout", { method: "POST" }); location.href = "/partner/login"; });
  document.addEventListener("click", async (event) => {
    const booking = event.target.closest("[data-partner-booking]");
    if (booking) { await api("/api/partner/bookings/" + booking.dataset.partnerBooking + "/status", { method: "PATCH", body: { status: booking.dataset.status } }); await render(); }
  });
  try { await render(); } catch { document.querySelector("[data-partner-dashboard-app]").insertAdjacentHTML("beforeend", '<p class="empty-state">Войдите в кабинет партнёра.</p>'); }
}

loadOffers();
setupFilters();
setupBooking();
setupPublicForms();
setupAdmin();
setupPartnerLogin();
setupPartnerDashboard();
`;

const STYLES = `
:root {
  --color-primary: #B84A2B;
  --color-primary-dark: #8F321F;
  --color-primary-soft: #E8A071;
  --color-accent: #C9954E;
  --color-accent-soft: #F3D8B4;
  --color-bg: #FBF6EF;
  --color-bg-soft: #F6EDE2;
  --color-card: #FFFFFF;
  --color-text: #241815;
  --color-text-soft: #3A2A25;
  --color-muted: #7A6A61;
  --color-border: #E8D8C9;
  --color-border-soft: #F1E5DA;
  --color-success-bg: #E4F4E8;
  --color-success-text: #337A4A;
  --color-warning-bg: #FFF1CF;
  --color-warning-text: #8A6418;
  --shadow: 0 18px 50px rgba(64, 33, 20, .12);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--color-text);
  background: linear-gradient(180deg, #fffaf5 0%, var(--color-bg) 34%, #fffaf5 100%);
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
button, input, select, textarea { font: inherit; }
img { max-width: 100%; display: block; }
.site-header {
  width: min(100% - 72px, 1180px);
  height: 112px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 230px 1fr auto;
  gap: 24px;
  align-items: center;
}
.brand { display: flex; align-items: center; gap: 14px; }
.brand::before {
  content: "БС";
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: white;
  font-weight: 900;
  background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
}
.brand strong { display: block; font-size: 22px; color: var(--color-primary); }
.brand small { display: block; margin-top: 3px; color: var(--color-muted); }
.site-nav { display: flex; justify-content: center; gap: 34px; font-weight: 800; }
.site-nav a { position: relative; padding: 10px 0; }
.site-nav a.active { color: var(--color-primary); }
.site-nav a.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -7px;
  height: 2px;
  border-radius: 99px;
  background: var(--color-primary);
}
.button {
  min-height: 52px;
  border: 1px solid transparent;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 24px;
  cursor: pointer;
  font-weight: 900;
  white-space: nowrap;
  transition: transform .16s ease, box-shadow .16s ease, background .16s ease;
}
.button:hover { transform: translateY(-1px); }
.button-primary {
  color: #fffaf5;
  background: linear-gradient(180deg, #d84b20, #b73616);
  box-shadow: 0 12px 24px rgba(184, 74, 43, .24);
}
.button-outline {
  color: var(--color-primary);
  background: rgba(255,255,255,.72);
  border-color: var(--color-primary);
}
.header-cta { border-radius: 10px; }
main { overflow: hidden; }
.hero {
  width: min(100% - 72px, 1180px);
  min-height: 478px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, .94fr) minmax(440px, 1fr);
  align-items: center;
  gap: 56px;
}
.home-hero { min-height: 520px; }
.hero-copy h1 {
  margin: 0;
  max-width: 620px;
  font-size: clamp(42px, 5.4vw, 64px);
  line-height: 1.07;
  letter-spacing: 0;
}
.hero-copy p {
  max-width: 560px;
  margin: 22px 0 0;
  color: var(--color-muted);
  font-size: 19px;
  line-height: 1.55;
}
.actions { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 32px; }
.hero-badges, .badges {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 38px;
}
.badge, .stock-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 7px 13px;
  border-radius: 8px;
  color: var(--color-text-soft);
  background: var(--color-warning-bg);
  border: 1px solid #f2daa5;
  font-weight: 800;
  font-size: 14px;
}
.badge.success {
  color: var(--color-success-text);
  background: var(--color-success-bg);
  border-color: #c9e8d1;
}
.featured-offer {
  min-height: 350px;
  padding: 16px;
  display: grid;
  grid-template-columns: 1fr .95fr;
  gap: 22px;
  border-radius: 24px;
  background: rgba(255,255,255,.92);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow);
}
.featured-photo, .offer-image, .large-photo, .strip-photo, .cta-photo, .dash-photo, .contact-photo, .code-photo {
  overflow: hidden;
  border-radius: 18px;
  background: linear-gradient(135deg, var(--color-accent-soft), var(--color-bg-soft));
}
.featured-photo img, .offer-image img, .large-photo img, .strip-photo img, .cta-photo img, .dash-photo img, .contact-photo img, .code-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.featured-copy { padding: 10px 2px 0; }
.partner-name {
  margin: 0 0 8px;
  color: var(--color-primary);
  font-weight: 900;
}
.featured-copy h2 { margin: 0 0 12px; font-size: 28px; line-height: 1.06; }
.meta { color: var(--color-muted); font-size: 15px; margin: 11px 0; }
.price-line { display: flex; align-items: baseline; gap: 11px; margin: 14px 0; }
.price-line strong { color: var(--color-primary); font-size: 34px; line-height: 1; }
.price-line span { color: var(--color-muted); text-decoration: line-through; }
.featured-copy .button, .offer-body .button { width: 100%; margin-top: 16px; }
.cash-note { text-align: center; color: var(--color-muted); font-weight: 700; }
.section {
  width: min(100% - 72px, 1180px);
  margin: 0 auto 26px;
  padding: 0;
}
.section-white {
  width: 100%;
  padding: 24px max(36px, calc((100vw - 1180px) / 2)) 28px;
  background: rgba(255,255,255,.62);
  border-top: 1px solid var(--color-border-soft);
  border-bottom: 1px solid var(--color-border-soft);
}
.section-title { margin-bottom: 18px; }
.section-title h2 {
  margin: 0;
  font-size: clamp(28px, 3.2vw, 38px);
  line-height: 1.1;
}
.section-title p { max-width: 760px; color: var(--color-muted); line-height: 1.5; }
.kicker { color: var(--color-primary-dark); font-weight: 900; text-transform: uppercase; letter-spacing: 0; font-size: 13px; }
.filters { display: flex; gap: 10px; overflow-x: auto; padding: 2px 0 18px; }
.filter {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 9px 18px;
  background: white;
  color: var(--color-text-soft);
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
.filter.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }
.offers-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.offer-card {
  display: grid;
  grid-template-columns: .9fr 1fr;
  gap: 16px;
  min-height: 230px;
  padding: 14px;
  border-radius: 18px;
  background: white;
  border: 1px solid var(--color-border);
}
.offer-body h3 { margin: 0; font-size: 20px; line-height: 1.12; }
.offer-body .price-line { display: block; margin: 10px 0; }
.offer-body .price-line strong { display: block; font-size: 27px; }
.offer-body .price-line span { display: block; margin-top: 3px; }
.empty-state {
  padding: 22px;
  border: 1px dashed var(--color-border);
  border-radius: 18px;
  background: white;
  color: var(--color-muted);
}
.compact-section {
  margin-top: 28px;
  padding: 30px;
  border-radius: 20px;
  background: rgba(255,255,255,.74);
  border: 1px solid var(--color-border);
}
.compact-section .section-title { text-align: center; }
.steps-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}
.step-card, .info-card, .panel-card, .accent-card, .contact-card, .partner-dashboard {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: rgba(255,255,255,.86);
  box-shadow: 0 8px 22px rgba(64, 33, 20, .05);
}
.step-card { min-height: 160px; padding: 22px; }
.step-number {
  position: absolute;
  top: 20px;
  left: 20px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--color-primary);
  color: white;
  font-weight: 900;
}
.line-icon {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  margin-bottom: 12px;
  border-radius: 14px;
  color: var(--color-primary);
  border: 2px solid currentColor;
  font-size: 28px;
  font-weight: 900;
}
.step-card .line-icon { margin-left: 54px; }
.step-card h3, .info-card h3, .panel-card h3 { margin: 0 0 9px; font-size: 18px; line-height: 1.18; }
.step-card p, .info-card p, .panel-card p, .accent-card p { margin: 0; color: var(--color-muted); line-height: 1.45; font-size: 14px; }
.center-note { text-align: center; color: var(--color-muted); margin: 20px 0 0; }
.info-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}
.info-card { min-height: 128px; padding: 22px; display: grid; grid-template-columns: 56px 1fr; gap: 14px; }
.info-card .line-icon { margin: 0; }
.partner-strip, .bottom-cta {
  width: min(100% - 72px, 1180px);
  margin: 0 auto 34px;
  padding: 14px;
  min-height: 150px;
  display: grid;
  grid-template-columns: 260px 1fr auto;
  align-items: center;
  gap: 26px;
  border-radius: 18px;
  border: 1px solid var(--color-border);
  background: linear-gradient(100deg, #fff7eb, #fffdf9 55%, #ffe9ce);
}
.strip-photo, .cta-photo { height: 130px; }
.partner-strip h2, .bottom-cta h2 { margin: 0 0 10px; font-size: 28px; line-height: 1.1; }
.partner-strip p, .bottom-cta p { color: var(--color-muted); margin: 0; line-height: 1.45; }
.strip-cards {
  display: grid;
  grid-template-columns: repeat(3, 120px);
  gap: 12px;
}
.strip-cards .info-card {
  min-height: 104px;
  display: block;
  padding: 14px;
  text-align: center;
}
.strip-cards .line-icon { margin: 0 auto 8px; width: 42px; height: 42px; font-size: 22px; border-width: 1px; }
.strip-cards h3 { font-size: 14px; }
.booking-preview {
  position: relative;
  min-height: 340px;
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 16px;
  padding: 16px;
  border-radius: 24px;
  background: rgba(255,255,255,.92);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow);
}
.browser-dots { position: absolute; top: 18px; left: 24px; display: flex; gap: 6px; }
.browser-dots span { width: 10px; height: 10px; border-radius: 50%; background: #e74722; }
.browser-dots span:nth-child(2) { background: #f2b949; }
.browser-dots span:nth-child(3) { background: #4ab56a; }
.code-card {
  align-self: end;
  padding: 24px;
  border-radius: 16px;
  border: 1px solid var(--color-border);
  background: #fffaf5;
}
.code-card p { margin: 0 0 10px; font-weight: 800; }
.code-card strong {
  display: block;
  color: var(--color-primary);
  font-size: 42px;
  margin-bottom: 14px;
}
.code-card span, .code-card small { display: block; color: var(--color-muted); line-height: 1.45; margin-top: 9px; }
.code-photo { min-height: 292px; }
.float-badge {
  position: absolute;
  right: -28px;
  bottom: 20px;
  min-width: 150px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 18px;
  background: white;
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow);
}
.float-badge .line-icon { width: 42px; height: 42px; margin: 0; font-size: 22px; }
.partner-explain {
  display: grid;
  grid-template-columns: 1.1fr 1.2fr .86fr;
  gap: 22px;
  align-items: stretch;
}
.large-photo { min-height: 230px; }
.panel-card { padding: 24px; }
.check-list { margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 13px; }
.check-list li { position: relative; padding-left: 28px; color: var(--color-text-soft); }
.check-list li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--color-primary);
  font-weight: 900;
}
.mini-stack { display: grid; gap: 14px; }
.mini-stack .info-card { min-height: auto; }
.partner-dashboard {
  padding: 18px;
  border-radius: 22px;
  box-shadow: var(--shadow);
}
.partner-dashboard h2 { margin: 0 0 14px; }
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.stats-row span {
  min-height: 76px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: white;
}
.stats-row small { display: block; color: var(--color-primary); font-size: 11px; line-height: 1.1; }
.stats-row b { display: block; margin-top: 10px; font-size: 24px; }
.dashboard-main { display: grid; grid-template-columns: 1.3fr .9fr; gap: 12px; margin-top: 14px; }
.dash-offer { display: grid; grid-template-columns: 130px 1fr; gap: 14px; padding: 12px; border: 1px solid var(--color-border); border-radius: 14px; background: white; }
.dash-offer img { height: 130px; border-radius: 12px; object-fit: cover; }
.dash-offer h3 { margin: 0 0 8px; }
.dash-offer strong { color: var(--color-primary); font-size: 24px; }
.dash-offer dl { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 12px; margin: 10px 0; font-size: 13px; }
.dash-offer dt { color: var(--color-muted); }
.dash-offer dd { margin: 0; font-weight: 800; }
.dash-photo { min-height: 210px; }
.dash-badge { right: -28px; bottom: 14px; }
.category-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; }
.category-grid article {
  padding: 14px;
  border-radius: 16px;
  background: white;
  border: 1px solid var(--color-border);
}
.category-grid h3 { margin: 8px 0 10px; font-size: 18px; }
.food-strip { height: 78px; border-radius: 12px; overflow: hidden; }
.pilot-grid {
  display: grid;
  grid-template-columns: 1.4fr .94fr;
  gap: 28px;
}
.two-columns { grid-template-columns: 1fr 1fr; }
.accent-card {
  padding: 28px;
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 22px;
  align-items: center;
  background: linear-gradient(135deg, #fff4e5, #fffaf4);
}
.calendar-mark {
  width: 92px;
  height: 92px;
  display: grid;
  place-items: center;
  border: 5px solid var(--color-primary);
  border-radius: 20px;
  color: var(--color-primary);
  font-size: 38px;
  font-weight: 900;
}
.form-section { padding: 30px; border: 1px solid var(--color-border); border-radius: 22px; background: rgba(255,255,255,.72); }
.demo-notice {
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: 12px;
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  border: 1px solid #f1d99e;
  font-weight: 800;
  line-height: 1.45;
}
.smart-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
label { display: grid; gap: 8px; color: var(--color-text-soft); font-weight: 800; }
input, select, textarea {
  width: 100%;
  min-height: 48px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: white;
  color: var(--color-text);
  padding: 0 14px;
  outline: none;
}
textarea { min-height: 110px; padding-top: 14px; resize: vertical; }
input:focus, select:focus, textarea:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(184, 74, 43, .12); }
.full { grid-column: 1 / -1; }
.consent {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  max-width: 720px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}
.consent input {
  width: 18px;
  height: 18px;
  min-height: 18px;
  margin: 2px 0 0;
  padding: 0;
  accent-color: var(--color-primary);
}
.consent span { display: block; min-width: 0; }
.consent a { color: var(--color-primary); text-decoration: underline; text-underline-offset: 3px; }
.form-error { grid-column: 1 / -1; margin: 0; color: #9E2F22; font-weight: 800; }
.success-box {
  padding: 24px;
  border-radius: 18px;
  border: 1px solid #c9e8d1;
  background: var(--color-success-bg);
  color: var(--color-success-text);
}
.contact-card {
  display: grid;
  grid-template-columns: 1fr .98fr;
  gap: 18px;
  padding: 16px;
  box-shadow: var(--shadow);
}
.contact-list { padding: 10px; }
.contact-list p {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 12px;
  align-items: center;
  margin: 0 0 18px;
}
.contact-list b { display: block; color: var(--color-text); }
.contact-list span { color: var(--color-muted); font-weight: 700; }
.contact-photo { min-height: 250px; }
.contact-form-layout {
  display: grid;
  grid-template-columns: 1.35fr .86fr;
  gap: 32px;
  align-items: start;
}
.side-stack { display: grid; gap: 18px; }
.side-stack .info-card { border: 0; box-shadow: none; padding: 12px 0; background: transparent; }
.city-card {
  min-height: 178px;
  padding: 24px;
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid var(--color-border);
  background: linear-gradient(135deg, #fff2df, #fff9f0);
}
.city-card h3 { margin: 0 0 8px; font-size: 28px; }
.city-card p { color: var(--color-muted); max-width: 260px; }
.city-lines {
  position: absolute;
  right: 18px;
  bottom: 16px;
  width: 210px;
  height: 80px;
  opacity: .46;
  background:
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 0 70px / 190px 2px no-repeat,
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 30px 45px / 2px 27px no-repeat,
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 70px 30px / 2px 42px no-repeat,
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 120px 18px / 2px 54px no-repeat,
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 160px 38px / 2px 34px no-repeat;
}
.faq-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
}
.faq-item {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: white;
  overflow: hidden;
}
.faq-item summary {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 18px;
  cursor: pointer;
  font-weight: 900;
}
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item b {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-border);
  color: var(--color-primary);
}
.faq-item[open] b { background: var(--color-primary); color: white; }
.faq-item p { margin: 0; padding: 0 18px 18px 56px; color: var(--color-muted); line-height: 1.45; }
.bottom-cta { grid-template-columns: 260px 1fr 220px 120px; }
.cta-actions { display: grid; gap: 12px; }
.shop-line {
  height: 100px;
  opacity: .42;
  background:
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 10px 25px / 90px 3px no-repeat,
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 20px 55px / 70px 3px no-repeat,
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 25px 20px / 3px 70px no-repeat,
    linear-gradient(var(--color-primary-soft), var(--color-primary-soft)) 85px 20px / 3px 70px no-repeat;
}
.site-footer {
  width: min(100% - 72px, 1180px);
  margin: 0 auto;
  padding: 26px 0 34px;
  border-top: 1px solid var(--color-border);
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(260px, auto) minmax(220px, 1fr);
  align-items: center;
  gap: 14px 28px;
}
.footer-logo { color: var(--color-primary); font-size: 26px; font-weight: 900; }
.site-footer p, .footer-contacts, .footer-links, .footer-legal { color: var(--color-muted); }
.site-footer p { max-width: 330px; margin: 12px 0 0; line-height: 1.35; }
.footer-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px 28px;
  align-self: center;
}
.footer-legal {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px 24px;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-soft);
  font-size: 13px;
}
.footer-contacts {
  display: grid;
  justify-content: end;
  justify-items: end;
  gap: 10px;
  text-align: right;
  align-self: center;
}
.modal[hidden] { display: none; }
.modal { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 20px; }
.modal-backdrop { position: absolute; inset: 0; background: rgba(36, 24, 21, .42); }
.modal-panel {
  position: relative;
  z-index: 1;
  width: min(100%, 480px);
  padding: 28px;
  border-radius: 22px;
  background: white;
  border: 1px solid var(--color-border);
  box-shadow: 0 28px 90px rgba(30, 15, 10, .28);
}
.modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: white;
  cursor: pointer;
  font-size: 22px;
}
.booking-summary {
  padding: 16px;
  margin-bottom: 16px;
  border-radius: 14px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
}
.booking-summary h3 { margin: 0 0 8px; }
.booking-summary p { color: var(--color-muted); margin: 6px 0; }
.booking-form { display: grid; gap: 14px; }
.booking-success { text-align: center; }
.booking-success strong {
  display: block;
  color: var(--color-primary);
  font-size: 58px;
  margin: 18px 0;
}
.legal-page { margin-top: 50px; }
.legal-doc {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.legal-block ul { margin: 0; padding-left: 18px; color: var(--color-text-soft); line-height: 1.5; }
.legal-block li + li { margin-top: 8px; }
.hidden-hero { min-height: 520px; }
.app-panel {
  padding: 28px;
  border: 1px solid var(--color-border);
  border-radius: 22px;
  background: rgba(255,255,255,.74);
}
.auth-box {
  max-width: 560px;
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: white;
}
.auth-form { grid-template-columns: 1fr; }
.admin-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
.tab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0 0 18px;
}
.tab-nav a {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: white;
  color: var(--color-text);
  font-weight: 900;
  text-decoration: none;
}
.tab-nav a.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: white;
}
.tab-panel[hidden] { display: none !important; }
.admin-stats { margin-bottom: 20px; }
.admin-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.admin-grid .panel-card { overflow: hidden; }
.mini-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 12px 0 16px;
}
.mini-form .button { width: 100%; }
.table-wrap {
  max-width: 100%;
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 540px;
  font-size: 14px;
}
.data-table th,
.data-table td {
  padding: 10px;
  border-bottom: 1px solid var(--color-border-soft);
  text-align: left;
  vertical-align: top;
}
.data-table th {
  color: var(--color-muted);
  font-size: 12px;
  text-transform: uppercase;
}
.data-table button {
  min-height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-primary);
  font-weight: 800;
  cursor: pointer;
}
@media (max-width: 1024px) {
  .site-header { width: min(100% - 36px, 1180px); grid-template-columns: 1fr; height: auto; padding: 18px 0; }
  .site-nav { justify-content: flex-start; overflow-x: auto; }
  .header-cta { justify-self: start; }
  .hero, .section, .partner-strip, .bottom-cta, .site-footer { width: min(100% - 36px, 1180px); }
  .hero { grid-template-columns: 1fr; min-height: auto; padding: 54px 0 30px; }
  .featured-offer, .booking-preview, .contact-card { grid-template-columns: 1fr; }
  .offers-grid, .info-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .steps-grid, .category-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .partner-strip, .bottom-cta, .partner-explain, .pilot-grid, .contact-form-layout, .site-footer { grid-template-columns: 1fr; }
  .admin-grid { grid-template-columns: 1fr; }
  .strip-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .footer-links, .footer-legal { justify-content: flex-start; }
  .footer-contacts { justify-content: start; justify-items: start; text-align: left; }
  .float-badge { right: 16px; }
}
@media (max-width: 640px) {
  .site-header { width: min(100% - 24px, 1180px); }
  .brand strong { font-size: 19px; }
  .site-nav { gap: 20px; font-size: 14px; }
  .hero, .section, .partner-strip, .bottom-cta, .site-footer { width: min(100% - 24px, 1180px); }
  .hero-copy h1 { font-size: 40px; }
  .hero-copy p { font-size: 17px; }
  .button { width: 100%; }
  .offers-grid, .info-grid, .steps-grid, .category-grid, .smart-form, .faq-grid, .stats-row, .dashboard-main, .dash-offer, .two-columns, .legal-doc { grid-template-columns: 1fr; }
  .offer-card { grid-template-columns: 1fr; }
  .offer-image { height: 190px; }
  .section-white { padding-left: 12px; padding-right: 12px; }
  .featured-photo, .code-photo, .contact-photo, .dash-photo { min-height: 220px; }
  .price-line strong { font-size: 30px; }
  .strip-cards { grid-template-columns: 1fr; }
  .bottom-cta .shop-line { display: none; }
  .contact-list p { grid-template-columns: 42px 1fr; }
  .faq-item p { padding-left: 18px; }
}
`;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/styles.css") {
    sendText(response, 200, STYLES, { ...securityHeaders, "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  if (url.pathname === "/app.js") {
    sendText(response, 200, APP_JS, { ...securityHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  if (url.pathname === "/favicon.ico") {
    response.writeHead(204, { ...securityHeaders, "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (url.pathname === "/robots.txt") {
    sendText(response, 200, "User-agent: *\nDisallow: /\n", { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  if (url.pathname.startsWith("/images/")) {
    const filePath = path.join(ROOT, "public", url.pathname);
    if (fs.existsSync(filePath)) {
      response.writeHead(200, { ...securityHeaders, "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600", "Content-Length": fs.statSync(filePath).size });
      fs.createReadStream(filePath).pipe(response);
      return;
    }
  }

  const requirement = authRequirement(url.pathname);
  if (requirement && !isAuthorized(request, requirement.user, requirement.hash)) {
    sendUnauthorized(response, requirement.realm);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(request, response, url);
    return;
  }

  const knownRoutes = new Set(["/", "/how-it-works", "/partners", "/contacts", "/privacy", "/personal-data-consent", "/terms", "/partner-terms", "/admin", "/partner/login", "/partner/dashboard"]);

  if (!knownRoutes.has(url.pathname)) {
    sendText(response, 404, renderPage("/"), { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  sendText(response, 200, renderPage(url.pathname), { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
});

server.listen(PORT, () => {
  console.log(`Бери сегодня запущен: http://localhost:${PORT}`);
});
