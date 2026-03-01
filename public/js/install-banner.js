(function () {
  // Nu afișa pe desktop
  if (!window.matchMedia('(max-width: 640px)').matches && !window.matchMedia('(pointer: coarse)').matches) return;

  // Deja standalone (app instalată)
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (navigator.standalone === true) return;

  // Dismissed recent (7 zile)
  const dismissed = localStorage.getItem('pwa-dismissed-at');
  if (dismissed) {
    const age = Date.now() - parseInt(dismissed, 10);
    if (age < 7 * 24 * 60 * 60 * 1000) return;
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  function showBanner() {
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const el = document.createElement('div');
    el.className = 'pwa-install-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Instalare aplicație');
    el.innerHTML =
      '<p class="pwa-install-banner__text">Instalează pentru o experiență mai bună</p>' +
      '<div class="pwa-install-banner__actions">' +
      '<button type="button" class="btn btn--primary btn--sm pwa-install-banner__install">Instalează</button>' +
      '<button type="button" class="btn btn--ghost btn--icon btn--sm pwa-install-banner__dismiss" aria-label="Închide">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('.pwa-install-banner__install').addEventListener('click', function () {
      localStorage.removeItem('pwa-dismissed-at');
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () { el.remove(); });
      } else if (isSafari) {
        el.querySelector('.pwa-install-banner__text').textContent = 'Share → Add to Home Screen';
      }
    });

    el.querySelector('.pwa-install-banner__dismiss').addEventListener('click', function () {
      localStorage.setItem('pwa-dismissed-at', String(Date.now()));
      el.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
})();
