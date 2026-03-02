# CSS Layers Architecture — OneChat / ONE21

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migra sistemul CSS al aplicației OneChat la o arhitectură bazată pe `@layer`, eliminând complet CSS-ul embedded din HTML, hardcodata culorile, și asigurând că orice modificare viitoare este forțată prin sistemul de tokeni și componente reutilizabile.

**Architecture:** Cascade Layers CSS (`@layer tokens, base, components, pages, overrides`) oferă o ierarhie explicită a cascadei — stilurile din `tokens` nu pot fi suprascrise accidental de stiluri din `pages`, iar specificitatea devine irelevantă. Fiecare pagină importă doar `design-system.css` (entry point unic) + propriul fișier de pagină. Un script de audit detectează automat orice violare a sistemului.

**Tech Stack:** Vanilla CSS, CSS Cascade Layers (`@layer`), Bash (audit script), Node.js (server existent)

---

## Structura finală a fișierelor

```
public/css/
  design-system.css      ← entry point unic (importă toate layer-ele)
  layers/
    tokens.css           ← @layer tokens  (din theme.css)
    base.css             ← @layer base    (reset + body din theme.css)
    components.css       ← @layer components (din components.css)
    pages/
      chat.css           ← @layer pages   (extras din chat.html)
      admin.css          ← @layer pages   (extras din admin.html — 660 linii)
      login.css          ← @layer pages   (extras din login.html — 292 linii)
scripts/
  audit-css.sh           ← detectează violări ale sistemului
CLAUDE.md                ← reguli design system pentru Claude
```

---

## Task 1: Adaugă tokenii lipsă în theme.css

**Files:**
- Modify: `public/css/theme.css`

**Context:** Există 2 valori hardcodate în components.css care nu au corespondent în tokeni:
- `#8888ff` (culoare purple pentru feed-log__tag--auth)
- Diverse `rgba(255,61,61,...)` care sunt variante ale `--danger` dar fără tokeni dedicați

**Step 1: Editează `public/css/theme.css` — adaugă tokenii lipsă după blocul `/* ─── Semantic ─── */`**

```css
/* ─── Extended semantic (complete set) ─── */
--danger-border:       rgba(255,61,61,0.2);
--danger-border-mid:   rgba(255,61,61,0.35);
--danger-hover:        rgba(255,61,61,0.07);
--danger-focus:        rgba(255,61,61,0.4);
--danger-focus-shadow: rgba(255,61,61,0.08);

/* ─── Purple (auth/system events) ─── */
--purple:              #8888ff;
--purple-muted:        rgba(100,100,220,0.12);

/* ─── Info extended ─── */
--info-muted:          rgba(0,180,216,0.12);

/* ─── Accent extended (for keyframe animations) ─── */
--accent-anim-glow-0:  rgba(0,230,118,0);
--accent-anim-glow-35: rgba(0,230,118,0.35);
--accent-anim-bg-05:   rgba(0,230,118,0.05);
--accent-anim-bg-08:   rgba(0,230,118,0.08);
--accent-anim-bg-30:   rgba(0,230,118,0.3);
```

**Step 2: Verifică că fișierul nu are erori de sintaxă**

```bash
node -e "const fs=require('fs'); console.log('OK:', fs.readFileSync('public/css/theme.css','utf8').includes('--purple'))"
```
Expected output: `OK: true`

**Step 3: Commit**

```bash
git add public/css/theme.css
git commit -m "feat(css): add missing semantic tokens — purple, danger variants, accent anim"
```

---

## Task 2: Înlocuiește valorile hardcodate din components.css

**Files:**
- Modify: `public/css/components.css`

**Context:** 17 instanțe de culori hardcodate care trebuie înlocuite cu tokenii definiți în Task 1.

**Step 1: Înlocuiește fiecare valoare hardcodată**

Modifică `public/css/components.css` cu înlocuirile de mai jos (în ordinea apariției):

| Linie | Valoare veche | Valoare nouă |
|-------|--------------|--------------|
| 35 | `color: #00b4d8` | `color: var(--info)` |
| 173 | `border-color: rgba(255,61,61,0.35)` | `border-color: var(--danger-border-mid)` |
| 177 | `background: rgba(255,61,61,0.07)` | `background: var(--danger-hover)` |
| 251 | `border-color: rgba(255,61,61,0.4)` | `border-color: var(--danger-focus)` |
| 252 | `box-shadow: 0 0 0 2px rgba(255,61,61,0.08)` | `box-shadow: 0 0 0 2px var(--danger-focus-shadow)` |
| 360-361 | `rgba(0,230,118,0)` / `rgba(0,230,118,0.12)` | `var(--accent-anim-glow-0)` / `var(--accent-glow)` |
| 523-525 | cele 3 `rgba(0,230,118,...)` din `@keyframes item-activity` | `var(--accent-anim-glow-35)` / `var(--accent-anim-glow-0)` |
| 566 | `rgba(0,230,118,0.05)` | `var(--accent-anim-bg-05)` |
| 670 | `rgba(0,230,118,0.3)` | `var(--accent-anim-bg-30)` |
| 898 | `rgba(0,230,118,0.08)` | `var(--accent-anim-bg-08)` |
| 1261 | `rgba(0,230,118,0.2)` | `var(--border-accent)` |
| 1350 | `background: rgba(100,100,220,0.12); color: #8888ff` | `background: var(--purple-muted); color: var(--purple)` |
| 1348 | `rgba(0,180,216,0.12)` | `var(--info-muted)` |
| 1378 | `rgba(0,0,0,0.6)` | `var(--shadow-md)` *(ajustare)*|
| 1426 | `rgba(0,0,0,0.75)` | lăsat cu token nou `--overlay-bg` (adaugă în theme.css) |
| 1514 | `rgba(255,61,61,0.2)` | `var(--danger-border)` |

**Step 2: Adaugă token `--overlay-bg` în theme.css**

```css
/* în blocul Shadows din theme.css */
--overlay-bg: rgba(0,0,0,0.75);
```

**Step 3: Verifică că nu mai există valori hardcodate**

```bash
grep -nE "(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))" public/css/components.css | grep -v "var(--" | grep -v "^.*\/\*"
```
Expected output: **gol** (zero rezultate)

**Step 4: Commit**

```bash
git add public/css/components.css public/css/theme.css
git commit -m "fix(css): replace all hardcoded color values with design tokens"
```

---

## Task 3: Creează structura de directoare pentru layers

**Files:**
- Create: `public/css/layers/` (director)
- Create: `public/css/layers/pages/` (director)

**Step 1: Creează directoarele**

```bash
mkdir -p public/css/layers/pages
```

**Step 2: Verifică**

```bash
ls public/css/layers/
```
Expected output: `pages`

---

## Task 4: Creează `layers/tokens.css`

**Files:**
- Create: `public/css/layers/tokens.css`
- Source: conținut din `public/css/theme.css` (blocul `:root {}` + `/* Legacy compat aliases */`)

**Step 1: Creează `public/css/layers/tokens.css`**

Conținut — wrap-ul `@layer tokens` în jurul blocului `:root`:

```css
/* ============================================================
   ONE21 — NEURAL TERMINAL Design Tokens
   @layer tokens — prima prioritate în cascadă
   Modifică DOAR aici pentru a schimba tema globală.
   ============================================================ */

@layer tokens {

  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Barlow+Condensed:wght@600;700;800;900&display=swap');

  :root {
    /* ─── Backgrounds ─── */
    --bg-base:       #040404;
    --bg-surface:    #0d0d0d;
    --bg-elevated:   #141414;
    --bg-active:     #1a1a1a;
    --bg-hover:      rgba(255,255,255,0.04);

    /* ... (toate variabilele din theme.css :root) ... */
  }
}
```

> **IMPORTANT:** Copiază EXACT conținutul blocului `:root { ... }` din `public/css/theme.css` (liniile 10-133) înăuntrul blocului `@layer tokens { :root { ... } }`. Nu omite niciun token.

**Step 2: Verifică că numărul de variabile este identic**

```bash
grep -c "^\s*--" public/css/theme.css
grep -c "^\s*--" public/css/layers/tokens.css
```
Expected: aceleași numere

---

## Task 5: Creează `layers/base.css`

**Files:**
- Create: `public/css/layers/base.css`
- Source: conținut din `public/css/theme.css` după blocul `:root` (liniile 137-218)

**Step 1: Creează `public/css/layers/base.css`**

```css
/* ============================================================
   ONE21 — Base Reset & Body Styles
   @layer base — după tokens, înainte de componente
   ============================================================ */

@layer base {

  *,
  *::before,
  *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  /* ... (tot conținutul din theme.css de la linia 137 până la final) ... */
  /* Include: html {}, @keyframes bg-drift, body {}, body::after, ::selection, scrollbar, a, img, button, input, textarea, select */
}
```

> **IMPORTANT:** Copiază exact blocurile de la linia 137 la 218 din `public/css/theme.css`, învelite în `@layer base { ... }`. Incluzia fonturilor Google (`@import`) rămâne **în afara** layer-ului — mută-o la `design-system.css`.

**Step 2: Verifică că `@keyframes bg-drift` este inclus**

```bash
grep "bg-drift" public/css/layers/base.css
```
Expected: `@keyframes bg-drift {`

---

## Task 6: Creează `layers/components.css`

**Files:**
- Create: `public/css/layers/components.css`
- Source: conținut complet din `public/css/components.css`

**Step 1: Creează `public/css/layers/components.css`**

```css
/* ============================================================
   ONE21 — NEURAL TERMINAL Components
   @layer components — toate componentele reutilizabile
   Adaugă componente noi DOAR în acest fișier.
   ============================================================ */

@layer components {

  /* ... (conținut complet din public/css/components.css, liniile 1-1631) ... */

}
```

> **IMPORTANT:** Copiază EXACT conținutul complet al `public/css/components.css` înăuntrul `@layer components { }`. Nu modifica nimic altceva.

**Step 2: Verifică că toate cele 20 de componente sunt prezente**

```bash
grep -c "^/\* ===" public/css/layers/components.css
```
Expected: `20`

---

## Task 7: Extrage CSS-ul din `chat.html` → `layers/pages/chat.css`

**Files:**
- Create: `public/css/layers/pages/chat.css`
- Modify: `public/chat.html` (șterge `<style>` block)

**Step 1: Identifică blocul `<style>` din `chat.html`**

```bash
awk '/<style>/,/<\/style>/' public/chat.html
```

**Step 2: Creează `public/css/layers/pages/chat.css`**

```css
/* ============================================================
   ONE21 — Chat Page Specific Styles
   @layer pages — override-uri specifice paginii /chat.html
   ============================================================ */

@layer pages {

  /* ... (conținutul din <style> al chat.html) ... */

}
```

**Step 3: Șterge blocul `<style>...</style>` din `public/chat.html`**

Elimină exact liniile cu `<style>` și `</style>` și tot conținutul dintre ele.

**Step 4: Verifică că `<style>` nu mai există în chat.html**

```bash
grep -c "<style>" public/chat.html
```
Expected: `0`

---

## Task 8: Extrage CSS-ul din `login.html` → `layers/pages/login.css`

**Files:**
- Create: `public/css/layers/pages/login.css`
- Modify: `public/login.html`

**Step 1: Copiază conținutul embedded CSS (292 linii)**

```bash
awk '/<style>/,/<\/style>/' public/login.html
```

**Step 2: Creează `public/css/layers/pages/login.css`**

```css
/* ============================================================
   ONE21 — Login Page Specific Styles
   @layer pages — stiluri specifice paginii /login.html
   ============================================================ */

@layer pages {

  /* ... (conținut complet din <style> al login.html) ... */

}
```

**Step 3: Șterge blocul `<style>` din `public/login.html`**

**Step 4: Verifică**

```bash
grep -c "<style>" public/login.html
```
Expected: `0`

---

## Task 9: Extrage CSS-ul din `admin.html` → `layers/pages/admin.css`

**Files:**
- Create: `public/css/layers/pages/admin.css`
- Modify: `public/admin.html`

**Step 1: Copiază conținutul embedded CSS (660 linii)**

```bash
awk '/<style>/,/<\/style>/' public/admin.html | wc -l
```

**Step 2: Creează `public/css/layers/pages/admin.css`**

```css
/* ============================================================
   ONE21 — Admin Page Specific Styles
   @layer pages — stiluri specifice paginii /admin.html
   ============================================================ */

@layer pages {

  /* ... (conținut complet din <style> al admin.html) ... */

}
```

**Step 3: În fișierul extras, înlocuiește valorile hardcodate cu tokeni**

Caută și înlocuiește în `admin.css`:
- `rgba(0,230,118,0.5)` → `var(--border-accent-strong)`
- Orice `#hex` sau `rgba()` fără `var(--` → verifică dacă există token, dacă nu — adaugă token în `tokens.css`

```bash
grep -nE "(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))" public/css/layers/pages/admin.css | grep -v "var(--"
```

**Step 4: Șterge blocul `<style>` din `public/admin.html`**

**Step 5: Verifică**

```bash
grep -c "<style>" public/admin.html
```
Expected: `0`

---

## Task 10: Creează entry point `design-system.css`

**Files:**
- Create: `public/css/design-system.css`

**Step 1: Creează `public/css/design-system.css`**

```css
/* ============================================================
   ONE21 — NEURAL TERMINAL Design System Entry Point
   ============================================================
   Importă toate layer-ele în ordinea corectă.
   Aceasta este singura regulă: toate paginile importează DOAR
   acest fișier + propriul fișier din layers/pages/.

   Ordinea layer-elor (crescătoare ca prioritate):
   tokens < base < components < pages < overrides
   ============================================================ */

/* Font import — în afara @layer pentru compatibilitate maximă */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Barlow+Condensed:wght@600;700;800;900&display=swap');

/* Declarare ordine layer-e — TREBUIE să fie primul */
@layer tokens, base, components, pages, overrides;

/* Layer imports */
@import './layers/tokens.css'     layer(tokens);
@import './layers/base.css'       layer(base);
@import './layers/components.css' layer(components);
```

> **NOTE:** Paginile individuale importă `design-system.css` + propriul `layers/pages/X.css`. Layer-ul `pages` este definit în fișierele individuale de pagină.

**Step 2: Verifică sintaxa**

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('public/css/design-system.css', 'utf8');
console.log('Has layer declaration:', content.includes('@layer tokens, base, components, pages, overrides'));
console.log('Has imports:', content.includes('@import'));
"
```
Expected:
```
Has layer declaration: true
Has imports: true
```

---

## Task 11: Actualizează HTML files să folosească noul sistem

**Files:**
- Modify: `public/chat.html`
- Modify: `public/login.html`
- Modify: `public/admin.html`

**Step 1: Actualizează `public/chat.html` — înlocuiește linkurile CSS**

Înlocuiește:
```html
<link href="https://fonts.googleapis.com/...">
<link rel="stylesheet" href="/css/theme.css">
<link rel="stylesheet" href="/css/components.css">
```

Cu:
```html
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/css/layers/pages/chat.css">
```

**Step 2: Actualizează `public/login.html`**

Înlocuiește:
```html
<link href="https://fonts.googleapis.com/...">
<link rel="stylesheet" href="/css/theme.css">
```

Cu:
```html
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/css/layers/pages/login.css">
```

**Step 3: Actualizează `public/admin.html`**

Înlocuiește:
```html
<link href="https://fonts.googleapis.com/...">
<link rel="stylesheet" href="/css/theme.css">
```

Cu:
```html
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/css/layers/pages/admin.css">
```

**Step 4: Verifică că fiecare pagină are exact 2 link-uri CSS**

```bash
grep -c 'rel="stylesheet"' public/chat.html public/login.html public/admin.html
```
Expected: `2` pentru fiecare fișier

---

## Task 12: Testare vizuală în browser

**Step 1: Pornește serverul**

```bash
node server.js
```

**Step 2: Deschide fiecare pagină și verifică visual că arată identic cu înainte**

- http://localhost:3737/login.html — verifică: card centrat, culori verzi, font mono, corner decorations
- http://localhost:3737/chat.html — verifică: sidebar, mesaje, compose bar, status bar
- http://localhost:3737/admin.html — verifică: nav lateral, tabele, badge-uri

**Step 3: Verifică în DevTools că layer-ele sunt vizibile**

Deschide Chrome DevTools → tab `Styles` → verifică că apar `@layer tokens`, `@layer base`, `@layer components`, `@layer pages` în panoul de stiluri.

**Step 4: Verifică că nu există erori în consolă**

```bash
# Sau din Chrome DevTools Console
```
Expected: zero erori CSS

---

## Task 13: Creează scriptul de audit `scripts/audit-css.sh`

**Files:**
- Create: `scripts/audit-css.sh`

**Step 1: Creează scriptul**

```bash
#!/usr/bin/env bash
# ============================================================
# ONE21 — CSS Design System Audit Script
# Detectează violări ale sistemului de design.
# Usage: bash scripts/audit-css.sh
# Exit code 0 = tot ok, 1 = violări găsite
# ============================================================

set -euo pipefail

ERRORS=0
WARNINGS=0

echo "═══════════════════════════════════════════════"
echo " ONE21 CSS Design System Audit"
echo "═══════════════════════════════════════════════"

# ── 1. Verifică că nu există <style> embedded în HTML ──
echo ""
echo "▶ [1/4] Checking for embedded <style> tags in HTML files..."
for file in public/*.html; do
  count=$(grep -c "<style>" "$file" 2>/dev/null || true)
  if [ "$count" -gt 0 ]; then
    echo "  ✗ FAIL: $file contains $count embedded <style> block(s)"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ OK: $file"
  fi
done

# ── 2. Verifică că nu există culori hardcodate în CSS (în afara var()) ──
echo ""
echo "▶ [2/4] Checking for hardcoded colors in CSS files..."
for file in public/css/layers/**/*.css public/css/layers/*.css; do
  # Exclude comentarii și liniile cu var(--
  results=$(grep -nE "(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))" "$file" 2>/dev/null \
    | grep -v "var(--" \
    | grep -v "^\s*/\*" \
    || true)
  if [ -n "$results" ]; then
    echo "  ✗ FAIL: $file has hardcoded colors:"
    echo "$results" | sed 's/^/    /'
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ OK: $file"
  fi
done

# ── 3. Verifică că nu există inline style= în HTML (warning, nu error) ──
echo ""
echo "▶ [3/4] Checking for inline style= attributes in HTML files..."
for file in public/*.html; do
  count=$(grep -c ' style=' "$file" 2>/dev/null || true)
  if [ "$count" -gt 0 ]; then
    echo "  ⚠ WARN: $file has $count inline style= attribute(s)"
    WARNINGS=$((WARNINGS + 1))
  else
    echo "  ✓ OK: $file"
  fi
done

# ── 4. Verifică că toate paginile importă design-system.css ──
echo ""
echo "▶ [4/4] Checking that all HTML pages import design-system.css..."
for file in public/*.html; do
  if grep -q "design-system.css" "$file"; then
    echo "  ✓ OK: $file"
  else
    echo "  ✗ FAIL: $file does not import design-system.css"
    ERRORS=$((ERRORS + 1))
  fi
done

# ── Sumar ──
echo ""
echo "═══════════════════════════════════════════════"
echo " Results: $ERRORS error(s), $WARNINGS warning(s)"
echo "═══════════════════════════════════════════════"

if [ "$ERRORS" -gt 0 ]; then
  echo " STATUS: FAIL ✗"
  exit 1
else
  echo " STATUS: PASS ✓"
  exit 0
fi
```

**Step 2: Fă scriptul executabil**

```bash
chmod +x scripts/audit-css.sh
```

**Step 3: Rulează auditul — ar trebui să treacă complet**

```bash
bash scripts/audit-css.sh
```
Expected output:
```
═══════════════════════════════════════════════
 Results: 0 error(s), 0 warning(s)
═══════════════════════════════════════════════
 STATUS: PASS ✓
```

**Step 4: Commit**

```bash
git add scripts/audit-css.sh
git commit -m "feat: add CSS design system audit script"
```

---

## Task 14: Creează `CLAUDE.md` cu regulile design system-ului

**Files:**
- Create: `CLAUDE.md`

**Step 1: Creează `CLAUDE.md` în rădăcina proiectului**

```markdown
# ONE21 — Design System Rules for Claude

## CSS Architecture: @layer System

Proiectul folosește CSS Cascade Layers. Ordinea priorităților:

```
@layer tokens < base < components < pages < overrides
```

### Reguli obligatorii

- **IMPORTANT:** Nu scrie niciodată CSS direct în fișierele HTML (`<style>` tags sunt interzise)
- **IMPORTANT:** Toate culorile TREBUIE să folosească `var(--token-name)` din `public/css/layers/tokens.css`
- **IMPORTANT:** Nu hardcoda niciodată `#hex`, `rgb()`, sau `rgba()` — adaugă token nou dacă nu există
- **IMPORTANT:** Nu folosi atribute `style=` inline în HTML — creează o clasă CSS

### Unde pui stilurile noi

| Ce vrei să adaugi | Unde |
|-------------------|------|
| Token nou (culoare, spacing, etc.) | `public/css/layers/tokens.css` — în blocul semantic corect |
| Componentă reutilizabilă nouă | `public/css/layers/components.css` — urmează pattern-ul existent |
| Stil specific doar pentru chat.html | `public/css/layers/pages/chat.css` |
| Stil specific doar pentru admin.html | `public/css/layers/pages/admin.css` |
| Stil specific doar pentru login.html | `public/css/layers/pages/login.css` |
| Pagină nouă | Creează `public/css/layers/pages/numenou.css` + importă în pagina HTML |

### Entry point CSS

Fiecare pagină HTML importă EXACT:
```html
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/css/layers/pages/[pagina].css">
```

### Tokeni disponibili

- **Backgrounds:** `--bg-base`, `--bg-surface`, `--bg-elevated`, `--bg-active`, `--bg-hover`
- **Borders:** `--border-dim`, `--border-mid`, `--border-bright`, `--border-accent`, `--border-accent-strong`
- **Accent:** `--accent`, `--accent-dim`, `--accent-muted`, `--accent-glow`
- **Text:** `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-accent`, `--text-inverse`
- **Semantic:** `--online`, `--offline`, `--error`, `--warning`, `--info`, `--danger`, `--danger-muted`, `--purple`
- **Spacing:** `--sp-1` (4px) → `--sp-12` (48px)
- **Typography:** `--font-xs` → `--font-3xl`, `--font-mono`, `--font-display`
- **Layout:** `--sidebar-width`, `--header-h`, `--statusbar-h`, `--panel-width`
- **Z-index:** `--z-base`, `--z-sticky`, `--z-dropdown`, `--z-overlay`, `--z-modal`, `--z-toast`
- **Transitions:** `--transition-fast`, `--transition-normal`, `--transition-slow`

### Cum schimbi toată tema instantaneu

Modifică **DOAR** `public/css/layers/tokens.css` — toate componentele și paginile se actualizează automat.

### Audit

Rulează `bash scripts/audit-css.sh` după orice modificare CSS pentru a verifica că nu ai introdus violări.

### Componente existente (nu recrea, refolosește)

`.btn`, `.btn--primary`, `.btn--secondary`, `.btn--danger`, `.btn--ghost`, `.btn--icon`, `.btn--sm`
`.input`, `.input--error`, `.input-group`
`.avatar`, `.avatar--sm`, `.avatar--md`, `.avatar--lg`
`.badge`, `.badge--accent`, `.badge--danger`, `.badge--warning`, `.badge--muted`, `.badge--outline`
`.modal`, `.modal-overlay`, `.modal__header`, `.modal__body`, `.modal__footer`
`.sidebar`, `.sidebar__brand`, `.sidebar__search`, `.sidebar__list`, `.sidebar__footer`
`.panel-header`, `.panel-header__title`, `.panel-header__actions`
`.msg`, `.msg--sent`, `.msg--received`, `.msg--system`
`.compose`, `.compose__input`, `.compose__send`, `.compose__statusbar`
`.chat-item`, `.chat-item--active`
`.status-dot`, `.status-dot--online`
`.divider`, `.typing`, `.edit-bar`, `.search-overlay`
`.modal`, `.user-picker`, `.info-panel`, `.home-screen`, `.stat-card`, `.feed-log`
```

**Step 2: Commit final**

```bash
git add CLAUDE.md
git commit -m "feat: add CLAUDE.md design system rules and CSS @layer architecture"
```

---

## Task 15: Șterge fișierele vechi (după verificare)

**Files:**
- Delete: `public/css/theme.css` (conținut migrat în layers/)
- Delete: `public/css/components.css` (conținut migrat în layers/)

**Step 1: Verifică că nicio pagină nu mai referențiază fișierele vechi**

```bash
grep -r "theme.css\|components.css" public/*.html
```
Expected: **gol** (zero rezultate)

**Step 2: Verifică vizual că aplicația arată corect în browser (Task 12 deja verificat)**

**Step 3: Șterge fișierele vechi**

```bash
rm public/css/theme.css public/css/components.css
```

**Step 4: Verifică că aplicația continuă să funcționeze**

```bash
curl -s http://localhost:3737/health
```
Expected: `{"status":"ok",...}`

**Step 5: Commit final**

```bash
git add -A
git commit -m "chore: remove legacy CSS files — fully migrated to @layer architecture"
```

---

## Verificare finală

```bash
# 1. Audit complet
bash scripts/audit-css.sh

# 2. Structura fișierelor
find public/css -type f | sort

# 3. Număr tokeni
grep -c "^\s*--" public/css/layers/tokens.css

# 4. Server health
curl -s http://localhost:3737/health | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).status))"
```

Expected final output:
```
STATUS: PASS ✓
public/css/design-system.css
public/css/layers/base.css
public/css/layers/components.css
public/css/layers/pages/admin.css
public/css/layers/pages/chat.css
public/css/layers/pages/login.css
public/css/layers/tokens.css
[număr tokeni]
ok
```
