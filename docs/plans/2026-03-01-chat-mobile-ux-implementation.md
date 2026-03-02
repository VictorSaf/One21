# Chat Mobile UX — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Îmbunătățește experiența mobile pentru chat: tap targets 44×44px, info-panel accesibil pe ecran mic, curățare CSS mort.

**Architecture:** Modificări CSS în media queries existente (`components.css`, `chat.css`). Info-panel devine overlay la ≤900px în loc de `display: none`. Zero modificări HTML structurale.

**Tech Stack:** Vanilla CSS (@layer, tokeni), Vanilla JS (eventual resize handler minim)

**Design doc:** `docs/plans/2026-03-01-chat-mobile-ux-design.md`

---

## Task 1: Info-panel vizibil pe mobile (≤900px)

**Files:**
- Modify: `public/css/layers/components.css` — în `@media (max-width: 900px)`

**Context:** Info-panel are deja `position: fixed`, `transform: translateX(100%)`, `.info-panel--open` → `translateX(0)`. La 900px era `display: none` și îl ascundea complet.

**Step 1: Înlocuiește display:none cu width override**

În `@media (max-width: 900px)`, înlocuiește:
```css
.info-panel { display: none; }
```

cu:
```css
.info-panel {
  width: min(360px, 90vw);
  min-width: unset;
}
```

**Step 2: Verificare**

Deschide chat pe mobile (resize la 900px sau DevTools device mode). Click pe icon info din header. Info-panel trebuie să apară slide-in din dreapta. Click pe backdrop → închide.

**Step 3: Audit CSS**

```bash
bash scripts/audit-css.sh
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add public/css/layers/components.css
git commit -m "feat(chat): info-panel overlay pe mobile (≤900px)"
```

---

## Task 2: Tap targets — chat-item, mobile-back-btn, compose

**Files:**
- Modify: `public/css/layers/components.css` — în `@media (max-width: 640px)`

**Step 1: Adaugă tap targets în breakpoint 640px**

În interiorul `@media (max-width: 640px)`, adaugă:

```css
/* Tap targets min 44×44px (WCAG) */
.chat-item {
  min-height: 52px;
  padding: var(--sp-2) var(--sp-3);
}

.mobile-back-btn {
  min-width: 44px;
  min-height: 44px;
  padding: var(--sp-2);
}

.panel-header .btn--icon {
  min-width: 44px;
  min-height: 44px;
}

.compose__send,
#attachBtn,
.compose .btn--icon {
  min-width: 44px;
  min-height: 44px;
}

.sidebar__section-label button {
  min-width: 44px;
  min-height: 44px;
}
```

**Step 2: Verificare**

Testează pe viewport 640px: chat-item, back button, butoane header, compose send, attach — toate ușor de apăsat.

**Step 3: Audit CSS**

```bash
bash scripts/audit-css.sh
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add public/css/layers/components.css
git commit -m "feat(chat): tap targets 44×44px pe mobile"
```

---

## Task 3: Curățare CSS mort — mobile-nav

**Files:**
- Modify: `public/css/layers/components.css` — `@media (max-width: 640px)`

**Step 1: Elimină .mobile-nav și padding-bottom**

În `@media (max-width: 640px)`:
- Șterge blocul complet `.mobile-nav { ... }`
- Șterge `.app { padding-bottom: 56px; }`

**Step 2: Verificare**

Layout-ul pe mobile rămâne funcțional. Nu există spațiu gol în partea de jos.

**Step 3: Audit CSS**

```bash
bash scripts/audit-css.sh
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add public/css/layers/components.css
git commit -m "chore(chat): curățare CSS mort .mobile-nav"
```

---

## Task 4: Resize handler pentru sidebar (opțional)

**Files:**
- Modify: `public/js/chat.js` — în `initMobileLayout()`

**Step 1: Adaugă resize listener**

După codul existent din `initMobileLayout()`, adaugă:

```javascript
let resizeTicking = false;
window.addEventListener('resize', () => {
  if (resizeTicking) return;
  resizeTicking = true;
  requestAnimationFrame(() => {
    if (window.innerWidth <= 640 && !currentRoomId && sidebar) {
      sidebar.classList.add('sidebar--open');
    }
    resizeTicking = false;
  });
});
```

**Step 2: Verificare**

Redimensionare de la desktop la 640px fără room selectat → sidebar deschis.

**Step 3: Commit**

```bash
git add public/js/chat.js
git commit -m "feat(chat): resize handler sidebar pe mobile"
```

---

## Execution Handoff

**Plan salvat în** `docs/plans/2026-03-01-chat-mobile-ux-implementation.md`

**Opțiuni de execuție:**

1. **Subagent-Driven (această sesiune)** — subagent per task, review între taskuri
2. **Sesiune separată** — sesiune nouă cu executing-plans, execuție batch cu checkpointuri

**Care variantă preferi?**
