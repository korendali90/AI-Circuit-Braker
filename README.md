# AI Circuit Breaker

A self-hosted API proxy that sits between your application and any AI provider (OpenAI, Anthropic, etc.), enforcing configurable rules — PII blocking, rate limiting, time fences, kill switches, and action whitelists — before requests reach the model. Manage everything from a React dashboard with real-time request logs.

## Quick Start

```bash
cp .env.example .env
docker-compose up
```

Dashboard: http://localhost:3000
API: http://localhost:8001
Proxy: http://localhost:8000

## Integration

Point your existing AI client at the proxy and add your Circuit Breaker API key.

**Python**
```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:8000/v1",  # was: https://api.openai.com/v1
    api_key="sk-your-openai-key",         # still needed for upstream
    default_headers={"X-CB-Key": "sk-cb_your_circuit_breaker_key"},
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

**JavaScript / TypeScript**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://localhost:8000/v1',  // was: https://api.openai.com/v1
  apiKey: 'sk-your-openai-key',
  defaultHeaders: { 'X-CB-Key': 'sk-cb_your_circuit_breaker_key' },
})

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
})
```

## Running Tests

**Backend (pytest)**
```bash
cd apps/api
pytest tests/ -v

cd apps/proxy
pytest tests/ -v
```

**Frontend (vitest)**
```bash
cd apps/frontend
npm run test
```

## Project Structure

```
.
├── apps/
│   ├── api/                  # FastAPI management API (port 8001)
│   │   └── app/
│   │       ├── auth/         # JWT + dependencies
│   │       ├── routers/      # auth, projects, rules, keys, logs, alerts
│   │       └── main.py
│   ├── proxy/                # FastAPI proxy (port 8000)
│   │   └── app/
│   │       ├── cache/        # Redis rule cache
│   │       ├── evaluators/   # pii_regex, rate_limit, time_fence
│   │       ├── pipeline/     # evaluator + forwarder
│   │       └── main.py
│   └── frontend/             # React + Vite dashboard (port 3000)
│       └── src/
│           ├── components/
│           ├── lib/api/      # typed API client
│           ├── pages/
│           └── store/
├── packages/
│   ├── db/                   # SQLAlchemy models + sessions
│   └── shared/               # Pydantic schemas
├── docker/                   # Dockerfiles + nginx.conf
├── docker-compose.yml
├── fly.toml                  # Fly.io deployment config
└── alembic.ini               # DB migrations
```

## Rule Types

| Type | What it does | Key config fields |
|------|-------------|-------------------|
| **PII Block** | Blocks requests matching regex patterns (SSN, credit card, email, custom) | `patterns: [...]` |
| **Rate Limit** | Blocks traffic that exceeds N calls per time window | `max_calls`, `window_seconds` |
| **Time Fence** | Restricts AI calls to allowed hours / days | `allowed_hours`, `allowed_days`, `timezone` |
| **Kill Switch** | Instantly stops all traffic to a project (`status: killed`) | Set project status via dashboard |
| **Action Whitelist** | Allows only explicitly permitted request paths or methods | `allowed_paths: [...]` |

Rules are evaluated in ascending priority order. The first blocking rule wins.

## Deploy to Fly.io

```bash
fly auth login
fly launch --copy-config          # uses fly.toml, prompts for app name
fly secrets set SECRET_KEY=$(openssl rand -hex 32) \
             ENCRYPTION_KEY=$(openssl rand -base64 32) \
             DATABASE_URL="postgres://..."
fly deploy
```
