# ONE21 — Invitații QR + join pe oneaigency.com

**Data:** 2026-02-25  
**Status:** Approved — ready for implementation

---

## 1. Premise

- **Un singur domeniu vizibil:** oneaigency.com. Userul nu vede niciodată alt domeniu.
- **Rutare în spate:** DNS oneaigency.com → serverul unde rulează ONE21. Serverul răspunde la Host oneaigency.com și servește aplicația la /one21/ (și join la /one21/join).
- **Flow invitație:** Admin generează invitație cu nume + prenume; primește QR. Invitatul primește QR-ul; pe oneaigency.com dă click pe icon → e redirecționat la noi (oneaigency.com/one21/join); încarcă QR → întrebare „Who are you? (ONE/name only)” (răspuns: prenumele) → formular username + parolă → cont creat.

---

## 2. Model date

### Invitations — câmpuri noi

| Câmp    | Tip   | Descriere |
|--------|-------|-----------|
| token  | TEXT  | Unic, URL-safe, folosit în link/QR (ex. `a1b2c3d4`). Generat la creare. |
| nume   | TEXT  | Nume de familie (precompletat pentru join). |
| prenume| TEXT  | Prenume; răspunsul așteptat la „Who are you?”. |

- Păstrăm `code` pentru compatibilitate cu register existent; la join prin token folosim token pentru lookup, dar la register trimitem `invite_code` (sau acceptăm `token` și îl rezolvăm la code în backend).
- Migrare: adăugăm coloanele `token`, `nume`, `prenume`; pentru invitații noi generăm token (ex. 8 caractere alfanumerice).

---

## 3. Flux utilizator

1. **Admin (ONE21):** Creează invitație: nume, prenume (opțional note, permissions). Sistemul generează `code` + `token`. Admin vede/descarcă **QR** cu URL: `https://oneaigency.com/one21/join/<token>`.
2. **Invitatul:** Primește QR-ul (WhatsApp etc.). Deschide oneaigency.com (main page pe GoDaddy sau de la noi — la click pe icon e redirect la noi). Ajunge la **oneaigency.com/one21/join** (servit de serverul nostru).
3. **Pagina /one21/join:** Dacă nu e token în URL → afișează „Încarcă QR code”; user încarcă imagine → decode client-side (jsQR) → redirect la `/one21/join/<token>`.
4. **Pagina /one21/join/:token:** Fetch `GET /api/join/:token` → afișează „Who are you? (ONE/name only)”; user introduce prenumele → `POST /api/join/verify` (token + answer) → dacă corect, afișează formular **username** + **parolă**; la submit `POST /api/auth/register` cu token (sau invite_code rezolvat din token) + username + password. Nume/prenume din invitație se folosesc pentru display_name.
5. După register → redirect la oneaigency.com/one21/ (login sau auto-login).

---

## 4. API

- **GET /api/join/:token** (public): Returnează `{ nume, prenume }` dacă invitația există și nu e folosită; altfel 404.
- **POST /api/join/verify** (public): Body `{ token, answer }`. Verifică `answer.trim().toLowerCase() === invite.prenume.trim().toLowerCase()`. Returnează `{ ok: true }` sau 400.
- **POST /api/auth/register:** Extindere: acceptă `token` în loc de `invite_code`; dacă e token, rezolvă invitația după token și folosește `invite.code` intern. Body: `username`, `password`, `display_name?`, `invite_code?` sau `token?`.

---

## 5. Server și rute

- **Rutare:** Toate request-urile pentru oneaigency.com sunt servite de serverul ONE21 (DNS → acest server). Caddy/Express: server block pentru oneaigency.com; aplicația la `/one21`.
- **Fișiere:** Pagini join în `public/one21/` sau rute Express care servesc HTML pentru `GET /one21/join` și `GET /one21/join/:token` (același HTML, token din path).
- **Base URL:** În frontend, linkuri și redirecturi folosesc `/one21/` ca base path când host e oneaigency.com (sau mereu dacă aplicația e montată acolo).

---

## 6. Admin

- La creare invitație (modal sau form): câmpuri opționale **Nume**, **Prenume**. Dacă sunt completate, se generează **token** și se afișează **QR** (lib QR client-side sau server-side) cu `https://oneaigency.com/one21/join/<token>`.
- Lista de invitații poate afișa și token/link scurt pentru copy.

---

## 7. Rezumat

| Ce | Unde |
|----|------|
| DB | invitations: token (UNIQUE), nume, prenume |
| API | GET /api/join/:token, POST /api/join/verify, POST /api/auth/register acceptă token |
| Join pages | /one21/join (upload QR), /one21/join/:token (Who are you? → username/password) |
| Admin | Nume, prenume la creare; generare QR cu link oneaigency.com/one21/join/:token |
| DNS | oneaigency.com → server ONE21; rutare /one21 la aplicație |
