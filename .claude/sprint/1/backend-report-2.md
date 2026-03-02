# Backend Report — Sprint 1, Iteration 2

### TASK
Fix Zod v4 validation error property: replace `.error.errors[0].message` with `.error.issues[0].message` (6 occurrences across 3 files).

### CONFORMITY STATUS: YES

### FILES CHANGED:
- `routes/auth.js` — lines 38, 133
- `routes/messages.js` — lines 98, 183
- `routes/rooms.js` — lines 107, 180

### ISSUES FOUND: None

### RESULT
All 6 occurrences replaced. Endpoints now correctly return HTTP 400 with validation message instead of crashing with TypeError 500.
