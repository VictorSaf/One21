(function () {
  // Deja standalone (app instalată) — nu afișa nimic
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (navigator.standalone === true) return;

  // Dismissed recent (7 zile)
  const dismissed = localStorage.getItem('pwa-dismissed-at');
  if (dismissed && Date.now() - parseInt(dismissed, 10) < 7 * 24 * 60 * 60 * 1000) return;

  const isIOS    = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) && !/CriOS/.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  function dismiss(el) {
    localStorage.setItem('pwa-dismissed-at', String(Date.now()));
    el.remove();
  }

  function showBanner() {
    const el = document.createElement('div');
    el.className = 'pwa-install-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Instalare aplicație');

    if (isIOS && isSafari) {
      // iOS Safari: nu există beforeinstallprompt, instrucțiuni manuale
      el.innerHTML =
        '<p class="pwa-install-banner__text">' +
          '<svg class="pwa-install-banner__share-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>' +
          'Apasă <strong>Share</strong> → <strong>Add to Home Screen</strong>' +
        '</p>' +
        '<button type="button" class="btn btn--ghost btn--icon btn--sm pwa-install-banner__dismiss" aria-label="Închide">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>';
    } else {
      el.innerHTML =
        '<p class="pwa-install-banner__text">Instalează ONE21 pentru acces rapid</p>' +
        '<div class="pwa-install-banner__actions">' +
          '<button type="button" class="btn btn--primary btn--sm pwa-install-banner__install">Instalează</button>' +
          '<button type="button" class="btn btn--ghost btn--icon btn--sm pwa-install-banner__dismiss" aria-label="Închide">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>';
    }

    document.body.appendChild(el);

    const installBtn = el.querySelector('.pwa-install-banner__install');
    if (installBtn) {
      installBtn.addEventListener('click', function () {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(function (choice) {
            deferredPrompt = null;
            if (choice.outcome === 'accepted') el.remove();
          });
        } else if (isAndroid) {
          el.querySelector('.pwa-install-banner__text').textContent = 'Meniu (⋮) → Adaugă pe ecranul principal';
        } else {
          el.querySelector('.pwa-install-banner__text').textContent = 'Meniu browser → Instalează aplicația';
        }
      });
    }

    el.querySelector('.pwa-install-banner__dismiss').addEventListener('click', function () {
      dismiss(el);
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }
})();
