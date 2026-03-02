# PWA Icons & Install Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Asigurarea unei experiențe de instalare PWA corecte pe orice platformă (iOS, Android, desktop Chrome/Edge) cu iconuri dedicate, pătrate, și fără UI-ul browser-ului.

**Architecture:** Generăm iconurile programatic dintr-un template SVG cu branding ONE21, folosind Playwright pentru render PNG. Actualizăm manifest.json cu toate variantele necesare, adăugăm meta tags în toate paginile HTML, și reparăm install-banner.js.

**Tech Stack:** Playwright (icon generation), SVG, Node.js, Express static files

---

### Task 1: Generare iconuri PWA via Playwright

**Files:**
- Create: `scripts/generate-icons.js`
- Create: `public/icons/` (directory)

**Step 1: Creează scriptul de generare**

```js
// scripts/generate-icons.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#040404"/>
  <!-- Subtle radial glow -->
  <radialGradient id="glow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#00e676" stop-opacity="0.08"/>
    <stop offset="100%" stop-color="#040404" stop-opacity="0"/>
  </radialGradient>
  <rect width="512" height="512" fill="url(#glow)"/>
  <!-- "ONE" box -->
  <rect x="110" y="180" width="180" height="72" fill="none" stroke="#00e676" stroke-width="2.5"
    style="clip-path:polygon(0 8px,8px 0,calc(100% - 8px) 0,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0 calc(100% - 8px))"/>
  <text x="200" y="233" font-family="monospace" font-size="52" font-weight="700"
    fill="#00e676" text-anchor="middle" letter-spacing="6">ONE</text>
  <!-- "_21" suffix -->
  <text x="316" y="244" font-family="monospace" font-size="32" font-weight="400"
    fill="#888" text-anchor="start" letter-spacing="2">_21</text>
  <!-- Subtitle -->
  <text x="256" y="300" font-family="monospace" font-size="18" font-weight="400"
    fill="#444" text-anchor="middle" letter-spacing="4">NEURAL LINK</text>
  <!-- Corner accents -->
  <path d="M40 40 L40 80 M40 40 L80 40" stroke="#00e676" stroke-width="2" opacity="0.4"/>
  <path d="M472 472 L472 432 M472 472 L432 472" stroke="#00e676" stroke-width="2" opacity="0.4"/>
</svg>`;

// Maskable version — same design dar cu 10% safe zone padding (icon fills only 80% of space)
const maskableSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#040404"/>
  <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#00e676" stop-opacity="0.08"/>
    <stop offset="100%" stop-color="#040404" stop-opacity="0"/>
  </radialGradient>
  <rect width="512" height="512" fill="url(#glow2)"/>
  <!-- Same content but scaled to 80% (safe zone) — padding 51px on each side -->
  <g transform="translate(51,51) scale(0.8)">
    <rect x="110" y="180" width="180" height="72" fill="none" stroke="#00e676" stroke-width="3"
      style="clip-path:polygon(0 8px,8px 0,calc(100% - 8px) 0,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0 calc(100% - 8px))"/>
    <text x="200" y="233" font-family="monospace" font-size="52" font-weight="700"
      fill="#00e676" text-anchor="middle" letter-spacing="6">ONE</text>
    <text x="316" y="244" font-family="monospace" font-size="32" font-weight="400"
      fill="#888" text-anchor="start" letter-spacing="2">_21</text>
    <text x="256" y="300" font-family="monospace" font-size="18" font-weight="400"
      fill="#444" text-anchor="middle" letter-spacing="4">NEURAL LINK</text>
  </g>
</svg>`;

async function generateIcons() {
  const iconsDir = path.join(__dirname, '../public/icons');
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const sizes = [
    { name: 'icon-512.png',          svg: iconSvg,     size: 512 },
    { name: 'icon-192.png',          svg: iconSvg,     size: 192 },
    { name: 'icon-maskable-512.png', svg: maskableSvg, size: 512 },
    { name: 'apple-touch-icon.png',  svg: iconSvg,     size: 180 },
  ];

  for (const { name, svg, size } of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;padding:0;background:#040404">${svg}</body></html>`);
    await page.waitForTimeout(200);
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
    fs.writeFileSync(path.join(iconsDir, name), buf);
    console.log(`✓ ${name} (${size}x${size})`);
  }

  // favicon.svg — copy standard icon
  fs.writeFileSync(path.join(__dirname, '../public/favicon.svg'), iconSvg.trim());
  console.log('✓ favicon.svg');

  await browser.close();
  console.log('\nToate iconurile generate în public/icons/');
}

generateIcons().catch(console.error);
```

**Step 2: Rulează scriptul**

```bash
cd /Users/victorsafta/onechat
node scripts/generate-icons.js
```

Rezultat așteptat:
```
✓ icon-512.png (512x512)
✓ icon-192.png (192x192)
✓ icon-maskable-512.png (512x512)
✓ apple-touch-icon.png (180x180)
✓ favicon.svg
Toate iconurile generate în public/icons/
```

Verifică că fișierele există:
```bash
ls -la public/icons/
```

**Step 3: Commit**

```bash
git add scripts/generate-icons.js public/icons/ public/favicon.svg
git commit -m "feat(pwa): generate proper square icons for all platforms"
```

---

### Task 2: Actualizare manifest.json

**Files:**
- Modify: `public/manifest.json`

**Step 1: Înlocuiește conținutul manifest.json**

```json
{
  "name": "ONE21",
  "short_name": "ONE21",
  "description": "Neural Access Terminal — ONE21 Chat",
  "start_url": "/one21/hey",
  "scope": "/one21/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#040404",
  "theme_color": "#040404",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

**Note:** `theme_color` schimbat din `#00e676` în `#040404` — pe Android aceasta colorează bara de stare a OS-ului. Verde e prea agresiv; negru e mai potrivit pentru o app de tip terminal.

**Step 2: Commit**

```bash
git add public/manifest.json
git commit -m "feat(pwa): update manifest with correct icons and scope"
```

---

### Task 3: Apple Touch Icon + Favicon în toate paginile HTML

**Files:**
- Modify: `public/login.html`
- Modify: `public/chat.html`
- Modify: `public/admin.html`
- Modify: `public/index.html`
- Modify: `public/one21/join.html`

**Step 1: Adaugă în `<head>` pe FIECARE pagină HTML**

Imediat după `<meta charset="UTF-8">`, adaugă:

```html
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
```

**Verifică că `<link rel="manifest">` există deja** pe fiecare pagină. Dacă nu există, adaugă și:
```html
<link rel="manifest" href="/manifest.json">
```

**Step 2: Verifică în browser că favicon apare**

Navighează la `http://localhost:3737/login.html` și verifică tab-ul browser-ului — trebuie să apară iconul ONE21.

**Step 3: Commit**

```bash
git add public/login.html public/chat.html public/admin.html public/index.html public/one21/join.html
git commit -m "feat(pwa): add apple-touch-icon and svg favicon to all pages"
```

---

### Task 4: Fix install-banner.js

**Files:**
- Modify: `public/js/install-banner.js`

**Probleme de rezolvat:**
1. Banner apare doar pe mobile — trebuie să apară și pe desktop (Chrome/Edge suportă PWA install)
2. Bug: blocul `else if (/Android/i.test...)` e duplicat (liniile 45 și 47)
3. iOS Safari: instrucțiunea e înlocuită în text dar bannerul nu are un design dedicat pentru asta

**Step 1: Înlocuiește complet `public/js/install-banner.js`**

```js
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
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>' +
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
```

**Step 2: Commit**

```bash
git add public/js/install-banner.js
git commit -m "fix(pwa): fix install-banner for desktop + iOS + remove duplicate Android check"
```

---

### Task 5: Verificare finală

**Step 1: Testează pe desktop Chrome**

Navighează la `http://platonos.mooo.com:3737/one21/hey`. În bara de adresă Chrome trebuie să apară iconița de install (computer cu săgeată în jos). Click pe ea → trebuie să instaleze app-ul cu iconul ONE21.

**Step 2: Testează cu Lighthouse PWA audit**

În Chrome DevTools → Lighthouse → selectează "Progressive Web App" → Run. Scorul trebuie să fie verde pe:
- Installable: ✓
- PWA Optimized: ✓

**Step 3: Verifică manifest în DevTools**

Application → Manifest → verifică că toate iconurile se încarcă (fără erori roșii).

**Step 4: Commit final dacă sunt ajustări minore**

```bash
git add -p
git commit -m "fix(pwa): final adjustments after verification"
```

---

### Sumar fișiere create/modificate

| Acțiune | Fișier |
|---------|--------|
| Create | `scripts/generate-icons.js` |
| Create | `public/icons/icon-192.png` |
| Create | `public/icons/icon-512.png` |
| Create | `public/icons/icon-maskable-512.png` |
| Create | `public/icons/apple-touch-icon.png` |
| Create | `public/favicon.svg` |
| Modify | `public/manifest.json` |
| Modify | `public/login.html` |
| Modify | `public/chat.html` |
| Modify | `public/admin.html` |
| Modify | `public/index.html` |
| Modify | `public/one21/join.html` |
| Modify | `public/js/install-banner.js` |
