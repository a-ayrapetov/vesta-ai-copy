# Vesta AI (Fashion Companion)

Local-first AI fashion companion: chat styling advice, DeepFashion image suggestions, affiliate product catalog (browse), wardrobe/trends tabs, and demo virtual try-on. **Online-only commerce** — no owned inventory; cart/checkout handoff is next.

## Features

- **AI Fashion Assistant**: Claude-powered chat with structured outfit / color / accessory responses
- **Image Analysis**: Upload clothing photos for styling advice
- **DeepFashion catalog**: Local image corpus for recommendations (`server/data/DeepFashion-MultiModal`)
- **Affiliate products**: Postgres `products` + `GET /api/catalog`; chat prefers affiliate rows when seeded
- **Chat History**: Persisted in PostgreSQL for the local MVP user
- **Virtual Try-On (demo)**: UI + API; results are explicitly labeled demo until Kolors/production VTO is wired
- **Fallback**: Rule-based + DeepFashion responses when the Anthropic API is unavailable

## Technology Stack

- **Frontend**: React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Express.js, Node.js (`server/index.ts` serves API + Vite client in one process)
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: Anthropic Claude (`ANTHROPIC_API_KEY`) via `server/services/fashionAi.ts`
- **Mobile**: Expo subset (chat-focused)

---

## Quick start (do this in order)

You run **one Node process** for the web app. Postgres (and optionally try-on) run separately.

### 1. Prerequisites

- Node.js 18+
- Docker Desktop (for Postgres) **or** a local PostgreSQL 16
- An [Anthropic API key](https://console.anthropic.com/)

### 2. Clone and install dependencies

```bash
cd /path/to/FashionMentor   # or FashionMentor
npm install
```

### 3. Create `.env` (required before DB or app)

```bash
cp .env.example .env
```

Edit `.env` and set at least:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection (Compose default below) |
| `ANTHROPIC_API_KEY` | Claude chat |

Compose Postgres defaults (use these unless you changed `docker-compose.yml`):

```env
DATABASE_URL=postgresql://vesta:vesta@localhost:5432/vesta_ai
ANTHROPIC_API_KEY=sk-ant-...your-key...
PORT=3000
STORAGE_MODE=local
STORAGE_LOCAL_ROOT=./uploads
```

### 4. Start Postgres first

```bash
npm run docker:db
```

This runs `docker compose up -d postgres` and listens on **localhost:5432**.

Wait until healthy (a few seconds). Check with:

```bash
docker compose ps
```

### 5. Apply database schema

```bash
npm run db:push
```

Uses Drizzle (`drizzle.config.ts` + `shared/schema.ts`) against `DATABASE_URL`.

### 6. Seed affiliate demo catalog (optional but recommended)

```bash
npm run catalog:ingest
```

Loads `server/fixtures/affiliate-products.json` into `products` (idempotent upsert). Override path with `AFFILIATE_FEED_PATH`. See [docs/MILESTONE_2_NOTES.md](docs/MILESTONE_2_NOTES.md).

### 7. Start the app (API + UI together)

```bash
npm run dev
```

This starts `server/index.ts` on **http://localhost:3000** (Express API + Vite React UI).

**Smoke check:**

```bash
curl http://localhost:3000/api/health
curl "http://localhost:3000/api/catalog?audience=feminine&limit=5"
```

Expected health JSON includes `"status":"ok"`. Then open **http://localhost:3000** in the browser (Chat tab).

### 8. Optional — DeepFashion images

For catalog-style outfit images in chat, place data locally (not in git):

```text
server/data/DeepFashion-MultiModal/captions.json
server/data/DeepFashion-MultiModal/images/...
```

Served at `/data/deepfashion/images/...`.

**Docker (`--profile full`):** the dataset is **not** copied into the image (see `.dockerignore`). Compose bind-mounts the host folder:

```text
./server/data/DeepFashion-MultiModal → /app/server/data/DeepFashion-MultiModal
```

If that host folder is missing, chat/recommendations will have no local images. Host `npm run dev` uses the same path on disk (no Compose mount needed).

### 8. Optional — virtual try-on sidecar

Only if you want try-on beyond the UI demo label:

```bash
npm run docker:vto
```

Then in `.env`:

```env
PYTHON_SERVICE_URL=http://localhost:8000
```

Restart `npm run dev`. Try-on UI calls **your** API `POST /api/virtual-try-on`, which proxies to the Python service.

---

## Tests

```bash
npm run check   # typecheck
npm test        # unit tests + the real API against Postgres (run npm run db:push first)
```

CI runs both plus `eval:chat` on every push. Review notes and open items: [docs/REVIEW_2026-11-07.md](docs/REVIEW_2026-11-07.md).

## Conversation / prompt eval (manual)

Do **not** run these on every boot. Use them after prompt or intent changes. They never call Claude.

```bash
npm run eval:chat              # mock catalog, no tokens, no database, only mocked data
npm run eval:retrieval         # local DeepFashion mix / gender-leak
EVAL_CHAT_CORPUS=1 npm run eval:chat   # same chats against DeepFashion images
```

Details: [docs/EVAL_CHAT.md](docs/EVAL_CHAT.md).
---

## What talks to what

```text
Browser (localhost:3000)
    │
    ├─ UI (Vite/React)
    └─ fetch /api/*  ──────────────►  Express (server/index.ts + server/routes.ts)
                                            │
                                            ├─ DATABASE_URL ──► Postgres :5432
                                            ├─ ANTHROPIC_API_KEY ──► Claude API
                                            ├─ STORAGE_MODE=local ──► ./uploads (+ /uploads URL)
                                            └─ PYTHON_SERVICE_URL? ──► VTO :8000 (optional)
```

You do **not** start the React app separately for web; `npm run dev` is enough.

---

## API reference (main endpoints)

Base URL: `http://localhost:3000`

| Method | Path | Used by | Notes |
|--------|------|---------|--------|
| `GET` | `/api/health` | You / Docker | Liveness; shows storage + VTO config flags |
| `POST` | `/api/chat` | Chat UI | Body: `{ message, history?, imageData? }` → Claude / local fallback |
| `POST` | `/api/chat/history` | Chat UI | Saves thread for local MVP user |
| `GET` | `/api/chat/history/:id` | Chat UI | Load one thread |
| `GET` | `/api/chat/histories/1` | Sidebar | List histories (`1` = local MVP user) |
| `PUT` | `/api/chat/history/:id` | Chat UI | Update messages |
| `GET` | `/api/recommendations?query=&limit=` | Optional clients | DeepFashion outfits |
| `GET` | `/api/catalog?audience=&category=&color=&style=&search=` | You | Affiliate products |
| `GET` | `/api/cart` | Cart UI | Lines grouped by merchant + subtotal |
| `POST` | `/api/cart/items` | Product cards | `{ productId, quantity? }` |
| `PATCH`/`DELETE` | `/api/cart/items/:itemId` | Cart UI | Quantity change / remove |
| `GET` | `/api/go/:productId?source=` | Buy links | Logs click, 302 to merchant |
| `POST` | `/api/virtual-try-on` | Try-on dialog | Needs `PYTHON_SERVICE_URL` or returns setup error |

Example chat call:

```bash
curl -s http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Suggest a casual navy outfit"}'
```

---

## Other run modes

### Full stack in Docker (API image + Postgres)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
docker compose --profile full up --build
```

App: http://localhost:3000 · DB only reachable as `postgres` inside the network (host still uses `localhost:5432` if the postgres service is up).

### Stop containers

```bash
npm run docker:down
```

### Mobile (separate process)

```bash
cd client/mobile
npm install
npm start
```

Point `src/lib/api.js` at your machine’s LAN IP and port **3000** (the same Express server).

---

## Lift to cloud later

| Concern | Local now | Cloud later |
|---------|-----------|-------------|
| Database | Compose `postgres` | Managed Postgres (`DATABASE_URL`) |
| API | `npm run dev` or Compose `api` | Same Docker image |
| Uploads | `STORAGE_MODE=local` → `./uploads` | `STORAGE_MODE=s3` (stub in `objectStorage.ts`) |
| Try-on | Compose profile `vto` | Same image or hosted VTO URL |

See [docs/MILESTONE_0B_NOTES.md](docs/MILESTONE_0B_NOTES.md).

## Cursor agent roles

`.cursor/rules/` — `orchestrator`, `analyst`, `developer`, `debugger`. Mention with `@` when working a milestone.

## Documentation

- [Feature list](docs/FEATURES.md) — everything implemented so far, plus demo feed contents

### Milestone notes

- [Milestone 0 cleanup](docs/MILESTONE_0_NOTES.md)
- [Milestone 0b Docker / storage](docs/MILESTONE_0B_NOTES.md)
- [Milestone 1 prompt / intent retrieval](docs/MILESTONE_1_NOTES.md)
- [Milestone 2 affiliate catalog](docs/MILESTONE_2_NOTES.md)
- [Milestone 3 cart / checkout handoff](docs/MILESTONE_3_NOTES.md)
- [Milestone 3.5 prompt / retrieval eval](docs/MILESTONE_3_5_NOTES.md)
- [Milestone 3.6 search / browse](docs/MILESTONE_3_6_NOTES.md)
- [Conversation simulations (eval:chat)](docs/EVAL_CHAT.md)

## License

MIT
