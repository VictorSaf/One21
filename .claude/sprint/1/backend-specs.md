# Sprint 1 — Backend Specs (Iteration 2)

## Previous work (COMPLETE -- do not redo)
- `routes/files.js` socket broadcast + SELECT fix -- DONE
- `socket/handlers/messages.js` upload_progress handler -- DONE

## Remaining: Fix Zod v4 validation error property

**Bug:** Zod v4 uses `.issues` instead of `.errors` on the ZodError object. All occurrences of `result.error.errors[0].message` crash with a TypeError, causing the server to return 500 instead of 400 for invalid input.

**Fix:** Replace `result.error.errors[0].message` with `result.error.issues[0].message` in all 6 occurrences across 3 files.

### File: `/Users/victorsafta/onechat/routes/auth.js`
- Line 38: `result.error.errors[0].message` -> `result.error.issues[0].message`
- Line 133: `result.error.errors[0].message` -> `result.error.issues[0].message`

### File: `/Users/victorsafta/onechat/routes/messages.js`
- Line 98: `result.error.errors[0].message` -> `result.error.issues[0].message`
- Line 183: `result.error.errors[0].message` -> `result.error.issues[0].message`

### File: `/Users/victorsafta/onechat/routes/rooms.js`
- Line 107: `result.error.errors[0].message` -> `result.error.issues[0].message`
- Line 180: `result.error.errors[0].message` -> `result.error.issues[0].message`

This is a simple find-and-replace. All 6 lines follow the exact same pattern.
