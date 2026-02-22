# ONE21 — Design System Rules for Claude

## CSS Architecture: @layer System

Proiectul folosește CSS Cascade Layers. Ordinea priorităților:

```
@layer tokens < base < components < pages < overrides
```

### ⚠️ Reguli OBLIGATORII — Nu le încălca niciodată

- **INTERZIS:** CSS direct în fișierele HTML (`<style>` tags sunt interzise)
- **INTERZIS:** Culori hardcodate `#hex`, `rgb()`, `rgba()` — folosește ÎNTOTDEAUNA `var(--token-name)`
- **INTERZIS:** Atribute `style=` inline în HTML — creează o clasă CSS
- **INTERZIS:** Să importezi `theme.css` sau `components.css` direct — folosește `design-system.css`

### Unde pui stilurile noi

| Ce adaugi | Unde | Layer |
|-----------|------|-------|
| Token nou (culoare, spacing etc.) | `public/css/layers/tokens.css` | `tokens` |
| Componentă reutilizabilă | `public/css/layers/components.css` | `components` |
| Stil specific chat.html | `public/css/layers/pages/chat.css` | `pages` |
| Stil specific admin.html | `public/css/layers/pages/admin.css` | `pages` |
| Stil specific login.html | `public/css/layers/pages/login.css` | `pages` |
| Pagină HTML nouă | Creează `public/css/layers/pages/numenou.css` | `pages` |

### Import CSS în HTML pages

```html
<!-- CORECT — exact 2 link-uri per pagină -->
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/css/layers/pages/[pagina].css">
```

### Tokeni disponibili (tokens.css)

**Backgrounds:** `--bg-base` `--bg-surface` `--bg-elevated` `--bg-active` `--bg-hover`

**Borders:** `--border-dim` `--border-mid` `--border-bright` `--border-accent` `--border-accent-strong`

**Accent:** `--accent` `--accent-dim` `--accent-muted` `--accent-glow`

**Text:** `--text-primary` `--text-secondary` `--text-tertiary` `--text-accent` `--text-inverse`

**Semantic:** `--online` `--offline` `--error` `--warning` `--info` `--danger` `--danger-muted` `--purple` `--overlay-bg`

**Danger variants:** `--danger-border` `--danger-border-mid` `--danger-hover` `--danger-focus` `--danger-focus-shadow`

**Spacing:** `--sp-1` (4px) → `--sp-12` (48px)

**Typography:** `--font-xs` → `--font-3xl` · `--font-mono` · `--font-display`

**Layout:** `--sidebar-width` `--header-h` `--statusbar-h` `--panel-width`

**Z-index:** `--z-base` `--z-sticky` `--z-dropdown` `--z-overlay` `--z-modal` `--z-toast`

**Transitions:** `--transition-fast` `--transition-normal` `--transition-slow`

### Cum schimbi toată tema instantaneu

Modifică **DOAR** `public/css/layers/tokens.css` — totul se actualizează automat.

### Componente existente — Refolosește, nu recrea

```
Butoane:    .btn .btn--primary .btn--secondary .btn--danger .btn--ghost .btn--icon .btn--sm
Input:      .input .input--error .input-group
Avatar:     .avatar .avatar--sm .avatar--md .avatar--lg
Badge:      .badge .badge--accent .badge--danger .badge--warning .badge--muted .badge--outline
Modal:      .modal .modal-overlay .modal__header .modal__body .modal__footer .modal__field
Sidebar:    .sidebar .sidebar__brand .sidebar__search .sidebar__list .sidebar__footer
Header:     .panel-header .panel-header__title .panel-header__actions
Mesaje:     .msg .msg--sent .msg--received .msg--system
Compose:    .compose .compose__input .compose__send .compose__statusbar
Chat item:  .chat-item .chat-item--active
Status:     .status-dot .status-dot--online
Alte:       .divider .typing .edit-bar .search-overlay .user-picker .info-panel
Dashboard:  .home-screen .stat-card .feed-log
```

### Audit

```bash
bash scripts/audit-css.sh
```

Rulează după orice modificare CSS. 0 errors = sistem intact.
