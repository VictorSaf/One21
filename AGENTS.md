## Cursor Cloud specific instructions

**ONE21** is a self-hosted real-time team chat app (Express + Socket.IO + SQLite). Single Node.js process, no external services required.

### Running the app

- `npm run dev` — starts with `--watch` for auto-reload on port **3737**
- `npm start` — production-like start without watch mode
- SQLite DB at `db/chat.db` is auto-created and seeded on first run (admin/admin123, claude/claude-agent-secret, claudiu/claudiu123)
- Delete `db/chat.db` to reset to seed state

### Lint / Audit

- No ESLint or test framework is configured in the project
- CSS audit: `bash scripts/audit-css.sh` — validates the CSS layer system (0 errors = pass)

### Dependency install caveat

- `npm install --legacy-peer-deps` is required due to a peer dependency conflict between `@langchain/community` and `zod@4`. Plain `npm install` will fail with `ERESOLVE`.

### Health check

- `curl http://localhost:3737/health` returns JSON with status, uptime, and DB stats

### Seed credentials

| User | Password | Role |
|------|----------|------|
| admin | admin123 | admin |
| claude | claude-agent-secret | agent |
| claudiu | claudiu123 | user |
