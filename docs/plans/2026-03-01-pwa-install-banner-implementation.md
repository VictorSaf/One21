# PWA Install Banner — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pe toate paginile ONE21 accesate de pe mobil, utilizatorul vede un banner „Instalează pentru o experiență mai bună” și poate instala aplicația ca PWA (display standalone, fără header browser).

**Architecture:** Manifest JSON + install banner component + service worker minimal (cache-first pentru resurse statice). Banner se afișează doar pe mobile, nu în standalone; Chrome folosește beforeinstallprompt, Safari arată instrucțiuni.

**Tech Stack:** Vanilla JS, Express (statice), Web App Manifest, Service Worker API, localStorage.

**Design doc:** `docs/plans/2026-03-01-pwa-install-banner-design.md`

---

## Task 1: Web App Manifest

**Files:**
- Create: `public/manifest.json`
- Create: `public/icons/icon-192.png` (sau folosește logo.png dacă există 192×192)
- Create: `public/icons/icon-512.png` (sau placeholder)

**Step 1: Creează manifest.json**

```json
{
  "name": "ONE21",
  "short_name": "ONE21",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#040404",
  "theme_color": "#00e676",
  "scope": "/",
  "icons": [
    {
      "src": "/logo.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/logo.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    }
  ]
}
```

> Dacă logo.png nu e 192×192 sau 512×512, creează iconuri separate în `public/icons/` (sau folosește logo.png — unele browsere scalează). Pentru deploy, generează iconuri la dimensiuni corecte.

**Step 2: Serve manifest cu MIME corect**

Verifică că Express servește `manifest.json` cu `Content-Type: application/manifest+json`. Dacă `express.static('public')` îl servește, verifică extensia. Alternativ, adaugă ruta explicită în server.js dacă e necesar.

**Step 3: Commit**

```bash
git add public/manifest.json
git commit -m "feat(pwa): add Web App Manifest"
```

---

## Task 2: Install banner component — JS logic

**Files:**
- Create: `public/js/install-banner.js`

**Step 1: Creează install-banner.js**

```javascript
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
})();
```

**Step 2: Înregistrează service worker (opțional în același fișier, după banner)**

```javascript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function () {});
}
```

Adaugă această secțiune la sfârșitul IIFE din `install-banner.js`.

**Step 3: Commit**

```bash
git add public/js/install-banner.js
git commit -m "feat(pwa): add install banner logic"
```

---

## Task 3: Install banner — CSS (components.css)

**Files:**
- Modify: `public/css/layers/components.css`

**Step 1: Adaugă reguli pentru .pwa-install-banner**

La sfârșitul layer-ului `components`, adaugă:

```css
.pwa-install-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-surface);
  border-top: 1px solid var(--border-dim);
  z-index: var(--z-sticky);
  box-shadow: 0 -4px 12px var(--shadow-overlay);
}

.pwa-install-banner__text {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--text-primary);
}

.pwa-install-banner__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.pwa-install-banner__install { flex-shrink: 0; }
.pwa-install-banner__dismiss { flex-shrink: 0; min-width: 44px; min-height: 44px; }
```

**Step 2: Rulează audit CSS**

```bash
bash scripts/audit-css.sh
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add public/css/layers/components.css
git commit -m "feat(pwa): add install banner styles"
```

---

## Task 4: Service worker

**Files:**
- Create: `public/sw.js`

**Step 1: Creează sw.js**

```javascript
const CACHE_VERSION = 'one21-v1';
const CACHE_NAME = 'one21-static-' + CACHE_VERSION;

const ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/chat.html',
  '/admin.html',
  '/one21/join.html',
  '/css/design-system.css',
  '/css/layers/components.css',
  '/css/layers/pages/index.css',
  '/css/layers/pages/login.css',
  '/css/layers/pages/join.css',
  '/css/layers/pages/chat.css',
  '/css/layers/pages/admin.css',
  '/manifest.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.startsWith('one21-static-') && k !== CACHE_NAME;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.url.indexOf('/api/') !== -1) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request);
    })
  );
});
```

**Step 2: Asigură-te că sw.js e servit la `/sw.js`**

Express cu `express.static('public')` servește `public/sw.js` la `/sw.js`. Verifică că nu există rute care capturează `/sw.js` înainte de static.

**Step 3: Commit**

```bash
git add public/sw.js
git commit -m "feat(pwa): add service worker"
```

---

## Task 5: Integrare în paginile ONE21

**Files:**
- Modify: `public/index.html`
- Modify: `public/login.html`
- Modify: `public/one21/join.html`
- Modify: `public/chat.html`
- Modify: `public/admin.html`

**Step 1: Adaugă în &lt;head&gt; pe fiecare pagină**

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#00e676">
```

**Step 2: Adaugă script înainte de &lt;/body&gt;**

```html
<script src="/js/install-banner.js"></script>
```

Aplică pentru: index.html, login.html, one21/join.html, chat.html, admin.html. Poziționează după conținut, înainte de orice script inline existent (sau după, în funcție de ordinea dorită).

**Step 3: Verificare manuală**

Deschide localhost pe un device mobil sau emulator Chrome (responsive mode), verifică că bannerul apare. Dacă e standalone, nu ar trebui să apară.

**Step 4: Commit**

```bash
git add public/index.html public/login.html public/one21/join.html public/chat.html public/admin.html
git commit -m "feat(pwa): integrate manifest and install banner on all ONE21 pages"
```

---

## Task 6: Verificare finală

**Step 1: Audit CSS**

```bash
bash scripts/audit-css.sh
```

**Step 2: Test pe Chrome Android / iOS Safari**

- Banner vizibil pe mobile
- La click „Instalează” — prompt nativ (Chrome) sau instrucțiuni (Safari)
- După instalare — display standalone, fără URL bar
- Dismiss — banner dispare, nu reapare 7 zile

**Step 3: Commit final dacă totul e ok**

---

## Principii

- Tokeni CSS (`var(--*)`) — zero culori hardcodate în CSS
- `scripts/audit-css.sh` trebuie să treacă
- Nu modifica fluxul existent join/login/chat/admin; doar adaugă link + script
