# Design: PWA Install Banner — Instalare aplicație pe mobil

> Date: 2026-03-01 | Status: Approved  
> Context: Pe toate paginile ONE21 accesate de pe mobil, utilizatorul are opțiunea „Instalează aplicația” pentru vizibilitate mai bună și lipsa header-ului browserului.

## Obiectiv

Permiterea instalării ONE21 ca PWA pe mobil: display standalone (fără URL bar), banner persistent cu prompt nativ, plus service worker minimal pentru lansare rapidă din home screen.

## Abordare aleasă

**Standard** — Manifest + banner + service worker minimal (fără offline complet).

---

## Secțiunea 1: Arhitectură

| Componentă | Rol |
|------------|-----|
| **manifest.json** | `display: "standalone"`, icon pe home screen, theme/background color |
| **Install banner** | Text „Instalează pentru o experiență mai bună” + buton; trigger prompt nativ (Chrome) sau instrucțiuni (Safari) |
| **Service worker** | Cache HTML/CSS/JS pentru lansare rapidă din home screen |

**Fișiere:** `public/manifest.json`, `public/sw.js`, `public/js/install-banner.js`, modificări în paginile ONE21.

---

## Secțiunea 2: Web App Manifest

| Câmp | Valoare |
|------|---------|
| `name` | ONE21 |
| `short_name` | ONE21 |
| `start_url` | / |
| `display` | standalone |
| `background_color` | Valoare din token (ex. #0d0d0d) |
| `theme_color` | Valoare din token accent |
| `scope` | / |
| `icons` | 192×192, 512×512 PNG |

---

## Secțiunea 3: Install Banner Component

| Aspect | Specificație |
|--------|--------------|
| Locație | Fix jos (sau sus), discret |
| Conținut | „Instalează pentru o experiență mai bună” + buton „Instalează” |
| Vizibilitate | Doar pe mobile |
| Condiții | Nu standalone; nu dismissed recent (localStorage) |
| La click | Chrome: `prompt.prompt()`; Safari: instrucțiuni „Share → Add to Home Screen” |
| Dismiss | X / „Mai târziu”; localStorage `pwa-dismissed-at` (7 zile) |
| Stil | Tokeni CSS în `components.css` |

---

## Secțiunea 4: Service Worker (minim)

| Aspect | Specificație |
|--------|--------------|
| Cache strategy | Cache-first pentru HTML/CSS/JS; network pentru `/api/*` |
| Versiune | CACHE_VERSION pentru invalidare la update |
| Resurse | Pagini HTML, design-system, theme, pagini CSS, JS |
| Offline | Nu — la lipsă rețea, comportament standard browser |

---

## Secțiunea 5: Integrare pagini ONE21

Pagini: `index.html`, `login.html`, `public/one21/join.html`, `chat.html`, `admin.html`.

Fiecare: `<link rel="manifest" href="/manifest.json">` + `<script src="/js/install-banner.js"></script>`.

---

## Secțiunea 6: Edge cases

| Caz | Comportament |
|-----|--------------|
| Already standalone | Nu afișa banner |
| Dismissed &lt; 7 zile | Nu afișa |
| SW registration fails | Catch; pagina funcționează; banner rămâne |
| Safari (fără beforeinstallprompt) | Instrucțiuni text |
| Desktop | Nu afișa banner |
| HTTPS | Necesar în producție |

---

## Fișiere afectate

| Fișier | Modificări |
|--------|------------|
| `public/manifest.json` | Nou |
| `public/sw.js` | Nou |
| `public/js/install-banner.js` | Nou |
| `public/css/layers/components.css` | Clase banner |
| `public/index.html`, `login.html`, `chat.html`, `admin.html`, `one21/join.html` | Link manifest + script banner |
