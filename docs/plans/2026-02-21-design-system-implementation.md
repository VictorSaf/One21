# OneChat Design System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete CSS design system (theme + components) with a visual showcase page, validated in Chrome.

**Architecture:** CSS-only design system using CSS custom properties (variables) for theming. All components are class-based, no JS required for styling. A showcase.html page displays every component for visual validation.

**Tech Stack:** Vanilla CSS, HTML5, no build tools. Served via Express static files.

---

### Task 1: Create theme.css — Design Tokens

**Files:**
- Create: `public/css/theme.css`

**Step 1: Write theme.css with all design tokens**

```css
/* OneChat Design System — Theme Tokens */
/* NEVER put component styles here. Only variables. */

:root {
  /* ── Backgrounds ── */
  --bg-primary: #0d0d12;
  --bg-secondary: #141419;
  --bg-tertiary: #1a1a21;
  --bg-elevated: #222230;

  /* ── Borders ── */
  --border: #2a2a35;
  --border-light: #35354a;

  /* ── Text ── */
  --text-primary: #ececf1;
  --text-secondary: #8e8ea0;
  --text-tertiary: #5a5a6e;

  /* ── Accent (Emerald) ── */
  --accent: #10b981;
  --accent-hover: #34d399;
  --accent-muted: rgba(16, 185, 129, 0.12);

  /* ── Semantic ── */
  --danger: #ef4444;
  --danger-muted: rgba(239, 68, 68, 0.12);
  --warning: #f59e0b;
  --warning-muted: rgba(245, 158, 11, 0.12);
  --info: #3b82f6;
  --info-muted: rgba(59, 130, 246, 0.12);
  --online: #10b981;
  --offline: #5a5a6e;

  /* ── Spacing (8px base) ── */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;
  --sp-12: 48px;

  /* ── Border Radius ── */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --radius-full: 50%;

  /* ── Typography ── */
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-xs: 10px;
  --font-sm: 12px;
  --font-md: 14px;
  --font-lg: 16px;
  --font-xl: 20px;
  --font-2xl: 24px;

  --weight-normal: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;

  --line-height: 1.5;
  --line-height-tight: 1.3;

  /* ── Shadows ── */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);

  /* ── Transitions ── */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow: 400ms cubic-bezier(0.16, 1, 0.3, 1);

  /* ── Z-index scale ── */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-toast: 500;

  /* ── Layout ── */
  --nav-width: 72px;
  --sidebar-width: 320px;
  --panel-width: 300px;
}

/* ── Base reset ── */
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  font-family: var(--font-family);
  font-size: var(--font-md);
  line-height: var(--line-height);
  color: var(--text-primary);
  background: var(--bg-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::selection {
  background: var(--accent-muted);
  color: var(--accent);
}

::-webkit-scrollbar {
  width: 4px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--border-light);
}
```

**Step 2: Verify file exists**

Run: `ls -la public/css/theme.css`
Expected: File exists

**Step 3: Commit**

```bash
git add public/css/theme.css
git commit -m "feat: add theme.css design tokens"
```

---

### Task 2: Create components.css — Avatar, Badge, Button

**Files:**
- Create: `public/css/components.css`

**Step 1: Write the first batch of components**

```css
/* OneChat Design System — Components */
/* All components use theme.css tokens. No hardcoded values. */

/* ═══════════════════════════════════════
   AVATAR
   Usage: <div class="avatar avatar--md"><img src="..." /><span class="avatar__status"></span></div>
   Sizes: avatar--sm (24px), avatar--md (36px), avatar--lg (48px)
   ═══════════════════════════════════════ */
.avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-weight: var(--weight-semibold);
  flex-shrink: 0;
  overflow: hidden;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-full);
}

.avatar--sm { width: 24px; height: 24px; font-size: var(--font-xs); }
.avatar--md { width: 36px; height: 36px; font-size: var(--font-sm); }
.avatar--lg { width: 48px; height: 48px; font-size: var(--font-md); }

.avatar__status {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  border: 2px solid var(--bg-secondary);
  background: var(--offline);
}

.avatar__status--online { background: var(--online); }

/* ═══════════════════════════════════════
   BADGE
   Usage: <span class="badge">4</span>
   Variants: badge--accent (default), badge--danger, badge--muted
   ═══════════════════════════════════════ */
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-full);
  font-size: var(--font-xs);
  font-weight: var(--weight-bold);
  background: var(--accent);
  color: #fff;
  line-height: 1;
}

.badge--danger { background: var(--danger); }
.badge--warning { background: var(--warning); }
.badge--muted {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

/* ═══════════════════════════════════════
   BUTTON
   Usage: <button class="btn btn--primary">Label</button>
   Variants: btn--primary, btn--secondary, btn--danger, btn--icon
   Sizes: default, btn--sm
   ═══════════════════════════════════════ */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-5);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-family);
  font-size: var(--font-md);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--accent);
  color: #fff;
}

.btn--primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn--secondary {
  background: transparent;
  border-color: var(--border);
  color: var(--text-primary);
}

.btn--secondary:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: var(--border-light);
}

.btn--danger {
  background: var(--danger);
  color: #fff;
}

.btn--danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn--ghost {
  background: transparent;
  color: var(--text-secondary);
}

.btn--ghost:hover:not(:disabled) {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.btn--icon {
  padding: var(--sp-2);
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.btn--icon:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: var(--border-light);
  color: var(--text-primary);
}

.btn--sm {
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--font-sm);
}
```

**Step 2: Verify**

Run: `ls -la public/css/components.css`

**Step 3: Commit**

```bash
git add public/css/components.css
git commit -m "feat: add avatar, badge, button components"
```

---

### Task 3: Add Input, Search, Textarea components

**Files:**
- Modify: `public/css/components.css` (append)

**Step 1: Append input components**

Append the following to the end of `public/css/components.css`:

```css
/* ═══════════════════════════════════════
   INPUT
   Usage: <input class="input" type="text" placeholder="..." />
   With icon: <div class="input-group"><span class="input-group__icon">Q</span><input class="input" /></div>
   ═══════════════════════════════════════ */
.input {
  width: 100%;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-family);
  font-size: var(--font-md);
  outline: none;
  transition: all var(--transition-fast);
}

.input::placeholder {
  color: var(--text-tertiary);
}

.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.input--error {
  border-color: var(--danger);
}

.input--error:focus {
  box-shadow: 0 0 0 3px var(--danger-muted);
}

.input-group {
  position: relative;
  display: flex;
  align-items: center;
}

.input-group__icon {
  position: absolute;
  left: var(--sp-3);
  color: var(--text-tertiary);
  font-size: var(--font-md);
  pointer-events: none;
  display: flex;
  align-items: center;
}

.input-group .input {
  padding-left: var(--sp-10);
}

textarea.input {
  min-height: 80px;
  resize: vertical;
  line-height: var(--line-height);
}

/* ═══════════════════════════════════════
   COMPOSE BAR
   Usage: <div class="compose"><input class="compose__input" /><button class="btn btn--primary compose__send">Send</button></div>
   ═══════════════════════════════════════ */
.compose {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}

.compose__input {
  flex: 1;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-family: var(--font-family);
  font-size: var(--font-md);
  outline: none;
  transition: border-color var(--transition-fast);
}

.compose__input::placeholder {
  color: var(--text-tertiary);
}

.compose__input:focus {
  border-color: var(--accent);
}

.compose__send {
  border-radius: var(--radius-full);
  width: 40px;
  height: 40px;
  padding: 0;
}
```

**Step 2: Commit**

```bash
git add public/css/components.css
git commit -m "feat: add input, search, compose bar components"
```

---

### Task 4: Add Chat Item (sidebar conversation row)

**Files:**
- Modify: `public/css/components.css` (append)

**Step 1: Append chat-item component**

```css
/* ═══════════════════════════════════════
   CHAT ITEM (sidebar conversation row)
   Usage: <div class="chat-item"><div class="avatar ...">...</div><div class="chat-item__body"><div class="chat-item__header"><span class="chat-item__name">Name</span><span class="chat-item__time">9:52</span></div><div class="chat-item__preview"><span class="chat-item__text">Last message...</span><span class="badge">4</span></div></div></div>
   ═══════════════════════════════════════ */
.chat-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.chat-item:hover {
  background: var(--bg-tertiary);
}

.chat-item--active {
  background: var(--bg-elevated);
}

.chat-item__body {
  flex: 1;
  min-width: 0;
}

.chat-item__header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--sp-2);
}

.chat-item__name {
  font-size: var(--font-md);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-item__time {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}

.chat-item__preview {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.chat-item__text {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Read receipt checkmarks */
.chat-item__check {
  color: var(--accent);
  font-size: var(--font-sm);
  flex-shrink: 0;
}

.chat-item__check--unread {
  color: var(--text-tertiary);
}
```

**Step 2: Commit**

```bash
git add public/css/components.css
git commit -m "feat: add chat-item sidebar component"
```

---

### Task 5: Add Message Bubble component

**Files:**
- Modify: `public/css/components.css` (append)

**Step 1: Append message bubble component**

```css
/* ═══════════════════════════════════════
   MESSAGE BUBBLE
   Usage: <div class="msg msg--received"><span class="msg__sender">Name</span><p class="msg__text">...</p><div class="msg__meta"><span class="msg__time">9:45</span><span class="msg__check">✓✓</span></div></div>
   Variants: msg--sent (right-aligned), msg--received (left-aligned), msg--system (centered)
   ═══════════════════════════════════════ */
.msg {
  max-width: 75%;
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-lg);
  font-size: var(--font-md);
  line-height: var(--line-height);
  word-wrap: break-word;
  animation: msg-in var(--transition-slow) forwards;
}

@keyframes msg-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.msg--received {
  align-self: flex-start;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-bottom-left-radius: var(--radius-sm);
}

.msg--sent {
  align-self: flex-end;
  background: var(--accent-muted);
  border: 1px solid rgba(16, 185, 129, 0.15);
  border-bottom-right-radius: var(--radius-sm);
}

.msg--system {
  align-self: center;
  max-width: 90%;
  text-align: center;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-sm);
  padding: var(--sp-2) var(--sp-4);
}

.msg__sender {
  display: block;
  font-size: 11px;
  font-weight: var(--weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: var(--sp-1);
  color: var(--accent);
}

.msg--sent .msg__sender {
  color: var(--accent-hover);
}

.msg__text {
  margin: 0;
}

.msg__meta {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--sp-1);
  margin-top: var(--sp-1);
}

.msg__time {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.msg__check {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.msg__check--read {
  color: var(--accent);
}

/* Link preview inside message */
.msg__link-preview {
  display: block;
  margin-top: var(--sp-2);
  padding: var(--sp-3);
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
  transition: border-color var(--transition-fast);
}

.msg__link-preview:hover {
  border-color: var(--border-light);
}

.msg__link-preview-title {
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--accent);
  margin-bottom: var(--sp-1);
}

.msg__link-preview-desc {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  line-height: var(--line-height);
}

/* Image in message */
.msg__image {
  max-width: 100%;
  border-radius: var(--radius-md);
  margin-top: var(--sp-2);
}
```

**Step 2: Commit**

```bash
git add public/css/components.css
git commit -m "feat: add message bubble component"
```

---

### Task 6: Add Nav, Panel Header, Divider, Typing, File Card components

**Files:**
- Modify: `public/css/components.css` (append)

**Step 1: Append remaining components**

```css
/* ═══════════════════════════════════════
   NAV ICON (narrow left sidebar)
   Usage: <nav class="nav"><button class="nav__item nav__item--active"><span>icon</span></button></nav>
   ═══════════════════════════════════════ */
.nav {
  width: var(--nav-width);
  min-width: var(--nav-width);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--sp-4) 0;
  gap: var(--sp-2);
}

.nav__brand {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--weight-bold);
  font-size: var(--font-lg);
  margin-bottom: var(--sp-6);
  flex-shrink: 0;
}

.nav__item {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: all var(--transition-fast);
}

.nav__item:hover {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.nav__item--active {
  background: var(--accent-muted);
  color: var(--accent);
}

.nav__spacer {
  flex: 1;
}

/* ═══════════════════════════════════════
   SIDEBAR (conversation list panel)
   ═══════════════════════════════════════ */
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar__header {
  padding: var(--sp-5) var(--sp-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar__title {
  font-size: var(--font-xl);
  font-weight: var(--weight-bold);
}

.sidebar__search {
  padding: 0 var(--sp-4) var(--sp-3);
}

.sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-1) var(--sp-2);
}

.sidebar__section-label {
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--font-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1.5px;
}

/* ═══════════════════════════════════════
   PANEL HEADER (main chat header)
   Usage: <div class="panel-header"><div class="panel-header__info">...</div><div class="panel-header__actions">...</div></div>
   ═══════════════════════════════════════ */
.panel-header {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-header__info {
  flex: 1;
  min-width: 0;
}

.panel-header__title {
  font-size: var(--font-lg);
  font-weight: var(--weight-semibold);
}

.panel-header__subtitle {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  margin-top: 1px;
}

.panel-header__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/* ═══════════════════════════════════════
   MESSAGES AREA
   ═══════════════════════════════════════ */
.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* ═══════════════════════════════════════
   DIVIDER (date separator)
   Usage: <div class="divider"><span class="divider__text">Today</span></div>
   ═══════════════════════════════════════ */
.divider {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-4) 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.divider__text {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1px;
  white-space: nowrap;
}

/* ═══════════════════════════════════════
   TYPING INDICATOR
   Usage: <div class="typing"><span></span><span></span><span></span></div>
   ═══════════════════════════════════════ */
.typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  border-bottom-left-radius: var(--radius-sm);
  align-self: flex-start;
}

.typing span {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--accent);
  animation: typing-bounce 1.4s infinite;
}

.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* ═══════════════════════════════════════
   FILE CARD
   Usage: <div class="file-card"><div class="file-card__icon">PDF</div><div class="file-card__info"><span class="file-card__name">file.pdf</span><span class="file-card__size">2.4 MB</span></div><button class="file-card__download">↓</button></div>
   ═══════════════════════════════════════ */
.file-card {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast);
}

.file-card:hover {
  border-color: var(--border-light);
}

.file-card__icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--accent-muted);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-xs);
  font-weight: var(--weight-bold);
  text-transform: uppercase;
  flex-shrink: 0;
}

.file-card__icon--danger {
  background: var(--danger-muted);
  color: var(--danger);
}

.file-card__info {
  flex: 1;
  min-width: 0;
}

.file-card__name {
  display: block;
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-card__size {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.file-card__download {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.file-card__download:hover {
  background: var(--bg-elevated);
  color: var(--accent);
  border-color: var(--accent);
}

/* ═══════════════════════════════════════
   MEDIA GRID
   Usage: <div class="media-grid"><div class="media-grid__item"><img src="..." /></div>...</div>
   ═══════════════════════════════════════ */
.media-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-2);
}

.media-grid__item {
  aspect-ratio: 1;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--border);
  transition: border-color var(--transition-fast);
}

.media-grid__item:hover {
  border-color: var(--accent);
}

.media-grid__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ═══════════════════════════════════════
   RIGHT PANEL (info/media sidebar)
   ═══════════════════════════════════════ */
.info-panel {
  width: var(--panel-width);
  min-width: var(--panel-width);
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.info-panel__section {
  padding: var(--sp-5);
  border-bottom: 1px solid var(--border);
}

.info-panel__section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--sp-3);
}

.info-panel__section-title {
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.info-panel__see-all {
  font-size: var(--font-xs);
  color: var(--accent);
  cursor: pointer;
  background: none;
  border: none;
  font-family: var(--font-family);
}

.info-panel__see-all:hover {
  color: var(--accent-hover);
}

/* ═══════════════════════════════════════
   APP LAYOUT
   Usage: <div class="app"><nav class="nav">...</nav><aside class="sidebar">...</aside><main class="main">...</main><aside class="info-panel">...</aside></div>
   ═══════════════════════════════════════ */
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
```

**Step 2: Commit**

```bash
git add public/css/components.css
git commit -m "feat: add nav, sidebar, panel, divider, typing, file-card, media-grid, layout components"
```

---

### Task 7: Create showcase.html — Visual Component Gallery

**Files:**
- Create: `public/showcase.html`

**Step 1: Build showcase page displaying every component**

Create a single HTML page that imports theme.css + components.css and renders every component with real-looking sample data. Organize by sections: Tokens (colors, spacing), Avatars, Badges, Buttons, Inputs, Chat Items, Message Bubbles, Nav, File Cards, Media Grid, Full Layout Preview.

Use Romanian labels where appropriate to match spec. Use placeholder avatar images from `https://i.pravatar.cc/` for realistic avatars.

**Step 2: Update server.js to serve static files**

Add `app.use(express.static(path.join(__dirname, 'public')));` to server.js so that `/showcase.html` is accessible at `http://localhost:3737/showcase.html`.

**Step 3: Start server and validate in Chrome**

Run: `node server.js`
Open: `http://localhost:3737/showcase.html`
Validate: All components render correctly with emerald accent on dark neutral background.

**Step 4: Commit**

```bash
git add public/showcase.html server.js
git commit -m "feat: add component showcase page and static file serving"
```

---

### Task 8: Visual QA and Refinement

**Step 1: Open showcase.html in Chrome**

Use Chrome DevTools to inspect spacing, alignment, and color consistency.

**Step 2: Fix any visual issues found**

Adjust CSS values in theme.css or components.css as needed.

**Step 3: Commit fixes**

```bash
git add public/css/
git commit -m "fix: visual refinements from Chrome QA"
```

---

## Execution Summary

| Task | What | Files |
|------|------|-------|
| 1 | Design tokens (theme.css) | `public/css/theme.css` |
| 2 | Avatar, Badge, Button | `public/css/components.css` |
| 3 | Input, Search, Compose | `public/css/components.css` |
| 4 | Chat Item (sidebar row) | `public/css/components.css` |
| 5 | Message Bubble | `public/css/components.css` |
| 6 | Nav, Panel, Divider, Typing, File Card, Media, Layout | `public/css/components.css` |
| 7 | Showcase page + static serving | `public/showcase.html`, `server.js` |
| 8 | Visual QA in Chrome | CSS files |
