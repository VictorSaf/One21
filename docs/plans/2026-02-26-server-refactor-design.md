# Design: Server.js Refactoring

> Date: 2026-02-26 | Status: Approved

## Obiectiv

Transformă `server.js` monolitic (300+ linii) într-un bootstrap slim (~50 linii) prin extragerea:
- Socket.IO handlers în `socket/handlers/`
- Config env vars în `config.js`
- Fix routing duplicat `messageRoutes`
- Guard securitate `AGENT_SECRET`

## Structură nouă

```
server.js                    # ~50 linii — bootstrap only
config.js                    # env vars + validare startup
socket/
  index.js                   # Socket.IO init + auth middleware
  handlers/
    messages.js              # on(message/edit/delete/read/typing)
    presence.js              # on(connect/disconnect)
    rooms.js                 # on(join_room/leave_room/member_*/room_updated)
```

## Fix-uri incluse

1. `messageRoutes` montat o singură dată (nu de 2×)
2. `AGENT_SECRET` obligatoriu în prod — warning/exit la startup dacă lipsește
3. `queueAgentRoomMemory` mutat în `lib/` sau în handlers

## Principii

- Fișierele existente din `routes/`, `middleware/`, `lib/` rămân neatinse
- Funcționalitate identică după refactoring — zero breaking changes
- Fiecare handler file exportă o funcție `register(io, socket, db)`
