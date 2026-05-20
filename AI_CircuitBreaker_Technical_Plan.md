# AI Circuit Breaker — Master Technical Plan

> A proxy layer that sits between any app and any AI model, evaluating every call against a configurable policy rules engine in real-time.

---

## Team

| Agent | Domain |
|---|---|
| Architect | System design, API contracts, data models, tech stack |
| Backend Engineer | FastAPI proxy, rules engine, database, auth |
| Frontend Engineer | React dashboard, rule builder, log viewer |
| DevOps Engineer | Docker, CI/CD, deployment, secrets |

---

# PART 1 — SYSTEM ARCHITECTURE

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATIONS                       │
│           (any app that calls OpenAI / Anthropic / etc.)        │
└─────────────────────────┬───────────────────────────────────────┘
                          │  HTTP (same API shape as upstream)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CIRCUIT BREAKER PROXY                         │
│   apps/proxy  (FastAPI, async, port 8000)                       │
│                                                                  │
│   1. Auth middleware       — validate X-CB-Key header           │
│   2. Request logger        — write to request_logs (async)      │
│   3. Rule evaluator        — load policy from Redis cache       │
│   4. Action executor       — block / redact / reroute / allow   │
│   5. Upstream forwarder    — httpx.AsyncClient, inject API key  │
│   6. Response interceptor  — evaluate response rules            │
│   7. Response logger       — update request_log with response   │
└──────────┬──────────────────────────┬───────────────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────┐      ┌──────────────────────────────────────┐
│   Redis (cache)  │      │       Upstream AI Models              │
│                  │      │  (OpenAI / Anthropic / Cohere / etc.) │
│  - Active rules  │      └──────────────────────────────────────┘
│  - Rate counters │
│  - Kill switches │
└──────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    MANAGEMENT API                                 │
│   apps/api  (FastAPI, port 8001)                                │
│                                                                  │
│   - CRUD for projects, rules, alerts, API keys                  │
│   - JWT auth (RS256)                                            │
│   - SSE endpoint for live log streaming                         │
│   - Rule cache invalidation on change                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PostgreSQL                                    │
│   users, orgs, projects, policy_sets, rules,                    │
│   request_logs, alerts, api_keys                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   REACT DASHBOARD                                 │
│   apps/frontend  (Vite + React, served via Nginx)               │
│                                                                  │
│   - Login / signup                                               │
│   - Project management                                           │
│   - Rule builder (core UX)                                      │
│   - Live request log viewer (SSE)                               │
│   - Alert configuration                                          │
│   - Kill switch panel                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Proxy & API | Python / FastAPI | Async-native, streaming support, auto OpenAPI docs, IT-familiar |
| Database | PostgreSQL 16 | Reliable, JSONB for rule config, partitioned logs |
| Cache / rate-limit | Redis 7 | Sub-ms rule lookups, atomic counters for rate limiting |
| Auth | JWT (RS256) | Stateless, supports scope claims per project |
| Frontend | React + Vite + TypeScript | Industry standard, strong ecosystem |
| Styling | Tailwind CSS | Fast iteration, no CSS context switching |
| Data fetching | React Query | Caching, optimistic updates, background refetch |
| Charts | Recharts | React-native, composable |
| Deployment | Fly.io | Docker-based, managed Postgres + Redis, CLI-driven |
| CI/CD | GitHub Actions | Free, integrates with Fly.io |

## Core Data Models

```sql
-- Organizations (tenants)
CREATE TABLE orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email           TEXT UNIQUE NOT NULL,
  hashed_password TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member', -- admin | member
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects (one per AI agent deployment)
CREATE TABLE projects (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  upstream_base_url    TEXT NOT NULL, -- e.g. https://api.openai.com/v1
  upstream_api_key_enc TEXT NOT NULL, -- AES-256 encrypted
  status               TEXT NOT NULL DEFAULT 'active', -- active | paused | killed
  environment          TEXT NOT NULL DEFAULT 'production',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Policy Sets (a named collection of rules for a project)
CREATE TABLE policy_sets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rules
CREATE TABLE rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_set_id  UUID NOT NULL REFERENCES policy_sets(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  priority       INTEGER NOT NULL DEFAULT 100, -- lower = evaluated first
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  rule_type      TEXT NOT NULL, -- pii_block | rate_limit | action_whitelist | confidence_floor | time_fence | kill_switch | custom
  config         JSONB NOT NULL, -- rule-type-specific parameters
  action         TEXT NOT NULL, -- block | allow | redact | reroute | alert
  action_config  JSONB,          -- e.g. { "status_code": 429, "message": "..." }
  last_triggered TIMESTAMPTZ,
  trigger_count  BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rules_policy_set_priority ON rules(policy_set_id, priority) WHERE enabled = TRUE;

-- Request Logs (partitioned by day for performance)
CREATE TABLE request_logs (
  id             UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL,
  trace_id       TEXT NOT NULL,
  model          TEXT,
  request_method TEXT NOT NULL,
  request_path   TEXT NOT NULL,
  request_headers JSONB,
  request_body_hash TEXT,          -- SHA-256, not the body itself
  request_body_preview TEXT,       -- first 500 chars, redacted
  response_status INTEGER,
  response_latency_ms INTEGER,
  rule_triggered_id UUID,
  action_taken   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Alerts
CREATE TABLE alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  metric           TEXT NOT NULL, -- error_rate | latency_p99 | blocked_count | token_budget
  operator         TEXT NOT NULL, -- above | below | equals
  threshold        NUMERIC NOT NULL,
  window_seconds   INTEGER NOT NULL DEFAULT 300,
  silence_seconds  INTEGER NOT NULL DEFAULT 1800,
  channels         JSONB NOT NULL, -- [{ type: 'slack', webhook_url: '...' }, ...]
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys (for proxy authentication)
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_hash     TEXT UNIQUE NOT NULL, -- bcrypt hash of the full key
  key_prefix   TEXT NOT NULL,        -- first 8 chars, shown in UI
  scopes       TEXT[] NOT NULL DEFAULT '{proxy}',
  last_used    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Key API Endpoints

```
# Auth
POST   /api/auth/signup
POST   /api/auth/login
POST   /api/auth/refresh
DELETE /api/auth/logout

# Projects
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
POST   /api/projects/:id/kill      # immediate kill switch
POST   /api/projects/:id/resume

# Rules
GET    /api/projects/:id/rules
POST   /api/projects/:id/rules
GET    /api/projects/:id/rules/:ruleId
PATCH  /api/projects/:id/rules/:ruleId
DELETE /api/projects/:id/rules/:ruleId
POST   /api/projects/:id/rules/:ruleId/test  # test rule against sample request

# Logs
GET    /api/projects/:id/logs              # paginated historical
GET    /api/projects/:id/logs/stream       # SSE live stream
GET    /api/projects/:id/logs/:traceId     # single log detail

# Alerts
GET    /api/projects/:id/alerts
POST   /api/projects/:id/alerts
PATCH  /api/projects/:id/alerts/:alertId
DELETE /api/projects/:id/alerts/:alertId

# API Keys
GET    /api/projects/:id/keys
POST   /api/projects/:id/keys
DELETE /api/projects/:id/keys/:keyId

# Proxy (separate process, port 8000)
*      /:path*                             # catch-all proxy handler
GET    /health
GET    /health/ready
```

## Key Architectural Decisions

1. **Two separate processes (proxy + management API).** The proxy is the hot path — it must be fast and isolated. A management API restart should never drop live traffic. Separate processes share only the database.

2. **Synchronous, in-process rule evaluation.** Rules are CPU-light (regex/keyword). Sending to a sidecar adds network latency and a failure mode. Target: <10ms p99 overhead for rule evaluation.

3. **Redis caches the active rule set per project.** Rules are loaded from Postgres into Redis on first request and on any rule change (cache invalidation via pub/sub). Warm cache lookup: <1ms.

4. **Row-level multi-tenancy (not schema-per-tenant).** All tables have `org_id`. Simple to operate at MVP scale. Schema-per-tenant only worth it after 100+ enterprise customers.

5. **Request bodies are hashed, not stored.** Audit compliance: we prove a request was made (hash) without storing potentially sensitive data. Preview (first 500 chars, redacted) is stored for UX.

## Monorepo Folder Structure

```
ai-circuit-breaker/
├── apps/
│   ├── proxy/          # FastAPI proxy process
│   ├── api/            # FastAPI management API
│   └── frontend/       # React + Vite dashboard
├── packages/
│   ├── db/             # Shared SQLAlchemy models + Alembic migrations
│   └── shared/         # Shared Pydantic schemas, constants
├── docker/
│   ├── proxy.Dockerfile
│   ├── api.Dockerfile
│   └── frontend.Dockerfile
├── .github/
│   └── workflows/
├── docker-compose.yml
├── docker-compose.prod.yml
└── README.md
```

---

# PART 2 — BACKEND IMPLEMENTATION PLAN

## Proxy Mechanism

Every request to the proxy follows this pipeline:

```
Incoming request
       │
       ▼
1. Auth middleware
   - Extract X-CB-Key header
   - Hash it, look up in Redis (fallback: Postgres)
   - Attach project_id + org_id to request state
   - Return 401 if missing/invalid
       │
       ▼
2. Request logger (async, non-blocking)
   - Generate trace_id (UUID)
   - Write initial RequestLog row async (fire-and-forget)
       │
       ▼
3. Rule evaluator
   - Load active policy from Redis (keyed by project_id)
   - Evaluate rules in priority order (kill_switch first)
   - Short-circuit on BLOCK/KILL terminal actions
   - Collect non-terminal actions (ALERT, REDACT) and continue
       │
       ▼
4. Action executor
   - BLOCK: return HTTP 429 (or configured status) immediately
   - REDACT: apply regex patterns to request body
   - REROUTE: swap upstream URL
   - ALERT: fire webhook async (do not block request)
   - ALLOW: continue
       │
       ▼
5. Upstream forwarder
   - Strip X-CB-Key header
   - Inject upstream API key (decrypted from project config)
   - Forward via shared httpx.AsyncClient (connection pool)
   - Handle streaming: yield chunks via StreamingResponse
       │
       ▼
6. Response logger (async)
   - Update RequestLog with status, latency, response preview
```

**Streaming responses:** FastAPI `StreamingResponse` wraps an async generator. For streaming AI responses (SSE format), the generator yields chunks as they arrive from the upstream, with a configurable buffer to accumulate enough context for response-level rule evaluation.

**Latency target:** <10ms p99 overhead added by the proxy (excluding upstream model latency).

## Rules Engine Design

Rules are evaluated in a strict priority pipeline:

```
Priority order (always evaluated in this sequence):
1. KILL_SWITCH        — if project.status == 'killed', block immediately
2. TIME_FENCE         — check current UTC time against allowed windows
3. RATE_LIMIT         — atomic Redis counter, INCR + EXPIRE
4. ACTION_WHITELIST   — check requested tool/function against allowed list
5. PII_REGEX          — run compiled regex patterns against request body
6. CONFIDENCE_FLOOR   — check response confidence score (response-phase only)
7. CUSTOM             — user-defined JSONPath conditions
```

**Rule config shapes (JSONB):**

```json
// PII regex rule
{ "patterns": ["\\b\\d{3}-\\d{2}-\\d{4}\\b", "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b"] }

// Rate limit rule
{ "max_calls": 100, "window_seconds": 60, "scope": "project" }

// Action whitelist rule
{ "allowed_tools": ["web_search", "calculator"], "match_field": "body.tools" }

// Time fence rule
{ "allowed_days": [1,2,3,4,5], "allowed_hours_utc": [8, 18] }

// Confidence floor rule
{ "min_confidence": 0.7, "confidence_field": "response.usage.confidence" }
```

**Performance:** Regex patterns are compiled once when the rule set is loaded into the in-process cache. Not recompiled per request.

## Backend Modules

```
apps/
├── proxy/
│   ├── main.py              # FastAPI app, middleware wiring
│   ├── middleware/
│   │   ├── auth.py          # X-CB-Key validation
│   │   └── logging.py       # Structured request logging
│   ├── pipeline/
│   │   ├── evaluator.py     # Orchestrates rule evaluation pipeline
│   │   └── forwarder.py     # httpx upstream forwarding + streaming
│   ├── evaluators/
│   │   ├── kill_switch.py
│   │   ├── rate_limit.py    # Redis INCR/EXPIRE
│   │   ├── pii_regex.py     # Compiled regex evaluation
│   │   ├── time_fence.py
│   │   ├── action_whitelist.py
│   │   └── confidence_floor.py
│   └── cache/
│       ├── rule_cache.py    # Load/invalidate rules from Redis
│       └── key_cache.py     # API key lookup cache
│
├── api/
│   ├── main.py              # FastAPI app, router wiring
│   ├── routers/
│   │   ├── auth.py
│   │   ├── projects.py
│   │   ├── rules.py
│   │   ├── logs.py          # REST + SSE stream endpoint
│   │   ├── alerts.py
│   │   └── keys.py
│   ├── services/
│   │   ├── rule_service.py  # Business logic, cache invalidation
│   │   ├── alert_service.py # Alert evaluation + webhook dispatch
│   │   └── key_service.py   # Key generation + hashing
│   └── auth/
│       ├── jwt.py           # RS256 token issue/verify
│       └── dependencies.py  # FastAPI Depends() auth guards
│
packages/
├── db/
│   ├── models.py            # SQLAlchemy ORM models
│   ├── session.py           # Async sessionmaker
│   └── migrations/          # Alembic migration files
└── shared/
    ├── schemas.py           # Pydantic request/response schemas
    └── constants.py         # Rule types, action types, etc.
```

## Authentication & Multi-tenancy

**Proxy auth:** `X-CB-Key: sk-proj_<random_32_bytes>` header. The key is bcrypt-hashed in Postgres. The prefix (first 8 chars) is stored plaintext for display. On validation, the hash is cached in Redis for 60 seconds.

**Dashboard auth:** RS256 JWT. Payload: `{ sub: user_id, org_id, exp, iat }`. Access token TTL: 15 minutes. Refresh token: 7 days (stored as hash in DB for revocation). The management API serves as the auth server.

**Multi-tenancy:** Every DB query is scoped by `org_id` extracted from the JWT. There is no shared state between tenants except the database server itself. Row-level security can be added in Postgres as an extra safety net.

## Observability & Logging

**Structured logs (structlog):**

```json
{
  "timestamp": "2026-05-19T10:23:11.421Z",
  "level": "info",
  "event": "request_proxied",
  "trace_id": "01HX...",
  "project_id": "uuid",
  "model": "gpt-4o",
  "latency_ms": 8,
  "rule_triggered": "pii_block",
  "action": "block",
  "upstream_status": null
}
```

**Metrics (Prometheus, internal endpoint):**
- `proxy_requests_total{project_id, action}` — counter
- `proxy_latency_ms{project_id}` — histogram
- `rules_evaluated_total{rule_type}` — counter
- `upstream_latency_ms{model}` — histogram

**Estimated proxy overhead:** 5–8ms p99 for typical rule sets (2–5 rules, no ML). Redis round-trip: ~1ms. Rule evaluation (compiled regex): ~0.5ms. Async DB write: non-blocking, 0ms added to response path.

---

# PART 3 — FRONTEND IMPLEMENTATION PLAN

## Page Inventory

| Route | Page | Key UI Elements |
|---|---|---|
| `/login` | Login | Email + password, OAuth buttons |
| `/signup` | Sign Up | Name, email, password, org name |
| `/` | Dashboard Home | KPI cards, request volume chart, kill switch panel, activity feed |
| `/projects` | Projects List | Project cards with status, request count |
| `/projects/new` | Create Project | Multi-step wizard |
| `/projects/:id` | Project Overview | Per-project metrics, quick actions |
| `/projects/:id/rules` | Rules List | Table with enable/disable toggles |
| `/projects/:id/rules/new` | Rule Builder | Full-page condition + action form |
| `/projects/:id/rules/:ruleId` | Rule Editor | Pre-populated rule builder |
| `/projects/:id/logs` | Log Viewer | Filterable virtualized table, SSE live mode |
| `/projects/:id/alerts` | Alert Config | Alert table + SlideOver form |
| `/projects/:id/settings` | Project Settings | General, API Keys, Danger Zone tabs |
| `/settings` | Org Settings | Name, billing, members, SSO |

## Component Hierarchy (abridged)

```
AppShell
├── Sidebar (OrgSwitcher, Nav, ProjectNav, UserMenu)
├── TopBar (Breadcrumb, StatusBadge, GlobalKillSwitch)
└── PageContent

shared/ui/
  StatusBadge, MetricCard, CodeBlock, CopyButton,
  ConfirmDialog, FilterBar, EmptyState, Skeleton,
  ToastProvider, SlideOver, TimeRangeSelector

features/
  dashboard/    KPIStrip, RequestVolumeChart, RuleActivityFeed, KillSwitchPanel
  rules/        RuleBuilderForm, ConditionGroup, ConditionRow, ActionConfigurator, RuleTestModal
  logs/         LogTable (virtualized), LogFilterBar, LogStreamIndicator, LogExportButton
  alerts/       AlertTable, AlertSlideOver, AlertConditionPicker, NotificationChannelPicker
  settings/     GeneralSettingsForm, APIKeyTable, CreateAPIKeyModal, DangerZone
```

## Real-time: Server-Sent Events (SSE)

SSE is chosen over WebSocket and polling because:
- **Unidirectional** — server pushes log entries, client never sends on the stream
- **Auto-reconnect** — native `EventSource` API with `Last-Event-ID` ensures no entries are missed
- **Proxy-friendly** — enterprise proxies handle SSE correctly; WebSocket is frequently blocked
- **Simpler backend** — standard HTTP keep-alive, no upgrade handshake

**Client hook:** `useLogStream(projectId, filters)` opens `EventSource` to `/api/projects/:id/logs/stream`, prepends entries to a local buffer, handles reconnect state, and exposes `pause()` / `resume()`.

**Backpressure:** Events are batched into React state updates on 100ms intervals to prevent UI lockup during traffic spikes.

## State Management

- **React Query** — all server state (projects, rules, logs, alerts, keys)
- **react-hook-form + zod** — rule builder form with nested field arrays
- **Zustand (minimal)** — `activeProjectId`, `liveLogsPaused`, `pendingKillSwitchConfirm`
- **URL params** — log filter state synced via `useSearchParams` for shareable filtered views

---

# PART 4 — DEVOPS IMPLEMENTATION PLAN

## Docker Setup

**5 containers via docker-compose:**

| Container | Image | Purpose |
|---|---|---|
| `db` | postgres:16-alpine | Primary data store |
| `redis` | redis:7-alpine | Rule cache, rate limit counters |
| `migrate` | `./docker/api.Dockerfile` | One-shot Alembic migration runner |
| `backend` | `./docker/api.Dockerfile` + `./docker/proxy.Dockerfile` | FastAPI processes |
| `frontend` | `./docker/frontend.Dockerfile` | Nginx serving React build + `/api` proxy |

`migrate` depends on `db` being healthy. `backend` depends on `migrate` exiting with code 0. This ensures schema is always current before the app serves traffic.

**Volumes:** One named volume `postgres_data`. Redis is intentionally ephemeral at MVP.

## Dockerfile Plans

**Backend (multi-stage):**
```
Stage 1 base:    python:3.12-slim — OS deps (libpq-dev, curl)
Stage 2 builder: pip install from requirements.txt into /install
Stage 3 runtime: python:3.12-slim + libpq5 only, copy /install, run as non-root user
```

**Frontend (multi-stage):**
```
Stage 1 deps:    node:20-alpine — npm ci
Stage 2 builder: npm run build — outputs /app/dist
Stage 3 runtime: nginx:alpine — copy dist + nginx.conf, proxy /api to backend
```

## CI/CD Workflows (GitHub Actions)

**`pr-checks.yml`** — runs on every PR:
- Ruff (Python lint), mypy (type check), pytest with a real Postgres service container
- ESLint, TypeScript compiler check (tsc --noEmit), vitest
- Docker build (no push) to catch Dockerfile errors

**`deploy-staging.yml`** — runs on push to `main`:
1. Build and push Docker images to GitHub Container Registry
2. `flyctl deploy --app cb-staging` (proxy + api)
3. Run migrations via `flyctl ssh console -a cb-staging-api -- alembic upgrade head`
4. Smoke test: `curl https://cb-staging.fly.dev/health/ready`

**`deploy-production.yml`** — runs on release tags (`v*.*.*`):
1. Same as staging but targets `cb-production` apps
2. Requires manual approval via GitHub Environment protection rule
3. Posts deployment notification to Slack

## Secrets Management

| Secret | Where stored | How accessed |
|---|---|---|
| `DATABASE_URL` | Fly.io secrets | `flyctl secrets set` |
| `REDIS_URL` | Fly.io secrets | `flyctl secrets set` |
| `SECRET_KEY` (JWT signing) | Fly.io secrets | `flyctl secrets set` |
| `ENCRYPTION_KEY` (API keys at rest) | Fly.io secrets | `flyctl secrets set` |
| `FLY_API_TOKEN` | GitHub Secrets | Used by Actions to deploy |
| Local dev secrets | `.env` (gitignored) | `.env.example` committed as contract |

## Cloud Deployment: Fly.io

**Why Fly.io over Render / Railway:**
- Deploys directly from Dockerfiles — no special build config
- Managed Postgres (fly-postgres) and Redis (Upstash integration) included
- Private networking between apps — proxy can reach API without public internet
- Scale-to-zero Machines — $0 when idle, important at MVP
- CLI-driven — no web console required

**Initial setup:**
```bash
flyctl launch --name cb-proxy    # proxy app
flyctl launch --name cb-api      # management API
flyctl launch --name cb-frontend # React frontend
flyctl postgres create --name cb-db
flyctl redis create --name cb-redis
flyctl secrets set DATABASE_URL="..." --app cb-api
flyctl secrets set DATABASE_URL="..." --app cb-proxy
```

## Database Migrations (Alembic)

- Migrations live in `packages/db/migrations/`
- `alembic upgrade head` runs in the `migrate` container before `backend` starts (Docker Compose) and via `flyctl ssh console` before the new image takes traffic in CI/CD
- Guideline: all MVP migrations must be **additive** (add columns/tables only) — never drop or rename in the same migration as data changes. This enables zero-downtime deploys.

## Monitoring & Health Checks

**Health endpoints:**
- `GET /health` — liveness check, returns `200 OK` immediately (no DB check)
- `GET /health/ready` — readiness check, verifies DB connection + Redis ping

**External monitoring:** UptimeRobot (free tier) pings `/health` every 5 minutes. Alerts via email on downtime.

**Error tracking:** Sentry (free tier). One line of setup: `sentry_sdk.init(dsn=...)` in both FastAPI apps.

**Log viewer:** Fly.io `flyctl logs --app cb-api` — JSON-structured logs are parsed by Fly's log viewer automatically.

---

# BUILD TIMELINE

| Week | Milestone |
|---|---|
| 1–2 | Monorepo scaffold, Docker Compose working, Postgres + Redis up |
| 3–4 | Proxy forwarding works end-to-end, auth middleware, first rule (PII regex) |
| 5–6 | Full rules engine (all 6 rule types), management API CRUD |
| 7–8 | React dashboard: login, projects, rule builder |
| 9 | Log viewer with SSE, alert configuration |
| 10 | CI/CD pipeline, deploy to Fly.io staging |
| 11 | Polish, bug fixes, API key management UI |
| 12 | First paying customer onboarding |

---

*Generated by the AI Circuit Breaker agent team: Architect · Backend Engineer · Frontend Engineer · DevOps Engineer*
