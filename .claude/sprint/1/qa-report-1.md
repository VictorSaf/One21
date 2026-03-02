# QA Report — Sprint 1, Iteration 1

### SUITE STATUS
- Test files: helpers.js, setup.js, test_api.js, test_socket.js, test_file_upload_code.js, test_client_logic.js, test_css_audit.js
- Framework: Node.js built-in test runner (node:test + node:assert)
- Commands: `npm test`, `npm run test:api`, `npm run test:socket`, `npm run test:static`

### API CONFORMITY STATUS: NO

### FAILURES AND DEVIATIONS

**CRITICAL — File upload socket broadcast not active (stale server)**
- `POST /api/rooms/:id/upload` broadcast code exists on disk in `routes/files.js` lines 94-96 but server has NOT been restarted. Socket broadcast does not fire on running server.

**HIGH — upload_progress handler not active (stale server)**
- Handler added to `socket/handlers/messages.js` lines 194-204 but server running stale code.

**MEDIUM — Zod v4 API change (pre-existing bug)**
- `POST /api/auth/login` and `POST /api/rooms/:id/messages` return 500 instead of 400 for invalid input.
- Root cause: `result.error.errors[0].message` crashes in Zod v4 (uses `result.error.issues` not `result.error.errors`).
- Affected files: `routes/auth.js` (lines 38, 134), `routes/messages.js` (line 98), `routes/rooms.js` (line 107).

**LOW — Route mount inconsistency**
- Edit/delete message routes work at `/api/rooms/messages/:id` but are also mounted at `/api/messages` producing broken path `/api/messages/messages/:id`.

### TEST EXECUTION
- Static analysis (23 tests): ALL PASS
- API conformance (26 tests): ALL PASS
- Socket tests (19 tests): 16 PASS, 3 FAIL (all due to stale server)
- CSS audit: PASS — 0 errors

### ACTION REQUIRED
1. Restart server to activate Sprint 1 code changes
2. Fix Zod v4 issue format in auth.js, messages.js, rooms.js
