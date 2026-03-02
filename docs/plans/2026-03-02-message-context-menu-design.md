# Message Context Menu — Design

**Date:** 2026-03-02

## Goal

Click pe orice message bubble → mini-meniu cu Reply și Private chat.

## Architecture

Trei componente noi conectate la infrastructura existentă (`reply_to` în DB + socket handler):

1. **Context menu** — flotant, apare la click pe bubble
2. **Reply bar** — deasupra compose-ului, afișat când e activ un reply
3. **Quoted block** — în interiorul bubblului, pentru mesaje cu `reply_to`

Private chat folosește POST /api/rooms cu type='direct' (endpoint existent).

---

## Context Menu

- Trigger: click pe `.msg` (nu pe `.msg--system`)
- Poziționare: lângă bubble, se ajustează să nu iasă din viewport
- Items:
  - **Reply** — întotdeauna vizibil
  - **Private chat** — vizibil doar dacă `msg.sender_id !== currentUser.id`
- Dismiss: click în afara meniului sau ESC

## Reply Flow

1. Click Reply → se populează `replyingTo = { id, senderName, text }`
2. Reply bar apare deasupra compose: `↩ NumeSender: preview...` + buton ✕
3. La send: `socket.emit('message', { room_id, text, reply_to: replyingTo.id })`
4. Cancel (✕ sau ESC): `replyingTo = null`, reply bar dispare

## Quoted Block în Bubble

Mesajele cu `reply_to` afișează un bloc citat deasupra textului:
- Sender name + primele ~80 caractere din textul original
- Click → `scrollIntoView` pe mesajul original + CSS flash animat (`msg--highlight`)
- Dacă mesajul original a fost șters → afișează „mesaj șters"

## API Change

`GET /api/rooms/:id/messages` — adaugă JOIN pentru reply context:

```sql
LEFT JOIN messages rm ON rm.id = m.reply_to
LEFT JOIN users ru ON ru.id = rm.sender_id
```

Câmpuri noi per mesaj: `reply_to_text`, `reply_to_sender`.

## Private Chat Flow

1. Click Private chat → `POST /api/rooms { type: 'direct', participant_id: senderId }`
2. Dacă DM există → returnează room existent (upsert logic în backend)
3. Frontend navighează la room-ul returnat

## CSS

Clase noi în `public/css/layers/pages/chat.css` (`@layer pages`):
- `.msg-menu` — containerul flotant al meniului
- `.msg-menu__item` — fiecare opțiune din meniu
- `.msg__reply-quote` — blocul citat din bubble
- `.reply-bar` — bara deasupra compose
- `.msg--highlight` — animație flash pe mesajul original

## No-scope (YAGNI)

- Nested replies (reply la un reply)
- Thread view colapsabil
- Reaction emoji
- Read receipts per reply
