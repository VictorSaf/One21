# Design: Chat — UX Mobile Optimizat

> Date: 2026-03-01 | Status: Approved  
> Context: Optimizare servicii ONE21 — prioritate 1: mobile UX (admin creează users, comunică inclusiv pe mobile)

## Obiectiv

Îmbunătățirea experienței mobile pentru chat: tap targets conform WCAG, info-panel accesibil pe ecran mic, curățare CSS mort.

## Ordine fazelor (plan general)

| # | Fază | Motiv |
|---|------|-------|
| 1 | **UX mobile** (acest doc) | Nevoie urgentă |
| 2 | Arhitectură cod | Refactor chat.js, server.js |
| 3 | Performanță | Virtualizare mesaje, lazy load |

## Abordare aleasă

**Fix + polish** — modificări minime pe cod existent, fără redesign major.

---

## Secțiunea 1: Layout și navigare

| Element | Comportament |
|---------|--------------|
| **Sidebar** | Rămâne overlay cu `sidebar--open`. La load pe mobile: sidebar deschis. |
| **Info-panel** | La ≤900px: overlay slide-in din dreapta cu backdrop (nu `display: none`). |
| **Hamburger** | Opțional; logo/back button acoperă navigarea. |
| **Mobile-nav** | Nu se implementează. Eliminăm stilurile și `padding-bottom: 56px`. |

---

## Secțiunea 2: Tap targets (WCAG ~44×44px)

| Element | Modificare |
|---------|------------|
| `.chat-item` | `min-height: 52px`, `padding: var(--sp-2) var(--sp-3)` |
| `.mobile-back-btn` | Min `44×44px`, `padding: var(--sp-2)` |
| `.panel-header .btn--icon` (≤640px) | Min `44×44px` |
| `.compose__send`, `.attachBtn` | Min `44×44px` |
| `.sidebar__section-label button` | Min `44×44px` pe mobile |
| `.info-panel__section button` | Min-height 44px pe mobile |

Fișiere: `components.css` (în media queries), eventual `chat.css` pentru override-uri specifice.

---

## Secțiunea 3: Info-panel pe mobile

| Aspect | Specificație |
|--------|--------------|
| Breakpoint | ≤900px: info-panel overlay (nu ascuns) |
| Backdrop | `.info-panel-backdrop` existent; vizibil la ≤900px |
| Animație | `transform: translateX(100%)` → `translateX(0)`, `transition: 0.22s ease` |
| Lățime | `min(360px, 90vw)` pe mobile |
| Close | Click backdrop sau buton CLOSE |

Modificări: în `components.css` la `@media (max-width: 900px)` înlocuim `display: none` pe `.info-panel` cu reguli overlay + animație. HTML și `toggleInfoPanel()` neschimbate.

---

## Secțiunea 4: Curățare CSS mort

| Element | Acțiune |
|---------|---------|
| `.mobile-nav` | Eliminat din CSS (nepopulat) |
| `.app { padding-bottom: 56px }` | Eliminat din breakpoint 640px |

---

## Secțiunea 5: Edge cases

| Caz | Comportament |
|-----|--------------|
| Resize desktop ↔ mobile | La `resize`, dacă width ≤640px și nu e room selectat, sidebar deschis |
| Info-panel + resize | La >900px, închidere info-panel dacă e deschis (opțional) |
| Tap rapid chat-item | Event delegation existentă; fără modificări |

---

## Fișiere afectate

| Fișier | Modificări |
|--------|------------|
| `public/css/layers/components.css` | Media 640px/900px: tap targets, info-panel overlay, curățare mobile-nav |
| `public/css/layers/pages/chat.css` | Eventual override tap targets specifice chat |
| `public/js/chat.js` | Eventual `resize` handler pentru sidebar (minimal) |

---

## Principii

- Tokeni CSS (`var(--*)`) — zero culori hardcodate
- Zero modificări HTML structurale
- `scripts/audit-css.sh` trebuie să treacă după modificări
