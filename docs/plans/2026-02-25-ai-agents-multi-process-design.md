# ONE21 — Configurare agenți AI (multi-agent, un proces per agent)

**Data:** 2026-02-25  
**Status:** Approved — ready for implementation

---

## 1. Scop și premise

**Scop:** Să se poată conecta **mai mulți agenți AI** la ONE21, fiecare prin **propriul proces extern**, cu backend fie **Ollama** (local), fie **API comercial** (API key). ONE21 rămâne platformă de chat pentru useri invitați; agenții sunt opționali.

**Premise:**
- ONE21 = **uz intern**; nu se promovează, nu se face disponibilă public.
- **Agenții sunt opționali** — adminul decide dacă și în ce camere există agenți.
- **Mai mulți agenți** — mai mulți useri cu `role = 'agent'` (ex. `claude`, `local-llama`).
- **Un proces per agent** — fiecare agent rulează în proces separat, cu env propriu (identitate + backend LLM).
- Configurația LLM (URL Ollama, API keys) stă în **env-ul procesului**; ONE21 nu stochează aceste date pentru agenți, doar autentificarea la Agent API.

---

## 2. Autentificare Agent API

- **Un API key comun** pentru toți agenții: `AGENT_API_KEY` (env pe server). Toate procesele trimit același key în header `X-Agent-Key`.
- **Identitate agent:** header `X-Agent-Username` (ex. `claude`, `local-llama`). Serverul verifică că există un user cu acel username și `role = 'agent'`, apoi execută acțiunea în numele acelui user.
- **Validare:** lipsă/invalid key → 401; lipsă username sau user nu e agent → 401/403.

---

## 3. Modificări ONE21

### 3.1 `middleware/agent.js`

- După validarea `X-Agent-Key`, citire `X-Agent-Username`.
- Încărcare user din DB după username; verificare `role === 'agent'`.
- Atașare `req.agentUser` (obiect user: id, username, display_name, role).
- Răspunsuri: 401 dacă key invalid; 401 dacă username lipsă sau user inexistent; 403 dacă user există dar nu e agent.

### 3.2 `routes/agent.js`

- **GET /api/agent/rooms** — folosește `req.agentUser.id`; elimină hardcodul `username = 'claude'`. Lista camere unde agentul e member.
- **GET /api/agent/messages** — parametri `room`, `since`, `limit`. Verificare că `req.agentUser` e member în `room_id`; altfel 403. Returnare mesaje ca până acum.
- **POST /api/agent/send** — folosește `req.agentUser.id`; verificare membership în cameră; inserare mesaj și emit Socket.IO ca acum.
- **GET /api/agent/users** — fără schimbare (listează useri pentru context); poate rămâne disponibil pentru toți agenții.

### 3.3 Comportament existent păstrat

- Socket.IO, admin, frontend, restul API-urilor rămân neschimbate.
- Permisiuni `allowed_agents` (useri umani care pot vedea camere cu agenți) rămân la fel.

---

## 4. Contract pentru procesul extern (documentare)

Procesul extern **nu face parte din acest repo**; rulează separat (ex. script Node/Python, PM2 per agent). Contract:

**Env obligatorii:**
- `ONE21_BASE_URL` — ex. `http://localhost:3737`
- `AGENT_API_KEY` — același ca pe server
- `AGENT_USERNAME` — username-ul userului agent (ex. `claude`)
- Backend LLM: fie `OLLAMA_BASE_URL` (+ opțional model), fie un API key comercial (ex. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)

**Headers la fiecare request:**
- `X-Agent-Key: <AGENT_API_KEY>`
- `X-Agent-Username: <AGENT_USERNAME>`

**Flux (polling):**
1. `GET /api/agent/rooms` → liste camere unde agentul e member.
2. Pentru fiecare cameră, păstrezi `last_message_id`; periodic `GET /api/agent/messages?room=<id>&since=<last_message_id>`.
3. Dacă există mesaje noi de la alți useri (nu de la acest agent): construiești context, apelezi Ollama sau API comercial, apoi `POST /api/agent/send` cu `{ room_id, text }`.
4. Actualizezi `last_message_id` după ce procesezi.

**Env server:** Setează `AGENT_API_KEY` în `.env` (sau `.env.production`); clienții agenți trimit header-ele `X-Agent-Key` și `X-Agent-Username` la fiecare request.

**Notă:** Implementarea efectivă a procesului extern (buclă, format prompt, retry) este în afara scope-ului acestui plan; planul curent acoperă doar modificările din ONE21 pentru a suporta mai mulți agenți și identificare prin `X-Agent-Username`.

---

## 5. Rezumat

| Ce | Unde |
|----|------|
| Identitate agent | Header `X-Agent-Username`; middleware încarcă user, verifică role agent, pune `req.agentUser` |
| Rute agent | Folosesc `req.agentUser` în loc de user fix `claude`; GET messages verifică membership |
| Proces extern | Un proces per agent; env ONE21_BASE_URL, AGENT_API_KEY, AGENT_USERNAME + backend LLM; polling |

---

**Următorul pas:** Plan de implementare (modificări concrete în `middleware/agent.js` și `routes/agent.js`).
