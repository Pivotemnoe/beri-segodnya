(function () {
  const installButtons = Array.from(document.querySelectorAll("[data-pwa-install]"));
  const dialog = document.querySelector("[data-pwa-dialog]");
  const dialogText = dialog?.querySelector("[data-pwa-instructions]");
  let installPrompt = null;
  let returnFocus = null;
  let reloadingForUpdate = false;

  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isAppleMobile = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isMobile = () => window.matchMedia("(max-width: 820px)").matches;

  function setInstallVisible(visible) {
    installButtons.forEach((button) => { button.hidden = !visible || isStandalone(); });
  }

  function focusable(container) {
    return Array.from(container.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getClientRects().length);
  }

  function openInstructions(trigger) {
    if (!dialog) return;
    returnFocus = trigger || document.activeElement;
    if (dialogText) {
      dialogText.textContent = isAppleMobile()
        ? "Нажмите «Поделиться», выберите «На экран Домой», затем подтвердите добавление."
        : "Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».";
    }
    dialog.hidden = false;
    document.body.classList.add("pwa-dialog-open");
    dialog.querySelector("[data-pwa-dialog-close]")?.focus({ preventScroll: true });
  }

  function closeInstructions() {
    if (!dialog) return;
    dialog.hidden = true;
    document.body.classList.remove("pwa-dialog-open");
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  installButtons.forEach((button) => button.addEventListener("click", async () => {
    if (!installPrompt) {
      openInstructions(button);
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    installPrompt = null;
    if (choice.outcome === "accepted") setInstallVisible(false);
  }));

  dialog?.querySelectorAll("[data-pwa-dialog-close]").forEach((node) => node.addEventListener("click", closeInstructions));
  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeInstructions();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusable(dialog);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    setInstallVisible(true);
  });
  window.addEventListener("appinstalled", () => setInstallVisible(false));

  function statusNotice(message, actionLabel, action) {
    document.querySelector("[data-pwa-status]")?.remove();
    const notice = document.createElement("div");
    notice.className = "pwa-status";
    notice.dataset.pwaStatus = "true";
    notice.setAttribute("role", "status");
    notice.innerHTML = '<span></span>' + (actionLabel ? '<button type="button"></button>' : "");
    notice.querySelector("span").textContent = message;
    const button = notice.querySelector("button");
    if (button) {
      button.textContent = actionLabel;
      button.addEventListener("click", action);
    }
    document.body.appendChild(notice);
    if (!actionLabel) window.setTimeout(() => notice.remove(), 4500);
  }

  function offerUpdate(worker) {
    if (!worker) return;
    statusNotice("Доступна новая версия приложения.", "Обновить", () => worker.postMessage({ type: "SKIP_WAITING" }));
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
          });
        });
      }).catch(() => {});
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
  }

  window.addEventListener("offline", () => statusNotice("Нет соединения. Брони и изменения временно недоступны."));
  window.addEventListener("online", () => statusNotice("Соединение восстановлено."));
  setInstallVisible(true);
})();
