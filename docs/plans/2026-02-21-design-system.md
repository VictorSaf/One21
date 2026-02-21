# OneChat Design System — Design Document

## Date: 2026-02-21

## Context

OneChat is a multi-room chat platform (Node.js + Socket.IO + SQLite). The current prototype has a single hardcoded HTML page. We need a standardized design system before building any pages.

## Reference

The UI is inspired by a modern dark-mode 3-panel chat layout (Messenger-style):
- Narrow icon nav (left)
- Conversation list (center-left)
- Main chat area (center)
- Info/media panel (right, collapsible)

## Decision: Design System First

Build `theme.css` + `components.css` + `showcase.html` before any real pages. This ensures:
- Zero page-specific styles
- 100% component reuse
- Visual validation before backend work

## Color Palette: Dark Neutral + Emerald

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0d0d12` | Main background |
| `--bg-secondary` | `#141419` | Sidebar, panels |
| `--bg-tertiary` | `#1a1a21` | Cards, surfaces |
| `--bg-elevated` | `#222230` | Hover, selected |
| `--border` | `#2a2a35` | Subtle borders |
| `--border-light` | `#35354a` | Active borders |
| `--text-primary` | `#ececf1` | Primary text |
| `--text-secondary` | `#8e8ea0` | Dim text |
| `--text-tertiary` | `#5a5a6e` | Placeholders |
| `--accent` | `#10b981` | Emerald primary |
| `--accent-hover` | `#34d399` | Emerald hover |
| `--accent-muted` | `rgba(16,185,129,0.12)` | Accent backgrounds |
| `--danger` | `#ef4444` | Errors, delete |
| `--warning` | `#f59e0b` | Warnings |
| `--online` | `#10b981` | Online status |

## Spacing: 8px base

`--sp-1: 4px` / `--sp-2: 8px` / `--sp-3: 12px` / `--sp-4: 16px` / `--sp-5: 20px` / `--sp-6: 24px` / `--sp-8: 32px` / `--sp-12: 48px`

## Border Radius

`--radius-sm: 6px` / `--radius-md: 12px` / `--radius-lg: 18px` / `--radius-full: 50%`

## Typography

Font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `--font-xs` | 10px | 400 | Timestamps |
| `--font-sm` | 12px | 400 | Captions, labels |
| `--font-md` | 14px | 400 | Body text |
| `--font-lg` | 16px | 600 | Headings |
| `--font-xl` | 20px | 700 | Page titles |

## Components

1. **Avatar** — 3 sizes (24/36/48px), online dot, initials fallback
2. **Badge** — unread count circle, accent colored
3. **Button** — primary/secondary/danger/icon-only, 2 sizes
4. **Input** — text/search/textarea, with icon support
5. **Chat item** — sidebar conversation row (avatar + name + preview + time + badge)
6. **Message bubble** — sent/received, sender label, time, read receipts (checkmarks)
7. **Nav icon** — icon button for narrow left sidebar
8. **Panel header** — title + subtitle + action buttons
9. **File card** — icon + filename + size + download button
10. **Media thumbnail** — grid item for shared media
11. **Divider** — horizontal line with centered date text
12. **Typing indicator** — 3 animated dots

## File Structure

```
public/
  css/
    theme.css        -- Variables only
    components.css   -- All component styles
  showcase.html      -- Visual component gallery
  login.html         -- (future)
  chat.html          -- (future)
  admin.html         -- (future)
```

## Next Steps

1. Implement theme.css + components.css
2. Build showcase.html with all components
3. Validate visually in Chrome
4. Build real pages using the same components
