# PWA Install Per Environment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Butonul "Instalează" să funcționeze corect pe orice browser/OS — fie prin `beforeinstallprompt` nativ (Chrome/Edge cu HTTPS), fie printr-un modal vizual cu instrucțiuni pas-cu-pas specific per mediu detectat.

**Architecture:** Extindem `install-banner.js` cu detecție precisă a mediului (9 cazuri distincte) și un modal overlay care se deschide când `beforeinstallprompt` nu e disponibil. Modalul refolosește clasele `.modal` existente din design-system. Caddyfile-ul e actualizat cu domeniul real pentru HTTPS.

**Tech Stack:** Vanilla JS, CSS @layer components (existing modal classes), Caddy (HTTPS)

---

### Task 1: Detecție mediu + modal instrucțiuni în install-banner.js

**Files:**
- Modify: `public/js/install-banner.js`
- Modify: `public/css/layers/components.css` (adaugă stiluri `.pwa-modal-steps`)

**Context:**
- Codul curent: când `deferredPrompt` e null, schimbă text în banner → invizibil/ignorat de user
- Fix: deschide un modal centrat cu pași vizuali specifici mediului detectat
- Clasele modale existente: `.modal`, `.modal-overlay`, `.modal__header`, `.modal__body`, `.modal__footer`
- Nu folosi `style=` inline — adaugă clase CSS

**Step 1: Înlocuiește complet `public/js/install-banner.js`**

```js
(function () {
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (navigator.standalone === true) return;

  const dismissed = localStorage.getItem('pwa-dismissed-at');
  if (dismissed && Date.now() - parseInt(dismissed, 10) < 7 * 24 * 60 * 60 * 1000) return;

  // --- Detecție mediu ---
  function detectEnv() {
    var ua = navigator.userAgent;
    var isIOS     = /iphone|ipad|ipod/i.test(ua);
    var isAndroid = /Android/i.test(ua);
    var isSafari  = /Safari/.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua) && !/FxiOS/.test(ua);
    var isChrome  = /Chrome/.test(ua) && !/Edg\//.test(ua) && !/OPR/.test(ua);
    var isEdge    = /Edg\//.test(ua);
    var isFirefox = /Firefox/.test(ua) || /FxiOS/.test(ua);
    var isSamsung = /SamsungBrowser/.test(ua);
    var isMac     = /Macintosh/.test(ua);

    if (isIOS && isSafari)                  return 'ios-safari';
    if (isIOS && (isChrome || isEdge))      return 'ios-chrome';
    if (isIOS)                              return 'ios-other';
    if (isAndroid && isSamsung)             return 'android-samsung';
    if (isAndroid)                          return 'android-chrome';
    if (isMac && isSafari)                  return 'desktop-safari';
    if (isFirefox)                          return 'desktop-firefox';
    if (isChrome || isEdge)                 return 'desktop-chromium';
    return 'desktop-other';
  }

  // --- Instrucțiuni per mediu ---
  var ENV_INSTRUCTIONS = {
    'ios-safari': {
      title: 'Instalează ONE21 pe iPhone / iPad',
      steps: [
        'Apasă <strong>Share</strong> <svg class="pwa-modal-steps__icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg> din bara de jos',
        'Scroll și apasă <strong>Add to Home Screen</strong>',
        'Confirmă cu <strong>Add</strong> în colțul dreapta sus'
      ]
    },
    'ios-chrome': {
      title: 'Instalare necesită Safari',
      steps: [
        'Chrome pe iOS nu poate instala aplicații web',
        'Deschide <strong>Safari</strong> și accesează același link',
        'Share <svg class="pwa-modal-steps__icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg> → <strong>Add to Home Screen</strong>'
      ]
    },
    'ios-other': {
      title: 'Instalare necesită Safari',
      steps: [
        'Browserul curent nu suportă instalarea aplicațiilor web pe iOS',
        'Deschide <strong>Safari</strong> și accesează același link',
        'Share → <strong>Add to Home Screen</strong>'
      ]
    },
    'android-samsung': {
      title: 'Instalează ONE21',
      steps: [
        'Apasă meniul <strong>⋮</strong> din colțul dreapta sus',
        'Apasă <strong>Add page to</strong> → <strong>Home screen</strong>',
        'Confirmă cu <strong>Add</strong>'
      ]
    },
    'android-chrome': {
      title: 'Instalează ONE21',
      steps: [
        'Apasă meniul <strong>⋮</strong> din colțul dreapta sus',
        'Apasă <strong>Add to Home Screen</strong> sau <strong>Install app</strong>',
        'Confirmă instalarea'
      ]
    },
    'desktop-safari': {
      title: 'Adaugă ONE21 în Dock',
      steps: [
        'Click meniu <strong>File</strong> din bara de meniu macOS',
        'Click <strong>Add to Dock…</strong>',
        'Confirmă cu <strong>Add</strong>'
      ],
      note: 'Necesită macOS Sonoma (14) sau mai recent'
    },
    'desktop-firefox': {
      title: 'Folosește Chrome sau Edge',
      steps: [
        'Firefox nu suportă instalarea aplicațiilor web',
        'Deschide <strong>Google Chrome</strong> sau <strong>Microsoft Edge</strong>',
        'Accesează același link — iconița de instalare apare în bara de adresă'
      ]
    },
    'desktop-chromium': {
      title: 'Instalează ONE21',
      steps: [
        'Click iconița <strong>⊕</strong> din bara de adresă (dreapta)',
        'Sau: Meniu <strong>⋮</strong> → <strong>Save and share</strong> → <strong>Install page as app…</strong>',
        'Click <strong>Install</strong> în dialogul care apare'
      ],
      note: 'Dacă iconița nu apare, asigură-te că site-ul e accesat prin HTTPS'
    },
    'desktop-other': {
      title: 'Instalează ONE21',
      steps: [
        'Deschide <strong>Google Chrome</strong> sau <strong>Microsoft Edge</strong>',
        'Accesează același link',
        'Click iconița de instalare <strong>⊕</strong> din bara de adresă'
      ]
    }
  };

  var env = detectEnv();
  var info = ENV_INSTRUCTIONS[env] || ENV_INSTRUCTIONS['desktop-other'];
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
  });

  // --- Modal ---
  function openModal() {
    var existing = document.getElementById('pwa-install-modal');
    if (existing) { existing.removeAttribute('hidden'); return; }

    var stepsHtml = info.steps.map(function (step, i) {
      return '<li class="pwa-modal-steps__item">' +
        '<span class="pwa-modal-steps__num">' + (i + 1) + '</span>' +
        '<span class="pwa-modal-steps__text">' + step + '</span>' +
        '</li>';
    }).join('');

    var noteHtml = info.note
      ? '<p class="pwa-modal-steps__note">' + info.note + '</p>'
      : '';

    var modal = document.createElement('div');
    modal.id = 'pwa-install-modal';
    modal.innerHTML =
      '<div class="modal-overlay pwa-modal-overlay"></div>' +
      '<div class="modal pwa-modal" role="dialog" aria-modal="true" aria-labelledby="pwa-modal-title">' +
        '<div class="modal__header">' +
          '<span class="modal__header-icon">⊕</span>' +
          '<h2 class="modal__title" id="pwa-modal-title">' + info.title + '</h2>' +
          '<button type="button" class="btn btn--ghost btn--icon btn--sm pwa-modal__close" aria-label="Închide">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="modal__body">' +
          '<ol class="pwa-modal-steps">' + stepsHtml + '</ol>' +
          noteHtml +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    modal.querySelector('.pwa-modal-overlay').addEventListener('click', closeModal);
    modal.querySelector('.pwa-modal__close').addEventListener('click', closeModal);
  }

  function closeModal() {
    var modal = document.getElementById('pwa-install-modal');
    if (modal) modal.setAttribute('hidden', '');
  }

  // --- Banner ---
  function showBanner() {
    var el = document.createElement('div');
    el.className = 'pwa-install-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Instalare aplicație');

    if (env === 'ios-safari' || env === 'ios-chrome' || env === 'ios-other') {
      // iOS: nu există beforeinstallprompt — arată Share icon direct
      el.innerHTML =
        '<p class="pwa-install-banner__text">' +
          '<svg class="pwa-install-banner__share-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>' +
          'Instalează ONE21 — Share → Add to Home Screen' +
        '</p>' +
        '<div class="pwa-install-banner__actions">' +
          '<button type="button" class="btn btn--primary btn--sm pwa-install-banner__install">Cum?</button>' +
          '<button type="button" class="btn btn--ghost btn--icon btn--sm pwa-install-banner__dismiss" aria-label="Închide">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>';
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

    el.querySelector('.pwa-install-banner__install').addEventListener('click', function () {
      if (deferredPrompt) {
        // Chromium cu HTTPS: dialog nativ
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (choice) {
          deferredPrompt = null;
          if (choice.outcome === 'accepted') el.remove();
        });
      } else {
        // Orice alt caz: modal cu instrucțiuni
        openModal();
      }
    });

    el.querySelector('.pwa-install-banner__dismiss').addEventListener('click', function () {
      localStorage.setItem('pwa-dismissed-at', String(Date.now()));
      el.remove();
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
```

**Step 2: Adaugă stiluri modal în `public/css/layers/components.css`**

Găsește blocul `@layer components { }` și adaugă la sfârșit, înainte de `}`:

```css
/* --- PWA Install Modal --- */
.pwa-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  z-index: var(--z-overlay);
}

.pwa-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: var(--z-modal);
  width: min(420px, calc(100vw - var(--sp-8)));
  max-height: 90vh;
  overflow-y: auto;
}

.modal__header-icon {
  font-size: var(--font-lg);
  color: var(--accent);
  margin-right: var(--sp-2);
}

.pwa-modal__close {
  margin-left: auto;
}

.pwa-modal-steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.pwa-modal-steps__item {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
}

.pwa-modal-steps__num {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border-accent);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  font-weight: 700;
}

.pwa-modal-steps__text {
  padding-top: var(--sp-1);
  font-size: var(--font-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.pwa-modal-steps__note {
  margin-top: var(--sp-4);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-elevated);
  border: 1px solid var(--border-dim);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.pwa-modal-steps__icon-inline {
  vertical-align: middle;
  margin: 0 var(--sp-1);
}

#pwa-install-modal[hidden] {
  display: none;
}
```

**Step 3: Verifică vizual în browser**

```bash
# Serverul e deja pornit pe port 3737
# Navighează la http://localhost:3737/one21/hey
# Click pe "Instalează" în banner
# Trebuie să apară un modal centrat cu 3 pași numerotați
```

**Step 4: Commit**

```bash
cd /Users/victorsafta/onechat
git add public/js/install-banner.js public/css/layers/components.css
git commit -m "feat(pwa): show install instructions modal per browser/OS environment"
```

---

### Task 2: HTTPS via Caddy — configurare domeniu real

**Files:**
- Modify: `Caddyfile`

**Context:**
- Caddyfile-ul are `one21.yourdomain.com` ca placeholder — nu e activ
- Domeniu real: `platonos.mooo.com`
- Caddy gestionează automat certificatul Let's Encrypt
- HTTPS e OBLIGATORIU pentru ca `beforeinstallprompt` să se declanșeze nativ pe Chrome/Edge

**Step 1: Actualizează Caddyfile**

Înlocuiește `one21.yourdomain.com` cu `platonos.mooo.com`:

```
platonos.mooo.com {
    reverse_proxy localhost:3737 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    encode gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }

    @uploads path /uploads/*
    header @uploads Cache-Control "public, max-age=31536000, immutable"

    @static path *.css *.js *.png *.jpg *.jpeg *.gif *.ico *.woff2 *.svg
    header @static Cache-Control "public, max-age=86400"

    log {
        output file /var/log/caddy/one21.log
        format json
    }
}
```

**Step 2: Commit Caddyfile**

```bash
git add Caddyfile
git commit -m "feat(infra): configure Caddy for platonos.mooo.com with HTTPS"
```

**Step 3: Activare pe server**

Dacă Caddy e instalat pe mașina care servește aplicația:

```bash
# Verifică Caddy instalat
caddy version

# Pornește/reîncarcă Caddy
caddy run --config Caddyfile
# SAU dacă rulează deja:
caddy reload --config Caddyfile

# Verifică că HTTPS funcționează
curl -I https://platonos.mooo.com/one21/hey
# Trebuie să returneze 200 cu header Strict-Transport-Security
```

**Step 4: Testează `beforeinstallprompt` pe HTTPS**

Navighează la `https://platonos.mooo.com/one21/hey` în Chrome Desktop sau Android Chrome:
- Trebuie să apară iconița de instalare ⊕ în bara de adresă Chrome
- Click pe "Instalează" în banner → trebuie să declanșeze dialogul nativ Chrome (nu modal-ul)

**Note:** Dacă Caddy nu e instalat sau portul 80/443 nu e disponibil pe această mașină, Task 2 e opțional — modal-ul din Task 1 funcționează independent pe HTTP.

---

### Sumar

| Task | Fișiere | Rezultat |
|------|---------|---------|
| 1 | `install-banner.js`, `components.css` | Modal vizual per mediu — funcționează pe HTTP și HTTPS |
| 2 | `Caddyfile` | HTTPS activ → `beforeinstallprompt` nativ pe Chrome/Edge/Android |
