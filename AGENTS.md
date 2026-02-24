## Cursor Cloud specific instructions

ONE21 is a self-hosted real-time team chat platform (Node.js/Express + SQLite + Socket.IO). Everything is self-contained — no external databases or services needed.

### Quick reference

| Action | Command |
|--------|---------|
| Install deps | `npm install --legacy-peer-deps` |
| Dev server | `npm run dev` (port 3737, `node --watch server.js`) |
| Health check | `curl http://localhost:3737/health` |
| CSS audit | `bash scripts/audit-css.sh` |

### Non-obvious caveats

- **`--legacy-peer-deps` is required** for `npm install` due to a peer dependency conflict between `zod@4` (root) and `@browserbasehq/stagehand` (transitive peer of `@langchain/community`). Without this flag, install fails.
- **No `.env` file needed for dev.** `JWT_SECRET` has a sensible default in `middleware/auth.js`. The server auto-creates and seeds the SQLite database (`db/chat.db`) on first startup with users: `admin`/`admin123`, `claudiu`/`claudiu123`, and a `claude` agent account.
- **No ESLint, Prettier, or test framework** is configured. The only lint-like check is `bash scripts/audit-css.sh` which validates the CSS design system rules from `CLAUDE.md`.
- **No build step.** The frontend is vanilla JS/CSS served statically from `public/`.
- **SQLite database** is file-based at `db/chat.db`. Delete it to reset to a fresh seeded state.
