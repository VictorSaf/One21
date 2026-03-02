# ONE21 — Multi-agent API (X-Agent-Username) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow multiple AI agents to use the Agent API by identifying the agent via header `X-Agent-Username`; each agent runs in its own external process with its own env.

**Architecture:** Middleware validates `X-Agent-Key` then resolves `X-Agent-Username` to a user with `role = 'agent'` and attaches `req.agentUser`. All agent routes use `req.agentUser` instead of the hardcoded `claude` user; GET messages checks room membership for the agent.

**Tech Stack:** Node.js, Express 5, better-sqlite3, existing `middleware/agent.js`, `routes/agent.js`.

**Design doc:** `docs/plans/2026-02-25-ai-agents-multi-process-design.md`

---

## Task 1: Middleware — require and resolve X-Agent-Username

**Files:**
- Modify: `middleware/agent.js`

**Step 1: Add dependency on DB and resolve agent user**

After validating `X-Agent-Key`, read `X-Agent-Username` from headers. If missing, respond with `401` and `{ error: 'X-Agent-Username required' }`. Query DB for user by username; if not found, `401` with `{ error: 'Agent user not found' }`. If found but `role !== 'agent'`, respond `403` with `{ error: 'User is not an agent' }`. Otherwise set `req.agentUser = { id, username, display_name, role }` and call `next()`.

**Step 2: Implementation**

- Require `getDb` from `../db/init`.
- After the key check, get username: `const username = req.headers['x-agent-username']`.
- If `!username || typeof username !== 'string' || !username.trim()` → `return res.status(401).json({ error: 'X-Agent-Username required' })`.
- `const user = db.prepare("SELECT id, username, display_name, role FROM users WHERE username = ?").get(username.trim())`.
- If `!user` → `return res.status(401).json({ error: 'Agent user not found' })`.
- If `user.role !== 'agent'` → `return res.status(403).json({ error: 'User is not an agent' })`.
- `req.agentUser = user`; `next()`.

**Step 3: Verify**

Run server; then:

```bash
# No username → 401
curl -s -o /dev/null -w "%{http_code}" -H "X-Agent-Key: agent-dev-key-change-in-prod" http://localhost:3737/api/agent/rooms
# Expected: 401

# With username claude → 200 (if server running and DB seeded)
curl -s -o /dev/null -w "%{http_code}" -H "X-Agent-Key: agent-dev-key-change-in-prod" -H "X-Agent-Username: claude" http://localhost:3737/api/agent/rooms
# Expected: 200
```

**Step 4: Commit**

```bash
git add middleware/agent.js
git commit -m "feat(agent): require X-Agent-Username and resolve req.agentUser"
```

---

## Task 2: Agent routes — use req.agentUser everywhere

**Files:**
- Modify: `routes/agent.js`

**Step 1: GET /api/agent/rooms**

Replace the inline `agent` query with use of `req.agentUser`. Use `req.agentUser.id` in the rooms query. Response already has `agent_id`; keep it as `req.agentUser.id`. Remove any `SELECT ... WHERE username = 'claude'`.

**Step 2: GET /api/agent/messages — membership check**

Before running the messages query, verify that `req.agentUser.id` is a member of `roomId`. Query: `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?` with `(roomId, req.agentUser.id)`. If no row, `return res.status(403).json({ error: 'Agent not member of this room' })`. Then keep existing messages query unchanged (still by room_id, since, limit).

**Step 3: POST /api/agent/send**

Remove the local `agent` lookup. Use `req.agentUser.id` as sender_id. Keep membership check (room_id, req.agentUser.id). Keep insert and Socket emit as is.

**Step 4: GET /api/agent/users**

No change required (no agent identity needed for listing users).

**Step 5: Verify**

- `GET /api/agent/rooms` with `X-Agent-Username: claude` returns rooms for claude.
- `GET /api/agent/messages?room=<room_id>&since=0` with same headers returns messages; for a room where claude is not member, use a different room_id and expect 403.
- `POST /api/agent/send` with `{ room_id, text: "test" }` and headers sends as claude and returns 200.

**Step 6: Commit**

```bash
git add routes/agent.js
git commit -m "feat(agent): use req.agentUser in all routes; enforce room membership on GET messages"
```

---

## Task 3: Docs and env example

**Files:**
- Modify: `.env.example` (if exists) or add a short note in design doc / README about `AGENT_API_KEY` and that clients must send `X-Agent-Username`.

**Step 1:** If `.env.example` exists, ensure it documents:
- `AGENT_API_KEY` — shared key for agent API; clients must send `X-Agent-Key` and `X-Agent-Username`.

If no `.env.example`, skip or add one line to design doc that runtime env must set `AGENT_API_KEY`.

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document AGENT_API_KEY and X-Agent-Username for agent API"
```

---

## Execution summary

| Task | Summary |
|------|---------|
| 1 | Middleware: X-Agent-Username required, resolve to req.agentUser |
| 2 | Routes: use req.agentUser; GET messages checks room membership |
| 3 | Env/docs: document AGENT_API_KEY and X-Agent-Username |

After implementation, the Agent API supports multiple agents; each external process sets `X-Agent-Username` to the desired agent username and uses the same `AGENT_API_KEY`.
