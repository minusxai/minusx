## Local development

MinusX is a single Next.js application — there is no separate backend service.
The AI chat/agent orchestration runs in-process (TypeScript orchestrator under
`frontend/orchestrator/` + `frontend/agents/`).

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment Variables

**This is a one-time setup.**

```bash
cd frontend
cp .env.example .env
```

Generate the required NextAuth secret:
```bash
openssl rand -base64 32
```

Edit `frontend/.env`:
```bash
NEXTAUTH_SECRET=<generated-secret-here>
```

The LLM provider is configured in the app after first launch (setup wizard
"AI Models" step, or Settings → Models) — there are no LLM env vars.

### 3. Start the App

```bash
cd frontend
npm run dev
```

The application will be available at http://localhost:3000

### 4. Run in production

`docker-compose.yml` pulls the latest stable frontend image from ghcr.io and uses
embedded PGLite for storage:
```bash
docker compose up -d
```

`docker-compose.prod.yml` pulls the canary image and uses an external Postgres
database. Set `DATABASE_URL` in `frontend/.env` before starting (see
`frontend/.env.example`):
```bash
# frontend/.env
DATABASE_URL=postgresql://user:password@host:5432/dbname

docker compose -f docker-compose.prod.yml up -d
```
