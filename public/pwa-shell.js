(() => {
  if (!document.body.classList.contains("page-pwa")) return;
  const guestKey = "bs_pwa_guest_links_v1";
  const tourKey = "bs_pwa_tour_seen_v1";
  const bookingPattern = /^\/booking\/(booking-view-[a-zA-Z0-9-]{36,160})$/;

  // Bookmarks only: never store codes, contacts, stock or account history here.
  function bookingPath(value) {
    if (typeof value !== "string" || value.length > 300) return "";
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin && bookingPattern.test(url.pathname) ? url.pathname : "";
    } catch { return ""; }
  }
  function guestLinks() {
    try {
      const saved = JSON.parse(localStorage.getItem(guestKey) || "[]");
      return Array.isArray(saved) ? [...new Set(saved.map(bookingPath).filter(Boolean))].slice(0, 20) : [];
    } catch { return []; }
  }
  window.bsRememberGuestBooking = value => {
    const path = bookingPath(value);
    if (!path) return;
    try { localStorage.setItem(guestKey, JSON.stringify([path, ...guestLinks().filter(item => item !== path)].slice(0, 20))); } catch {}
  };

  function appHref(value) {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return value;
    if (url.pathname === "/") return "/app";
    if (url.pathname === "/customer") return "/app/profile";
    if (/^\/(?:booking|partner)(?:\/|$)/.test(url.pathname) || ["/admin", "/partners", "/how-it-works"].includes(url.pathname)) url.searchParams.set("app", "1");
    return url.pathname + url.search + url.hash;
  }
  document.addEventListener("click", event => {
    const link = event.target.closest?.("a[href]");
    if (!link || link.hasAttribute("download") || link.target === "_blank" || !/^https?:$/.test(new URL(link.href).protocol)) return;
    link.href = appHref(link.href);
  }, true);

  const viewport = window.visualViewport;
  let fullHeight = viewport?.height || window.innerHeight;
  function keyboard() {
    const editable = document.activeElement?.matches("input:not([type=checkbox]):not([type=radio]), textarea, select");
    if (!editable) fullHeight = Math.max(viewport?.height || window.innerHeight, fullHeight);
    document.body.classList.toggle("keyboard-open", Boolean(editable && (!viewport || fullHeight - viewport.height > 100)));
  }
  document.addEventListener("focusin", keyboard);
  document.addEventListener("focusout", () => window.setTimeout(keyboard, 0));
  viewport?.addEventListener("resize", keyboard);

  if (new URLSearchParams(location.search).get("install") === "iphone" && !(navigator.standalone || window.matchMedia("(display-mode: standalone)").matches)) {
    const hint = document.createElement("aside"); hint.className = "pwa-iphone-hint";
    hint.textContent = "Чтобы установить: откройте эту страницу в Safari → «Поделиться» → «На экран Домой» → «Добавить». Если есть «Открыть как веб-приложение», включите его.";
    document.querySelector("main").prepend(hint);
  }

  async function api(path) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Object.assign(new Error("Не удалось загрузить брони."), { status: response.status });
      return result.data;
    } finally { window.clearTimeout(timeout); }
  }
  const root = document.querySelector("[data-pwa-bookings]");
  function readableDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || "";
    const date = new Date(`${value}T12:00:00+03:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(date);
  }
  function bookingCard(row) {
    const path = bookingPath(`/booking/${row.publicToken}`);
    if (!path) return null;
    const card = document.createElement("article"); card.className = "pwa-booking-card";
    const state = document.createElement("span"); state.className = "pwa-booking-state";
    state.textContent = ({ created: "Забронировано", issued: "Выдано", cancelled: "Отменено", no_show: "Не получено" })[row.status] || "Бронь завершена";
    const title = document.createElement("h2"); title.textContent = row.offerTitle || "Ваша бронь";
    const code = document.createElement("strong"); code.className = "pwa-booking-code"; code.textContent = row.status === "created" ? row.code : "";
    const details = document.createElement("p"); details.textContent = [row.partnerName, readableDate(row.date), row.pickupWindow].filter(Boolean).join(" · ");
    const link = document.createElement("a"); link.className = "button button-outline"; link.href = `${path}?app=1`; link.textContent = "Открыть бронь";
    card.append(state, title, code, details, link); return card;
  }
  let loading = false;
  async function loadBookings() {
    if (!root || loading) return;
    loading = true;
    const find = name => root.querySelector(`[data-pwa-${name}]`);
    const status = find("bookings-status"), refresh = find("bookings-refresh");
    refresh.disabled = true; status.textContent = "Загружаем брони…";
    find("bookings-empty").hidden = true;
    const account = find("account-bookings"), guest = find("guest-bookings");
    account.replaceChildren(); guest.replaceChildren(); find("guest-section").hidden = true; find("profile-note").hidden = true;
    try {
      let state = null, incomplete = false, shown = 0;
      try { state = await api("/api/customer/auth/me"); } catch { incomplete = true; }
      const accountTokens = new Set();
      if (state?.authenticated) {
        try {
          const rows = await api("/api/customer/bookings");
          for (const row of rows) { const card = bookingCard(row); if (card) { account.append(card); accountTokens.add(row.publicToken); shown++; } }
        } catch { incomplete = true; }
      }
      const links = guestLinks().filter(path => !accountTokens.has(path.slice("/booking/".length)));
      const results = await Promise.allSettled(links.map(path => api(`/api/public/bookings/${encodeURIComponent(path.slice("/booking/".length))}`)));
      for (const result of results) {
        if (result.status === "fulfilled") { const card = bookingCard(result.value); if (card) { guest.append(card); shown++; } }
        else if (![400, 404, 410].includes(result.reason?.status)) incomplete = true;
      }
      find("guest-section").hidden = !guest.children.length;
      find("bookings-empty").hidden = shown > 0 || incomplete;
      find("profile-note").hidden = state?.authenticated || !state?.enabled;
      status.textContent = incomplete ? "Не все брони загрузились. Проверьте интернет и нажмите «Обновить». Сохранённые ссылки не удалены." : "";
    } finally { loading = false; refresh.disabled = false; }
  }
  root?.querySelector("[data-pwa-bookings-refresh]").addEventListener("click", loadBookings);
  if (root) loadBookings();

  // Optional, repeatable guidance. Only the local dismissal marker is persisted.
  let tourDialog = null;
  function tourSeen() { try { return localStorage.getItem(tourKey) === "1"; } catch { return false; } }
  function rememberTour() { try { localStorage.setItem(tourKey, "1"); } catch {} }
  function startTour(trigger) {
    if (tourDialog) return;
    document.querySelector("[data-pwa-tour-invite]")?.remove();
    const dialog = document.createElement("dialog"); dialog.className = "pwa-tour"; tourDialog = dialog;
    dialog.setAttribute("aria-labelledby", "pwa-tour-title");
    dialog.innerHTML = '<p class="kicker" data-tour-step></p><h2 id="pwa-tour-title"></h2><p data-tour-text></p><div class="actions"><button class="button button-primary" type="button" data-tour-next>Дальше</button><button class="button button-outline" type="button" data-tour-close>Пропустить</button></div>';
    const steps = [
      ["Предложения", "Внизу нажмите «Предложения». Выберите набор и откройте карточку: там состав, цена, адрес и время получения.", "/app"],
      ["Получите код", "В карточке нажмите «Забронировать» или «Получить код». Проверьте имя и телефон, согласитесь с обработкой данных и получите код. Оплата — в магазине.", "/app"],
      ["Мои брони", "Ваш код и время получения — в разделе «Мои брони» внизу. Покажите код сотруднику. Не успеваете прийти? Откройте бронь и отмените её.", "/app/bookings"]
    ];
    let step = 0;
    function render() {
      const [title, text, href] = steps[step];
      dialog.querySelector("[data-tour-step]").textContent = `${step + 1} из ${steps.length}`;
      dialog.querySelector("h2").textContent = title;
      dialog.querySelector("[data-tour-text]").textContent = text;
      dialog.querySelector("[data-tour-next]").textContent = step === steps.length - 1 ? "Выбрать предложение" : "Дальше";
      document.querySelectorAll(".pwa-bottom-nav a").forEach(link => link.classList.toggle("pwa-tour-highlight", new URL(link.href).pathname === href));
    }
    dialog.querySelector("[data-tour-next]").onclick = () => { if (++step < steps.length) render(); else { dialog.close(); location.assign("/app"); } };
    dialog.querySelector("[data-tour-close]").onclick = () => dialog.close();
    dialog.addEventListener("close", () => {
      rememberTour(); document.querySelectorAll(".pwa-tour-highlight").forEach(node => node.classList.remove("pwa-tour-highlight"));
      dialog.remove(); tourDialog = null; if (trigger?.isConnected) trigger.focus();
    });
    document.body.append(dialog); render(); dialog.showModal();
  }
  function offerTour(authenticated) {
    if (!authenticated || tourSeen() || tourDialog || document.querySelector("[data-pwa-tour-invite]")) return;
    const invite = document.createElement("aside"); invite.className = "pwa-note"; invite.dataset.pwaTourInvite = "true";
    invite.innerHTML = '<h2>Показать, как забронировать?</h2><p>Три коротких шага. Можно пропустить и посмотреть позже в профиле.</p><div class="actions"><button class="button button-primary" type="button" data-show-tour>Показать</button><button class="button button-outline" type="button" data-skip-tour>Позже</button></div>';
    invite.querySelector("[data-show-tour]").onclick = event => startTour(event.currentTarget);
    invite.querySelector("[data-skip-tour]").onclick = () => { rememberTour(); invite.remove(); };
    document.querySelector("main").prepend(invite);
  }
  document.querySelectorAll("[data-pwa-tour-start]").forEach(node => node.addEventListener("click", event => startTour(event.currentTarget)));
  window.addEventListener("bs-customer-change", event => { offerTour(event.detail?.authenticated); if (!event.detail?.authenticated) document.querySelector("[data-pwa-tour-invite]")?.remove(); });
  offerTour(Boolean(window.bsCustomer));
})();
