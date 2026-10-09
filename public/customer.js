(() => {
  const page = document.querySelector("[data-customer-page]");
  const config = window.PUBLIC_CONFIG || {};
  let challenge = null, email = "", resendAt = 0, busy = false;
  const find = name => page?.querySelector(`[data-customer-${name}]`);
  function message(text) { const node = find("message"); if (node) node.textContent = text; }
  async function api(path, method = "GET", body) {
    const response = await fetch(`/api/customer/${path}`, { method, credentials: "same-origin", cache: "no-store", headers: { "X-BS-Request": "1", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error?.message || "Не удалось выполнить действие. Попробуйте позже.");
    return result.data;
  }
  async function action(callback) {
    if (busy) return;
    busy = true; page?.querySelectorAll("button").forEach(node => { node.disabled = true; });
    try { await callback(); } catch (error) { message(error instanceof TypeError ? "Нет связи с сервисом. Проверьте интернет и попробуйте снова." : error.message); }
    finally { busy = false; page?.querySelectorAll("button").forEach(node => { node.disabled = false; }); }
  }
  function profile(value) {
    window.bsCustomer = value;
    document.querySelectorAll("[data-customer-link]").forEach(node => { node.textContent = value ? "Мой кабинет" : "Вход для покупателя"; });
    if (!page) return;
    find("login").hidden = Boolean(value); find("account").hidden = !value;
    if (value) {
      find("email").textContent = value.email;
      find("profile-form").elements.name.value = value.name;
      find("profile-form").elements.phone.value = value.phone;
      find("delete").disabled = Boolean(value.deletionRequestedAt);
    }
  }
  function guestToken() {
    try {
      const url = new URL(localStorage.getItem("bs_latest_booking") || "", location.origin);
      const match = url.origin === location.origin && url.pathname.match(/^\/booking\/(booking-view-[a-zA-Z0-9-]{36,160})$/);
      return match ? match[1] : "";
    } catch { return ""; }
  }
  async function bookings() {
    if (!page) return;
    const rows = await api("bookings");
    const container = find("bookings"); container.replaceChildren();
    if (!rows.length) { const empty = document.createElement("p"); empty.textContent = "Здесь появятся ваши брони. Выберите предложение на главной странице."; container.append(empty); }
    for (const row of rows) {
      const card = document.createElement("article"); card.className = "customer-booking-card";
      const title = document.createElement("h3"); title.textContent = row.offerTitle || "Ваша бронь";
      const details = document.createElement("p"); details.textContent = `${row.code} · ${row.partnerName} · ${row.pickupWindow}`;
      const link = document.createElement("a"); link.className = "button button-outline"; link.textContent = "Открыть бронь"; link.href = `/booking/${encodeURIComponent(row.publicToken)}`;
      card.append(title, details, link); container.append(card);
    }
    const token = guestToken(); find("claim").hidden = !token || rows.some(row => row.publicToken === token);
  }
  async function refresh() {
    const state = await api("auth/me"); window.bsCustomerReady = true; profile(state.profile);
    if (page) {
      message(state.enabled ? "" : "Вход по почте пока недоступен. Можно забронировать без регистрации.");
      if (!state.enabled) find("login").hidden = true;
      if (state.authenticated) await bookings();
    }
  }
  async function sendCode() {
    if (Date.now() < resendAt) { message("Подождите минуту перед повторной отправкой."); return; }
    challenge = await api("auth/request-code", "POST", { email, personalDataConsent: true });
    resendAt = Date.now() + challenge.resendAfter * 1000;
    find("email-form").hidden = true; find("code-form").hidden = false;
    find("code-form").elements.code.value = ""; find("code-form").elements.code.focus();
    message(`Отправили код на ${email}. Он действует 10 минут. Если письма нет, проверьте «Спам».`);
  }
  if (page) {
    find("email-form").addEventListener("submit", event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; email = form.elements.email.value.trim(); action(sendCode); });
    find("code-form").addEventListener("submit", event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity() || !challenge) return; action(async () => { const state = await api("auth/verify-code", "POST", { challengeId: challenge.challengeId, code: form.elements.code.value.trim() }); form.elements.code.value = ""; challenge = null; profile(state.profile); await bookings(); message("Вы вошли. Сохраните имя и телефон для следующих заказов."); }); });
    find("resend").onclick = () => action(sendCode);
    find("other-email").onclick = () => { if (busy) return; challenge = null; find("email-form").hidden = false; find("code-form").hidden = true; message(""); };
    find("profile-form").addEventListener("submit", event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; action(async () => { profile(await api("profile", "PATCH", { name: form.elements.name.value, phone: form.elements.phone.value })); message("Сохранили. При следующей брони эти поля заполнятся автоматически."); }); });
    find("logout").onclick = () => action(async () => { await api("auth/logout", "POST", {}); profile(null); find("bookings").replaceChildren(); find("email-form").hidden = false; find("code-form").hidden = true; message("Вы вышли из кабинета."); });
    find("claim").onclick = () => action(async () => { if (!confirm("Добавить последнюю бронь с этого устройства в ваш кабинет? Она будет доступна на всех устройствах, где вы вошли по этой почте.")) return; await api("bookings/claim", "POST", { publicToken: guestToken() }); await bookings(); message("Добавили бронь в кабинет."); });
    find("delete").onclick = () => action(async () => { if (!confirm("Отправить в поддержку запрос на удаление кабинета? Мы проверим незавершённые брони и ответим на вашу почту.")) return; const result = await api("account/deletion-request", "POST", {}); message(result.message); });
  }
  if (config.customerAuthEnabled) refresh().catch(() => { window.bsCustomerReady = false; message("Не удалось загрузить кабинет. Проверьте интернет и обновите страницу."); });
  else { window.bsCustomerReady = true; profile(null); if (page) { find("login").hidden = true; message("Вход по почте пока недоступен. Можно забронировать без регистрации."); } }
})();
