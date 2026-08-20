import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDb } from "./backend/storage/jsonStore.mjs";
import { handleApiRequest } from "./backend/routes/apiRouter.mjs";
import { listPublicOffers } from "./backend/repositories/databaseRepository.mjs";
import { sessionFromRequest } from "./backend/services/authService.mjs";
import { partnerUploadFolder, resolveUploadedImage } from "./backend/storage/imageStore.mjs";
import { legalConfig } from "./backend/utils/legal.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(".env.local");
loadEnvFile(".env");

const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || "127.0.0.1";
ensureDb();
const config = {
  siteAccessEnabled: readEnv("SITE_ACCESS_ENABLED", "false") === "true",
  siteAccessUser: readEnv("SITE_ACCESS_USER", ""),
  siteAccessPasswordHash: readEnv("SITE_ACCESS_PASSWORD_SHA256", ""),
  adminAccessEnabled: readEnv("ADMIN_ACCESS_ENABLED", "false") === "true",
  adminAccessUser: readEnv("ADMIN_ACCESS_USER", ""),
  adminAccessPasswordHash: readEnv("ADMIN_ACCESS_PASSWORD_SHA256", ""),
  partnerAccessEnabled: readEnv("PARTNER_ACCESS_ENABLED", "false") === "true",
  partnerAccessUser: readEnv("PARTNER_ACCESS_USER", ""),
  partnerAccessPasswordHash: readEnv("PARTNER_ACCESS_PASSWORD_SHA256", ""),
  appName: readEnv("NEXT_PUBLIC_APP_NAME", "Бери сегодня"),
  appCity: readEnv("NEXT_PUBLIC_APP_CITY", "Армавир"),
  demoMode: readEnv("NEXT_PUBLIC_DEMO_MODE", "true") === "true",
  supportEmail: readEnv("PUBLIC_SUPPORT_EMAIL", "hello@berisegodnya.ru"),
  supportPhone: readEnv("PUBLIC_SUPPORT_PHONE", ""),
  legal: legalConfig()
};

const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; media-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Strict-Transport-Security": "max-age=31536000",
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
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
  if (isAdminArea) {
    return config.adminAccessEnabled
      ? { realm: "Beri Segodnya Admin", user: config.adminAccessUser, hash: config.adminAccessPasswordHash }
      : null;
  }

  const isPartnerArea = pathname === "/partner" || pathname.startsWith("/partner/") || pathname.startsWith("/api/partner/");
  if (isPartnerArea) {
    return config.partnerAccessEnabled
      ? { realm: "Beri Segodnya Partner", user: config.partnerAccessUser, hash: config.partnerAccessPasswordHash }
      : null;
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

function isUploadedAssetAuthorized(request, pathname) {
  const session = sessionFromRequest(request);
  if (session?.role === "admin") return true;
  if (session?.role === "partner" && pathname.startsWith(`/uploads/${partnerUploadFolder(session.partner_id)}/`)) return true;
  if (config.siteAccessEnabled) return isAuthorized(request, config.siteAccessUser, config.siteAccessPasswordHash);
  return listPublicOffers().some((offer) => offer.imageUrls?.includes(pathname));
}

function sendUnauthorized(response, realm) {
  sendText(response, 401, "Требуется доступ к закрытому стенду «Бери сегодня».", {
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

function sendFile(response, filePath, contentType, cacheControl = "public, max-age=3600", extraHeaders = {}) {
  const stat = fs.statSync(filePath);
  response.writeHead(200, {
    ...securityHeaders,
    ...extraHeaders,
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Content-Length": stat.size
  });
  fs.createReadStream(filePath).pipe(response);
}

const nav = [
  { href: "/#offers", path: "/", label: "Предложения сегодня" },
  { href: "/how-it-works", path: "/how-it-works", label: "Как это работает" }
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

function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function header(pathname) {
  return `<header class="site-header">
    <a class="brand" href="/" aria-label="Бери сегодня">
      <span class="brand-mark" aria-hidden="true">БС</span>
      <span class="brand-text"><strong>Бери сегодня</strong><small>Еда выгоднее сегодня</small></span>
    </a>
    <span class="city-pill"><span aria-hidden="true">●</span> Армавир</span>
    <nav class="site-nav" aria-label="Основная навигация">
      ${nav
        .map((item) => {
          const active = item.path === "/" ? pathname === "/" : pathname === item.path;
          return `<a class="${active ? "active" : ""}" href="${item.href}">${item.label}</a>`;
        })
        .join("")}
    </nav>
    <div class="header-actions">
      <a class="last-booking-link" href="#" data-last-booking hidden>Моя бронь</a>
      <a class="button button-primary header-cta" href="/partners#partner-application">Для заведений</a>
    </div>
    <details class="mobile-menu">
      <summary aria-label="Открыть меню"><span></span><span></span><span></span></summary>
      <nav aria-label="Мобильная навигация">
        ${nav.map((item) => `<a href="${item.href}">${item.label}</a>`).join("")}
        <a data-last-booking href="#" hidden>Моя бронь</a>
        <a href="/partners#partner-application">Для заведений</a>
      </nav>
    </details>
  </header>`;
}

function workspaceHeader(pathname) {
  const role = pathname === "/admin" ? "Управление сервисом" : "Кабинет заведения";
  return `<header class="workspace-header">
    <a class="brand" href="/" aria-label="Бери сегодня">
      <span class="brand-mark" aria-hidden="true">БС</span>
      <span class="brand-text"><strong>Бери сегодня</strong><small>${role}</small></span>
    </a>
    <a class="workspace-site-link" href="/">Открыть сайт</a>
  </header>`;
}

function footer() {
  return `<footer class="site-footer">
    <div>
      <a class="footer-logo" href="/">Бери сегодня</a>
      <p>Свежая еда из заведений Армавира дешевле сегодня. Бронь по коду, самовывоз и оплата на кассе.</p>
    </div>
    <nav class="footer-links" aria-label="Ссылки в подвале">
      <a href="/#offers">Предложения</a>
      <a href="/how-it-works">Как это работает</a>
      <a href="/partners">Партнёрам</a>
      <a href="/contacts">Контакты</a>
    </nav>
    <div class="footer-contacts">
      <a href="mailto:${html(config.supportEmail)}">${html(config.supportEmail)}</a>
      <a href="/contacts">Написать команде</a>
      <span class="footer-app-status">Приложение в разработке</span>
    </div>
    <nav class="footer-legal" aria-label="Юридические документы">
      <a href="/privacy">Политика обработки ПДн</a>
      <a href="/personal-data-consent">Согласие на обработку ПДн</a>
      <a href="/terms">Правила сервиса</a>
      <a href="/partner-terms">Партнёрские условия</a>
    </nav>
  </footer>`;
}

function pwaInstallDialog() {
  return `<div class="pwa-dialog" data-pwa-dialog hidden>
    <div class="pwa-dialog-backdrop" data-pwa-dialog-close></div>
    <section class="pwa-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="pwa-dialog-title">
      <button class="pwa-dialog-close" type="button" data-pwa-dialog-close aria-label="Закрыть подсказку">×</button>
      <img src="/icons/icon-192.png" alt="" width="80" height="80" />
      <h2 id="pwa-dialog-title">Добавить «Бери сегодня» на экран</h2>
      <p data-pwa-instructions>Откройте меню браузера и выберите установку приложения.</p>
      <button class="button button-primary" type="button" data-pwa-dialog-close>Понятно</button>
    </section>
  </div>`;
}

function categoryImage(category = "lunch") {
  return {
    lunch: "/images/offer-lunch-v2.png",
    bakery: "/images/offer-bakery-v2.png",
    evening: "/images/offer-evening-v2.png"
  }[category] || "/images/offer-lunch-v2.png";
}

function categoryLabel(category = "lunch") {
  return { lunch: "Готовая еда", bakery: "Выпечка", evening: "На вечер" }[category] || "Набор дня";
}

function foodImage(className = "", category = "lunch", alt = "Нейтральное изображение тестового набора еды") {
  return `<img class="${className}" src="${categoryImage(category)}" alt="${alt}" loading="lazy" />`;
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
  return `<p class="legal-version">Редакция от ${html(config.legal.documentVersion)}.</p>`;
}

function legalBlock(title, items) {
  return `<article class="panel-card legal-block"><h3>${html(title)}</h3><ul>${items.map((item) => `<li>${html(item)}</li>`).join("")}</ul></article>`;
}

function legalUnavailableDocument(title) {
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", title, "Документ ещё готовится к публикации.")}
    <div class="empty-state legal-form-unavailable" role="status">
      <h3>Документ пока не опубликован</h3>
      <p>Реквизиты оператора ещё не заполнены. До завершения документа все формы, которые принимают персональные данные, закрыты.</p>
      <p>Общие вопросы можно направить на <a href="mailto:${html(config.supportEmail)}">${html(config.supportEmail)}</a>.</p>
    </div>
  </section>`;
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

function getPageOffers() {
  try {
    return listPublicOffers();
  } catch (error) {
    console.error("Не удалось прочитать предложения из server-side storage:", error.message);
    return [];
  }
}

function offerCardMarkup(offer) {
  const remaining = offer.remaining ?? offer.remaining_quantity ?? 0;
  const oldPrice = offer.oldPrice ?? offer.old_price;
  const pickupWindow = offer.pickupWindow ?? offer.pickup_window;
  const ctaLabel = offer.ctaLabel ?? offer.cta_label ?? "Получить код";
  const soldOut = Number(remaining) <= 0 || offer.status === "sold_out";
  const savingsPercent = offer.savingsPercent || (oldPrice > offer.price ? Math.round((1 - offer.price / oldPrice) * 100) : 0);
  const imageUrl = offer.imageUrl || categoryImage(offer.category);
  return `<article class="offer-card" data-offer-card data-category="${offer.category}">
    <div class="offer-image">
      <img src="${html(imageUrl)}" alt="${html(offer.imageAlt || offer.image_alt || offer.title)}" loading="lazy" />
      <span class="today-chip">Сегодня</span>
      ${savingsPercent ? `<span class="discount-chip">−${savingsPercent}%</span>` : ""}
    </div>
    <div class="offer-body">
      <div class="offer-eyebrow"><p class="partner-name">${html(offer.partnerName || "Заведение")}</p><span>${html(categoryLabel(offer.category))}</span></div>
      <h3>${html(offer.title)}</h3>
      <p class="offer-description">${html(offer.description || "Набор приготовлен сегодня и доступен по предварительной брони.")}</p>
      <p class="offer-address"><span aria-hidden="true">⌖</span> ${html(offer.address || "Адрес тестовой точки")}</p>
      <div class="pickup-row"><span><small>Забрать</small><b>${html(pickupWindow)}</b></span><span class="stock-badge">${soldOut ? "Распродано" : `Осталось ${remaining}`}</span></div>
      <div class="price-line"><strong>${offer.price} ₽</strong>${oldPrice ? `<span>${oldPrice} ₽</span>` : ""}</div>
      <button class="button button-primary js-open-booking" data-offer-id="${html(offer.id)}" ${soldOut ? "disabled" : ""}>${soldOut ? "Распродано" : html(ctaLabel)}</button>
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
  return `<section class="marketplace-catalog" id="offers">
    <div class="catalog-title-row">
      <h2>Все предложения</h2>
      <span>Обновляется в течение дня</span>
    </div>
    <div class="filters" role="group" aria-label="Фильтры предложений">
      <button class="filter active" data-filter="all">Все</button>
      <button class="filter" data-filter="lunch">Готовая еда</button>
      <button class="filter" data-filter="bakery">Выпечка</button>
      <button class="filter" data-filter="evening">На вечер</button>
    </div>
    <p class="marketplace-status" id="marketplace-status" role="status" aria-live="polite" hidden></p>
    <div class="offer-list" id="offers-grid">${pageOffers.map(offerRowMarkup).join("")}</div>
    <div class="empty-state marketplace-empty" id="offers-empty" ${pageOffers.length ? "hidden" : ""}>
      <h3 id="offers-empty-title">Сегодня предложений пока нет</h3>
      <p id="offers-empty-text">Заведения добавляют наборы в течение дня. Проверьте витрину немного позже.</p>
      <div><button class="button button-primary" type="button" data-refresh-offers>Обновить предложения</button><a class="button button-outline" href="/how-it-works">Как это работает</a></div>
    </div>
  </section>`;
}

function offerPhotoTime(offer) {
  const value = offer.photoCapturedAt || offer.publishedAt;
  if (!value) return "время не указано";
  try {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value));
  } catch {
    return "время не указано";
  }
}

function setNoun(count) {
  const value = Math.abs(Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "набор";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "набора";
  return "наборов";
}

function remainingText(count) {
  const value = Math.max(0, Number(count) || 0);
  return `${value === 1 ? "Остался" : "Осталось"} ${value} ${setNoun(value)}`;
}

function photoSourceLabel(offer) {
  return offer.sourceType === "quick_photo" ? "Фото от заведения" : "Обновлено";
}

function recentOfferMarkup(offer) {
  const imageUrl = offer.imageUrl || categoryImage(offer.category);
  const label = photoSourceLabel(offer);
  return `<button class="recent-offer js-open-offer" type="button" data-offer-id="${html(offer.id)}" aria-label="Открыть ${html(offer.title)}">
    <img src="${html(imageUrl)}" alt="${html(offer.imageAlt || offer.title)}" loading="eager" />
    <span class="fresh-photo-label">${label} · ${html(offerPhotoTime(offer))}</span>
    <span class="recent-offer-copy"><strong>${html(offer.title)}</strong><small>${html(offer.partnerName)} · ${html(offer.address)}</small></span>
    <span class="recent-stock">${html(remainingText(offer.remaining))}</span>
  </button>`;
}

function offerRowMarkup(offer) {
  const imageUrl = offer.imageUrl || categoryImage(offer.category);
  const oldPrice = offer.oldPrice || offer.old_price;
  const discount = oldPrice > offer.price ? Math.round((1 - offer.price / oldPrice) * 100) : 0;
  return `<button class="offer-row js-open-offer" type="button" data-offer-card data-category="${html(offer.category)}" data-offer-id="${html(offer.id)}">
    <img src="${html(imageUrl)}" alt="${html(offer.imageAlt || offer.title)}" loading="lazy" />
    <span class="offer-row-main"><strong>${html(offer.title)}</strong><small>${html(offer.partnerName)} · ${html(offer.address)}</small><em>${html(photoSourceLabel(offer))} · ${html(offerPhotoTime(offer))}</em><span class="offer-row-mobile-pickup">Выдача ${html(offer.pickupWindow)}</span></span>
    <span class="offer-row-pickup"><small>Забрать сегодня</small><b>${html(offer.pickupWindow)}</b></span>
    <span class="offer-row-stock">${html(remainingText(offer.remaining))}</span>
    <span class="offer-row-price"><strong>${Number(offer.price)} ₽</strong>${oldPrice ? `<del>${Number(oldPrice)} ₽</del>` : ""}${discount ? `<em>−${discount}%</em>` : ""}</span>
    <span class="offer-row-more">Подробнее</span>
  </button>`;
}

function homePage() {
  const pageOffers = getPageOffers();
  const today = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date()).replace(" г.", "");
  return `<section class="customer-hero">
    <div class="customer-hero-copy">
      <p class="kicker">Еда на сегодня · Армавир</p>
      <h1>Заберите готовую еду дешевле — сегодня</h1>
      <p>Выберите предложение заведения, получите код и оплатите заказ на кассе при получении. Без регистрации и звонков.</p>
      <div class="actions"><a class="button button-primary" href="#offers">Выбрать предложение</a><a class="button button-outline" href="/how-it-works">Как это работает</a></div>
      <ul class="customer-trust"><li>Бронь по коду</li><li>Самовывоз сегодня</li><li>Оплата в заведении</li></ul>
    </div>
    ${codePreview()}
  </section>
  <section class="marketplace-home">
    <div class="marketplace-heading">
      <div><h1>Сегодня в Армавире</h1><p>Свежие предложения появляются в течение дня.</p></div>
      <div class="marketplace-date"><small>Сегодня</small><strong>${html(today)}</strong></div>
    </div>
    <section class="recent-section" id="recent-section" ${pageOffers.length ? "" : "hidden"}>
      <div class="recent-heading"><h2>Появилось недавно</h2><p>Новые предложения от заведений</p></div>
      <div class="recent-rail" id="recent-offers">${pageOffers.slice(0, 6).map(recentOfferMarkup).join("")}</div>
    </section>
    ${offerGridSection()}
    <p class="resource-note">Количество ограничено: заведение показывает только те наборы, которые готово выдать сегодня.</p>
  </section>
  <section class="section customer-guide">
    ${sectionTitle("Понятный заказ", "От выбора до получения — четыре шага", "Сервис сохраняет вашу последнюю бронь на этом устройстве, чтобы код не потерялся.")}
    ${steps([
      { title: "Выберите", text: "Откройте карточку предложения и проверьте состав, цену, адрес и время выдачи.", icon: "search" },
      { title: "Забронируйте", text: "Получите уникальный код брони на сайте.", icon: "ticket" },
      { title: "Приходите", text: "Подойдите в выбранное заведение в указанное время.", icon: "shop" },
      { title: "Получите", text: "Покажите код сотруднику и оплатите заказ на кассе.", icon: "card" }
    ])}
  </section>
  <section class="section customer-faq">
    ${sectionTitle("Ответы", "Что важно знать перед бронью")}
    ${faq([
      { q: "Нужно ли регистрироваться?", a: "Нет. Для бронирования отдельный аккаунт не нужен." },
      { q: "Где оплачивать?", a: "Оплата проходит в заведении при получении. Сервис не принимает деньги за еду." },
      { q: "Можно отменить бронь?", a: "Да. Откройте страницу своей брони и нажмите кнопку отмены до окончания выдачи." },
      { q: "Кто отвечает за состав и качество?", a: "Предложение готовит и выдаёт указанное заведение. Состав и аллергены проверяйте в карточке и уточняйте у сотрудника." }
    ])}
  </section>
  <div class="offer-drawer-backdrop" data-close-offer-drawer hidden></div>
  <aside class="offer-drawer" id="offer-drawer" role="dialog" aria-modal="true" aria-label="Карточка предложения" aria-hidden="true" tabindex="-1" hidden>
    <button class="drawer-close" type="button" data-close-offer-drawer aria-label="Закрыть" title="Закрыть">×</button>
    <div data-offer-drawer-content></div>
  </aside>`;
}

function howItWorksPage() {
  return `<section class="hero split-hero">
    <div class="hero-copy">
      <h1>Как работает Бери сегодня</h1>
      <p>Сервис помогает быстро забронировать выгодные предложения еды на сегодня. Без звонков, без приложения, с оплатой прямо в заведении.</p>
      <div class="actions">
        <a class="button button-primary" href="/#offers">Смотреть предложения</a>
      </div>
    </div>
    ${codePreview()}
  </section>
  <section class="section">
    ${sectionTitle("", "4 простых шага")}
    ${steps([
      { title: "Выберите предложение", text: "Найдите готовый обед, выпечку или вечерний набор, который доступен сегодня.", icon: "search" },
      { title: "Получите код", text: "Подтвердите бронь на сайте и сохраните код.", icon: "ticket" },
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
    ${sectionTitle("", "Частые вопросы")}
    ${faq([
      { q: "Нужно ли приложение?", a: "Нет, приложение не требуется. Всё работает прямо на сайте: выбираете предложение, получаете код и забираете заказ." },
      { q: "Как происходит оплата?", a: "Оплата происходит в заведении при получении заказа. Сервис на старте не принимает онлайн-оплату." },
      { q: "Можно ли отменить бронь?", a: "Да. Откройте страницу своей брони и подтвердите отмену — набор снова станет доступен, если время выдачи ещё не закончилось." },
      { q: "Что если я не успел забрать заказ?", a: "Предложения действуют только в указанное время. Если клиент не приходит, бронь считается неиспользованной." },
      { q: "Почему предложения ограничены?", a: "Сервис работает только с предложениями на сегодня. Количество задаёт само заведение." }
    ])}
  </section>
  ${bottomCta("Готовы попробовать?", "Откройте предложения на сегодня и получите код брони.", "Смотреть предложения", "/#offers", "На главную", "/")}`;
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

function personalDataUnavailable(kind = "Форма") {
  return `<div class="empty-state legal-form-unavailable" role="status">
    <h3>${html(kind)} временно закрыта</h3>
    <p>Документы сервиса ещё готовятся, поэтому сейчас мы не принимаем имена, телефоны и другие персональные данные через сайт.</p>
    <p>Предложения можно просматривать без регистрации. Для общих вопросов используйте <a href="mailto:${html(config.supportEmail)}">${html(config.supportEmail)}</a>.</p>
  </div>`;
}

function partnersPage() {
  const applicationHref = config.legal.ready ? "#partner-application" : `mailto:${config.supportEmail}`;
  const applicationLabel = config.legal.ready ? "Оставить заявку" : "Написать на email";
  return `<section class="hero split-hero">
    <div class="hero-copy">
      <h1>Партнёрам Бери сегодня</h1>
      <p>Помогаем кафе, пекарням, буфетам и кулинариям продавать ограниченные предложения на сегодня. Клиенты бронируют по коду, оплачивают на месте, а вы получаете дополнительную выручку без лишних затрат.</p>
      <div class="actions">
        <a class="button button-primary" href="${html(applicationHref)}">${html(applicationLabel)}</a>
        <a class="button button-outline" href="/partner/login">Войти в кабинет</a>
        <a class="text-link" href="/how-it-works">Как это работает</a>
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
      ${config.demoMode ? `<p class="demo-notice">Тестовый режим: не вводите реальные персональные данные.</p>` : ""}
    ${config.legal.ready ? `<form class="smart-form" method="post" data-form="partner">
      <label>Название заведения<input name="venueName" required maxlength="120" placeholder="Например: Заведение 1" /></label>
      <label>Тип заведения<select name="venueType" required><option value="">Выберите тип</option><option value="bakery">Пекарня</option><option value="coffee">Кофейня</option><option value="culinary">Кулинария</option><option value="buffet">Буфет</option><option value="ready_food_cafe">Кафе с готовой едой</option><option value="other">Другое</option></select></label>
      <label>Город<input name="city" required maxlength="80" value="Армавир" /></label>
      <label>Адрес первой точки<input name="firstAddress" required maxlength="160" placeholder="Например: ул. Тестовая, 1" /></label>
      <label>Контактное лицо<input name="contactName" required maxlength="80" placeholder="Ваше имя" /></label>
      <label>Телефон<input name="phone" required type="tel" inputmode="tel" minlength="7" maxlength="30" placeholder="+7 (___) ___-__-__" /></label>
      <label>Email<input name="email" type="email" maxlength="120" placeholder="email@example.ru" /></label>
      <label>Сколько точек<select name="locationsCount"><option value="1">1</option><option value="2-3">2–3</option><option value="4+">4+</option><option value="unknown">пока не знаю</option></select></label>
      <label class="full">Что хотите размещать<input name="offerFormats" maxlength="240" placeholder="Готовые обеды, выпечка, вечерние наборы" /></label>
      <label class="full">Комментарий<textarea name="comment" maxlength="1000" placeholder="Опишите формат предложений или вопросы по запуску"></textarea></label>
      <label class="consent full"><input type="checkbox" name="personalDataConsent" required /><span>Я согласен на <a href="/personal-data-consent" target="_blank" rel="noopener">обработку персональных данных</a> и принимаю <a href="/privacy" target="_blank" rel="noopener">Политику обработки персональных данных</a></span></label>
      <label class="consent full"><input type="checkbox" name="partnerTermsConsent" required /><span>Я принимаю <a href="/partner-terms" target="_blank" rel="noopener">Условия подключения партнёров</a></span></label>
      <p class="form-error" role="alert" aria-live="polite" hidden></p>
      <button class="button button-primary" type="submit">Отправить заявку</button>
    </form>
    <div class="success-box" data-success="partner" hidden><h3>Заявка сохранена</h3><p>${config.demoMode ? "Тестовая заявка сохранена." : "Заявка отправлена. Мы свяжемся с вами в течение рабочего дня."}</p><button class="button button-outline" data-reset-form="partner">Отправить ещё одну заявку</button></div>` : personalDataUnavailable("Заявка на подключение")}
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
  ${bottomCta("Готовы подключить заведение?", config.legal.ready ? "Оставьте заявку — мы свяжемся с вами и поможем запустить пилот уже сегодня." : "Форма подключения откроется после публикации документов. Пока можно написать команде по email.", applicationLabel, applicationHref, "Связаться с нами", "/contacts")}`;
}

function contactCard() {
  return `<article class="contact-card">
    <div class="contact-list">
      ${config.supportPhone ? `<p>${miniIcon("phone")}<span><b>Телефон</b>${html(config.supportPhone)}</span></p>` : ""}
      <p>${miniIcon("mail")}<span><b>Email</b>${html(config.supportEmail)}</span></p>
      <p>${miniIcon("pin")}<span><b>Город</b>Армавир</span></p>
      <p>${miniIcon("clock")}<span><b>Время ответа</b>в течение рабочего дня</span></p>
      ${badge("На связи по запуску пилота", "success")}
    </div>
    <div class="contact-photo">${foodImage("")}</div>
  </article>`;
}

function contactsPage() {
  const contactHref = config.legal.ready ? "#contact-form" : `mailto:${config.supportEmail}`;
  const contactLabel = config.legal.ready ? "Оставить заявку" : "Написать на email";
  return `<section class="hero split-hero">
    <div class="hero-copy">
      <h1>Контакты Бери сегодня</h1>
      <p>Свяжитесь с нами, чтобы подключить заведение, задать вопрос о сервисе или обсудить запуск пилота в Армавире.</p>
      <div class="actions">
        <a class="button button-primary" href="${html(contactHref)}">${html(contactLabel)}</a>
        <a class="button button-outline" href="mailto:${html(config.supportEmail)}">Написать нам</a>
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
      ${config.demoMode ? `<p class="demo-notice">Тестовый режим: не вводите реальные персональные данные.</p>` : ""}
      ${config.legal.ready ? `<form class="smart-form" method="post" data-form="contact">
        <label>Имя<input name="name" required maxlength="80" placeholder="Ваше имя" /></label>
        <label>Телефон<input name="phone" required type="tel" inputmode="tel" minlength="7" maxlength="30" placeholder="+7 (___) ___-__-__" /></label>
        <label>Email<input name="email" type="email" maxlength="120" placeholder="email@example.ru" /></label>
        <label class="full">Тип обращения<select name="type" required><option value="venue_connection">Подключение заведения</option><option value="service_question">Вопрос по сервису</option><option value="partner_pilot">Партнёрский пилот</option><option value="order_question">Вопрос по заказу</option><option value="other">Другое</option></select></label>
        <label class="full">Сообщение<textarea name="message" required maxlength="1000" placeholder="Опишите ваш вопрос или оставьте комментарий"></textarea></label>
        <label class="consent full"><input type="checkbox" name="personalDataConsent" required /><span>Я согласен на <a href="/personal-data-consent" target="_blank" rel="noopener">обработку персональных данных</a> и принимаю <a href="/privacy" target="_blank" rel="noopener">Политику обработки персональных данных</a></span></label>
        <p class="form-error" role="alert" aria-live="polite" hidden></p>
        <button class="button button-primary" type="submit">Отправить заявку</button>
      </form>
      <div class="success-box" data-success="contact" hidden><h3>Обращение сохранено</h3><p>${config.demoMode ? "Тестовое обращение сохранено." : "Мы получили ваше обращение и свяжемся с вами в течение рабочего дня."}</p><button class="button button-outline" data-reset-form="contact">Отправить ещё одно обращение</button></div>` : personalDataUnavailable("Форма обращения")}
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
  ${bottomCta("Готовы обсудить запуск?", config.legal.ready ? "Оставьте контакты — мы свяжемся с вами и поможем запустить пилот для вашего заведения." : "Форма обращения откроется после публикации документов. Пока можно написать команде по email.", contactLabel, contactHref, config.supportPhone ? "Позвонить нам" : "Написать нам", config.supportPhone ? `tel:${config.supportPhone.replace(/[^+\d]/g, "")}` : `mailto:${config.supportEmail}`)}`;
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
  if (!config.legal.ready) return legalUnavailableDocument("Политика обработки персональных данных");
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", "Политика обработки персональных данных", "Правила обработки и защиты данных в сервисе «Бери сегодня».")}
    ${legalIntro()}
    <div class="legal-doc">
      ${legalBlock("1. Оператор", [
        `Оператор персональных данных: ${config.legal.operatorName}.`,
        `Реквизиты: ${config.legal.operatorId}.`,
        `Адрес: ${config.legal.operatorAddress}.`,
        `Email для обращений по персональным данным: ${config.legal.privacyEmail}.`
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
        "Сведения о работе сервиса хранятся только в течение срока, необходимого для безопасности и разбора обращений."
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
        "Защищённое соединение с сайтом.",
        "Проверка входа и разделение прав администратора и партнёров.",
        "Пароли не хранятся в открытом виде.",
        "Резервное копирование и ограничение доступа к рабочим данным."
      ])}
      ${legalBlock("10. Контакты", [
        `Email для обращений по персональным данным: ${config.legal.privacyEmail}.`,
        `Почтовый адрес оператора: ${config.legal.operatorAddress}.`
      ])}
    </div>
  </section>`;
}

function personalDataConsentPage() {
  if (!config.legal.ready) return legalUnavailableDocument("Согласие на обработку персональных данных");
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", "Согласие на обработку персональных данных", "Условия согласия для форм сайта и партнёрского подключения.")}
    ${legalIntro()}
    <div class="legal-doc">
      ${legalBlock("1. Кто даёт согласие", [
        "Пользователь сайта или представитель партнёра, заполняющий форму на сайте."
      ])}
      ${legalBlock("2. Кому даётся согласие", [
        `Оператору персональных данных: ${config.legal.operatorName}.`,
        `Реквизиты оператора: ${config.legal.operatorId}.`,
        `Адрес оператора: ${config.legal.operatorAddress}.`,
        `Email для обращений: ${config.legal.privacyEmail}.`
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
        `Направить письмо на ${config.legal.privacyEmail} с указанием данных, по которым нужно прекратить обработку.`
      ])}
      ${legalBlock("8. Чекбокс на формах", [
        "Отправка формы означает, что пользователь отметил чекбокс согласия и ознакомился с политикой обработки персональных данных."
      ])}
    </div>
  </section>`;
}

function termsPage() {
  if (!config.legal.ready) return legalUnavailableDocument("Правила использования сервиса");
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", "Правила использования сервиса", "Условия использования сервиса «Бери сегодня».")}
    ${legalIntro()}
    <div class="legal-doc">
      ${legalBlock("Оператор сервиса", [
        `Оператор: ${config.legal.operatorName}.`,
        `Реквизиты: ${config.legal.operatorId}.`,
        `Адрес: ${config.legal.operatorAddress}.`,
        `Email для обращений: ${config.legal.privacyEmail}.`
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
        `Пользователь может обратиться через страницу «Контакты» или написать на ${config.legal.privacyEmail}.`
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
  if (!config.legal.ready) return legalUnavailableDocument("Условия подключения партнёров");
  return `<section class="section legal-page">
    ${sectionTitle("Юридические документы", "Условия подключения партнёров", "Условия пилота для заведений-партнёров.")}
    ${legalIntro()}
    <div class="legal-doc">
      ${legalBlock("Оператор сервиса", [
        `Оператор: ${config.legal.operatorName}.`,
        `Реквизиты: ${config.legal.operatorId}.`,
        `Адрес: ${config.legal.operatorAddress}.`,
        `Email для обращений: ${config.legal.privacyEmail}.`
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
    <article class="panel-card"><h2>Закрытый раздел</h2><p>Страница доступна только пользователям с выданными правами.</p>${badge("Требуется вход")}${badge("Доступ по роли")}</article>
  </section>`;
}

function adminPage() {
  return `<section class="section app-panel" data-admin-app>
    ${sectionTitle("Админка", "Панель администратора", "Управляйте партнёрами, предложениями, бронями и обращениями в одном месте.")}
    <div class="access-layout" data-admin-login>
      <div class="access-intro">
        <p class="kicker">Закрытый раздел</p>
        <h3>Управление сервисом</h3>
        <p>Партнёры, предложения, брони и обращения собраны в одной рабочей панели.</p>
        <ul class="access-points"><li>Данные всех партнёров</li><li>Контроль кодов и остатков</li><li>Заявки и обращения</li></ul>
      </div>
      <div class="auth-box">
        <h3>Вход администратора</h3>
        <p>Используйте персональный логин администратора.</p>
        <form class="smart-form auth-form" method="post" data-admin-login-form>
          <label>Логин<input name="login" required maxlength="80" autocomplete="username" placeholder="Введите логин" /></label>
          <label>Пароль<input name="password" required maxlength="120" type="password" autocomplete="current-password" placeholder="Введите пароль" /></label>
          <p class="form-error" role="alert" aria-live="polite" hidden></p>
          <button class="button button-primary" type="submit">Войти в панель</button>
        </form>
      </div>
    </div>
    <div class="access-layout password-gate" data-admin-password-gate hidden>
      <div class="access-intro"><p class="kicker">Первый вход</p><h3>Задайте свой постоянный пароль</h3><p>Временный пароль больше не понадобится после сохранения нового.</p><ul class="access-points"><li>Не менее 12 символов</li><li>Не используйте пароль от почты</li><li>Активные входы будут обновлены</li></ul></div>
      <div class="auth-box"><h3>Сменить пароль</h3><form class="smart-form auth-form" method="post" data-admin-change-password><label>Текущий пароль<input name="currentPassword" required maxlength="120" type="password" autocomplete="current-password" /></label><label>Новый пароль<input name="newPassword" required minlength="12" maxlength="120" type="password" autocomplete="new-password" /></label><label>Повторите новый пароль<input name="confirmPassword" required minlength="12" maxlength="120" type="password" autocomplete="new-password" /></label><p class="form-error" role="alert" aria-live="polite" hidden></p><button class="button button-primary" type="submit">Сохранить новый пароль</button></form></div>
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
        <a data-tab-link="audit" href="/admin?tab=audit">Журнал действий</a>
        <a data-tab-link="settings" href="/admin?tab=settings">Настройки</a>
      </nav>
      <label class="mobile-tab-select">Раздел админки<select data-tab-select="admin"><option value="overview">Обзор</option><option value="partners">Партнёры</option><option value="offers">Предложения</option><option value="bookings">Брони и коды</option><option value="partner-applications">Заявки партнёров</option><option value="contact-requests">Обращения</option><option value="audit">Журнал действий</option><option value="settings">Настройки</option></select></label>
      <div class="stats-row admin-stats" data-admin-stats></div>
      <div class="admin-grid">
        <article class="panel-card tab-panel" data-tab-panel="overview"><h3>Рабочий порядок</h3><div class="admin-workflow"><button type="button" data-admin-go-tab="partner-applications"><b>1</b><span>Проверить заявки</span></button><button type="button" data-admin-go-tab="partners"><b>2</b><span>Подключить партнёра</span></button><button type="button" data-admin-go-tab="bookings"><b>3</b><span>Контролировать коды</span></button></div><div class="table-wrap" data-admin-service></div></article>
        <article class="panel-card tab-panel onboarding-panel" data-tab-panel="partners">
          <div class="panel-heading"><div><h3>Подключить нового партнёра</h3><p>Одна кнопка создаёт организацию, первую точку и вход владельца.</p></div></div>
          <form class="onboarding-form" method="post" data-admin-onboard-partner>
            <input type="hidden" name="applicationId" />
            <div class="onboarding-source" data-admin-onboarding-source hidden><span>Поля заполнены из заявки партнёра</span><button type="button" data-clear-application>Очистить</button></div>
            <fieldset><legend><b>1</b> Организация</legend><div class="onboarding-fields"><label>Название<input name="partnerName" required maxlength="120" placeholder="Тестовая кулинария" /></label><label>Тип<select name="partnerType"><option value="culinary">Кулинария</option><option value="bakery">Пекарня</option><option value="coffee">Кофейня</option><option value="cafe">Кафе</option><option value="ready_food_cafe">Кафе с готовой едой</option><option value="buffet">Буфет</option><option value="other">Другое</option></select></label><label>Контактное лицо<input name="contactName" maxlength="80" placeholder="Имя представителя" /></label><label>Телефон<input name="phone" type="tel" maxlength="30" placeholder="+7 900 000-00-00" /></label><label>Email<input name="email" type="email" maxlength="120" placeholder="partner@example.test" /></label></div></fieldset>
            <fieldset><legend><b>2</b> Первая точка</legend><div class="onboarding-fields"><label>Название точки<input name="addressTitle" required maxlength="120" value="Основная точка" /></label><label>Город<input name="city" required maxlength="80" value="Армавир" /></label><label class="field-wide">Адрес<input name="address" required maxlength="160" placeholder="Армавир, тестовый адрес" /></label></div></fieldset>
            <fieldset><legend><b>3</b> Вход владельца</legend><div class="onboarding-fields"><label>Имя пользователя<input name="userName" required maxlength="120" placeholder="Владелец точки" /></label><label>Логин<input name="login" required maxlength="80" autocomplete="off" placeholder="partner-new" /></label><label>Временный пароль<input name="password" required minlength="12" maxlength="120" type="password" autocomplete="new-password" placeholder="Не менее 12 символов" /></label></div></fieldset>
            <button class="button button-primary onboarding-submit" type="submit">Создать партнёра и кабинет</button>
          </form>
          <div class="panel-heading list-heading"><div><h3>Подключённые партнёры</h3><p>«В архив» закрывает доступ и сохраняет историю. «Удалить» доступно только партнёру без предложений и броней.</p></div><div class="table-filters" data-table-filter-group data-filter-target="[data-admin-partners]"><input type="search" placeholder="Найти партнёра" data-filter-query /><select data-filter-status aria-label="Статус партнёра"><option value="">Все статусы</option><option value="Активен">Активные</option><option value="Отключён">Отключённые</option><option value="В архиве">В архиве</option></select></div></div><div class="table-wrap" data-admin-partners></div>
        </article>
        <details class="admin-maintenance tab-panel" data-tab-panel="partners"><summary>Дополнительные адреса и сотрудники</summary><div class="maintenance-grid"><section><h3>Добавить ещё одну точку</h3><form class="mini-form" method="post" data-admin-create-address><select name="partnerId" required data-admin-partner-select><option value="">Выберите партнёра</option></select><input name="title" required placeholder="Название точки" /><input name="city" required value="Армавир" /><input name="address" required placeholder="Армавир, тестовый адрес" /><button class="button button-primary" type="submit">Добавить адрес</button></form><div class="table-wrap" data-admin-addresses></div></section><section><h3>Добавить ещё одного сотрудника</h3><form class="mini-form" method="post" data-admin-create-user><select name="partnerId" required data-admin-partner-select><option value="">Выберите партнёра</option></select><input name="name" required placeholder="Имя сотрудника" /><input name="login" required placeholder="Логин" /><input name="password" required minlength="12" type="password" placeholder="Временный пароль от 12 символов" /><select name="role"><option value="owner">Владелец</option><option value="manager">Менеджер</option></select><button class="button button-primary" type="submit">Добавить пользователя</button></form><div class="table-wrap" data-admin-users></div></section></div></details>
        <article class="panel-card tab-panel" data-tab-panel="offers"><div class="panel-heading"><div><h3>Предложения</h3><p>Обычно предложение публикует партнёр из своего кабинета. Эта форма нужна для первого запуска или помощи партнёру.</p></div></div><form class="mini-form offer-editor" method="post" data-admin-create-offer><select name="partnerId" required data-admin-offer-partner><option value="">Выберите партнёра</option></select><select name="addressId" required data-admin-offer-address disabled><option value="">Сначала выберите партнёра</option></select><input name="title" required maxlength="120" placeholder="Название предложения" /><select name="category"><option value="lunch">Готовая еда</option><option value="bakery">Выпечка</option><option value="evening">На вечер</option></select><input name="description" maxlength="240" placeholder="Короткое описание" /><input name="contents" maxlength="500" placeholder="Что входит в набор" /><input name="weight" maxlength="80" placeholder="Вес или количество изделий" /><input name="allergens" maxlength="240" placeholder="Аллергены или способ уточнения" /><input name="price" required type="number" min="1" placeholder="Цена" /><input name="oldPrice" type="number" min="1" placeholder="Обычная стоимость" /><input name="pickupWindow" required maxlength="40" placeholder="15:30–18:00" /><input name="date" required type="date" data-today-date /><input name="totalQuantity" required type="number" min="1" placeholder="Количество" /><select name="status"><option value="active">Активно</option><option value="paused">Черновик</option></select><button class="button button-primary" type="submit">Опубликовать предложение</button></form><div class="table-filters" data-table-filter-group data-filter-target="[data-admin-offers]"><input type="search" placeholder="Найти предложение или партнёра" data-filter-query /><select data-filter-status aria-label="Статус предложения"><option value="">Все статусы</option><option value="Активен">Активные</option><option value="Черновик">Черновики</option><option value="Распродано">Распроданные</option><option value="Истекло">Истёкшие</option></select></div><div class="table-wrap" data-admin-offers></div></article>
        <article class="panel-card tab-panel" data-tab-panel="bookings"><div class="panel-heading"><div><h3>Брони и коды</h3><p>Найдите код, покупателя или заведение и подтвердите результат выдачи.</p></div><div class="table-filters" data-table-filter-group data-filter-target="[data-admin-bookings]"><input type="search" placeholder="Найти код или покупателя" data-filter-query /><select data-filter-status aria-label="Статус брони"><option value="">Все статусы</option><option value="Забронировано">Текущие</option><option value="Выдано">Выданные</option><option value="Не пришёл">Не полученные</option><option value="Отменено">Отменённые</option></select></div></div><div class="table-wrap" data-admin-bookings></div></article>
        <article class="panel-card tab-panel" data-tab-panel="partner-applications"><div class="panel-heading"><div><h3>Заявки партнёров</h3><p>Здесь появляются заявки со страницы «Для заведений». Откройте заявку, свяжитесь с представителем, затем подключите или отклоните.</p></div><div class="table-filters" data-table-filter-group data-filter-target="[data-admin-applications]"><input type="search" placeholder="Найти заведение или контакт" data-filter-query /><select data-filter-status aria-label="Статус заявки"><option value="">Все статусы</option><option value="Новое">Новые</option><option value="Связались">Связались</option><option value="Подключён">Подключённые</option><option value="Отклонено">Отклонённые</option></select></div></div><div class="table-wrap" data-admin-applications></div></article>
        <article class="panel-card tab-panel" data-tab-panel="contact-requests"><div class="panel-heading"><div><h3>Обращения</h3><p>Сообщения с контактной страницы. Откройте обращение, возьмите его в работу и закройте после ответа.</p></div><div class="table-filters" data-table-filter-group data-filter-target="[data-admin-contacts]"><input type="search" placeholder="Найти обращение" data-filter-query /><select data-filter-status aria-label="Статус обращения"><option value="">Все статусы</option><option value="Новое">Новые</option><option value="В работе">В работе</option><option value="Закрыто">Закрытые</option></select></div></div><div class="table-wrap" data-admin-contacts></div></article>
        <article class="panel-card tab-panel" data-tab-panel="audit"><div class="panel-heading"><div><h3>Журнал действий</h3><p>Показываются время, роль, действие и тип объекта — без паролей, токенов и содержимого персональных данных.</p></div><div class="table-filters" data-table-filter-group data-filter-target="[data-admin-audit]"><input type="search" placeholder="Найти действие" data-filter-query /><select data-filter-status aria-label="Роль в журнале"><option value="">Все роли</option><option value="Администратор">Администратор</option><option value="Партнёр">Партнёр</option><option value="Сервис">Сервис</option></select></div></div><div class="table-wrap" data-admin-audit></div></article>
        <article class="panel-card tab-panel" data-tab-panel="settings"><div class="settings-grid"><section><h3>Сменить пароль администратора</h3><form class="mini-form labelled-form" method="post" data-admin-change-password><label>Текущий пароль<input name="currentPassword" required maxlength="120" type="password" autocomplete="current-password" /></label><label>Новый пароль<input name="newPassword" required minlength="12" maxlength="120" type="password" autocomplete="new-password" /></label><label>Повторите новый пароль<input name="confirmPassword" required minlength="12" maxlength="120" type="password" autocomplete="new-password" /></label><p class="form-error" role="alert" aria-live="polite" hidden></p><button class="button button-primary" type="submit">Сменить пароль</button></form></section><section><h3>Рабочая проверка</h3><ul class="check-list"><li>Перед обновлением создайте резервную копию данных и фотографий.</li><li>После обновления проверьте входы, бронирование и выдачу кода.</li><li>Проверяйте журнал действий и уведомления мониторинга.</li></ul></section></div></article>
      </div>
    </div>
    <div class="record-dialog" data-record-dialog hidden><div class="record-dialog-backdrop" data-close-record-dialog></div><section class="record-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title" tabindex="-1"><button class="modal-close" type="button" data-close-record-dialog aria-label="Закрыть">×</button><p class="kicker" data-record-kind></p><h2 id="record-dialog-title" data-record-title></h2><dl class="record-details" data-record-details></dl><div class="record-message" data-record-message hidden></div></section></div>
  </section>`;
}

function partnerLoginPage() {
  return `<section class="section app-panel" data-partner-login-app>
    ${sectionTitle("Кабинет партнёра", "Вход партнёра", "Введите выданные логин и пароль. Изменения в кабинете сохраняются автоматически.")}
    <div class="access-layout">
      <div class="access-intro">
        <p class="kicker">Для заведения</p>
        <h3>Предложение за несколько минут</h3>
        <p>Сфотографируйте сегодняшнюю партию, укажите цену и количество, затем опубликуйте её для покупателей.</p>
        <ul class="access-points"><li>Фото текущей партии</li><li>Предложения и остатки</li><li>Коды для выдачи</li></ul>
      </div>
      <div class="auth-box">
        <h3>Войти в кабинет</h3>
        <p>Доступ выдаёт администратор сервиса. При первом входе задайте свой постоянный пароль.</p>
        <form class="smart-form auth-form" method="post" data-partner-login-form>
          <label>Логин<input name="login" required maxlength="80" autocomplete="username" placeholder="Введите логин" /></label>
          <label>Пароль<input name="password" required maxlength="120" type="password" autocomplete="current-password" placeholder="Введите пароль" /></label>
          <p class="form-error" role="alert" aria-live="polite" hidden></p>
          <button class="button button-primary" type="submit">Войти в кабинет</button>
        </form>
      </div>
    </div>
  </section>`;
}

function partnerDashboardPage() {
  return `<section class="section app-panel" data-partner-dashboard-app>
    <div class="partner-dashboard-heading">
      ${sectionTitle("Кабинет партнёра", "Панель партнёра", "Сфотографируйте текущую партию и опубликуйте предложение за несколько шагов.")}
      <div class="partner-dashboard-actions"><span class="role-badge" data-partner-role></span><button class="button button-primary" type="button" data-open-offer-wizard>Разместить сегодня</button><button class="button button-outline" data-partner-logout>Выйти</button></div>
    </div>
    <nav class="tab-nav" data-tabs="partner" aria-label="Разделы кабинета партнёра">
      <a data-tab-link="overview" href="/partner/dashboard?tab=overview">Обзор</a>
      <a data-tab-link="addresses" href="/partner/dashboard?tab=addresses">Адреса</a>
      <a data-tab-link="offers" href="/partner/dashboard?tab=offers">Предложения</a>
      <a data-tab-link="bookings" href="/partner/dashboard?tab=bookings">Коды и брони</a>
      <a data-tab-link="profile" href="/partner/dashboard?tab=profile">Профиль</a>
      <a data-tab-link="security" href="/partner/dashboard?tab=security">Пароль</a>
      <a data-tab-link="help" href="/partner/dashboard?tab=help">Помощь</a>
    </nav>
    <label class="mobile-tab-select">Раздел кабинета<select data-tab-select="partner"><option value="overview">Обзор</option><option value="addresses">Адреса</option><option value="offers">Предложения</option><option value="bookings">Коды и брони</option><option value="profile">Профиль</option><option value="security">Пароль</option><option value="help">Помощь</option></select></label>
    <div class="password-required-notice" data-partner-password-required hidden><strong>Задайте постоянный пароль</strong><span>До смены временного пароля остальные разделы кабинета закрыты.</span></div>
    <div class="stats-row admin-stats" data-partner-stats></div>
    <div class="admin-grid">
      <article class="panel-card tab-panel" data-tab-panel="overview"><h3>Сегодня в точках</h3><div data-partner-overview></div></article>
      <article class="panel-card tab-panel" data-tab-panel="addresses"><h3>Адреса</h3><p class="permission-note" data-manager-only hidden>Менеджер может просматривать точки, а добавлять и изменять их может владелец.</p><form class="mini-form labelled-form" method="post" data-partner-create-address data-owner-only><label>Название точки<input name="title" required placeholder="Основная точка" /></label><label>Город<input name="city" required value="Армавир" /></label><label>Адрес<input name="address" required placeholder="Армавир, ул. Тестовая, 1" /></label><button class="button button-primary" type="submit">Добавить адрес</button></form><div class="table-wrap" data-partner-addresses></div></article>
      <article class="panel-card tab-panel" data-tab-panel="offers"><div class="panel-heading"><div><h3>Предложения</h3><p>Для новой текущей партии используйте быстрый мастер. Расширенная форма ниже остаётся для ручной настройки.</p></div><button class="button button-primary" type="button" data-open-offer-wizard>Разместить сегодня</button></div><details class="advanced-offer-editor"><summary>Расширенная форма</summary><form class="mini-form offer-editor" method="post" data-partner-create-offer><select name="addressId" required data-partner-address-select><option value="">Выберите точку</option></select><input name="title" required maxlength="120" placeholder="Название предложения" /><select name="category"><option value="lunch">Готовая еда</option><option value="bakery">Выпечка</option><option value="evening">На вечер</option></select><input name="description" maxlength="240" placeholder="Короткое описание" /><input name="contents" maxlength="500" placeholder="Что входит в набор" /><input name="weight" maxlength="80" placeholder="Вес или количество изделий" /><input name="allergens" maxlength="240" placeholder="Аллергены или способ уточнения" /><input name="price" required type="number" min="1" placeholder="Цена" /><input name="oldPrice" type="number" min="1" placeholder="Обычная стоимость" /><input name="pickupWindow" required maxlength="40" placeholder="15:30–18:00" /><input name="date" required type="date" data-today-date /><input name="totalQuantity" required type="number" min="1" placeholder="Количество" /><select name="status"><option value="active">Опубликовать</option><option value="paused">Сохранить черновик</option></select><button class="button button-primary" type="submit">Сохранить предложение</button></form></details><div class="table-wrap" data-partner-offers></div></article>
      <article class="panel-card tab-panel" data-tab-panel="bookings"><div class="panel-heading"><div><h3>Коды и брони</h3><p>Сначала найдите код, затем подтвердите результат выдачи.</p></div><div class="table-filters"><input type="search" placeholder="Найти код или предложение" data-partner-booking-search /><select data-partner-booking-status aria-label="Статус брони"><option value="">Все статусы</option><option value="created">Текущие</option><option value="issued">Выданные</option><option value="no_show">Не полученные</option><option value="cancelled">Отменённые</option></select></div></div><div class="table-wrap" data-partner-bookings></div></article>
      <article class="panel-card tab-panel" data-tab-panel="profile"><h3>Профиль</h3><p class="permission-note" data-manager-only hidden>Менеджер может просматривать профиль. Изменять реквизиты может владелец.</p><form class="mini-form labelled-form" method="post" data-partner-profile-form data-owner-only><label>Название заведения<input name="name" maxlength="120" placeholder="Название партнёра" /></label><label>Контактное лицо<input name="contactName" maxlength="80" placeholder="Контактное лицо" /></label><label>Телефон<input name="phone" type="tel" inputmode="tel" maxlength="30" placeholder="+7 900 000-00-00" /></label><label>Email<input name="email" type="email" maxlength="120" placeholder="email@example.test" /></label><button class="button button-primary" type="submit">Сохранить профиль</button></form><div class="table-wrap" data-partner-profile></div></article>
      <article class="panel-card tab-panel" data-tab-panel="security"><h3>Пароль кабинета</h3><p>Партнёр меняет пароль самостоятельно. После смены другие активные входы будут закрыты.</p><form class="mini-form labelled-form password-form" method="post" data-partner-change-password><label>Текущий пароль<input name="currentPassword" required maxlength="120" type="password" autocomplete="current-password" /></label><label>Новый пароль<input name="newPassword" required minlength="12" maxlength="120" type="password" autocomplete="new-password" /></label><label>Повторите новый пароль<input name="confirmPassword" required minlength="12" maxlength="120" type="password" autocomplete="new-password" /></label><p class="form-error" role="alert" aria-live="polite" hidden></p><button class="button button-primary" type="submit">Сохранить новый пароль</button></form></article>
      <article class="panel-card tab-panel" data-tab-panel="help"><h3>Помощь</h3><div class="help-steps"><p><strong>Где появляются брони?</strong><span>Во вкладке «Коды и брони». Новая бронь появляется там сразу после получения кода покупателем.</span></p><p><strong>Как выдать заказ?</strong><span>Найдите код покупателя и нажмите «Выдан» после оплаты на кассе.</span></p><p><strong>Как сменить пароль?</strong><span>Откройте вкладку «Пароль». Временный пароль, выданный администратором, нужно заменить при первом входе.</span></p></div></article>
    </div>
  </section>
  <div class="offer-wizard" data-offer-wizard hidden>
    <div class="offer-wizard-backdrop" data-close-offer-wizard></div>
    <section class="offer-wizard-panel" role="dialog" aria-modal="true" aria-labelledby="offer-wizard-title" tabindex="-1">
      <header class="offer-wizard-header">
        <div><small>Быстрая публикация</small><h2 id="offer-wizard-title">Предложение на сегодня</h2></div>
        <button type="button" class="wizard-close" data-close-offer-wizard aria-label="Закрыть мастер публикации">Закрыть</button>
      </header>
      <ol class="wizard-progress" aria-label="Шаги публикации">
        <li data-wizard-progress="1"><b>1</b><span>Фото</span></li>
        <li data-wizard-progress="2"><b>2</b><span>Набор</span></li>
        <li data-wizard-progress="3"><b>3</b><span>Условия</span></li>
        <li data-wizard-progress="4"><b>4</b><span>Проверка</span></li>
      </ol>
      <form class="wizard-form" method="post" data-offer-wizard-form>
        <section class="wizard-step" data-wizard-step="1">
          <h3>Что выставляете сегодня?</h3>
          <p>Сделайте свежие фото текущей партии или выберите готовый шаблон.</p>
          <div class="wizard-mode" role="group" aria-label="Способ публикации">
            <button type="button" class="active" data-wizard-mode="quick">Сфотографировать сейчас</button>
            <button type="button" data-wizard-mode="template">Взять шаблон</button>
          </div>
          <div data-wizard-quick>
            <label class="photo-picker"><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple data-wizard-photo-input /><strong>Сделать фото или выбрать</strong><span>От 1 до 3 фото. Лучше при дневном свете.</span></label>
            <div class="wizard-photo-grid" data-wizard-photo-grid></div>
            <p class="wizard-quality" data-wizard-quality>Фото будет уменьшено и очищено от метаданных перед отправкой.</p>
          </div>
          <div data-wizard-template-panel hidden><div class="wizard-template-list" data-wizard-template-list></div><p class="wizard-quality">Шаблон подставит название и условия. Фото можно обновить на следующей публикации.</p></div>
        </section>
        <section class="wizard-step" data-wizard-step="2" hidden>
          <h3>Назовите набор</h3>
          <p>Можно выбрать простой номер набора или написать понятное название.</p>
          <div class="wizard-presets" role="group" aria-label="Быстрое название"><button type="button" data-wizard-preset="Набор 1">Набор 1</button><button type="button" data-wizard-preset="Набор 2">Набор 2</button><button type="button" data-wizard-preset="Набор 3">Набор 3</button></div>
          <div class="wizard-fields two"><label>Название<input name="title" required maxlength="120" placeholder="Например, Обед с курицей" /></label><label>Категория<select name="category"><option value="lunch">Готовая еда</option><option value="bakery">Выпечка</option><option value="evening">На вечер</option></select></label></div>
          <label>Коротко о предложении<textarea name="description" maxlength="240" rows="2" placeholder="Что приготовлено и для кого подходит"></textarea></label>
          <label>Что входит<textarea name="contents" maxlength="500" rows="2" placeholder="Например: горячее, гарнир и салат"></textarea></label>
        </section>
        <section class="wizard-step" data-wizard-step="3" hidden>
          <h3>Цена, количество и выдача</h3>
          <p>Только необходимые данные. Всё предложение закончится сегодня.</p>
          <div class="wizard-fields two"><label>Точка выдачи<select name="addressId" required data-wizard-address></select></label><label>Количество наборов<input name="totalQuantity" required type="number" min="1" max="10000" inputmode="numeric" value="5" /></label></div>
          <div class="wizard-fields two"><label>Цена сегодня, ₽<input name="price" required type="number" min="1" max="100000" inputmode="numeric" placeholder="199" /></label><label>Обычная цена, ₽<input name="oldPrice" type="number" min="1" max="100000" inputmode="numeric" placeholder="279" /></label></div>
          <div class="wizard-fields two"><label>Начало выдачи<input name="pickupStart" required type="time" value="16:00" /></label><label>Окончание выдачи<input name="pickupEnd" required type="time" value="19:00" /></label></div>
        </section>
        <section class="wizard-step" data-wizard-step="4" hidden>
          <h3>Проверьте перед публикацией</h3>
          <p>Так предложение увидит покупатель.</p>
          <div class="wizard-preview" data-wizard-preview></div>
          <label class="wizard-save-template"><input type="checkbox" name="saveTemplate" /><span>Сохранить как шаблон для следующего раза</span></label>
          <p class="wizard-error" data-wizard-error hidden></p>
        </section>
      </form>
      <footer class="offer-wizard-footer"><span data-wizard-draft-status>Черновик сохраняется</span><div><button class="button button-outline" type="button" data-wizard-clear-draft>Очистить черновик</button><button class="button button-outline" type="button" data-wizard-back hidden>Назад</button><button class="button button-primary" type="button" data-wizard-next>Далее</button><button class="button button-primary" type="button" data-wizard-publish hidden>Опубликовать сегодня</button></div></footer>
    </section>
  </div>`;
}

function bookingPage(pathname) {
  const publicToken = decodeURIComponent(pathname.slice("/booking/".length));
  return `<section class="booking-page section" data-public-booking="${html(publicToken)}">
    <a class="back-link" href="/#offers">← Вернуться к предложениям</a>
    <div class="booking-page-shell">
      <div class="booking-page-main">
        <p class="kicker">Бронь на сегодня</p>
        <h1>Ваш код и детали получения</h1>
        <div class="booking-page-content" data-booking-page-content>
          <p class="booking-loading">Загружаем бронь…</p>
        </div>
      </div>
      <aside class="booking-help">
        <h2>Что делать дальше</h2>
        <ol>
          <li>Приходите в указанное время.</li>
          <li>Покажите код сотруднику.</li>
          <li>Оплатите набор на кассе.</li>
        </ol>
        <p>Не успеваете? Отмените бронь, чтобы набор снова стал доступен.</p>
      </aside>
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
  if (pathname.startsWith("/booking/")) return bookingPage(pathname);
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
  return `<!doctype html>
  <html lang="ru">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex,nofollow" />
      <title>${pathname === "/" ? "Бери сегодня" : `${pathname.startsWith("/booking/") ? "Моя бронь" : (titles[pathname] || "Бери сегодня")} · Бери сегодня`}</title>
      <meta name="description" content="Выгодные наборы еды из заведений Армавира на сегодня. Бронь по коду, самовывоз и оплата при получении." />
      <meta name="theme-color" content="#102F38" />
      <meta name="application-name" content="Бери сегодня" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="Бери сегодня" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" type="image/png" sizes="64x64" href="/icons/favicon-64.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
      <link rel="stylesheet" href="/styles.css" />
      <script src="/page-config.js"></script>
    </head>
    <body class="${pathname === "/" ? "page-home" : "page-inner"}${isAppPage ? " page-app" : ""}">
      ${isAppPage ? workspaceHeader(pathname) : header(pathname)}
      <main>${renderBody(pathname)}</main>
      ${isAppPage ? "" : footer()}
      ${isAppPage ? "" : bookingModal()}
      ${isAppPage ? `<script src="/app.js"></script>` : `<script src="/public.js"></script>`}
      ${isAppPage ? "" : `<script src="/pwa.js"></script>`}
    </body>
  </html>`;
}

function bookingModal() {
  return `<div class="modal" id="booking-modal" hidden>
    <div class="modal-backdrop" data-close-modal></div>
    <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <button class="modal-close" type="button" data-close-modal aria-label="Закрыть форму бронирования" title="Закрыть">×</button>
      <div data-booking-step="form">
        <h2 id="booking-title">Получить код</h2>
        <div class="booking-summary" id="booking-summary"></div>
        <form class="booking-form" id="booking-form" method="post">
          <label>Имя<input name="customerName" required maxlength="80" placeholder="Ваше имя" /></label>
          <label>Телефон<input name="customerPhone" required type="tel" inputmode="tel" minlength="7" maxlength="30" placeholder="+7 (___) ___-__-__" /></label>
          <label class="consent"><input type="checkbox" name="personalDataConsent" required /><span>Я согласен на <a href="/personal-data-consent" target="_blank" rel="noopener">обработку персональных данных</a> и принимаю <a href="/privacy" target="_blank" rel="noopener">Политику обработки персональных данных</a></span></label>
          <p class="form-error" role="alert" aria-live="polite" hidden></p>
          <button class="button button-primary" type="submit">Получить код</button>
        </form>
      </div>
      <div class="booking-success" data-booking-step="success" hidden>
        <p class="success-mark" aria-hidden="true">✓</p>
        <h2 tabindex="-1" data-booking-success-title>Набор забронирован</h2>
        <p>Сохраните код и покажите его сотруднику в указанное время.</p>
        <strong id="booking-code">BS-1042</strong>
        <div class="booking-success-actions">
          <button class="button button-outline" type="button" data-copy-booking-code>Копировать код</button>
          <a class="button button-primary" href="#" id="booking-page-link">Открыть бронь</a>
        </div>
      </div>
    </section>
  </div>`;
}

const PUBLIC_JS = `
(function () {
  var offers = window.DEFAULT_OFFERS || [];
  var selectedOffer = null;
  var publicConfig = window.PUBLIC_CONFIG || {};
  var drawerReturnFocus = null;
  var modalReturnFocus = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  function saveLatestBooking(url) {
    try { localStorage.setItem("bs_latest_booking", url); } catch {}
    document.querySelectorAll("[data-last-booking]").forEach(function (link) {
      link.href = url;
      link.hidden = false;
    });
  }

  function clearLatestBooking(url) {
    try {
      var current = localStorage.getItem("bs_latest_booking");
      if (!url || current === url) localStorage.removeItem("bs_latest_booking");
    } catch {}
    document.querySelectorAll("[data-last-booking]").forEach(function (link) {
      link.hidden = true;
      link.removeAttribute("href");
    });
  }

  function api(path, options) {
    options = options || {};
    var method = options.method || "GET";
    var headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers["X-BS-Request"] = "1";
    return fetch(path, {
      credentials: "same-origin",
      headers: headers,
      method: method,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).catch(function () {
      throw new Error(navigator.onLine === false ? "Нет соединения с интернетом. Проверьте сеть и повторите действие." : "Сервис временно недоступен. Попробуйте ещё раз.");
    }).then(function (response) {
      return response.json().catch(function () {
        return { ok: false, error: { message: "Некорректный ответ сервера" } };
      }).then(function (payload) {
        if (!response.ok || !payload.ok) {
          var error = new Error((payload.error && payload.error.message) || "Ошибка сервера");
          error.status = response.status;
          error.code = payload.error && payload.error.code;
          throw error;
        }
        return payload.data;
      });
    });
  }

  function formObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function humanError(error, fallback) {
    if (navigator.onLine === false) return "Нет соединения с интернетом. Проверьте сеть и повторите действие.";
    if (error && error.code === "LEGAL_NOT_READY") return error.message;
    if (error && error.status === 429) return "Слишком много попыток. Подождите несколько минут и повторите действие.";
    if (error && error.status >= 500) return error.message || "Сервис временно недоступен. Попробуйте немного позже.";
    return (error && error.message) || fallback || "Не удалось выполнить действие. Попробуйте ещё раз.";
  }

  function setNoun(count) {
    var value = Math.abs(Number(count) || 0);
    var mod10 = value % 10;
    var mod100 = value % 100;
    if (mod10 === 1 && mod100 !== 11) return "набор";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "набора";
    return "наборов";
  }

  function remainingText(count) {
    var value = Math.max(0, Number(count) || 0);
    return (value === 1 ? "Остался " : "Осталось ") + value + " " + setNoun(value);
  }

  function photoSourceLabel(offer) {
    return offer.sourceType === "quick_photo" ? "Фото от заведения" : "Обновлено";
  }

  function focusableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (item) {
      return !item.hidden && item.getAttribute("aria-hidden") !== "true" && item.getClientRects().length > 0;
    });
  }

  function trapFocus(event, container) {
    if (event.key !== "Tab") return;
    var focusable = focusableElements(container);
    if (!focusable.length) { event.preventDefault(); container.focus(); return; }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function restoreLatestBooking() {
    var latest = "";
    try { latest = localStorage.getItem("bs_latest_booking") || ""; } catch {}
    if (latest.indexOf("/booking/") !== 0) { clearLatestBooking(); return Promise.resolve(); }
    var token = latest.slice("/booking/".length);
    if (!token) { clearLatestBooking(latest); return Promise.resolve(); }
    return api("/api/public/bookings/" + encodeURIComponent(token)).then(function (booking) {
      var expires = new Date(booking.expiresAt || 0).getTime();
      if (booking.status === "created" && expires > Date.now()) saveLatestBooking(latest);
      else clearLatestBooking(latest);
    }).catch(function () { clearLatestBooking(latest); });
  }

  function photoTime(offer) {
    var value = offer.photoCapturedAt || offer.publishedAt;
    if (!value) return "время не указано";
    try { return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
    catch { return "время не указано"; }
  }

  function offerImages(offer) {
    return Array.isArray(offer.imageUrls) && offer.imageUrls.length ? offer.imageUrls.slice(0, 3) : [offer.imageUrl || "/images/offer-lunch-v2.png"];
  }

  function recentMarkup(offer) {
    return '<button class="recent-offer js-open-offer" type="button" data-offer-id="' + escapeHtml(offer.id) + '">' +
      '<img src="' + escapeHtml(offerImages(offer)[0]) + '" alt="' + escapeHtml(offer.imageAlt || offer.title) + '" />' +
      '<span class="fresh-photo-label">' + escapeHtml(photoSourceLabel(offer)) + ' · ' + escapeHtml(photoTime(offer)) + '</span>' +
      '<span class="recent-offer-copy"><strong>' + escapeHtml(offer.title) + '</strong><small>' + escapeHtml(offer.partnerName) + ' · ' + escapeHtml(offer.address) + '</small></span>' +
      '<span class="recent-stock">' + escapeHtml(remainingText(offer.remaining)) + '</span></button>';
  }

  function rowMarkup(offer) {
    var oldPrice = Number(offer.oldPrice || 0);
    var discount = oldPrice > Number(offer.price) ? Math.round((1 - Number(offer.price) / oldPrice) * 100) : 0;
    return '<button class="offer-row js-open-offer" type="button" data-offer-card data-category="' + escapeHtml(offer.category) + '" data-offer-id="' + escapeHtml(offer.id) + '">' +
      '<img src="' + escapeHtml(offerImages(offer)[0]) + '" alt="' + escapeHtml(offer.imageAlt || offer.title) + '" />' +
      '<span class="offer-row-main"><strong>' + escapeHtml(offer.title) + '</strong><small>' + escapeHtml(offer.partnerName) + ' · ' + escapeHtml(offer.address) + '</small><em>' + escapeHtml(photoSourceLabel(offer)) + ' · ' + escapeHtml(photoTime(offer)) + '</em><span class="offer-row-mobile-pickup">Выдача ' + escapeHtml(offer.pickupWindow) + '</span></span>' +
      '<span class="offer-row-pickup"><small>Забрать сегодня</small><b>' + escapeHtml(offer.pickupWindow) + '</b></span>' +
      '<span class="offer-row-stock">' + escapeHtml(remainingText(offer.remaining)) + '</span>' +
      '<span class="offer-row-price"><strong>' + Number(offer.price) + ' ₽</strong>' + (oldPrice ? '<del>' + oldPrice + ' ₽</del>' : '') + (discount ? '<em>−' + discount + '%</em>' : '') + '</span>' +
      '<span class="offer-row-more">Подробнее</span></button>';
  }

  function renderMarketplace() {
    var recent = document.getElementById("recent-offers");
    var recentSection = document.getElementById("recent-section");
    var list = document.getElementById("offers-grid");
    if (recent) recent.innerHTML = offers.slice(0, 6).map(recentMarkup).join("");
    if (recentSection) recentSection.hidden = offers.length === 0;
    if (list) list.innerHTML = offers.map(rowMarkup).join("");
    var active = document.querySelector(".filter.active");
    setFilter(active ? active.dataset.filter : "all");
  }

  function refreshOffers() {
    if (!document.getElementById("offers-grid")) return Promise.resolve();
    return api("/api/public/offers").then(function (data) {
      offers = data;
      renderMarketplace();
      var status = document.getElementById("marketplace-status");
      if (status) status.hidden = true;
    });
  }

  function showMarketplaceError(error) {
    var status = document.getElementById("marketplace-status");
    if (!status) return;
    status.textContent = humanError(error, "Не удалось обновить предложения. Уже загруженные карточки остаются доступны.");
    status.hidden = false;
  }

  function renderOfferDrawer(offer, activeImage) {
    var drawer = document.getElementById("offer-drawer");
    var content = drawer && drawer.querySelector("[data-offer-drawer-content]");
    if (!drawer || !content) return;
    var wasHidden = drawer.hidden;
    var images = offerImages(offer);
    var current = Math.max(0, Math.min(Number(activeImage || 0), images.length - 1));
    var oldPrice = Number(offer.oldPrice || 0);
    var discount = oldPrice > Number(offer.price) ? Math.round((1 - Number(offer.price) / oldPrice) * 100) : 0;
    var soldOut = Number(offer.remaining) <= 0 || offer.status === "sold_out";
    content.innerHTML = '<div class="drawer-heading"><div><h2>' + escapeHtml(offer.title) + '</h2><p>' + escapeHtml(offer.partnerName) + ' · ' + escapeHtml(offer.address) + '</p></div></div>' +
      '<span class="drawer-fresh">' + escapeHtml(photoSourceLabel(offer)) + ' · ' + escapeHtml(photoTime(offer)) + '</span>' +
      '<div class="drawer-gallery"><img src="' + escapeHtml(images[current]) + '" alt="' + escapeHtml(offer.imageAlt || offer.title) + '" />' +
      (images.length > 1 ? '<div class="gallery-dots">' + images.map(function (_, index) { return '<button type="button" aria-label="Фото ' + (index + 1) + '" class="' + (index === current ? "active" : "") + '" data-drawer-image="' + index + '"></button>'; }).join("") + '</div>' : '') + '</div>' +
      '<div class="drawer-pickup"><span><small>Забрать сегодня</small><strong>' + escapeHtml(offer.pickupWindow) + '</strong></span><b>' + (soldOut ? "Распродано" : escapeHtml(remainingText(offer.remaining))) + '</b></div>' +
      '<div class="drawer-description"><p>' + escapeHtml(offer.description || "Предложение приготовлено сегодня и доступно до указанного времени.") + '</p>' + (offer.contents ? '<p><strong>В наборе:</strong> ' + escapeHtml(offer.contents) + '</p>' : '') + '</div>' +
      '<div class="drawer-price"><strong>' + Number(offer.price) + ' ₽</strong>' + (oldPrice ? '<del>' + oldPrice + ' ₽</del>' : '') + (discount ? '<span>−' + discount + '%</span>' : '') + '</div>' +
      '<button class="button button-primary js-open-booking" data-offer-id="' + escapeHtml(offer.id) + '"' + (soldOut || !publicConfig.legalReady ? ' disabled' : '') + '>' + (soldOut ? "Распродано" : (publicConfig.legalReady ? "Получить код" : "Бронирование пока закрыто")) + '</button>' +
      '<small class="drawer-payment-note">' + (publicConfig.legalReady ? "Оплата при получении в заведении" : "Документы сервиса готовятся. Просмотр предложений доступен без передачи персональных данных.") + '</small>' +
      '<div class="drawer-trust"><span><b>Фото от заведения</b><small>Изображение добавил партнёр</small></span><span><b>Самовывоз сегодня</b><small>Время указано в карточке</small></span></div>';
    drawer.dataset.offerId = offer.id;
    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    var backdrop = document.querySelector("[data-close-offer-drawer].offer-drawer-backdrop");
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add("drawer-open");
    if (wasHidden) drawer.querySelector("[data-close-offer-drawer]")?.focus({ preventScroll: true });
  }

  function closeOfferDrawer(restoreFocus) {
    var drawer = document.getElementById("offer-drawer");
    if (drawer) { drawer.hidden = true; drawer.setAttribute("aria-hidden", "true"); }
    var backdrop = document.querySelector("[data-close-offer-drawer].offer-drawer-backdrop");
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("drawer-open");
    if (restoreFocus !== false && drawerReturnFocus && drawerReturnFocus.isConnected) drawerReturnFocus.focus({ preventScroll: true });
  }

  function closeBookingModal(restoreFocus) {
    var modal = document.getElementById("booking-modal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("modal-open");
    if (restoreFocus !== false && modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus({ preventScroll: true });
  }

  function setFilter(category) {
    var visibleCount = 0;
    document.querySelectorAll("[data-offer-card]").forEach(function (card) {
      var visible = category === "all" || card.dataset.category === category;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    var empty = document.getElementById("offers-empty");
    if (empty) {
      empty.hidden = visibleCount > 0;
      var title = document.getElementById("offers-empty-title");
      var text = document.getElementById("offers-empty-text");
      if (title) title.textContent = offers.length ? "В этой категории пока ничего нет" : "Сегодня предложений пока нет";
      if (text) text.textContent = offers.length ? "Выберите другую категорию или обновите витрину позже." : "Заведения добавляют наборы в течение дня. Проверьте витрину немного позже.";
    }
  }

  document.addEventListener("click", function (event) {
    var copyCode = event.target.closest("[data-copy-booking-code]");
    if (copyCode) {
      var code = document.getElementById("booking-code");
      if (code && navigator.clipboard) {
        navigator.clipboard.writeText(code.textContent).then(function () { copyCode.textContent = "Код скопирован"; });
      }
      return;
    }

    var filter = event.target.closest(".filter");
    if (filter) {
      event.preventDefault();
      document.querySelectorAll(".filter").forEach(function (item) { item.classList.remove("active"); });
      filter.classList.add("active");
      setFilter(filter.dataset.filter || "all");
      return;
    }

    var refreshButton = event.target.closest("[data-refresh-offers]");
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Обновляем…";
      refreshOffers().catch(showMarketplaceError).finally(function () {
        refreshButton.disabled = false;
        refreshButton.textContent = "Обновить предложения";
      });
      return;
    }

    var imageDot = event.target.closest("[data-drawer-image]");
    if (imageDot) {
      var openDrawer = document.getElementById("offer-drawer");
      var galleryOffer = offers.find(function (offer) { return offer.id === openDrawer.dataset.offerId; });
      if (galleryOffer) renderOfferDrawer(galleryOffer, Number(imageDot.dataset.drawerImage));
      return;
    }

    if (event.target.closest("[data-close-offer-drawer]")) {
      closeOfferDrawer();
      return;
    }

    var offerOpener = event.target.closest(".js-open-offer");
    if (offerOpener) {
      event.preventDefault();
      drawerReturnFocus = offerOpener;
      var drawerOffer = offers.find(function (offer) { return offer.id === offerOpener.dataset.offerId; });
      if (drawerOffer) renderOfferDrawer(drawerOffer, 0);
      return;
    }

    var opener = event.target.closest(".js-open-booking");
    if (opener) {
      event.preventDefault();
      selectedOffer = offers.find(function (offer) { return offer.id === opener.dataset.offerId; });
      if (!selectedOffer) return;
      modalReturnFocus = drawerReturnFocus && drawerReturnFocus.isConnected ? drawerReturnFocus : opener;
      closeOfferDrawer(false);
      var modal = document.getElementById("booking-modal");
      var form = document.getElementById("booking-form");
      var summary = document.getElementById("booking-summary");
      if (!modal || !form || !summary) return;
      var pickupWindow = selectedOffer.pickupWindow || selectedOffer.pickup_window || "";
      summary.innerHTML = "<h3>" + escapeHtml(selectedOffer.title) + "</h3><p>" + escapeHtml(selectedOffer.partnerName || "Заведение") + " · " + escapeHtml(selectedOffer.address || "") + "</p><p><b>" + Number(selectedOffer.price) + " ₽</b> · " + escapeHtml(pickupWindow) + "</p>";
      document.querySelector('[data-booking-step="form"]').hidden = false;
      document.querySelector('[data-booking-step="success"]').hidden = true;
      form.reset();
      modal.hidden = false;
      document.body.classList.add("modal-open");
      form.querySelector('input[name="customerName"]')?.focus({ preventScroll: true });
      return;
    }

    if (event.target.closest("[data-close-modal]")) {
      closeBookingModal(true);
    }
  });

  document.addEventListener("keydown", function (event) {
    var modal = document.getElementById("booking-modal");
    var drawer = document.getElementById("offer-drawer");
    if (modal && !modal.hidden) {
      if (event.key === "Escape") { event.preventDefault(); closeBookingModal(true); return; }
      trapFocus(event, modal.querySelector('[role="dialog"]'));
      return;
    }
    if (drawer && !drawer.hidden) {
      if (event.key === "Escape") { event.preventDefault(); closeOfferDrawer(true); return; }
      trapFocus(event, drawer);
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
        body: { offerId: selectedOffer.id, customerName: data.customerName, customerPhone: data.customerPhone, personalDataConsent: data.personalDataConsent }
      }).then(function (result) {
        document.getElementById("booking-code").textContent = result.code;
        var bookingLink = document.getElementById("booking-page-link");
        if (bookingLink) bookingLink.href = result.bookingUrl;
        saveLatestBooking(result.bookingUrl);
        selectedOffer.remaining = Math.max(0, Number(selectedOffer.remaining || 0) - 1);
        refreshOffers().catch(function () {});
        document.querySelector('[data-booking-step="form"]').hidden = true;
        document.querySelector('[data-booking-step="success"]').hidden = false;
        document.querySelector("[data-booking-success-title]")?.focus({ preventScroll: true });
      }).catch(function (err) {
        if (error) {
          error.textContent = err.status === 409 ? "Предложение уже закончилось. Выберите другой набор." : humanError(err, "Не удалось создать бронь.");
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
          error.textContent = humanError(err, "Не удалось отправить данные. Попробуйте позже.");
          error.hidden = false;
        }
      });
    });
  });

  var bookingPageRoot = document.querySelector("[data-public-booking]");
  if (bookingPageRoot) {
    var publicToken = bookingPageRoot.dataset.publicBooking;
    var content = bookingPageRoot.querySelector("[data-booking-page-content]");
    var bookingHelp = bookingPageRoot.querySelector(".booking-help");
    var statusLabels = { created: "Забронировано", issued: "Выдано", no_show: "Не получено", cancelled: "Отменено" };
    var renderBooking = function (booking) {
      var canCancel = booking.status === "created";
      var bookingUrl = "/booking/" + publicToken;
      if (!canCancel) clearLatestBooking(bookingUrl);
      if (booking.status === "cancelled") {
        content.innerHTML = '<div class="booking-status-row"><span class="booking-status status-cancelled">Отменено</span></div>' +
          '<div class="booking-cancelled"><h2>Бронь отменена</h2><p>Код больше не действует, а набор снова доступен другим покупателям.</p><a class="button button-primary" href="/#offers">Выбрать другое предложение</a></div>';
        if (bookingHelp) bookingHelp.innerHTML = '<h2>Что теперь</h2><p>Ничего оплачивать и показывать сотруднику не нужно.</p><p><a href="/#offers">Вернитесь к предложениям</a>, если хотите выбрать другой набор.</p>';
        return;
      }
      if (bookingHelp) bookingHelp.innerHTML = '<h2>Что делать дальше</h2><ol><li>Приходите в указанное время.</li><li>Покажите код сотруднику.</li><li>Оплатите набор на кассе.</li></ol>' + (canCancel ? '<p>Не успеваете? Отмените бронь, чтобы набор снова стал доступен.</p>' : '');
      content.innerHTML = '<div class="booking-status-row"><span class="booking-status status-' + escapeHtml(booking.status) + '">' + escapeHtml(statusLabels[booking.status] || booking.status) + '</span><small>Оплата при получении</small></div>' +
        '<div class="public-code"><small>Код бронирования</small><strong>' + escapeHtml(booking.code) + '</strong></div>' +
        '<dl class="booking-details"><div><dt>Предложение</dt><dd>' + escapeHtml(booking.offerTitle) + '</dd></div><div><dt>Заведение</dt><dd>' + escapeHtml(booking.partnerName) + '</dd></div><div><dt>Адрес</dt><dd>' + escapeHtml(booking.address) + '</dd></div><div><dt>Забрать</dt><dd>Сегодня, ' + escapeHtml(booking.pickupWindow) + '</dd></div><div><dt>К оплате</dt><dd>' + Number(booking.price) + ' ₽ на кассе</dd></div></dl>' +
        '<div class="booking-page-actions"><button class="button button-outline" type="button" data-page-copy>Копировать код</button>' + (canCancel ? '<button class="text-danger" type="button" data-cancel-booking>Отменить бронь</button>' : '') + '</div>';
      content.querySelector("[data-page-copy]")?.addEventListener("click", function (event) {
        if (navigator.clipboard) navigator.clipboard.writeText(booking.code).then(function () { event.currentTarget.textContent = "Код скопирован"; });
      });
      content.querySelector("[data-cancel-booking]")?.addEventListener("click", function (event) {
        var button = event.currentTarget;
        if (button.dataset.confirmed !== "true") {
          button.dataset.confirmed = "true";
          button.textContent = "Подтвердить отмену";
          window.setTimeout(function () {
            if (button.isConnected && !button.disabled) { delete button.dataset.confirmed; button.textContent = "Отменить бронь"; }
          }, 6000);
          return;
        }
        button.disabled = true;
        api("/api/public/bookings/" + encodeURIComponent(publicToken) + "/cancel", { method: "POST" }).then(function () {
          return api("/api/public/bookings/" + encodeURIComponent(publicToken));
        }).then(renderBooking).catch(function (error) {
          content.insertAdjacentHTML("beforeend", '<p class="form-error">' + escapeHtml(error.message) + '</p>');
        });
      });
    };
    api("/api/public/bookings/" + encodeURIComponent(publicToken)).then(renderBooking).catch(function () {
      clearLatestBooking("/booking/" + publicToken);
      content.innerHTML = '<div class="empty-state"><h2>Бронь не найдена</h2><p>Проверьте ссылку или выберите новое предложение.</p><a class="button button-primary" href="/#offers">Смотреть предложения</a></div>';
      if (bookingHelp) bookingHelp.innerHTML = '<h2>Что можно сделать</h2><p>Вернитесь к предложениям и создайте новую бронь.</p>';
    });
  }
  restoreLatestBooking();
  refreshOffers().catch(showMarketplaceError);
})();
`;

const APP_JS = `
let offersState = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers["X-BS-Request"] = "1";
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      method,
      headers,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
    });
  } catch {
    throw new Error(navigator.onLine === false ? "Нет соединения с интернетом. Проверьте сеть и повторите действие." : "Сервис временно недоступен. Попробуйте ещё раз.");
  }
  const payload = await response.json().catch(() => ({ ok: false, error: { message: "Сервис временно недоступен" } }));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error?.message || "Не удалось выполнить действие");
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function localDateValue(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

const STATUS_LABELS = {
  active: "Активен", paused: "Черновик", disabled: "Отключён", archived: "В архиве", sold_out: "Распродано", expired: "Истекло",
  created: "Забронировано", issued: "Выдано", no_show: "Не пришёл", cancelled: "Отменено",
  new: "Новое", contacted: "Связались", approved: "Подключён", rejected: "Отклонено",
  in_progress: "В работе", closed: "Закрыто", owner: "Владелец", manager: "Менеджер"
};

const TYPE_LABELS = {
  culinary: "Кулинария", bakery: "Пекарня", coffee: "Кофейня", cafe: "Кафе", ready_food_cafe: "Кафе с готовой едой", buffet: "Буфет", other: "Другое",
  venue_connection: "Подключение заведения", service_question: "Вопрос по сервису", partner_pilot: "Партнёрский пилот", order_question: "Вопрос по заказу"
};

const AUDIT_ACTION_LABELS = {
  seed_database: "Подготовлена база", admin_login: "Вход администратора", partner_login: "Вход партнёра", create_booking: "Создана бронь",
  set_booking_status: "Изменён статус брони", create_partner_application: "Создана заявка партнёра", create_contact_request: "Создано обращение",
  create_partner: "Создан партнёр", onboard_partner: "Подключён партнёр", create_partner_from_application: "Партнёр создан из заявки",
  create_address: "Добавлена точка", create_offer: "Создано предложение", create_offer_template: "Создан шаблон", create_partner_user: "Добавлен сотрудник",
  revoke_user_sessions: "Закрыты сеансы сотрудника", revoke_partner_sessions: "Закрыты сеансы партнёра", revoke_role_sessions: "Закрыты активные входы", rehash_partner_password: "Обновлена защита пароля",
  change_partner_password: "Партнёр сменил пароль", change_admin_password: "Администратор сменил пароль", archive_partner: "Партнёр перенесён в архив", delete_partner: "Партнёр удалён"
};

const AUDIT_ENTITY_LABELS = {
  database: "Данные сервиса", session: "Вход", booking: "Бронь", partner_application: "Заявка партнёра", contact_request: "Обращение",
  partner: "Партнёр", partner_address: "Точка", partner_user: "Сотрудник", admin_user: "Администратор", offer: "Предложение", offer_template: "Шаблон"
};

function statusLabel(value) {
  return STATUS_LABELS[value] || value || "—";
}

function typeLabel(value) {
  return TYPE_LABELS[value] || "Другое";
}

function auditActionLabel(value) {
  if (AUDIT_ACTION_LABELS[value]) return AUDIT_ACTION_LABELS[value];
  if (String(value).startsWith("patch_")) return "Изменены данные";
  if (String(value).startsWith("delete_")) return "Отключена запись";
  return "Системное действие";
}

function auditEntityLabel(value) {
  return AUDIT_ENTITY_LABELS[value] || "Запись сервиса";
}

function auditActorLabel(value) {
  return value === "admin" ? "Администратор" : value === "partner" ? "Партнёр" : "Сервис";
}

function dateTimeLabel(value) {
  try { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
  catch { return "—"; }
}

function setSelectOptions(select, items, placeholder, valueKey, label) {
  if (!select) return;
  const selected = select.value;
  select.innerHTML = '<option value="">' + escapeHtml(placeholder) + '</option>' + items.map((item) => '<option value="' + escapeHtml(item[valueKey]) + '">' + escapeHtml(label(item)) + '</option>').join('');
  if (items.some((item) => String(item[valueKey]) === selected)) select.value = selected;
}

function notify(message, type = "success") {
  let toast = document.querySelector("[data-app-toast]");
  if (!toast) {
    toast = document.createElement("div");
    toast.dataset.appToast = "true";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.className = "app-toast " + (type === "error" ? "is-error" : "is-success");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { toast.hidden = true; }, 3200);
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
  if (document.getElementById("recent-offers")) {
    const time = (offer) => { try { return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(offer.photoCapturedAt || offer.publishedAt)); } catch { return "сегодня"; } };
    const image = (offer) => Array.isArray(offer.imageUrls) && offer.imageUrls[0] ? offer.imageUrls[0] : (offer.imageUrl || "/images/offer-lunch-v2.png");
    grid.innerHTML = offers.map((offer) => {
      const oldPrice = Number(offer.oldPrice || 0);
      const discount = oldPrice > Number(offer.price) ? Math.round((1 - Number(offer.price) / oldPrice) * 100) : 0;
      return '<button class="offer-row js-open-offer" type="button" data-offer-card data-category="' + escapeHtml(offer.category) + '" data-offer-id="' + escapeHtml(offer.id) + '"><img src="' + escapeHtml(image(offer)) + '" alt="' + escapeHtml(offer.imageAlt || offer.title) + '" /><span class="offer-row-main"><strong>' + escapeHtml(offer.title) + '</strong><small>' + escapeHtml(offer.partnerName) + ' · ' + escapeHtml(offer.address) + '</small><em>Обновлено · ' + escapeHtml(time(offer)) + '</em></span><span class="offer-row-pickup"><small>Забрать сегодня</small><b>' + escapeHtml(offer.pickupWindow) + '</b></span><span class="offer-row-stock">Осталось ' + Number(offer.remaining || 0) + '</span><span class="offer-row-price"><strong>' + Number(offer.price) + ' ₽</strong>' + (oldPrice ? '<del>' + oldPrice + ' ₽</del>' : '') + (discount ? '<em>−' + discount + '%</em>' : '') + '</span><span class="offer-row-more">Подробнее</span></button>';
    }).join("");
    document.getElementById("recent-offers").innerHTML = offers.slice(0, 6).map((offer) => '<button class="recent-offer js-open-offer" type="button" data-offer-id="' + escapeHtml(offer.id) + '"><img src="' + escapeHtml(image(offer)) + '" alt="' + escapeHtml(offer.imageAlt || offer.title) + '" /><span class="fresh-photo-label">Обновлено · ' + escapeHtml(time(offer)) + '</span><span class="recent-offer-copy"><strong>' + escapeHtml(offer.title) + '</strong><small>' + escapeHtml(offer.partnerName) + ' · ' + escapeHtml(offer.address) + '</small></span><span class="recent-stock">Осталось ' + Number(offer.remaining || 0) + '</span></button>').join("");
  } else {
    grid.innerHTML = offers.map((offer) => {
      const soldOut = Number(offer.remaining) <= 0 || offer.status === "sold_out";
      return '<article class="offer-card"><div class="offer-image"><img src="' + escapeHtml(offer.imageUrl || "/images/offer-lunch-v2.png") + '" alt="' + escapeHtml(offer.imageAlt) + '" loading="lazy" /></div><div class="offer-body"><p class="partner-name">' + escapeHtml(offer.partnerName) + '</p><h3>' + escapeHtml(offer.title) + '</h3><div class="price-line"><strong>' + offer.price + ' ₽</strong>' + (offer.oldPrice ? '<span>вместо ' + offer.oldPrice + ' ₽</span>' : '') + '</div><p class="meta">' + escapeHtml(offer.pickupWindow) + '</p><span class="stock-badge">' + (soldOut ? 'Распродано' : 'Осталось ' + offer.remaining) + '</span><button class="button button-primary js-open-booking" data-offer-id="' + offer.id + '"' + (soldOut ? ' disabled' : '') + '>' + (soldOut ? 'Распродано' : escapeHtml(offer.ctaLabel)) + '</button></div></article>';
    }).join("");
  }
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
    const detail = event.target.closest(".js-open-offer");
    if (detail) {
      const offer = offersState.find((item) => item.id === detail.dataset.offerId);
      const drawer = document.getElementById("offer-drawer");
      if (offer && drawer) {
        const images = Array.isArray(offer.imageUrls) && offer.imageUrls.length ? offer.imageUrls : [offer.imageUrl || "/images/offer-lunch-v2.png"];
        const oldPrice = Number(offer.oldPrice || 0);
        const discount = oldPrice > Number(offer.price) ? Math.round((1 - Number(offer.price) / oldPrice) * 100) : 0;
        drawer.querySelector("[data-offer-drawer-content]").innerHTML = '<div class="drawer-heading"><h2>' + escapeHtml(offer.title) + '</h2><p>' + escapeHtml(offer.partnerName) + ' · ' + escapeHtml(offer.address) + '</p></div><span class="drawer-fresh">Обновлено заведением</span><div class="drawer-gallery"><img src="' + escapeHtml(images[0]) + '" alt="' + escapeHtml(offer.imageAlt || offer.title) + '" /></div><div class="drawer-pickup"><span><small>Забрать сегодня</small><strong>' + escapeHtml(offer.pickupWindow) + '</strong></span><b>Осталось ' + Number(offer.remaining || 0) + '</b></div><div class="drawer-description"><p>' + escapeHtml(offer.description || "Предложение приготовлено сегодня.") + '</p><p><strong>В наборе:</strong> ' + escapeHtml(offer.contents || "Состав уточняйте в точке") + '</p></div><div class="drawer-price"><strong>' + Number(offer.price) + ' ₽</strong>' + (oldPrice ? '<del>' + oldPrice + ' ₽</del>' : '') + (discount ? '<span>−' + discount + '%</span>' : '') + '</div><button class="button button-primary js-open-booking" data-offer-id="' + escapeHtml(offer.id) + '">Получить код</button><small class="drawer-payment-note">Оплата при получении в заведении</small><div class="drawer-trust"><span><b>Актуальное предложение</b><small>Данные добавляет заведение</small></span><span><b>Самовывоз сегодня</b><small>Оплата на кассе</small></span></div>';
        drawer.hidden = false; drawer.setAttribute("aria-hidden", "false"); drawer.dataset.offerId = offer.id;
        document.querySelector(".offer-drawer-backdrop").hidden = false; document.body.classList.add("drawer-open");
      }
      return;
    }
    if (event.target.closest("[data-close-offer-drawer]")) {
      const drawer = document.getElementById("offer-drawer");
      if (drawer) { drawer.hidden = true; drawer.setAttribute("aria-hidden", "true"); }
      document.querySelector(".offer-drawer-backdrop")?.setAttribute("hidden", ""); document.body.classList.remove("drawer-open"); return;
    }
    const opener = event.target.closest(".js-open-booking");
    if (!opener) return;
    selectedOffer = offersState.find((offer) => offer.id === opener.dataset.offerId);
    if (!selectedOffer) return;
    const openDrawer = document.getElementById("offer-drawer");
    if (openDrawer) { openDrawer.hidden = true; openDrawer.setAttribute("aria-hidden", "true"); }
    document.querySelector(".offer-drawer-backdrop")?.setAttribute("hidden", "");
    document.body.classList.remove("drawer-open");
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
      const result = await api("/api/public/bookings", { method: "POST", body: { offerId: selectedOffer.id, customerName: data.customerName, customerPhone: data.customerPhone, personalDataConsent: data.personalDataConsent } });
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

function applyTableFilter(group) {
  const target = document.querySelector(group.dataset.filterTarget || "");
  if (!target) return;
  const query = (group.querySelector("[data-filter-query]")?.value || "").trim().toLowerCase();
  const status = (group.querySelector("[data-filter-status]")?.value || "").trim().toLowerCase();
  const rows = Array.from(target.querySelectorAll("tbody tr"));
  let visible = 0;
  rows.forEach((row) => {
    const text = row.textContent.toLowerCase();
    const matches = (!query || text.includes(query)) && (!status || text.includes(status));
    row.hidden = !matches;
    if (matches) visible += 1;
  });
  let empty = target.querySelector("[data-filter-empty]");
  if (!empty && rows.length) {
    empty = document.createElement("p");
    empty.className = "empty-state filter-empty";
    empty.dataset.filterEmpty = "true";
    empty.textContent = "По заданным условиям ничего не найдено";
    target.appendChild(empty);
  }
  if (empty) empty.hidden = rows.length === 0 || visible > 0;
}

function setupTableFilters(root = document) {
  root.querySelectorAll("[data-table-filter-group]").forEach((group) => {
    if (!group.dataset.filterBound) {
      group.addEventListener("input", () => applyTableFilter(group));
      group.addEventListener("change", () => applyTableFilter(group));
      group.dataset.filterBound = "true";
    }
    applyTableFilter(group);
  });
}

function confirmRiskyAction(button) {
  if (!button?.hasAttribute("data-confirm-action")) return true;
  if (button.dataset.confirmed === "true") {
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.confirmed;
    delete button.dataset.originalText;
    button.classList.remove("confirming");
    return true;
  }
  button.dataset.confirmed = "true";
  button.dataset.originalText = button.textContent;
  button.textContent = "Подтвердить";
  button.classList.add("confirming");
  notify("Нажмите «Подтвердить» ещё раз, чтобы выполнить действие");
  window.setTimeout(() => {
    if (!button.isConnected || button.dataset.confirmed !== "true") return;
    button.textContent = button.dataset.originalText || "Повторить";
    delete button.dataset.confirmed;
    delete button.dataset.originalText;
    button.classList.remove("confirming");
  }, 6000);
  return false;
}

function trapAppFocus(event, container) {
  if (event.key !== "Tab" || !container) return;
  const focusable = Array.from(container.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((node) => !node.hidden && node.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
    root.querySelectorAll("[data-tab-select]").forEach((select) => { select.value = tab; });
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
  root.querySelectorAll("[data-tab-select]").forEach((select) => select.addEventListener("change", () => activate(select.value)));
  window.addEventListener("popstate", () => activate(null, true));
  activate(null, true);
  return activate;
}

async function setupAdmin() {
  if (!document.querySelector("[data-admin-app]")) return;
  const loginBox = document.querySelector("[data-admin-login]");
  const passwordGate = document.querySelector("[data-admin-password-gate]");
  const dashboard = document.querySelector("[data-admin-dashboard]");
  const activateTabs = setupTabs("[data-admin-app]", ["overview", "partners", "offers", "bookings", "partner-applications", "contact-requests", "audit", "settings"]);
  let applicationCache = [];
  let contactCache = [];
  let partnerCache = [];

  const showRecord = (kind, row) => {
    const dialog = document.querySelector("[data-record-dialog]");
    if (!dialog || !row) return;
    const application = kind === "application";
    dialog.querySelector("[data-record-kind]").textContent = application ? "Заявка партнёра" : "Обращение";
    dialog.querySelector("[data-record-title]").textContent = application ? row.venue_name : row.name;
    const details = application
      ? [["Контакт", row.contact_name], ["Телефон", row.phone], ["Email", row.email], ["Город", row.city], ["Адрес", row.first_address], ["Тип", typeLabel(row.venue_type)], ["Точек", row.locations_count], ["Статус", statusLabel(row.status)], ["Получено", dateTimeLabel(row.created_at)]]
      : [["Телефон", row.phone], ["Email", row.email], ["Тема", typeLabel(row.type)], ["Статус", statusLabel(row.status)], ["Получено", dateTimeLabel(row.created_at)]];
    const list = dialog.querySelector("[data-record-details]");
    list.replaceChildren(...details.map(([label, value]) => {
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value || "—";
      wrapper.append(term, description);
      return wrapper;
    }));
    const message = dialog.querySelector("[data-record-message]");
    message.textContent = application ? (row.comment || "Комментарий не оставлен") : row.message;
    message.hidden = false;
    dialog.hidden = false;
    document.body.classList.add("dialog-open");
    dialog.querySelector("[data-close-record-dialog]")?.focus({ preventScroll: true });
  };

  const closeRecord = () => {
    const dialog = document.querySelector("[data-record-dialog]");
    if (dialog) dialog.hidden = true;
    document.body.classList.remove("dialog-open");
  };

  const render = async () => {
    const data = await api("/api/admin/dashboard");
    loginBox.hidden = true; passwordGate.hidden = true; dashboard.hidden = false;
    document.querySelector("[data-admin-stats]").innerHTML = [
      ["Активные предложения", data.activeOffersCount], ["Получено кодов", data.bookingsCount], ["Выдано заказов", data.issuedBookingsCount], ["Новые заявки", data.newPartnerApplicationsCount], ["Новые обращения", data.newContactRequestsCount], ["Выручка", data.estimatedPartnerRevenue + " ₽"]
    ].map(([label, value]) => '<span><small>' + label + '</small><b>' + value + '</b></span>').join('');
    const [partners, offers, bookings, applications, contacts, auditLog] = await Promise.all([
      api("/api/admin/partners"), api("/api/admin/offers"), api("/api/admin/bookings"), api("/api/admin/partner-applications"), api("/api/admin/contact-requests"), api("/api/admin/audit-log")
    ]);
    applicationCache = applications;
    contactCache = contacts;
    partnerCache = partners;
    const addresses = (await Promise.all(partners.map(async (partner) => (await api("/api/admin/partners/" + partner.id + "/addresses")).map((item) => ({ ...item, partnerName: partner.name }))))).flat();
    const users = (await Promise.all(partners.map(async (partner) => (await api("/api/admin/partners/" + partner.id + "/users")).map((item) => ({ ...item, partnerName: partner.name }))))).flat();
    const partnerById = Object.fromEntries(partners.map((item) => [item.id, item]));
    const addressById = Object.fromEntries(addresses.map((item) => [item.id, item]));
    document.querySelectorAll("[data-admin-partner-select]").forEach((select) => setSelectOptions(select, partners, "Выберите партнёра", "id", (item) => item.name));
    const offerPartnerSelect = document.querySelector("[data-admin-offer-partner]");
    const offerAddressSelect = document.querySelector("[data-admin-offer-address]");
    setSelectOptions(offerPartnerSelect, partners, "Выберите партнёра", "id", (item) => item.name);
    const refreshOfferAddresses = () => {
      const ownAddresses = addresses.filter((item) => item.partner_id === offerPartnerSelect.value && item.is_active !== false);
      setSelectOptions(offerAddressSelect, ownAddresses, ownAddresses.length ? "Выберите точку" : "У партнёра нет активных точек", "id", (item) => item.title + " · " + item.address);
      offerAddressSelect.disabled = ownAddresses.length === 0;
    };
    offerPartnerSelect.onchange = refreshOfferAddresses;
    refreshOfferAddresses();
    document.querySelectorAll("[data-today-date]").forEach((input) => { if (!input.value) input.value = localDateValue(); });
    document.querySelector("[data-admin-service]").innerHTML = table([{ name: "Кабинеты сотрудников", value: "Доступны" }, { name: "Защита входа", value: "Включена" }, { name: "Резервное копирование", value: "По регламенту" }], [{ label: "Проверка", value: "name" }, { label: "Статус", value: "value" }]);
    document.querySelector("[data-admin-partners]").innerHTML = table(partners, [{ label: "Название", value: "name" }, { label: "Тип", value: (row) => typeLabel(row.type) }, { label: "Контакт", value: (row) => row.contact_name || "—" }, { label: "Телефон", value: (row) => row.phone || "—" }, { label: "Статус", value: (row) => statusLabel(row.status) }], (row) => '<button class="table-action" data-confirm-action data-admin-partner-status="' + row.id + '" data-status="' + (row.status === "active" ? "disabled" : "active") + '">' + (row.status === "active" ? "Отключить" : "Включить") + '</button> ' + (row.status === "archived" ? '' : '<button class="table-action" data-confirm-action data-admin-partner-archive="' + row.id + '">В архив</button> ') + '<button class="table-action danger" data-confirm-action data-admin-partner-delete="' + row.id + '">Удалить</button>');
    document.querySelector("[data-admin-addresses]").innerHTML = table(addresses, [{ label: "Партнёр", value: "partnerName" }, { label: "Точка", value: "title" }, { label: "Адрес", value: "address" }, { label: "Статус", value: (row) => row.is_active === false ? "Отключена" : "Активна" }], (row) => '<button class="table-action" data-confirm-action data-admin-address-status="' + row.id + '" data-partner-id="' + row.partner_id + '" data-status="' + (row.is_active === false ? "true" : "false") + '">' + (row.is_active === false ? "Включить" : "Отключить") + '</button>');
    document.querySelector("[data-admin-users]").innerHTML = table(users, [{ label: "Партнёр", value: "partnerName" }, { label: "Логин", value: "login" }, { label: "Роль", value: (row) => statusLabel(row.role) }, { label: "Статус", value: (row) => statusLabel(row.status) }], (row) => '<button class="table-action" data-confirm-action data-admin-user-status="' + row.id + '" data-partner-id="' + row.partner_id + '" data-status="' + (row.status === "active" ? "disabled" : "active") + '">' + (row.status === "active" ? "Отключить" : "Включить") + '</button>');
    document.querySelector("[data-admin-offers]").innerHTML = table(offers, [{ label: "Название", value: "title" }, { label: "Партнёр", value: (row) => partnerById[row.partner_id]?.name || "—" }, { label: "Точка", value: (row) => addressById[row.address_id]?.title || "—" }, { label: "Дата", value: "date" }, { label: "Остаток", value: (row) => row.remaining_quantity + " / " + row.total_quantity }, { label: "Статус", value: (row) => statusLabel(row.status) }], (row) => '<button class="table-action" data-confirm-action data-admin-offer-status="' + row.id + '" data-status="' + (row.status === "active" ? "paused" : "active") + '">' + (row.status === "active" ? "На паузу" : "Опубликовать") + '</button>');
    document.querySelector("[data-admin-bookings]").innerHTML = table(bookings.slice().reverse(), [{ label: "Код", value: "code" }, { label: "Предложение", value: "offerTitle" }, { label: "Партнёр", value: "partnerName" }, { label: "Клиент", value: "customer_name" }, { label: "Статус", value: (row) => statusLabel(row.status) }], (row) => row.status === "created" ? '<button class="table-action primary" data-confirm-action data-booking-status="' + row.id + '" data-status="issued">Выдан</button> <button class="table-action" data-confirm-action data-booking-status="' + row.id + '" data-status="no_show">Не пришёл</button> <button class="table-action" data-confirm-action data-booking-status="' + row.id + '" data-status="cancelled">Отменить</button>' : '—');
    document.querySelector("[data-admin-applications]").innerHTML = table(applications.slice().reverse(), [{ label: "Заведение", value: "venue_name" }, { label: "Контакт", value: "contact_name" }, { label: "Телефон", value: "phone" }, { label: "Статус", value: (row) => statusLabel(row.status) }], (row) => '<button class="table-action" data-view-application="' + row.id + '">Открыть</button> ' + (row.status === "new" ? '<button class="table-action" data-application-status="' + row.id + '" data-status="contacted">Связались</button> ' : '') + (row.status === "approved" ? '' : '<button class="table-action primary" data-use-application="' + row.id + '">Подключить</button> <button class="table-action" data-confirm-action data-application-status="' + row.id + '" data-status="rejected">Отклонить</button> ') + '<button class="table-action danger" data-confirm-action data-delete-application="' + row.id + '">Удалить</button>');
    document.querySelector("[data-admin-contacts]").innerHTML = table(contacts.slice().reverse(), [{ label: "Имя", value: "name" }, { label: "Телефон", value: "phone" }, { label: "Тип", value: (row) => typeLabel(row.type) }, { label: "Статус", value: (row) => statusLabel(row.status) }], (row) => '<button class="table-action" data-view-contact="' + row.id + '">Открыть</button> ' + (row.status === "closed" ? '' : '<button class="table-action" data-contact-status="' + row.id + '" data-status="in_progress">В работу</button> <button class="table-action" data-confirm-action data-contact-status="' + row.id + '" data-status="closed">Закрыть</button> ') + '<button class="table-action danger" data-confirm-action data-delete-contact="' + row.id + '">Удалить</button>');
    document.querySelector("[data-admin-audit]").innerHTML = table(auditLog.slice().reverse(), [{ label: "Время", value: (row) => dateTimeLabel(row.createdAt) }, { label: "Кем", value: (row) => auditActorLabel(row.actorRole) }, { label: "Действие", value: (row) => auditActionLabel(row.action) }, { label: "Объект", value: (row) => auditEntityLabel(row.entityType) }]);
    setupTableFilters(document.querySelector("[data-admin-app]"));
    activateTabs(null, true);
  };
  const mutate = async (task, successMessage) => {
    try {
      await task();
      notify(successMessage);
      await render();
    } catch (error) {
      notify(error.message || "Операцию не удалось выполнить", "error");
    }
  };

  const start = async () => {
    const session = await api("/api/admin/auth/me");
    if (!session.authenticated) {
      loginBox.hidden = false; passwordGate.hidden = true; dashboard.hidden = true;
      return;
    }
    loginBox.hidden = true;
    if (session.passwordChangeRequired) {
      passwordGate.hidden = false; dashboard.hidden = true;
      passwordGate.querySelector('input[name="currentPassword"]')?.focus({ preventScroll: true });
      return;
    }
    await render();
  };

  document.querySelector("[data-admin-login-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = event.currentTarget.querySelector(".form-error");
    try { await api("/api/admin/auth/login", { method: "POST", body: formObject(event.currentTarget) }); await start(); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
  });
  document.querySelectorAll("[data-admin-change-password]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = form.querySelector(".form-error");
    error.hidden = true;
    try {
      await api("/api/admin/auth/change-password", { method: "POST", body: formObject(form) });
      form.reset();
      notify("Новый пароль сохранён");
      await render();
    } catch (err) { error.textContent = err.message; error.hidden = false; }
  }));
  document.querySelector("[data-admin-refresh]")?.addEventListener("click", () => mutate(async () => {}, "Данные обновлены"));
  document.querySelector("[data-admin-logout]")?.addEventListener("click", async () => { await api("/api/admin/auth/logout", { method: "POST" }); location.reload(); });
  document.querySelector("[data-admin-onboard-partner]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await mutate(async () => {
      await api("/api/admin/partners/onboard", { method: "POST", body: formObject(form) });
      form.reset();
      form.elements.addressTitle.value = "Основная точка";
      form.elements.city.value = "Армавир";
      document.querySelector("[data-admin-onboarding-source]").hidden = true;
    }, "Партнёр, первая точка и кабинет созданы");
  });
  document.querySelector("[data-admin-create-address]")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; await mutate(async () => { const data = formObject(form); await api("/api/admin/partners/" + data.partnerId + "/addresses", { method: "POST", body: data }); form.reset(); }, "Точка добавлена"); });
  document.querySelector("[data-admin-create-user]")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; await mutate(async () => { const data = formObject(form); await api("/api/admin/partners/" + data.partnerId + "/users", { method: "POST", body: data }); form.reset(); }, "Пользователь партнёра создан"); });
  document.querySelector("[data-admin-create-offer]")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; await mutate(async () => { const data = formObject(form); await api("/api/admin/offers", { method: "POST", body: { ...data, totalQuantity: Number(data.totalQuantity), remainingQuantity: Number(data.totalQuantity), price: Number(data.price), oldPrice: data.oldPrice ? Number(data.oldPrice) : undefined, ctaLabel: "Получить код" } }); form.reset(); }, "Предложение сохранено"); });
  document.addEventListener("click", async (event) => {
    const confirmation = event.target.closest("[data-confirm-action]");
    if (confirmation && !confirmRiskyAction(confirmation)) return;
    const booking = event.target.closest("[data-booking-status]");
    const useApplication = event.target.closest("[data-use-application]");
    const contact = event.target.closest("[data-contact-status]");
    const applicationStatus = event.target.closest("[data-application-status]");
    const partnerStatus = event.target.closest("[data-admin-partner-status]");
    const partnerArchive = event.target.closest("[data-admin-partner-archive]");
    const partnerDelete = event.target.closest("[data-admin-partner-delete]");
    const addressStatus = event.target.closest("[data-admin-address-status]");
    const userStatus = event.target.closest("[data-admin-user-status]");
    const offerStatus = event.target.closest("[data-admin-offer-status]");
    const goTab = event.target.closest("[data-admin-go-tab]");
    const clearApplication = event.target.closest("[data-clear-application]");
    const viewApplication = event.target.closest("[data-view-application]");
    const viewContact = event.target.closest("[data-view-contact]");
    const deleteApplication = event.target.closest("[data-delete-application]");
    const deleteContact = event.target.closest("[data-delete-contact]");
    if (event.target.closest("[data-close-record-dialog]")) { closeRecord(); return; }
    if (viewApplication) { showRecord("application", applicationCache.find((item) => item.id === viewApplication.dataset.viewApplication)); return; }
    if (viewContact) { showRecord("contact", contactCache.find((item) => item.id === viewContact.dataset.viewContact)); return; }
    if (goTab) activateTabs(goTab.dataset.adminGoTab);
    if (clearApplication) {
      const form = document.querySelector("[data-admin-onboard-partner]");
      form.reset();
      form.elements.addressTitle.value = "Основная точка";
      form.elements.city.value = "Армавир";
      document.querySelector("[data-admin-onboarding-source]").hidden = true;
    }
    if (useApplication) {
      const application = applicationCache.find((item) => item.id === useApplication.dataset.useApplication);
      const form = document.querySelector("[data-admin-onboard-partner]");
      if (application && form) {
        form.elements.applicationId.value = application.id;
        form.elements.partnerName.value = application.venue_name || "";
        form.elements.partnerType.value = application.venue_type || "other";
        form.elements.contactName.value = application.contact_name || "";
        form.elements.phone.value = application.phone || "";
        form.elements.email.value = application.email || "";
        form.elements.addressTitle.value = "Основная точка";
        form.elements.city.value = application.city || "Армавир";
        form.elements.address.value = application.first_address || "";
        form.elements.userName.value = application.contact_name || "";
        document.querySelector("[data-admin-onboarding-source]").hidden = false;
        activateTabs("partners");
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        form.elements.login.focus({ preventScroll: true });
        notify("Данные заявки заполнены. Задайте логин и временный пароль");
      }
    }
    if (booking) await mutate(() => api("/api/admin/bookings/" + booking.dataset.bookingStatus + "/status", { method: "PATCH", body: { status: booking.dataset.status } }), "Статус брони обновлён");
    if (applicationStatus) await mutate(() => api("/api/admin/partner-applications/" + applicationStatus.dataset.applicationStatus + "/status", { method: "PATCH", body: { status: applicationStatus.dataset.status } }), "Статус заявки обновлён");
    if (contact) await mutate(() => api("/api/admin/contact-requests/" + contact.dataset.contactStatus + "/status", { method: "PATCH", body: { status: contact.dataset.status } }), "Статус обращения обновлён");
    if (partnerStatus) await mutate(() => api("/api/admin/partners/" + partnerStatus.dataset.adminPartnerStatus, { method: "PATCH", body: { status: partnerStatus.dataset.status } }), "Статус партнёра обновлён");
    if (partnerArchive) await mutate(() => api("/api/admin/partners/" + partnerArchive.dataset.adminPartnerArchive, { method: "PATCH", body: { status: "archived" } }), "Партнёр перенесён в архив");
    if (partnerDelete) {
      const partner = partnerCache.find((item) => item.id === partnerDelete.dataset.adminPartnerDelete);
      if (partner) await mutate(() => api("/api/admin/partners/" + partner.id, { method: "DELETE", body: { confirmation: partner.name } }), "Партнёр удалён");
    }
    if (deleteApplication) await mutate(() => api("/api/admin/partner-applications/" + deleteApplication.dataset.deleteApplication, { method: "DELETE" }), "Заявка удалена");
    if (deleteContact) await mutate(() => api("/api/admin/contact-requests/" + deleteContact.dataset.deleteContact, { method: "DELETE" }), "Обращение удалено");
    if (addressStatus) await mutate(() => api("/api/admin/partners/" + addressStatus.dataset.partnerId + "/addresses/" + addressStatus.dataset.adminAddressStatus, { method: "PATCH", body: { isActive: addressStatus.dataset.status === "true" } }), "Статус точки обновлён");
    if (userStatus) await mutate(() => api("/api/admin/partners/" + userStatus.dataset.partnerId + "/users/" + userStatus.dataset.adminUserStatus, { method: "PATCH", body: { status: userStatus.dataset.status } }), "Доступ сотрудника обновлён");
    if (offerStatus) await mutate(() => api("/api/admin/offers/" + offerStatus.dataset.adminOfferStatus, { method: "PATCH", body: { status: offerStatus.dataset.status } }), "Статус предложения обновлён");
  });
  try {
    await start();
  } catch {}
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
  try {
    const session = await api("/api/partner/auth/me");
    if (session.authenticated) location.href = "/partner/dashboard";
  } catch {}
}

async function setupPartnerDashboard() {
  if (!document.querySelector("[data-partner-dashboard-app]")) return;
  let partnerSession;
  try {
    partnerSession = await api("/api/partner/auth/me");
    if (!partnerSession.authenticated) {
      location.replace("/partner/login");
      return;
    }
  } catch {
    location.replace("/partner/login");
    return;
  }
  const isOwner = partnerSession.userRole === "owner";
  const roleNode = document.querySelector("[data-partner-role]");
  if (roleNode) roleNode.textContent = "Роль: " + statusLabel(partnerSession.userRole);
  document.querySelectorAll("[data-owner-only]").forEach((node) => { node.hidden = !isOwner; });
  document.querySelectorAll("[data-manager-only]").forEach((node) => { node.hidden = isOwner; });
  const activateTabs = setupTabs("[data-partner-dashboard-app]", ["overview", "addresses", "offers", "bookings", "profile", "security", "help"]);
  let bookingRows = [];
  let partnerAddresses = [];
  let offerTemplates = [];
  let wizardInitialized = false;
  const setPasswordRequired = (required) => {
    const root = document.querySelector("[data-partner-dashboard-app]");
    const notice = document.querySelector("[data-partner-password-required]");
    if (notice) notice.hidden = !required;
    root.querySelector("[data-partner-stats]").hidden = required;
    root.querySelectorAll("[data-tab-link]").forEach((link) => { link.hidden = required && link.dataset.tabLink !== "security"; });
    root.querySelectorAll("[data-tab-select] option").forEach((option) => { option.disabled = required && option.value !== "security"; });
    document.querySelectorAll("[data-open-offer-wizard]").forEach((button) => { button.hidden = required; });
    if (required) activateTabs("security", true);
  };
  const renderBookingRows = (query = "", status = "") => {
    const normalized = query.trim().toLowerCase();
    const rows = bookingRows.filter((row) => (!normalized || row.code.toLowerCase().includes(normalized) || row.offerTitle.toLowerCase().includes(normalized)) && (!status || row.status === status));
    document.querySelector("[data-partner-bookings]").innerHTML = table(rows, [{ label: "Код", value: "code" }, { label: "Предложение", value: "offerTitle" }, { label: "Клиент", value: "customer_name" }, { label: "Статус", value: (row) => statusLabel(row.status) }], (row) => row.status === "created" ? '<button class="table-action primary" data-confirm-action data-partner-booking="' + row.id + '" data-status="issued">Выдан</button> <button class="table-action" data-confirm-action data-partner-booking="' + row.id + '" data-status="no_show">Не пришёл</button> <button class="table-action" data-confirm-action data-partner-booking="' + row.id + '" data-status="cancelled">Отменить</button>' : '—');
  };
  const render = async () => {
    const [data, profile, addresses, offers, bookings, templates] = await Promise.all([
      api("/api/partner/dashboard"), api("/api/partner/profile"), api("/api/partner/addresses"), api("/api/partner/offers"), api("/api/partner/bookings"), api("/api/partner/offer-templates")
    ]);
    partnerAddresses = addresses.filter((item) => item.is_active !== false);
    offerTemplates = templates.length ? templates : offers.slice(-3).reverse().map((offer, index) => ({
      id: "recent-offer-" + offer.id,
      address_id: offer.address_id,
      title: offer.title || ("Набор " + (index + 1)),
      category: offer.category,
      description: offer.description,
      contents: offer.contents,
      price: offer.price,
      old_price: offer.old_price,
      pickup_window: offer.pickup_window,
      total_quantity: offer.total_quantity,
      image_urls: offer.image_urls || (offer.image_url ? [offer.image_url] : [])
    }));
    bookingRows = bookings.slice().reverse();
    document.querySelector("[data-partner-stats]").innerHTML = [
      ["Активные предложения", data.activeOffersCount], ["Коды", data.bookingsCount], ["Выдано", data.issuedBookingsCount], ["Не пришли", data.noShowBookingsCount], ["Выручка", data.estimatedRevenue + " ₽"]
    ].map(([label, value]) => '<span><small>' + label + '</small><b>' + value + '</b></span>').join('');
    document.querySelector("[data-partner-overview]").innerHTML = bookingRows.length ? '<div class="today-codes"><p>Последние коды</p>' + bookingRows.slice(0, 5).map((row) => '<a href="?tab=bookings"><strong>' + escapeHtml(row.code) + '</strong><span>' + escapeHtml(row.offerTitle) + '</span><b>' + escapeHtml(statusLabel(row.status)) + '</b></a>').join('') + '</div>' : '<p class="empty-state">Сегодня кодов пока нет. Новые брони появятся здесь автоматически.</p>';
    document.querySelector("[data-partner-addresses]").innerHTML = table(addresses, [{ label: "Точка", value: "title" }, { label: "Адрес", value: "address" }, { label: "Статус", value: (row) => row.is_active === false ? "Отключена" : "Активна" }]);
    document.querySelector("[data-partner-offers]").innerHTML = table(offers.slice().reverse(), [{ label: "Название", value: "title" }, { label: "Дата", value: "date" }, { label: "Выдача", value: "pickup_window" }, { label: "Остаток", value: (row) => row.remaining_quantity + " / " + row.total_quantity }, { label: "Статус", value: (row) => statusLabel(row.status) }], (row) => '<button class="table-action" data-confirm-action data-partner-offer-status="' + row.id + '" data-status="' + (row.status === "active" ? "paused" : "active") + '">' + (row.status === "active" ? "На паузу" : "Опубликовать") + '</button> <button class="table-action" data-partner-offer-duplicate="' + row.id + '">Повторить</button>');
    renderBookingRows(document.querySelector("[data-partner-booking-search]")?.value || "", document.querySelector("[data-partner-booking-status]")?.value || "");
    document.querySelector("[data-partner-profile]").innerHTML = table([profile], [{ label: "Название", value: "name" }, { label: "Тип", value: (row) => typeLabel(row.type) }, { label: "Контакт", value: (row) => row.contact_name || "—" }, { label: "Статус", value: (row) => statusLabel(row.status) }]);
    setSelectOptions(document.querySelector("[data-partner-address-select]"), addresses.filter((item) => item.is_active !== false), "Выберите точку", "id", (item) => item.title + " · " + item.address);
    setSelectOptions(document.querySelector("[data-wizard-address]"), partnerAddresses, partnerAddresses.length ? "Выберите точку" : "Сначала добавьте активную точку", "id", (item) => item.title + " · " + item.address);
    document.querySelectorAll("[data-today-date]").forEach((input) => { if (!input.value) input.value = localDateValue(); });
    const profileForm = document.querySelector("[data-partner-profile-form]");
    if (profileForm && !profileForm.dataset.loaded) {
      profileForm.name.value = profile.name || "";
      profileForm.contactName.value = profile.contact_name || "";
      profileForm.phone.value = profile.phone || "";
      profileForm.email.value = profile.email || "";
      profileForm.dataset.loaded = "true";
    }
    renderWizardTemplates();
    if (!wizardInitialized) {
      setupOfferWizard();
      wizardInitialized = true;
    }
    activateTabs(null, true);
  };

  const WIZARD_DRAFT_KEY = "bs_partner_offer_draft_v1";
  const WIZARD_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
  let wizardStep = 1;
  let wizardMode = "quick";
  let wizardPhotos = [];
  let selectedTemplateId = "";
  let wizardReturnFocus = null;

  function renderWizardTemplates() {
    const list = document.querySelector("[data-wizard-template-list]");
    if (!list) return;
    list.innerHTML = offerTemplates.length ? offerTemplates.map((template) => {
      const image = Array.isArray(template.image_urls) && template.image_urls[0] ? template.image_urls[0] : "/images/offer-lunch-v2.png";
      return '<button type="button" data-wizard-template="' + escapeHtml(template.id) + '" class="' + (template.id === selectedTemplateId ? "active" : "") + '"><img src="' + escapeHtml(image) + '" alt="" /><span><strong>' + escapeHtml(template.title) + '</strong><small>' + escapeHtml(template.pickup_window || "Условия задаются при публикации") + '</small></span></button>';
    }).join("") : '<p class="empty-state">Шаблонов пока нет. Разместите предложение и сохраните его как шаблон.</p>';
  }

  function renderWizardPhotos() {
    const grid = document.querySelector("[data-wizard-photo-grid]");
    if (!grid) return;
    grid.innerHTML = wizardPhotos.map((photo, index) => '<figure><img src="' + photo.dataUrl + '" alt="Фото ' + (index + 1) + '" /><button type="button" data-remove-wizard-photo="' + index + '">Удалить</button>' + (photo.warning ? '<figcaption>' + escapeHtml(photo.warning) + '</figcaption>' : '') + '</figure>').join("");
    const quality = document.querySelector("[data-wizard-quality]");
    if (quality) quality.textContent = wizardPhotos.length ? "Добавлено: " + wizardPhotos.length + " из 3. Фото очищены от метаданных." : "Фото будет уменьшено и очищено от метаданных перед отправкой.";
  }

  function wizardDraftPayload() {
    const form = document.querySelector("[data-offer-wizard-form]");
    const fields = form ? formObject(form) : {};
    return { step: wizardStep, mode: wizardMode, selectedTemplateId, fields, photos: wizardPhotos, savedAt: Date.now() };
  }

  function saveWizardDraft() {
    const status = document.querySelector("[data-wizard-draft-status]");
    try {
      localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(wizardDraftPayload()));
      if (status) status.textContent = "Черновик сохранён";
    } catch {
      try {
        const draft = wizardDraftPayload();
        draft.photos = [];
        localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(draft));
      } catch {}
      if (status) status.textContent = "Поля сохранены, фото — до закрытия страницы";
    }
  }

  function restoreWizardDraft() {
    const form = document.querySelector("[data-offer-wizard-form]");
    if (!form) return;
    try {
      const draft = JSON.parse(localStorage.getItem(WIZARD_DRAFT_KEY) || "null");
      if (!draft) return;
      if (!draft.savedAt || Date.now() - Number(draft.savedAt) > WIZARD_DRAFT_TTL_MS) {
        localStorage.removeItem(WIZARD_DRAFT_KEY);
        return;
      }
      wizardStep = Math.max(1, Math.min(4, Number(draft.step || 1)));
      wizardMode = draft.mode === "template" ? "template" : "quick";
      selectedTemplateId = String(draft.selectedTemplateId || "");
      wizardPhotos = Array.isArray(draft.photos) ? draft.photos.slice(0, 3).filter((item) => typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:image/")) : [];
      Object.entries(draft.fields || {}).forEach(([name, value]) => {
        const input = form.elements.namedItem(name);
        if (!input || input.type === "file") return;
        if (input.type === "checkbox") input.checked = value === "on" || value === true;
        else input.value = value;
      });
    } catch {}
  }

  function setWizardMode(mode) {
    wizardMode = mode === "template" ? "template" : "quick";
    document.querySelectorAll("[data-wizard-mode]").forEach((button) => button.classList.toggle("active", button.dataset.wizardMode === wizardMode));
    const quick = document.querySelector("[data-wizard-quick]");
    const template = document.querySelector("[data-wizard-template-panel]");
    if (quick) quick.hidden = wizardMode !== "quick";
    if (template) template.hidden = wizardMode !== "template";
    saveWizardDraft();
  }

  function setWizardStep(step) {
    wizardStep = Math.max(1, Math.min(4, step));
    document.querySelectorAll("[data-wizard-step]").forEach((section) => { section.hidden = Number(section.dataset.wizardStep) !== wizardStep; });
    document.querySelectorAll("[data-wizard-progress]").forEach((item) => {
      const number = Number(item.dataset.wizardProgress);
      item.classList.toggle("active", number === wizardStep);
      item.classList.toggle("done", number < wizardStep);
    });
    const back = document.querySelector("[data-wizard-back]");
    const next = document.querySelector("[data-wizard-next]");
    const publish = document.querySelector("[data-wizard-publish]");
    if (back) back.hidden = wizardStep === 1;
    if (next) next.hidden = wizardStep === 4;
    if (publish) publish.hidden = wizardStep !== 4;
    if (wizardStep === 4) renderWizardPreview();
    saveWizardDraft();
  }

  function wizardData() {
    const form = document.querySelector("[data-offer-wizard-form]");
    const data = formObject(form);
    const template = offerTemplates.find((item) => item.id === selectedTemplateId);
    return { data, template };
  }

  function applyTemplate(template) {
    if (!template) return;
    const form = document.querySelector("[data-offer-wizard-form]");
    const values = {
      title: template.title,
      category: template.category,
      description: template.description,
      contents: template.contents,
      addressId: template.address_id,
      totalQuantity: template.total_quantity,
      price: template.price,
      oldPrice: template.old_price
    };
    Object.entries(values).forEach(([name, value]) => { if (value !== null && value !== undefined && form.elements[name]) form.elements[name].value = value; });
    const times = String(template.pickup_window || "").match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || [];
    if (times[0]) form.elements.pickupStart.value = times[0];
    if (times[1]) form.elements.pickupEnd.value = times[1];
    selectedTemplateId = template.id;
    renderWizardTemplates();
    saveWizardDraft();
  }

  function validateWizardStep() {
    const form = document.querySelector("[data-offer-wizard-form]");
    if (wizardStep === 1) {
      if (wizardMode === "quick" && !wizardPhotos.length) { notify("Добавьте хотя бы одно фото текущей партии", "error"); return false; }
      if (wizardMode === "template" && !selectedTemplateId) { notify("Выберите шаблон", "error"); return false; }
      return true;
    }
    if (wizardStep === 2) {
      for (const name of ["title", "category"]) {
        if (!form.elements[name].checkValidity()) { form.elements[name].reportValidity(); return false; }
      }
      return true;
    }
    if (wizardStep === 3) {
      for (const name of ["addressId", "totalQuantity", "price", "pickupStart", "pickupEnd"]) {
        if (!form.elements[name].checkValidity()) { form.elements[name].reportValidity(); return false; }
      }
      if (form.elements.pickupEnd.value <= form.elements.pickupStart.value) { notify("Окончание выдачи должно быть позже начала", "error"); return false; }
      if (form.elements.oldPrice.value && Number(form.elements.oldPrice.value) <= Number(form.elements.price.value)) { notify("Обычная цена должна быть выше цены сегодня", "error"); return false; }
      return true;
    }
    return true;
  }

  function renderWizardPreview() {
    const preview = document.querySelector("[data-wizard-preview]");
    if (!preview) return;
    const { data, template } = wizardData();
    const photo = wizardPhotos[0]?.dataUrl || template?.image_urls?.[0] || "/images/offer-lunch-v2.png";
    const address = partnerAddresses.find((item) => item.id === data.addressId);
    preview.innerHTML = '<img src="' + escapeHtml(photo) + '" alt="" /><div><span>Сегодня · ' + escapeHtml(data.pickupStart || "") + '–' + escapeHtml(data.pickupEnd || "") + '</span><h4>' + escapeHtml(data.title || "Новое предложение") + '</h4><p>' + escapeHtml(address?.title || "Точка выдачи") + '</p><div><strong>' + Number(data.price || 0) + ' ₽</strong>' + (data.oldPrice ? '<del>' + Number(data.oldPrice) + ' ₽</del>' : '') + '<b>Осталось ' + Number(data.totalQuantity || 0) + '</b></div></div>';
  }

  function imageFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) return reject(new Error("Выберите JPEG, PNG или WebP до 12 МБ"));
      const source = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
          const width = Math.max(1, Math.round(img.naturalWidth * scale));
          const height = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext("2d", { alpha: false });
          context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.drawImage(img, 0, 0, width, height);
          const sample = document.createElement("canvas"); sample.width = 32; sample.height = 32;
          const sampleContext = sample.getContext("2d", { willReadFrequently: true });
          sampleContext.drawImage(img, 0, 0, 32, 32);
          const pixels = sampleContext.getImageData(0, 0, 32, 32).data;
          let brightness = 0;
          for (let index = 0; index < pixels.length; index += 4) brightness += (pixels[index] * .299) + (pixels[index + 1] * .587) + (pixels[index + 2] * .114);
          brightness /= pixels.length / 4;
          const warnings = [];
          if (img.naturalWidth < 600 || img.naturalHeight < 450) warnings.push("Низкое разрешение");
          if (brightness < 52) warnings.push("Фото выглядит тёмным");
          resolve({ dataUrl: canvas.toDataURL("image/jpeg", .8), capturedAt: new Date().toISOString(), warning: warnings.join(". ") });
        } catch (error) { reject(error); }
        finally { URL.revokeObjectURL(source); }
      };
      img.onerror = () => { URL.revokeObjectURL(source); reject(new Error("Не удалось прочитать фото")); };
      img.src = source;
    });
  }

  function openOfferWizard(event) {
    const wizard = document.querySelector("[data-offer-wizard]");
    if (!wizard) return;
    wizardReturnFocus = event?.currentTarget || document.activeElement;
    wizard.hidden = false;
    document.body.classList.add("wizard-open");
    setWizardMode(wizardMode);
    setWizardStep(wizardStep);
    wizard.querySelector(".wizard-close")?.focus({ preventScroll: true });
  }

  function closeOfferWizard({ restoreFocus = true, saveDraft = true } = {}) {
    const wizard = document.querySelector("[data-offer-wizard]");
    if (wizard) wizard.hidden = true;
    document.body.classList.remove("wizard-open");
    if (saveDraft) saveWizardDraft();
    if (restoreFocus && wizardReturnFocus?.isConnected) wizardReturnFocus.focus({ preventScroll: true });
  }

  function resetOfferWizard() {
    const form = document.querySelector("[data-offer-wizard-form]");
    form.reset();
    wizardStep = 1; wizardMode = "quick"; wizardPhotos = []; selectedTemplateId = "";
    form.elements.totalQuantity.value = "5"; form.elements.pickupStart.value = "16:00"; form.elements.pickupEnd.value = "19:00";
    renderWizardPhotos(); renderWizardTemplates(); setWizardMode("quick"); setWizardStep(1);
    try { localStorage.removeItem(WIZARD_DRAFT_KEY); } catch {}
    const status = document.querySelector("[data-wizard-draft-status]");
    if (status) status.textContent = "Черновик очищен";
  }

  function setupOfferWizard() {
    const wizard = document.querySelector("[data-offer-wizard]");
    const form = document.querySelector("[data-offer-wizard-form]");
    if (!wizard || !form) return;
    restoreWizardDraft();
    renderWizardPhotos();
    setWizardMode(wizardMode);
    setWizardStep(wizardStep);
    document.querySelectorAll("[data-open-offer-wizard]").forEach((button) => button.addEventListener("click", openOfferWizard));
    wizard.querySelectorAll("[data-close-offer-wizard]").forEach((button) => button.addEventListener("click", () => closeOfferWizard()));
    wizard.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeOfferWizard(); return; }
      trapAppFocus(event, wizard.querySelector('[role="dialog"]'));
    });
    wizard.querySelectorAll("[data-wizard-mode]").forEach((button) => button.addEventListener("click", () => setWizardMode(button.dataset.wizardMode)));
    form.addEventListener("input", saveWizardDraft);
    form.addEventListener("change", saveWizardDraft);
    wizard.querySelector("[data-wizard-photo-input]").addEventListener("change", async (event) => {
      const photoInput = event.currentTarget;
      const files = Array.from(photoInput.files || []).slice(0, 3 - wizardPhotos.length);
      try {
        const processed = [];
        for (const file of files) processed.push(await imageFromFile(file));
        wizardPhotos.push(...processed);
        renderWizardPhotos(); saveWizardDraft();
      } catch (error) { notify(error.message || "Фото не удалось обработать", "error"); }
      photoInput.value = "";
    });
    wizard.addEventListener("click", async (event) => {
      const remove = event.target.closest("[data-remove-wizard-photo]");
      const templateButton = event.target.closest("[data-wizard-template]");
      const preset = event.target.closest("[data-wizard-preset]");
      if (event.target.closest("[data-wizard-clear-draft]")) { resetOfferWizard(); notify("Черновик очищен"); return; }
      if (remove) { wizardPhotos.splice(Number(remove.dataset.removeWizardPhoto), 1); renderWizardPhotos(); saveWizardDraft(); return; }
      if (templateButton) { applyTemplate(offerTemplates.find((item) => item.id === templateButton.dataset.wizardTemplate)); return; }
      if (preset) { form.elements.title.value = preset.dataset.wizardPreset; saveWizardDraft(); return; }
      if (event.target.closest("[data-wizard-back]")) { setWizardStep(wizardStep - 1); return; }
      if (event.target.closest("[data-wizard-next]")) { if (validateWizardStep()) setWizardStep(wizardStep + 1); return; }
      const publish = event.target.closest("[data-wizard-publish]");
      if (!publish) return;
      if (!validateWizardStep()) return;
      publish.disabled = true; publish.textContent = "Публикуем…";
      const error = wizard.querySelector("[data-wizard-error]");
      error.hidden = true;
      try {
        const { data, template } = wizardData();
        let uploadedImages = [];
        if (wizardPhotos.length) {
          const upload = await api("/api/partner/uploads", { method: "POST", body: { images: wizardPhotos.map((photo) => ({ dataUrl: photo.dataUrl, capturedAt: photo.capturedAt })) } });
          uploadedImages = upload.images;
        }
        const imageUrls = uploadedImages.map((item) => item.url);
        if (!imageUrls.length && template?.image_urls) imageUrls.push(...template.image_urls.slice(0, 3));
        const offerInput = {
          addressId: data.addressId,
          title: data.title,
          category: data.category,
          description: data.description,
          contents: data.contents,
          price: Number(data.price),
          oldPrice: data.oldPrice ? Number(data.oldPrice) : undefined,
          pickupWindow: data.pickupStart + "–" + data.pickupEnd,
          totalQuantity: Number(data.totalQuantity),
          remainingQuantity: Number(data.totalQuantity),
          status: "active",
          date: localDateValue(),
          ctaLabel: "Получить код",
          imageAlt: data.title,
          imageUrls,
          photoCapturedAt: uploadedImages[0]?.capturedAt || new Date().toISOString(),
          sourceType: wizardMode === "quick" ? "quick_photo" : "template",
          templateId: template?.id
        };
        await api("/api/partner/offers", { method: "POST", body: offerInput });
        if (form.elements.saveTemplate.checked) await api("/api/partner/offer-templates", { method: "POST", body: offerInput });
        resetOfferWizard(); closeOfferWizard({ saveDraft: false }); activateTabs("offers"); notify("Предложение опубликовано на главной"); await render();
      } catch (publishError) {
        error.textContent = publishError.message || "Предложение не удалось опубликовать";
        error.hidden = false;
      } finally { publish.disabled = false; publish.textContent = "Опубликовать сегодня"; }
    });
  }
  const mutate = async (task, message) => { try { await task(); notify(message); await render(); } catch (error) { notify(error.message || "Операцию не удалось выполнить", "error"); } };
  document.querySelector("[data-partner-create-address]")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; await mutate(async () => { await api("/api/partner/addresses", { method: "POST", body: formObject(form) }); form.reset(); }, "Точка добавлена"); });
  document.querySelector("[data-partner-create-offer]")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; await mutate(async () => { const data = formObject(form); await api("/api/partner/offers", { method: "POST", body: { ...data, totalQuantity: Number(data.totalQuantity), remainingQuantity: Number(data.totalQuantity), price: Number(data.price), oldPrice: data.oldPrice ? Number(data.oldPrice) : undefined, ctaLabel: "Получить код" } }); form.reset(); }, "Предложение сохранено"); });
  document.querySelector("[data-partner-profile-form]")?.addEventListener("submit", async (event) => { event.preventDefault(); await mutate(() => api("/api/partner/profile", { method: "PATCH", body: formObject(event.currentTarget) }), "Профиль обновлён"); });
  document.querySelector("[data-partner-change-password]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector(".form-error");
    error.hidden = true;
    try {
      await api("/api/partner/auth/change-password", { method: "POST", body: formObject(form) });
      form.reset();
      partnerSession = await api("/api/partner/auth/me");
      setPasswordRequired(false);
      notify("Новый пароль сохранён");
      await render();
      activateTabs("overview", true);
    } catch (err) { error.textContent = err.message; error.hidden = false; }
  });
  document.querySelector("[data-partner-logout]")?.addEventListener("click", async () => { try { localStorage.removeItem(WIZARD_DRAFT_KEY); } catch {} await api("/api/partner/auth/logout", { method: "POST" }); location.href = "/partner/login"; });
  const refreshPartnerBookingRows = () => renderBookingRows(document.querySelector("[data-partner-booking-search]")?.value || "", document.querySelector("[data-partner-booking-status]")?.value || "");
  document.querySelector("[data-partner-booking-search]")?.addEventListener("input", refreshPartnerBookingRows);
  document.querySelector("[data-partner-booking-status]")?.addEventListener("change", refreshPartnerBookingRows);
  document.addEventListener("click", async (event) => {
    const confirmation = event.target.closest("[data-confirm-action]");
    if (confirmation && !confirmRiskyAction(confirmation)) return;
    const booking = event.target.closest("[data-partner-booking]");
    const offerStatus = event.target.closest("[data-partner-offer-status]");
    const duplicate = event.target.closest("[data-partner-offer-duplicate]");
    if (booking) await mutate(() => api("/api/partner/bookings/" + booking.dataset.partnerBooking + "/status", { method: "PATCH", body: { status: booking.dataset.status } }), "Статус кода обновлён");
    if (offerStatus) await mutate(() => api("/api/partner/offers/" + offerStatus.dataset.partnerOfferStatus + "/status", { method: "PATCH", body: { status: offerStatus.dataset.status } }), "Статус предложения обновлён");
    if (duplicate) await mutate(() => api("/api/partner/offers/" + duplicate.dataset.partnerOfferDuplicate + "/duplicate", { method: "POST" }), "Создан черновик предложения");
  });
  if (partnerSession.passwordChangeRequired) {
    setPasswordRequired(true);
    document.querySelector('[data-partner-change-password] input[name="currentPassword"]')?.focus({ preventScroll: true });
  } else {
    try { await render(); } catch (error) { notify(error.message || "Не удалось загрузить кабинет", "error"); }
  }
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
[hidden] { display: none !important; }
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
  font-size: 64px;
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
  font-size: 38px;
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
.app-panel [data-admin-stats] { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.app-panel [data-partner-stats] { grid-template-columns: repeat(5, minmax(0, 1fr)); }
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
.modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 20px; }
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
  width: 44px;
  height: 44px;
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

/* Product refresh: marketplace-first public experience. */
:root {
  --color-primary: #d5471f;
  --color-primary-dark: #a93016;
  --color-accent: #f1b84b;
  --color-bg: #f4f6f2;
  --color-bg-soft: #edf1eb;
  --color-card: #ffffff;
  --color-text: #15211d;
  --color-text-soft: #2d3b36;
  --color-muted: #68736f;
  --color-border: #dce2de;
  --color-border-soft: #e8ece9;
  --color-success-bg: #e3f2e9;
  --color-success-text: #246541;
  --shadow: 0 18px 48px rgba(21, 33, 29, .1);
}
body { background: var(--color-bg); }
.site-header {
  position: sticky;
  top: 0;
  z-index: 40;
  width: 100%;
  height: 76px;
  padding: 0 max(28px, calc((100vw - 1240px) / 2));
  grid-template-columns: auto auto 1fr auto;
  gap: 24px;
  background: rgba(255,255,255,.96);
  border-bottom: 1px solid var(--color-border-soft);
  backdrop-filter: blur(14px);
}
.brand::before { display: none; }
.brand { gap: 10px; min-width: max-content; }
.brand-mark {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: white;
  background: var(--color-primary);
  font-size: 14px;
  font-weight: 900;
}
.brand strong { color: var(--color-text); font-size: 18px; }
.brand small { margin-top: 1px; font-size: 11px; }
.city-pill {
  min-height: 34px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg);
  color: var(--color-text-soft);
  font-size: 13px;
  font-weight: 800;
}
.city-pill span { color: #3f8b62; font-size: 9px; }
.site-nav { justify-content: flex-end; gap: 27px; font-size: 14px; }
.site-nav a { padding: 12px 0; }
.site-nav a.active::after { bottom: 3px; }
.header-actions { display: flex; align-items: center; gap: 18px; }
.last-booking-link, .text-link { color: var(--color-primary-dark); font-weight: 850; }
.header-cta { min-height: 42px; padding: 0 17px; }
.mobile-menu { display: none; }
.button {
  min-height: 48px;
  border-radius: 8px;
  padding: 0 20px;
  box-shadow: none;
}
.button-primary { background: var(--color-primary); color: white; box-shadow: 0 9px 20px rgba(213, 71, 31, .18); }
.button-primary:hover { background: #c53c18; }
.button-outline { background: white; border-color: var(--color-border); color: var(--color-text); }
.market-intro {
  width: min(100% - 56px, 1240px);
  min-height: 370px;
  margin: 0 auto;
  padding: 42px 0 38px;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(380px, .92fr);
  align-items: center;
  gap: 72px;
}
.market-kicker {
  margin: 0 0 16px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--color-success-text);
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
}
.market-kicker span { width: 8px; height: 8px; border-radius: 50%; background: #45a46f; box-shadow: 0 0 0 5px #dcefe4; }
.market-copy h1 {
  max-width: 730px;
  margin: 0;
  font-size: 72px;
  line-height: .98;
  letter-spacing: 0;
}
.market-copy h1 em { color: var(--color-primary); font-style: normal; }
.market-copy > p:not(.market-kicker) { max-width: 650px; margin: 20px 0 0; color: var(--color-muted); font-size: 17px; line-height: 1.55; }
.market-copy .actions { align-items: center; margin-top: 26px; }
.text-link { padding: 10px 0; }
.service-facts { display: grid; grid-template-columns: repeat(3, max-content); gap: 28px; margin-top: 30px; }
.service-facts span { display: grid; gap: 2px; }
.service-facts b { font-size: 14px; }
.service-facts small { color: var(--color-muted); font-size: 12px; }
.market-photo { position: relative; aspect-ratio: 4 / 3; overflow: hidden; border-radius: 8px; background: white; box-shadow: var(--shadow); }
.market-photo > img { width: 100%; height: 100%; object-fit: cover; }
.market-photo-note {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  min-height: 68px;
  padding: 11px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 8px;
  background: rgba(255,255,255,.95);
  box-shadow: 0 8px 24px rgba(21,33,29,.14);
}
.market-photo-note > span { padding: 9px; border-radius: 6px; background: var(--color-primary); color: white; font-weight: 900; }
.market-photo-note p, .market-photo-note small { margin: 0; display: block; }
.market-photo-note small { margin-top: 3px; color: var(--color-muted); }
.section-white {
  width: min(100% - 56px, 1240px);
  margin: 0 auto;
  padding: 34px 0 66px;
  background: transparent;
  border: 0;
}
.catalog-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
.catalog-heading .section-title { margin-bottom: 18px; }
.catalog-heading .section-title h2 { font-size: 42px; }
.catalog-heading .section-title p { margin: 8px 0 0; }
.catalog-count { margin-bottom: 20px; color: var(--color-muted); font-size: 14px; font-weight: 800; white-space: nowrap; }
.filters { gap: 8px; padding: 0 0 22px; scrollbar-width: none; }
.filters::-webkit-scrollbar { display: none; }
.filter { border-radius: 7px; padding: 10px 15px; background: transparent; }
.filter.active { background: var(--color-text); border-color: var(--color-text); }
.offers-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.offer-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 100%;
  padding: 0;
  overflow: hidden;
  border-radius: 8px;
  border-color: var(--color-border-soft);
  box-shadow: 0 8px 24px rgba(21,33,29,.05);
}
.offer-card:hover { border-color: #c9d2cd; box-shadow: 0 16px 34px rgba(21,33,29,.09); transform: translateY(-2px); }
.offer-image { position: relative; width: 100%; height: auto; aspect-ratio: 16 / 10; border-radius: 0; }
.offer-image img { width: 100%; height: 100%; object-fit: cover; }
.today-chip, .discount-chip {
  position: absolute;
  top: 12px;
  min-height: 28px;
  padding: 5px 9px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 900;
}
.today-chip { left: 12px; color: var(--color-success-text); background: rgba(237,250,242,.96); }
.discount-chip { right: 12px; color: white; background: var(--color-primary); }
.offer-body { flex: 1; padding: 18px; display: flex; flex-direction: column; }
.offer-eyebrow { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.offer-eyebrow .partner-name { margin: 0; color: var(--color-text); font-size: 13px; }
.offer-eyebrow > span { color: var(--color-muted); font-size: 12px; }
.offer-body h3 { margin: 10px 0 8px; font-size: 23px; line-height: 1.1; }
.offer-description { min-height: 42px; margin: 0; color: var(--color-muted); font-size: 14px; line-height: 1.45; }
.offer-address { margin: 14px 0 0; color: var(--color-text-soft); font-size: 13px; line-height: 1.35; }
.offer-address span { color: var(--color-primary); }
.pickup-row { margin-top: 16px; padding: 12px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--color-border-soft); border-bottom: 1px solid var(--color-border-soft); }
.pickup-row > span:first-child { display: grid; gap: 2px; }
.pickup-row small { color: var(--color-muted); font-size: 11px; }
.pickup-row b { font-size: 14px; }
.stock-badge { min-height: 28px; padding: 5px 9px; border-radius: 6px; background: var(--color-success-bg); border-color: #cae6d5; color: var(--color-success-text); font-size: 12px; }
.offer-body .price-line { display: flex; align-items: baseline; margin: 16px 0 0; }
.offer-body .price-line strong { font-size: 29px; color: var(--color-text); }
.offer-body .price-line span { display: inline; margin: 0; font-size: 14px; }
.offer-body .button { margin-top: 14px; }
.partner-strip {
  width: min(100% - 56px, 1240px);
  min-height: 180px;
  padding: 22px;
  grid-template-columns: 190px 1fr auto;
  border: 0;
  border-radius: 8px;
  color: white;
  background: #17372d;
}
.partner-strip .strip-photo { height: 136px; border-radius: 6px; }
.partner-strip p { color: #c6d5cf; }
.partner-strip .strip-cards { display: none; }
.partner-strip .button-primary { background: #f0b84d; color: #17231f; }
.site-footer {
  width: 100%;
  margin: 36px 0 0;
  padding: 42px max(28px, calc((100vw - 1240px) / 2));
  grid-template-columns: 1.3fr 1fr 1fr;
  background: #11241e;
  border-top: 0;
  color: white;
}
.footer-logo { color: white; }
.site-footer p, .site-footer a { color: #b8c8c2; }
.site-footer a:hover { color: white; }
.footer-install { padding: 0; border: 0; background: transparent; color: #f4ce67; font: inherit; font-weight: 850; text-align: left; cursor: pointer; }
.footer-install:hover { color: white; }
.footer-install[hidden] { display: none; }
.footer-legal { grid-column: 1 / -1; padding-top: 20px; border-top: 1px solid #294038; }
.pwa-dialog { position: fixed; z-index: 110; inset: 0; display: grid; place-items: center; padding: 18px; }
.pwa-dialog[hidden] { display: none; }
.pwa-dialog-backdrop { position: absolute; inset: 0; background: rgba(5, 30, 36, .68); backdrop-filter: blur(3px); }
.pwa-dialog-panel { position: relative; width: min(100%, 440px); padding: 32px; border-radius: 12px; background: white; box-shadow: 0 28px 80px rgba(0, 0, 0, .28); text-align: center; }
.pwa-dialog-panel img { width: 80px; height: 80px; border-radius: 18px; }
.pwa-dialog-panel h2 { margin: 18px 0 10px; color: #102f38; font-size: 28px; line-height: 1.12; }
.pwa-dialog-panel p { margin: 0 0 22px; color: var(--color-muted); line-height: 1.55; }
.pwa-dialog-panel .button { width: 100%; }
.pwa-dialog-close { position: absolute; top: 12px; right: 12px; width: 38px; height: 38px; border: 0; border-radius: 7px; background: #eef2f0; color: #173a45; font: inherit; font-size: 24px; cursor: pointer; }
.pwa-dialog-open { overflow: hidden; }
.pwa-status { position: fixed; z-index: 105; right: 18px; bottom: calc(18px + env(safe-area-inset-bottom)); max-width: min(420px, calc(100vw - 36px)); padding: 13px 15px; display: flex; align-items: center; gap: 14px; border: 1px solid #c8d8d3; border-radius: 9px; background: #102f38; color: white; box-shadow: 0 16px 44px rgba(5, 30, 36, .25); font-size: 14px; font-weight: 750; }
.pwa-status button { min-height: 36px; padding: 7px 11px; border: 0; border-radius: 6px; background: #f4ce67; color: #173136; font: inherit; font-weight: 900; cursor: pointer; }
.modal-panel { max-width: 560px; border-radius: 8px; border: 0; box-shadow: 0 28px 80px rgba(0,0,0,.24); }
.modal-close { border-radius: 6px; }
.modal-open { overflow: hidden; }
.booking-summary { padding: 16px; border-radius: 8px; background: var(--color-bg-soft); }
.booking-summary h3 { margin: 0 0 6px; }
.booking-summary p { margin: 5px 0; color: var(--color-muted); }
.booking-success { text-align: center; }
.booking-success > strong { display: block; margin: 18px 0; color: var(--color-primary); font-size: 48px; }
.success-mark { width: 46px; height: 46px; margin: 0 auto 12px; display: grid; place-items: center; border-radius: 50%; background: var(--color-success-bg); color: var(--color-success-text); font-size: 24px; font-weight: 900; }
.booking-success-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.booking-page { padding-top: 46px; padding-bottom: 80px; }
.back-link { display: inline-flex; margin-bottom: 24px; color: var(--color-muted); font-weight: 800; }
.booking-page-shell { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(280px, .7fr); gap: 24px; align-items: start; }
.booking-page-main, .booking-help { padding: 30px; border: 1px solid var(--color-border); border-radius: 8px; background: white; }
.booking-page-main h1 { margin: 0 0 24px; font-size: 52px; line-height: 1.04; }
.booking-help h2 { margin-top: 0; }
.booking-help ol { padding-left: 22px; display: grid; gap: 12px; }
.booking-help p { color: var(--color-muted); line-height: 1.5; }
.booking-status-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.booking-status { padding: 7px 10px; border-radius: 6px; background: var(--color-success-bg); color: var(--color-success-text); font-size: 13px; font-weight: 900; }
.status-cancelled, .status-no_show { color: #7d3f34; background: #f7e4df; }
.status-issued { color: #305e3f; background: #dcefe3; }
.booking-cancelled { margin-top: 18px; padding: 24px; border: 1px solid #ead0ca; border-radius: 8px; background: #fff8f6; }
.booking-cancelled h2 { margin: 0; color: #6f2e22; font-size: 28px; }
.booking-cancelled p { margin: 10px 0 18px; color: #684a44; line-height: 1.5; }
.legal-form-unavailable { max-width: 760px; }
.legal-form-unavailable h3 { margin: 0; color: var(--color-text); }
.legal-form-unavailable p { margin: 9px 0 0; line-height: 1.5; }
.public-code { margin: 20px 0; padding: 24px; border-radius: 8px; background: #17372d; color: white; }
.public-code small, .public-code strong { display: block; }
.public-code strong { margin-top: 8px; font-size: 70px; letter-spacing: 0; }
.booking-details { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; overflow: hidden; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-border); }
.booking-details div { padding: 15px; background: white; }
.booking-details dt { color: var(--color-muted); font-size: 12px; }
.booking-details dd { margin: 5px 0 0; font-weight: 800; line-height: 1.35; }
.booking-page-actions { margin-top: 18px; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.text-danger { border: 0; background: transparent; color: #a33b28; font-weight: 800; cursor: pointer; }
.step-card, .info-card, .panel-card, .accent-card, .contact-card, .partner-dashboard, .compact-section, .form-section, .legal-block { border-radius: 8px; box-shadow: none; }
.app-panel {
  width: min(100% - 56px, 1240px);
  margin: 34px auto 80px;
  padding: 28px;
  border-radius: 8px;
  background: white;
}
.app-panel .section-title { margin-bottom: 24px; }
.app-panel .panel-card { padding: 22px; border-color: var(--color-border-soft); background: #fbfcfb; }
.app-panel .panel-card h3 { margin-top: 0; }
.app-panel .admin-grid { gap: 14px; }
.app-panel .tab-panel { grid-column: 1 / -1; }
.app-panel .mini-form { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.app-panel .offer-editor { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.app-panel input,
.app-panel select { min-width: 0; background: white; }
.app-panel .admin-actions { justify-content: flex-end; }
.app-panel .admin-actions .button { min-height: 40px; padding-inline: 15px; }
.mobile-tab-select { display: none; }
.table-filters { display: flex; align-items: center; gap: 8px; }
.table-filters input { width: min(100%, 300px); }
.table-filters select { width: auto; min-width: 150px; }
.filter-empty { margin-top: 10px; }
.role-badge { min-height: 38px; padding: 8px 12px; display: inline-flex; align-items: center; border: 1px solid #9fc4c0; border-radius: 999px; background: #e8f3f0; color: #174d50; font-size: 13px; font-weight: 900; }
.permission-note { margin: 0 0 16px; padding: 12px 14px; border-left: 4px solid #0b646a; background: #e8f3f0; color: #31515b; line-height: 1.45; }
.labelled-form label { min-width: 0; display: grid; gap: 6px; color: #49636d; font-size: 12px; font-weight: 850; }
.table-action.confirming { border-color: #b84a2b; background: #fff2ee; color: #8f321f; }
.admin-workflow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 22px; }
.admin-workflow button { min-height: 74px; display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid #d4e0dd; border-radius: 6px; background: white; color: #173a45; text-align: left; cursor: pointer; }
.admin-workflow b { width: 30px; height: 30px; flex: 0 0 30px; display: grid; place-items: center; border-radius: 50%; background: #0b646a; color: white; }
.admin-workflow span { font-weight: 850; }
.onboarding-form { display: grid; gap: 18px; margin: 8px 0 30px; }
.onboarding-form fieldset { min-width: 0; margin: 0; padding: 18px 0 0; border: 0; border-top: 1px solid #d4e0dd; }
.onboarding-form legend { padding: 0 14px 0 0; color: #062f3d; font-size: 16px; font-weight: 900; }
.onboarding-form legend b { width: 28px; height: 28px; display: inline-grid; place-items: center; margin-right: 8px; border-radius: 50%; background: #0b646a; color: white; }
.onboarding-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.onboarding-fields label { display: grid; gap: 6px; color: #49636d; font-size: 12px; font-weight: 850; }
.onboarding-fields .field-wide { grid-column: span 2; }
.onboarding-submit { justify-self: start; min-width: 280px; }
.onboarding-source { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-left: 4px solid #0b646a; background: #e3efeb; color: #173a45; font-weight: 800; }
.onboarding-source button { border: 0; background: transparent; color: #0b646a; font-weight: 850; cursor: pointer; }
.list-heading { margin-top: 8px; padding-top: 22px; border-top: 1px solid #d4e0dd; }
.admin-maintenance { grid-column: 1 / -1; border: 1px solid #d4e0dd; border-radius: 6px; background: #f7faf9; }
.admin-maintenance > summary { padding: 16px 20px; color: #173a45; font-weight: 900; cursor: pointer; }
.maintenance-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; border-top: 1px solid #d4e0dd; background: #d4e0dd; }
.maintenance-grid section { min-width: 0; padding: 20px; background: #fbfcfb; }
.maintenance-grid h3 { margin: 0; color: #062f3d; font-size: 17px; }
.maintenance-grid .mini-form { grid-template-columns: 1fr; }
.panel-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
.panel-heading h3, .panel-heading p { margin: 0; }
.panel-heading p { margin-top: 5px; color: var(--color-muted); font-size: 14px; }
.panel-heading input { width: min(100%, 260px); }
.table-action {
  min-height: 34px;
  margin: 2px;
  padding: 6px 9px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: white;
  color: var(--color-text-soft);
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
}
.table-action.primary { border-color: var(--color-primary); background: var(--color-primary); color: white; }
.app-toast {
  position: fixed;
  z-index: 80;
  top: 92px;
  right: 22px;
  max-width: min(380px, calc(100vw - 32px));
  padding: 13px 16px;
  border: 1px solid #b9d9c5;
  border-radius: 8px;
  background: #e8f5ed;
  color: #225f3d;
  box-shadow: 0 14px 36px rgba(21,33,29,.14);
  font-weight: 800;
}
.app-toast.is-error { border-color: #e5b9af; background: #fae8e4; color: #8d321f; }
.app-toast[hidden] { display: none; }
.today-codes { display: grid; gap: 1px; overflow: hidden; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-border); }
.today-codes > p { margin: 0; padding: 13px 15px; background: var(--color-bg-soft); color: var(--color-muted); font-size: 12px; font-weight: 900; text-transform: uppercase; }
.today-codes a { padding: 14px 15px; display: grid; grid-template-columns: 105px 1fr auto; align-items: center; gap: 14px; background: white; color: var(--color-text); text-decoration: none; }
.today-codes a:hover { background: #f7f9f7; }
.today-codes a strong { color: var(--color-primary); font-size: 18px; }
.today-codes a span { color: var(--color-text-soft); }
.today-codes a b { color: var(--color-muted); font-size: 12px; }

@media (max-width: 1024px) {
  .site-header { height: 70px; padding: 0 24px; grid-template-columns: auto auto 1fr auto; }
  .site-nav { gap: 16px; }
  .site-nav a { font-size: 13px; }
  .header-actions .last-booking-link { display: none; }
  .market-intro { width: min(100% - 40px, 1240px); grid-template-columns: minmax(0, 1fr) minmax(320px, .78fr); gap: 34px; }
  .offers-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .section-white, .partner-strip { width: min(100% - 40px, 1240px); }
  .app-panel { width: min(100% - 40px, 1240px); }
  .app-panel .offer-editor { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .app-panel [data-admin-stats], .app-panel [data-partner-stats] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .app-panel [data-partner-stats] span:last-child { grid-column: 1 / -1; }
}

@media (max-width: 760px) {
  .site-header { width: 100%; height: 66px; padding: 0 14px; grid-template-columns: 1fr auto; gap: 12px; }
  .city-pill, .site-nav, .header-actions { display: none; }
  .brand small { display: none; }
  .mobile-menu { display: block; position: relative; }
  .mobile-menu summary { width: 42px; height: 42px; display: grid; place-content: center; gap: 4px; border: 1px solid var(--color-border); border-radius: 7px; background: white; cursor: pointer; list-style: none; }
  .mobile-menu summary::-webkit-details-marker { display: none; }
  .mobile-menu summary span { width: 18px; height: 2px; background: var(--color-text); }
  .mobile-menu nav { position: absolute; top: 50px; right: 0; width: min(320px, calc(100vw - 28px)); padding: 10px; display: grid; gap: 2px; border: 1px solid var(--color-border); border-radius: 8px; background: white; box-shadow: var(--shadow); }
  .mobile-menu nav a { padding: 12px; border-radius: 6px; font-weight: 800; }
  .mobile-menu nav a:last-child { background: var(--color-primary); color: white; }
  .market-intro { width: min(100% - 28px, 1240px); min-height: 0; padding: 34px 0 26px; display: block; }
  .market-copy h1 { font-size: 42px; line-height: 1.01; }
  .hero-copy h1 { font-size: 42px; }
  .market-copy > p:not(.market-kicker) { font-size: 16px; }
  .market-copy .actions { display: grid; grid-template-columns: 1fr; gap: 10px; }
  .market-copy .button { width: 100%; }
  .text-link { text-align: center; }
  .service-facts { grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 24px; }
  .service-facts span { padding-right: 6px; border-right: 1px solid var(--color-border); }
  .service-facts span:last-child { border-right: 0; }
  .service-facts b { font-size: 12px; }
  .service-facts small { font-size: 10px; }
  .market-photo { display: none; }
  .section-white { width: 100%; padding: 24px 14px 48px; }
  .catalog-heading { display: block; }
  .catalog-heading .section-title { margin-bottom: 14px; }
  .catalog-heading .section-title h2 { font-size: 30px; }
  .section-title h2 { font-size: 30px; }
  .catalog-heading .section-title p { font-size: 14px; }
  .catalog-count { display: none; }
  .filters { margin: 0 -14px; padding: 0 14px 16px; }
  .filter { flex: 0 0 auto; }
  .offers-grid { grid-template-columns: 1fr; }
  .offer-image { height: auto; aspect-ratio: 16 / 9; }
  .offer-body h3 { font-size: 24px; }
  .offer-description { min-height: 0; }
  .partner-strip { width: min(100% - 28px, 1240px); grid-template-columns: 1fr; padding: 22px; }
  .partner-strip .strip-photo { display: none; }
  .site-footer { padding: 36px 18px; grid-template-columns: 1fr; gap: 24px; }
  .pwa-dialog { padding: 0; align-items: end; }
  .pwa-dialog-panel { width: 100%; padding: 30px 20px calc(24px + env(safe-area-inset-bottom)); border-radius: 14px 14px 0 0; }
  .pwa-status { right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); max-width: calc(100vw - 24px); }
  .footer-legal { grid-column: auto; display: grid; gap: 12px; }
  .booking-success-actions, .booking-page-shell, .booking-details { grid-template-columns: 1fr; }
  .booking-page { width: min(100% - 28px, 1180px); padding-top: 28px; }
  .booking-page-main, .booking-help { padding: 20px; }
  .booking-page-main h1 { font-size: 36px; }
  .public-code strong { font-size: 50px; }
  .booking-page-actions { align-items: stretch; flex-direction: column; }
  .booking-page-actions .button, .text-danger { width: 100%; min-height: 46px; }
  .app-panel { width: min(100% - 28px, 1240px); margin-top: 22px; padding: 18px; }
  .app-panel .mini-form,
  .app-panel .offer-editor { grid-template-columns: 1fr; }
  .app-panel .panel-card { padding: 16px; }
  .app-panel .tab-nav { display: none; }
  .mobile-tab-select { margin: 0 0 16px; display: grid; gap: 6px; color: #49636d; font-size: 12px; font-weight: 850; }
  .mobile-tab-select select { width: 100%; min-height: 46px; background: white; }
  .panel-heading { align-items: stretch; flex-direction: column; }
  .panel-heading input { width: 100%; }
  .table-filters { width: 100%; display: grid; grid-template-columns: 1fr; }
  .table-filters input, .table-filters select { width: 100%; }
  .partner-dashboard-actions { align-items: stretch; }
  .partner-dashboard-actions .role-badge { width: 100%; justify-content: center; }
  .today-codes a { grid-template-columns: 90px 1fr; }
  .today-codes a b { grid-column: 2; }
  .app-toast { top: 76px; right: 16px; }
}

/* Approved photo-first marketplace concept. */
.site-header {
  background: #073b4c;
  border-bottom-color: #0b4b60;
  color: white;
  backdrop-filter: none;
}
.site-header .brand-mark { display: none; }
.site-header .brand strong,
.site-header .brand small,
.site-header .site-nav a,
.site-header .last-booking-link { color: white; }
.site-header .brand small { color: #b9d3dc; }
.site-header .city-pill { border-color: #376577; background: transparent; color: white; }
.site-header .city-pill span { color: #f2c65f; }
.site-header .site-nav a.active::after { background: white; }
.site-header .header-cta { background: #ef4d2d; box-shadow: none; }
.marketplace-home {
  width: min(100% - 64px, 1360px);
  min-height: 720px;
  margin: 0 auto;
  padding: 34px 0 48px;
  transition: width .24s ease, margin .24s ease;
}
.marketplace-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 36px;
  padding-bottom: 30px;
}
.marketplace-heading h1 { margin: 0; color: #062f3d; font-size: 64px; line-height: 1; }
.marketplace-heading p { margin: 10px 0 0; color: #49636d; font-size: 17px; }
.marketplace-date {
  min-width: 220px;
  padding: 5px 0 5px 26px;
  display: grid;
  border-left: 1px solid #cddadd;
}
.marketplace-date small { color: #49636d; font-size: 13px; font-weight: 800; }
.marketplace-date strong { margin-top: 4px; color: #062f3d; font-size: 16px; }
.recent-heading { margin-bottom: 14px; }
.recent-section[hidden] { display: none; }
.recent-section[hidden] + .marketplace-catalog { padding-top: 0; }
.recent-heading h2, .catalog-title-row h2 { margin: 0; color: #062f3d; font-size: 21px; }
.recent-heading p { margin: 5px 0 0; color: #6e8188; font-size: 13px; }
.recent-rail {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(290px, 1fr);
  grid-template-rows: 250px;
  gap: 14px;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
  scrollbar-color: #0a6070 #dfe9e9;
  padding: 0 0 14px;
}
.recent-offer {
  position: relative;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  scroll-snap-align: start;
  border: 1px solid #d3dddf;
  border-radius: 8px;
  background: #102f38;
  color: white;
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 -105px 0 rgba(2, 26, 34, .6);
  animation: offer-in .32s ease both;
}
.recent-offer:nth-child(2) { animation-delay: .05s; }
.recent-offer:nth-child(3) { animation-delay: .1s; }
.recent-offer img { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; object-fit: cover; opacity: .94; }
.recent-offer::after { content: ""; position: absolute; inset: 58% 0 0; z-index: 1; background: rgba(3, 29, 37, .72); pointer-events: none; }
.fresh-photo-label {
  position: absolute;
  z-index: 2;
  top: 10px;
  left: 10px;
  min-height: 25px;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  border-radius: 5px;
  background: rgba(5, 66, 73, .92);
  color: white;
  font-size: 11px;
  font-weight: 800;
}
.recent-offer-copy { position: absolute; z-index: 2; left: 14px; right: 14px; bottom: 13px; display: grid; gap: 4px; padding-right: 128px; }
.recent-offer-copy strong { font-size: 17px; line-height: 1.2; }
.recent-offer-copy small { overflow: hidden; color: #e5eef0; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.recent-stock { position: absolute; z-index: 2; right: 10px; bottom: 10px; max-width: 120px; min-height: 27px; padding: 5px 8px; border-radius: 5px; background: #f4ce67; color: #173136; font-size: 10px; font-weight: 850; text-align: center; }
.recent-offer:hover, .recent-offer:focus-visible { border-color: #0c6878; outline: 3px solid rgba(15, 105, 121, .18); outline-offset: 2px; }
@keyframes offer-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.marketplace-catalog { padding-top: 26px; }
.catalog-title-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px solid #dce4e5; padding-top: 24px; }
.catalog-title-row span { color: #6e8188; font-size: 12px; }
.marketplace-catalog .filters { padding: 13px 0 11px; }
.marketplace-catalog .filter { padding: 7px 13px; border-radius: 5px; color: #173a45; font-size: 12px; }
.marketplace-catalog .filter.active { border-color: #073b4c; background: #073b4c; color: white; }
.marketplace-status { margin: 0 0 10px; padding: 10px 12px; border-radius: 6px; background: #fff0dc; color: #744a14; font-size: 12px; }
.marketplace-status[hidden] { display: none; }
.marketplace-empty { margin-top: 14px; padding: 26px; text-align: center; }
.marketplace-empty h3 { margin: 0; color: #123945; font-size: 20px; }
.marketplace-empty p { max-width: 560px; margin: 8px auto 16px; line-height: 1.5; }
.marketplace-empty > div { display: flex; justify-content: center; gap: 9px; flex-wrap: wrap; }
.marketplace-empty .button { min-width: 190px; }
.offer-list { border-top: 1px solid #dce4e5; }
.offer-row {
  width: 100%;
  min-height: 88px;
  padding: 8px 0;
  display: grid;
  grid-template-columns: 150px minmax(220px, 1.3fr) minmax(140px, .8fr) 108px 170px 72px;
  align-items: center;
  gap: 18px;
  border: 0;
  border-bottom: 1px solid #dce4e5;
  background: transparent;
  color: #092f3c;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.offer-row:hover { background: #f7faf9; }
.offer-row:focus-visible { outline: 3px solid rgba(15, 105, 121, .18); outline-offset: -3px; }
.offer-row > img { width: 150px; height: 76px; object-fit: cover; border-radius: 5px; }
.offer-row-main { min-width: 0; display: grid; gap: 3px; }
.offer-row-main strong { font-size: 15px; }
.offer-row-main small { overflow: hidden; color: #3f5c66; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.offer-row-main em { color: #819196; font-size: 10px; font-style: normal; }
.offer-row-mobile-pickup { display: none; color: #31515b; font-size: 11px; font-weight: 850; }
.offer-row-pickup { display: grid; gap: 3px; }
.offer-row-pickup small { color: #5b737b; font-size: 11px; }
.offer-row-pickup b { font-size: 12px; line-height: 1.25; }
.offer-row-stock { min-height: 29px; padding: 6px 8px; display: inline-flex; align-items: center; justify-content: center; border-radius: 5px; background: #f4ce67; color: #173136; font-size: 11px; font-weight: 850; text-align: center; }
.offer-row-price { display: flex; align-items: baseline; gap: 9px; white-space: nowrap; }
.offer-row-price strong { font-size: 21px; }
.offer-row-price del { color: #8b989c; font-size: 13px; }
.offer-row-price em { padding: 3px 5px; border: 1px solid #ccd8da; border-radius: 4px; color: #31515b; font-size: 10px; font-style: normal; }
.offer-row-more { color: #31515b; font-size: 11px; font-weight: 800; text-align: right; }
.resource-note { margin: 26px 0 0; padding: 17px 0; border-top: 1px solid #dce4e5; color: #1f665d; font-size: 13px; }
.offer-drawer-backdrop { position: fixed; inset: 76px 0 0; z-index: 49; background: rgba(3, 31, 40, .12); }
.offer-drawer-backdrop[hidden], .offer-drawer[hidden] { display: none; }
.offer-drawer {
  position: fixed;
  z-index: 50;
  top: 76px;
  right: 0;
  bottom: 0;
  width: min(520px, 40vw);
  overflow-y: auto;
  padding: 58px 28px 28px;
  border-left: 1px solid #d8e1e2;
  background: white;
  box-shadow: -18px 0 50px rgba(8, 43, 53, .12);
  animation: drawer-in .25s ease both;
}
@keyframes drawer-in { from { transform: translateX(30px); opacity: .3; } to { transform: translateX(0); opacity: 1; } }
.drawer-open { overflow: hidden; }
.drawer-open .marketplace-home { width: auto; margin-left: max(32px, calc((100vw - 1360px) / 2)); margin-right: min(552px, 43vw); }
.drawer-open .marketplace-heading h1 { font-size: 52px; }
.drawer-open .recent-rail { grid-auto-columns: minmax(250px, 1fr); }
.drawer-close { position: absolute; top: 10px; right: 21px; width: 44px; min-height: 44px; padding: 0; border: 0; background: transparent; color: #49636d; font: inherit; font-size: 30px; font-weight: 400; line-height: 1; cursor: pointer; }
.drawer-heading h2 { margin: 0; color: #062f3d; font-size: 38px; line-height: 1.05; }
.drawer-heading p { margin: 8px 0 0; color: #49636d; font-size: 13px; }
.drawer-fresh { margin: 13px 0 12px; min-height: 25px; padding: 4px 8px; display: inline-flex; align-items: center; border-radius: 5px; background: #0b646a; color: white; font-size: 11px; font-weight: 800; }
.drawer-gallery { position: relative; aspect-ratio: 1.28 / 1; overflow: hidden; border-radius: 7px; background: #eef3f2; }
.drawer-gallery img { width: 100%; height: 100%; object-fit: cover; }
.gallery-dots { position: absolute; left: 0; right: 0; bottom: 12px; display: flex; justify-content: center; gap: 7px; }
.gallery-dots button { width: 8px; height: 8px; padding: 0; border: 1px solid white; border-radius: 50%; background: rgba(255, 255, 255, .5); cursor: pointer; }
.gallery-dots button.active { background: white; }
.drawer-pickup { margin-top: 14px; padding: 15px 17px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-radius: 7px; background: #edf4f1; }
.drawer-pickup span { display: grid; gap: 3px; }
.drawer-pickup small { color: #4f686e; font-size: 11px; }
.drawer-pickup strong { font-size: 15px; }
.drawer-pickup > b { padding: 7px 9px; border-radius: 5px; background: #f4ce67; color: #173136; font-size: 11px; }
.drawer-description { padding: 16px 0 4px; color: #25434d; font-size: 14px; line-height: 1.5; }
.drawer-description p { margin: 0 0 9px; }
.drawer-price { display: flex; align-items: baseline; gap: 14px; margin: 10px 0 15px; }
.drawer-price strong { color: #062f3d; font-size: 31px; }
.drawer-price del { color: #87969a; }
.drawer-price span { padding: 4px 6px; border: 1px solid #ccd8da; border-radius: 4px; color: #31515b; font-size: 11px; }
.offer-drawer > [data-offer-drawer-content] > .button { width: 100%; background: #ef4d2d; }
.drawer-payment-note { display: block; margin-top: 9px; color: #687d84; text-align: center; }
.drawer-trust { margin-top: 24px; padding-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; border-top: 1px solid #dce4e5; }
.drawer-trust span { display: grid; gap: 3px; }
.drawer-trust b { color: #123945; font-size: 11px; }
.drawer-trust small { color: #687d84; font-size: 10px; line-height: 1.35; }

.partner-dashboard-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.partner-dashboard-heading .section-title { flex: 1; }
.partner-dashboard-actions { display: flex; gap: 9px; flex: 0 0 auto; }
.advanced-offer-editor { margin: 0 0 22px; border: 1px solid var(--color-border); border-radius: 7px; background: white; }
.advanced-offer-editor summary { padding: 13px 15px; color: var(--color-text-soft); font-size: 13px; font-weight: 850; cursor: pointer; }
.advanced-offer-editor .offer-editor { padding: 0 15px 15px; }
.offer-wizard[hidden] { display: none; }
.offer-wizard { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 18px; }
.offer-wizard-backdrop { position: absolute; inset: 0; background: rgba(3, 31, 40, .62); }
.wizard-open { overflow: hidden; }
.offer-wizard-panel { position: relative; width: min(860px, 100%); max-height: calc(100dvh - 36px); overflow: auto; border: 1px solid #dce4e5; border-radius: 8px; background: #f8faf9; box-shadow: 0 28px 90px rgba(3, 31, 40, .3); }
.offer-wizard-header { position: sticky; z-index: 2; top: 0; padding: 21px 24px 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; border-bottom: 1px solid #dce4e5; background: #f8faf9; }
.offer-wizard-header small { color: #0b646a; font-size: 11px; font-weight: 850; text-transform: uppercase; }
.offer-wizard-header h2 { margin: 4px 0 0; color: #062f3d; font-size: 27px; }
.wizard-close { min-height: 34px; padding: 5px 9px; border: 0; background: transparent; color: #49636d; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
.wizard-progress { margin: 0; padding: 18px 24px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; list-style: none; }
.wizard-progress li { position: relative; display: flex; align-items: center; gap: 8px; color: #819196; font-size: 12px; font-weight: 800; }
.wizard-progress li::after { content: ""; height: 1px; flex: 1; background: #d6e0e1; }
.wizard-progress li:last-child::after { display: none; }
.wizard-progress b { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid #cbd7d9; border-radius: 50%; background: white; font-size: 11px; }
.wizard-progress li.active, .wizard-progress li.done { color: #073b4c; }
.wizard-progress li.active b { border-color: #073b4c; background: #073b4c; color: white; }
.wizard-progress li.done b { border-color: #78a496; background: #e3f1eb; color: #286451; }
.wizard-form { padding: 0 24px; }
.wizard-step { min-height: 390px; padding: 18px 0 26px; }
.wizard-step[hidden] { display: none; }
.wizard-step > h3 { margin: 0; color: #062f3d; font-size: 25px; }
.wizard-step > p { margin: 8px 0 22px; color: #60767e; line-height: 1.45; }
.wizard-mode { margin-bottom: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; overflow: hidden; border: 1px solid #cad6d8; border-radius: 7px; background: #cad6d8; }
.wizard-mode button { min-height: 48px; border: 0; background: white; color: #35535d; font: inherit; font-size: 13px; font-weight: 850; cursor: pointer; }
.wizard-mode button.active { background: #073b4c; color: white; }
.photo-picker { min-height: 160px; padding: 28px; display: grid; place-items: center; align-content: center; gap: 7px; border: 2px dashed #acc1c6; border-radius: 8px; background: white; color: #073b4c; text-align: center; cursor: pointer; }
.photo-picker:hover { border-color: #0b646a; background: #f4f9f8; }
.photo-picker input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
.photo-picker strong { font-size: 17px; }
.photo-picker span, .wizard-quality { color: #6a7e84; font-size: 12px; }
.wizard-quality { margin: 10px 0 0; }
.wizard-photo-grid { margin-top: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.wizard-photo-grid figure { position: relative; aspect-ratio: 4 / 3; margin: 0; overflow: hidden; border-radius: 7px; background: #eaf0ef; }
.wizard-photo-grid img { width: 100%; height: 100%; object-fit: cover; }
.wizard-photo-grid button { position: absolute; top: 7px; right: 7px; min-height: 28px; padding: 4px 7px; border: 0; border-radius: 5px; background: rgba(3, 31, 40, .82); color: white; font: inherit; font-size: 10px; cursor: pointer; }
.wizard-photo-grid figcaption { position: absolute; left: 6px; right: 6px; bottom: 6px; padding: 5px 6px; border-radius: 4px; background: rgba(255, 242, 200, .94); color: #684e13; font-size: 10px; }
.wizard-template-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.wizard-template-list > button { padding: 0; overflow: hidden; border: 1px solid #d3dddf; border-radius: 7px; background: white; color: #133844; font: inherit; text-align: left; cursor: pointer; }
.wizard-template-list > button.active { border-color: #0b646a; outline: 3px solid rgba(11, 100, 106, .13); }
.wizard-template-list img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.wizard-template-list span { padding: 11px; display: grid; gap: 4px; }
.wizard-template-list strong { font-size: 14px; }
.wizard-template-list small { color: #6a7e84; font-size: 11px; }
.wizard-presets { margin-bottom: 15px; display: flex; gap: 8px; flex-wrap: wrap; }
.wizard-presets button { min-height: 40px; padding: 8px 13px; border: 1px solid #cbd7d9; border-radius: 6px; background: white; color: #173a45; font: inherit; font-size: 12px; font-weight: 850; cursor: pointer; }
.wizard-fields { display: grid; gap: 12px; }
.wizard-fields.two { grid-template-columns: 1fr 1fr; }
.wizard-step label:not(.photo-picker):not(.wizard-save-template) { margin-bottom: 13px; display: grid; gap: 6px; color: #274751; font-size: 12px; font-weight: 850; }
.wizard-step input, .wizard-step select, .wizard-step textarea { width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid #cbd7d9; border-radius: 6px; background: white; color: #102f38; resize: vertical; }
.wizard-step textarea { min-height: 74px; }
.wizard-preview { display: grid; grid-template-columns: minmax(220px, .8fr) minmax(0, 1.2fr); overflow: hidden; border: 1px solid #d3dddf; border-radius: 8px; background: white; }
.wizard-preview > img { width: 100%; height: 100%; min-height: 250px; object-fit: cover; }
.wizard-preview > div { padding: 22px; }
.wizard-preview span { color: #0b646a; font-size: 11px; font-weight: 850; }
.wizard-preview h4 { margin: 10px 0 8px; color: #062f3d; font-size: 25px; }
.wizard-preview p { margin: 0; color: #61767d; font-size: 13px; }
.wizard-preview > div > div { margin-top: 26px; display: flex; align-items: baseline; gap: 11px; }
.wizard-preview strong { font-size: 28px; }
.wizard-preview del { color: #8a989c; }
.wizard-preview b { margin-left: auto; padding: 6px 8px; border-radius: 5px; background: #f4ce67; font-size: 11px; }
.wizard-save-template { margin-top: 14px; display: flex; align-items: center; gap: 9px; color: #35535d; font-size: 12px; font-weight: 800; }
.wizard-save-template input { width: 18px; min-height: 18px; }
.wizard-error { padding: 10px; border-radius: 6px; background: #fae8e4; color: #8d321f; font-size: 13px; }
.offer-wizard-footer { position: sticky; z-index: 2; bottom: 0; padding: 15px 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px solid #dce4e5; background: #f8faf9; }
.offer-wizard-footer > span { color: #6e8188; font-size: 11px; }
.offer-wizard-footer > div { display: flex; gap: 8px; }
.offer-wizard-footer [hidden] { display: none !important; }

@media (prefers-reduced-motion: reduce) {
  .recent-offer, .offer-drawer { animation: none; }
  .marketplace-home { transition: none; }
}

@media (display-mode: standalone) {
  .site-header { padding-top: env(safe-area-inset-top); }
  .site-footer { padding-bottom: calc(36px + env(safe-area-inset-bottom)); }
}

@media (max-width: 1100px) {
  .offer-row { grid-template-columns: 120px minmax(200px, 1fr) 135px 95px 150px; }
  .offer-row > img { width: 120px; }
  .offer-row-more { display: none; }
  .offer-drawer { width: min(500px, 48vw); }
  .drawer-open .marketplace-home { margin-right: min(524px, 50vw); }
}

@media (max-width: 760px) {
  .site-header { background: #073b4c; }
  .site-header .mobile-menu summary { border-color: #376577; background: #073b4c; }
  .site-header .mobile-menu summary span { background: white; }
  .site-header .mobile-menu nav { border-color: #264f5e; background: #073b4c; }
  .site-header .mobile-menu nav a { color: white; }
  .marketplace-home { width: 100%; padding: 26px 14px 36px; }
  .marketplace-heading { display: block; padding-bottom: 24px; }
  .marketplace-heading h1 { font-size: 39px; }
  .marketplace-heading p { font-size: 15px; }
  .marketplace-date { margin-top: 17px; min-width: 0; padding: 10px 0 0; border-top: 1px solid #dce4e5; border-left: 0; display: flex; gap: 8px; }
  .marketplace-date strong { margin: 0; }
  .recent-rail { margin-right: -14px; grid-auto-columns: minmax(270px, 82vw); grid-template-rows: 225px; padding-right: 14px; }
  .catalog-title-row { align-items: start; }
  .catalog-title-row span { max-width: 110px; text-align: right; }
  .marketplace-catalog .filters { margin: 0 -14px; padding: 13px 14px 11px; }
  .offer-row { min-height: 112px; grid-template-columns: 104px minmax(0, 1fr) auto; grid-template-rows: auto auto; gap: 8px 11px; padding: 10px 0; }
  .offer-row > img { grid-row: 1 / 3; width: 104px; height: 92px; }
  .offer-row-main { align-self: end; }
  .offer-row-main small { max-width: 100%; }
  .offer-row-pickup { display: none; }
  .offer-row-mobile-pickup { display: inline-flex; margin-top: 2px; }
  .offer-row-stock { grid-column: 2; align-self: start; justify-self: start; min-height: 24px; padding: 4px 6px; }
  .offer-row-price { grid-column: 3; grid-row: 1 / 3; align-self: center; display: grid; gap: 1px; text-align: right; }
  .offer-row-price strong { font-size: 18px; }
  .offer-row-price del { font-size: 11px; }
  .offer-row-price em { display: none; }
  .offer-drawer-backdrop { inset: 66px 0 0; }
  .offer-drawer { top: auto; width: 100%; max-height: calc(100dvh - 38px); padding: 50px 16px 24px; border-top: 1px solid #d8e1e2; border-left: 0; border-radius: 8px 8px 0 0; animation-name: drawer-up; }
  @keyframes drawer-up { from { transform: translateY(35px); opacity: .3; } to { transform: translateY(0); opacity: 1; } }
  .drawer-open .marketplace-home { width: 100%; margin: 0; }
  .drawer-open .marketplace-heading h1 { font-size: 39px; }
  .drawer-open .recent-rail { grid-auto-columns: minmax(270px, 82vw); }
  .drawer-close { top: 8px; right: 10px; }
  .drawer-heading h2 { font-size: 29px; }
  .drawer-gallery { aspect-ratio: 4 / 3; }
  .drawer-pickup { padding: 13px; }
  .partner-dashboard-heading { display: block; }
  .partner-dashboard-actions { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 18px; }
  .partner-dashboard-actions .role-badge { grid-column: 1 / -1; }
  .partner-dashboard-actions .button { width: 100%; }
  .offer-wizard { padding: 0; align-items: end; }
  .offer-wizard-panel { width: 100%; max-height: 100dvh; border: 0; border-radius: 0; }
  .offer-wizard-header { padding: 16px 15px 13px; }
  .offer-wizard-header h2 { font-size: 22px; }
  .wizard-progress { padding: 12px 15px; }
  .wizard-progress li { gap: 4px; }
  .wizard-progress li span { display: none; }
  .wizard-progress b { flex: 0 0 25px; }
  .wizard-form { padding: 0 15px; }
  .wizard-step { min-height: calc(100dvh - 225px); padding-top: 14px; }
  .wizard-step > h3 { font-size: 23px; }
  .wizard-mode, .wizard-fields.two, .wizard-preview { grid-template-columns: 1fr; }
  .wizard-mode button { min-height: 44px; }
  .photo-picker { min-height: 135px; padding: 20px; }
  .wizard-photo-grid, .wizard-template-list { grid-template-columns: repeat(2, 1fr); }
  .wizard-preview > img { min-height: 190px; max-height: 230px; }
  .wizard-preview > div { padding: 16px; }
  .offer-wizard-footer { padding: 12px 15px; align-items: stretch; flex-direction: column; gap: 8px; }
  .offer-wizard-footer > div { display: grid; grid-template-columns: auto 1fr; }
  .offer-wizard-footer .button { width: auto; }
  .offer-wizard-footer [data-wizard-publish] { grid-column: 1 / -1; }
}

/* Shared visual system for secondary pages and protected workspaces. */
.page-inner {
  color: #15211d;
  background: #f4f6f2;
}
.page-inner main { min-height: 62vh; }
.page-inner .hero,
.page-inner .section,
.page-inner .bottom-cta {
  width: min(100% - 64px, 1240px);
}
.page-inner .split-hero {
  width: 100%;
  min-height: 470px;
  margin: 0;
  padding: 56px max(32px, calc((100vw - 1240px) / 2));
  border-bottom: 1px solid #d8e2df;
  background: #eaf1ef;
}
.page-inner .hero-copy h1,
.page-inner .section-title h2,
.page-inner .partner-dashboard h2,
.page-inner .panel-card h2,
.page-inner .accent-card h2,
.page-inner .city-card h3 {
  color: #062f3d;
}
.page-inner .hero-copy h1 { max-width: 680px; font-size: 60px; }
.page-inner .hero-copy p { color: #49636d; }
.page-inner .section { margin-bottom: 48px; }
.page-inner .section:first-of-type:not(.split-hero):not(.app-panel) { margin-top: 42px; }
.page-inner .section-title { margin-bottom: 22px; }
.page-inner .section-title h2 { font-size: 36px; }
.page-inner .section-title p { color: #60757b; }
.page-inner .kicker { color: #0b646a; }
.page-inner .button-primary {
  border-color: #ef4d2d;
  background: #ef4d2d;
  color: white;
  box-shadow: 0 9px 20px rgba(239, 77, 45, .16);
}
.page-inner .button-primary:hover { background: #d94326; }
.page-inner .button-outline { border-color: #9eb2b5; background: white; color: #073b4c; }
.page-inner .text-link { color: #0b646a; }
.page-inner .step-card,
.page-inner .info-card,
.page-inner .panel-card,
.page-inner .accent-card,
.page-inner .contact-card,
.page-inner .partner-dashboard,
.page-inner .compact-section,
.page-inner .form-section,
.page-inner .legal-block,
.page-inner .faq-item,
.page-inner .booking-preview,
.page-inner .code-card,
.page-inner .auth-box {
  border-color: #d8e2df;
  border-radius: 8px;
  background: #fff;
  box-shadow: none;
}
.page-inner .step-card,
.page-inner .info-card,
.page-inner .panel-card { border-top: 3px solid #0b646a; }
.page-inner .line-icon { border-radius: 8px; color: #0b646a; }
.page-inner .step-number { background: #f4ce67; color: #173136; }
.page-inner .check-list li::before { color: #0b646a; }
.page-inner .featured-photo,
.page-inner .offer-image,
.page-inner .large-photo,
.page-inner .strip-photo,
.page-inner .cta-photo,
.page-inner .dash-photo,
.page-inner .contact-photo,
.page-inner .code-photo { border-radius: 8px; background: #e6eeeb; }
.page-inner .booking-preview { padding: 16px; }
.page-inner .code-card { background: #f5f8f7; }
.page-inner .code-card strong { color: #d5471f; }
.page-inner .float-badge { border-radius: 8px; }
.page-inner .accent-card { background: #edf4f1; }
.page-inner .calendar-mark { border-color: #0b646a; border-radius: 8px; color: #0b646a; }
.page-inner .form-section { padding: 30px; background: #fff; }
.page-inner input:focus,
.page-inner select:focus,
.page-inner textarea:focus { border-color: #0b646a; box-shadow: 0 0 0 3px rgba(11, 100, 106, .13); }
.page-inner .consent a { color: #0b646a; }
.page-inner .city-card { border-color: #cbdcd6; border-radius: 8px; background: #e3efeb; }
.page-inner .city-lines,
.page-inner .shop-line { display: none; }
.page-inner .faq-item b { color: #0b646a; }
.page-inner .faq-item[open] b { background: #0b646a; color: #fff; }
.page-inner .bottom-cta {
  min-height: 170px;
  grid-template-columns: 230px minmax(0, 1fr) 220px;
  border: 0;
  border-radius: 8px;
  background: #073b4c;
  color: white;
}
.page-inner .bottom-cta h2 { color: white; }
.page-inner .bottom-cta p { color: #c4d7dc; }
.page-inner .bottom-cta .button-outline { border-color: white; background: white; color: #073b4c; }
.page-inner .legal-page { margin-top: 44px; }
.page-inner .legal-page > .section-title {
  padding: 0 0 24px;
  border-bottom: 1px solid #cfdcda;
}
.page-inner .legal-doc { gap: 14px; }
.page-inner .legal-block { border-top: 0; border-left: 4px solid #0b646a; }
.page-app .app-panel {
  width: min(100% - 64px, 1240px);
  margin: 42px auto 80px;
  padding: 0;
  border: 0;
  background: transparent;
}
.page-app .app-panel > .section-title,
.page-app .partner-dashboard-heading {
  margin: 0 0 24px;
  padding: 28px 30px;
  border-radius: 8px;
  background: #073b4c;
  color: white;
}
.page-app .app-panel > .section-title h2,
.page-app .partner-dashboard-heading h2 { color: white; }
.page-app .app-panel > .section-title .kicker,
.page-app .partner-dashboard-heading .kicker { color: #f4ce67; }
.page-app .app-panel > .section-title p,
.page-app .partner-dashboard-heading p { color: #c4d7dc; }
.page-app .partner-dashboard-heading .section-title { margin: 0; }
.page-app .partner-dashboard-heading .button-outline { border-color: white; background: white; color: #073b4c; }
.access-layout {
  display: grid;
  grid-template-columns: minmax(0, .9fr) minmax(380px, 1.1fr);
  overflow: hidden;
  border: 1px solid #d4e0dd;
  border-radius: 8px;
  background: white;
}
.access-intro { padding: 38px; background: #e3efeb; }
.access-intro h3 { margin: 10px 0 12px; color: #062f3d; font-size: 30px; line-height: 1.1; }
.access-intro > p:not(.kicker) { max-width: 520px; color: #49636d; line-height: 1.55; }
.access-points { margin: 24px 0 0; padding: 0; display: grid; gap: 12px; list-style: none; }
.access-points li { position: relative; padding-left: 24px; color: #173a45; font-weight: 800; }
.access-points li::before { content: "✓"; position: absolute; left: 0; color: #0b646a; }
.access-layout .auth-box { max-width: none; padding: 38px; border: 0; border-radius: 0; }
.access-layout .auth-box h3 { margin: 0; color: #062f3d; font-size: 26px; }
.access-layout .auth-box > p { margin: 8px 0 24px; color: #687d84; }
.access-layout .auth-box .button { width: 100%; }
.page-app .tab-nav a.active { border-color: #073b4c; background: #073b4c; }
.page-app .stats-row small { color: #0b646a; }
.page-app .data-table button { color: #0b646a; }
.workspace-header {
  width: 100%;
  min-height: 68px;
  padding: 0 max(32px, calc((100vw - 1240px) / 2));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #174f60;
  background: #073b4c;
  color: white;
}
.workspace-header .brand { color: white; }
.workspace-header .brand-mark { border-color: #f4ce67; background: #f4ce67; color: #173136; }
.workspace-header .brand strong { color: white; }
.workspace-header .brand small { color: #b9d3dc; }
.workspace-site-link {
  min-height: 40px;
  padding: 9px 14px;
  display: inline-flex;
  align-items: center;
  border: 1px solid #5f8794;
  border-radius: 7px;
  color: white;
  font-size: 13px;
  font-weight: 850;
}
.workspace-site-link:hover { border-color: white; background: rgba(255, 255, 255, .08); }
.customer-hero {
  width: min(100% - 64px, 1360px);
  margin: 0 auto;
  padding: 54px 0 34px;
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(360px, .88fr);
  align-items: center;
  gap: 56px;
}
.customer-hero-copy h1 { max-width: 760px; margin: 10px 0 18px; color: #062f3d; font-size: 62px; line-height: 1.02; }
.customer-hero-copy > p:not(.kicker) { max-width: 680px; margin: 0; color: #49636d; font-size: 17px; line-height: 1.55; }
.customer-hero-copy .actions { margin-top: 24px; }
.customer-trust { margin: 26px 0 0; padding: 0; display: flex; gap: 12px 24px; flex-wrap: wrap; list-style: none; }
.customer-trust li { position: relative; padding-left: 20px; color: #31515b; font-size: 13px; font-weight: 850; }
.customer-trust li::before { content: "✓"; position: absolute; left: 0; color: #0b646a; }
.customer-hero .booking-preview { max-width: 440px; justify-self: end; }
.customer-guide, .customer-faq { padding-top: 48px; padding-bottom: 48px; }
.footer-app-status { color: #f4ce67; font-weight: 850; }
.password-gate { margin-top: 22px; }
.settings-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(300px, 1.1fr); gap: 32px; }
.settings-grid section { min-width: 0; }
.settings-grid .mini-form { grid-template-columns: 1fr; }
.password-required-notice {
  margin: 0 0 18px;
  padding: 14px 16px;
  display: grid;
  gap: 4px;
  border: 1px solid #e3c567;
  border-left: 5px solid #d39a13;
  border-radius: 7px;
  background: #fff8df;
  color: #684e13;
}
.password-required-notice[hidden] { display: none; }
.help-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.help-steps p { margin: 0; padding: 16px; display: grid; gap: 7px; border: 1px solid #d4e0dd; border-radius: 7px; background: white; }
.help-steps span { color: #60767e; line-height: 1.45; }
.table-action.danger { border-color: #e3b6ab; color: #9c321f; }
.table-action.danger:hover { background: #fff1ed; }
.record-dialog { position: fixed; z-index: 120; inset: 0; display: grid; place-items: center; padding: 18px; }
.record-dialog[hidden] { display: none; }
.record-dialog-backdrop { position: absolute; inset: 0; background: rgba(3, 31, 40, .62); }
.record-dialog-panel { position: relative; width: min(620px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 30px; border-radius: 9px; background: white; box-shadow: 0 28px 90px rgba(3, 31, 40, .3); }
.record-dialog-panel h2 { margin: 8px 0 20px; color: #062f3d; }
.record-dialog-panel .modal-close { position: absolute; top: 12px; right: 12px; }
.record-details { margin: 0; display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 1px; overflow: hidden; border: 1px solid #d4e0dd; border-radius: 7px; background: #d4e0dd; }
.record-details dt, .record-details dd { margin: 0; padding: 11px 13px; background: white; }
.record-details dt { color: #60767e; font-size: 12px; font-weight: 850; }
.record-details dd { color: #173a45; line-height: 1.45; overflow-wrap: anywhere; }
.record-message { margin-top: 16px; padding: 15px; border-radius: 7px; background: #eef4f2; color: #25434d; line-height: 1.55; white-space: pre-wrap; }

@media (max-width: 1024px) {
  .page-inner .hero,
  .page-inner .section,
  .page-inner .bottom-cta,
  .page-app .app-panel { width: min(100% - 36px, 1240px); }
  .page-inner .split-hero { width: 100%; padding-inline: 28px; }
  .page-inner .bottom-cta { grid-template-columns: 1fr; }
  .page-inner .bottom-cta .cta-photo { display: none; }
  .customer-hero { width: min(100% - 36px, 1240px); grid-template-columns: 1fr minmax(320px, .72fr); gap: 30px; }
  .customer-hero-copy h1 { font-size: 50px; }
}

@media (max-width: 640px) {
  .page-inner .hero,
  .page-inner .section,
  .page-inner .bottom-cta,
  .page-app .app-panel { width: min(100% - 28px, 1240px); }
  .page-inner .split-hero { width: 100%; padding: 38px 14px 32px; }
  .page-inner .hero-copy h1 { font-size: 40px; }
  .page-inner .section-title h2 { font-size: 30px; }
  .page-inner .form-section { padding: 18px; }
  .page-inner .bottom-cta { padding: 22px; }
  .page-app .app-panel > .section-title,
  .page-app .partner-dashboard-heading { padding: 22px 18px; }
  .access-layout { grid-template-columns: 1fr; }
  .access-intro,
  .access-layout .auth-box { padding: 24px 18px; }
  .access-intro h3 { font-size: 25px; }
  .admin-workflow,
  .onboarding-fields,
  .maintenance-grid { grid-template-columns: 1fr; }
  .onboarding-fields .field-wide { grid-column: auto; }
  .onboarding-submit { width: 100%; min-width: 0; }
  .workspace-header { min-height: 62px; padding: 0 14px; }
  .workspace-header .brand small { display: block; }
  .workspace-header .brand-mark { display: none; }
  .workspace-site-link { min-height: 38px; padding-inline: 10px; }
  .customer-hero { width: min(100% - 28px, 1240px); padding: 36px 0 18px; grid-template-columns: 1fr; gap: 26px; }
  .customer-hero-copy h1 { font-size: 40px; }
  .customer-hero-copy > p:not(.kicker) { font-size: 15px; }
  .customer-hero-copy .actions { display: grid; grid-template-columns: 1fr; }
  .customer-hero-copy .button { width: 100%; }
  .customer-trust { display: grid; gap: 10px; }
  .customer-hero .booking-preview { width: 100%; max-width: none; justify-self: stretch; }
  .settings-grid, .help-steps { grid-template-columns: 1fr; }
  .record-dialog { padding: 0; align-items: end; }
  .record-dialog-panel { width: 100%; max-height: 88dvh; padding: 28px 18px calc(22px + env(safe-area-inset-bottom)); border-radius: 14px 14px 0 0; }
  .record-details { grid-template-columns: 1fr; }
  .record-details dt { padding-bottom: 4px; }
  .record-details dd { padding-top: 4px; }
}
`;

const server = http.createServer(async (request, response) => {
  let url;
  try {
    url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  } catch {
    sendText(response, 400, "Некорректный запрос", {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    return;
  }

  if (url.pathname === "/styles.css") {
    sendText(response, 200, STYLES, { ...securityHeaders, "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  if (url.pathname === "/app.js") {
    sendText(response, 200, APP_JS, { ...securityHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  if (url.pathname === "/public.js") {
    sendText(response, 200, PUBLIC_JS, { ...securityHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  const pwaAsset = {
    "/.well-known/assetlinks.json": [".well-known/assetlinks.json", "application/json; charset=utf-8", "public, max-age=300"],
    "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json; charset=utf-8", "no-cache"],
    "/sw.js": ["sw.js", "text/javascript; charset=utf-8", "no-cache"],
    "/pwa.js": ["pwa.js", "text/javascript; charset=utf-8", "no-cache"],
    "/offline.html": ["offline.html", "text/html; charset=utf-8", "no-cache"],
    "/offline.css": ["offline.css", "text/css; charset=utf-8", "public, max-age=86400"],
    "/offline.js": ["offline.js", "text/javascript; charset=utf-8", "public, max-age=86400"]
  }[url.pathname];
  if (pwaAsset) {
    const [fileName, contentType, cacheControl] = pwaAsset;
    sendFile(
      response,
      path.join(ROOT, "public", fileName),
      contentType,
      cacheControl,
      url.pathname === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}
    );
    return;
  }

  if (url.pathname.startsWith("/icons/")) {
    const iconRoot = path.join(ROOT, "public", "icons");
    const filePath = path.normalize(path.join(ROOT, "public", url.pathname));
    if (filePath.startsWith(iconRoot + path.sep) && fs.existsSync(filePath) && path.extname(filePath).toLowerCase() === ".png") {
      sendFile(response, filePath, "image/png", "public, max-age=31536000, immutable");
      return;
    }
  }

  if (url.pathname === "/favicon.ico") {
    sendFile(response, path.join(ROOT, "public", "icons", "favicon-64.png"), "image/png", "public, max-age=31536000, immutable");
    return;
  }

  if (url.pathname === "/robots.txt") {
    sendText(response, 200, "User-agent: *\nDisallow: /\n", { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  if (url.pathname.startsWith("/images/")) {
    const imageRoot = path.join(ROOT, "public", "images");
    const filePath = path.normalize(path.join(ROOT, "public", url.pathname));
    if (filePath.startsWith(imageRoot + path.sep) && fs.existsSync(filePath)) {
      const contentType = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      response.writeHead(200, { ...securityHeaders, "Content-Type": contentType, "Cache-Control": "public, max-age=3600", "Content-Length": fs.statSync(filePath).size });
      fs.createReadStream(filePath).pipe(response);
      return;
    }
  }

  if (url.pathname.startsWith("/uploads/")) {
    if (!isUploadedAssetAuthorized(request, url.pathname)) {
      sendUnauthorized(response, "Beri Segodnya Media");
      return;
    }
    const uploaded = resolveUploadedImage(url.pathname);
    if (uploaded) {
      response.writeHead(200, { ...securityHeaders, "Content-Type": uploaded.contentType, "Cache-Control": "private, max-age=3600", "Content-Length": uploaded.size });
      fs.createReadStream(uploaded.filePath).pipe(response);
      return;
    }
    sendText(response, 404, "Изображение не найдено", { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  const requirement = authRequirement(url.pathname);
  if (requirement && !isAuthorized(request, requirement.user, requirement.hash)) {
    sendUnauthorized(response, requirement.realm);
    return;
  }

  if (url.pathname === "/page-config.js") {
    const pageConfig = `window.DEFAULT_OFFERS=${json(listPublicOffers())};window.PUBLIC_CONFIG=${json({
      demoMode: config.demoMode,
      appName: config.appName,
      appCity: config.appCity,
      legalReady: config.legal.ready
    })};`;
    sendText(response, 200, pageConfig, { ...securityHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(request, response, url);
    return;
  }

  const knownRoutes = new Set(["/", "/how-it-works", "/partners", "/contacts", "/privacy", "/personal-data-consent", "/terms", "/partner-terms", "/admin", "/partner/login", "/partner/dashboard"]);
  const isBookingRoute = url.pathname.startsWith("/booking/") && url.pathname.length > "/booking/".length;

  if (!knownRoutes.has(url.pathname) && !isBookingRoute) {
    sendText(response, 404, renderPage("/"), { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return;
  }

  sendText(response, 200, renderPage(url.pathname), { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
});

server.listen(PORT, HOST, () => {
  console.log(`Бери сегодня запущен: http://${HOST}:${PORT}`);
});
