# Security Audit Report — AI Circuit Breaker

Audited by: Security Agent  
Date: 2026-05-20

---

## Summary

**10 critical/high issues found. 9 fixed in-code. 1 requires architectural decision (manual).**

| Severity | Count | Fixed |
|----------|-------|-------|
| Critical | 3 | 3 |
| High | 5 | 4 |
| Medium | 5 | 4 |

---

## Findings

### [CRITICAL-1] API Key Hash Algorithm Mismatch — Auth Bypass

- **File:** `apps/api/app/routers/keys.py` line 67, `apps/proxy/app/main.py` line 106
- **Issue:** API keys were stored using `hashlib.sha256()` (hex digest) in `keys.py`, but the proxy verified them using `passlib.CryptContext(schemes=["bcrypt"]).verify()`. Bcrypt verify against a SHA-256 hex string always returns `False`. Every proxy authentication check would silently fail, making the X-CB-Key auth completely non-functional.
- **Fix applied:** Yes
- **Details:** Changed `keys.py` to use `passlib.CryptContext(schemes=["bcrypt"]).hash()`, matching what the proxy uses for verification. Removed the `hashlib` import entirely.

---

### [CRITICAL-2] Hardcoded Default SECRET_KEY Used in Production

- **File:** `apps/api/app/auth/jwt.py` line 7, `apps/proxy/app/config.py` line 8
- **Issue:** Both files default to `"dev-secret-key-change-in-production"` with no startup validation. In production, any JWT signed with this key can be forged by anyone who reads the source code, granting full account access to any org.
- **Fix applied:** Yes
- **Details:** Added a startup check in `jwt.py` that raises `RuntimeError` if `ENVIRONMENT != "development"` and the default key is still set. Added `validate_production_secrets()` in `proxy/config.py` called at module load time. A `logger.warning` is emitted even in development.

---

### [CRITICAL-3] Weak Default ENCRYPTION_KEY with Broken Padding Logic

- **File:** `apps/api/app/routers/projects.py` lines 28–38
- **Issue:** `_get_fernet()` defaulted to a hardcoded dev key AND had a broken fallback: keys not exactly 44 chars were silently truncated to 32 bytes and zero-padded, producing a predictable, low-entropy key. This could cause incorrect decryption or allow an attacker who knows the source to derive the encryption key.
- **Fix applied:** Yes
- **Details:** Replaced the broken truncation/padding logic with strict length validation. The function now raises `RuntimeError` in production if `ENCRYPTION_KEY` is absent, and `ValueError` for any unexpected key length. In development only, the deterministic dev key is used with a warning.

---

### [HIGH-1] ReDoS Vulnerability in PII Regex Evaluator

- **File:** `apps/proxy/app/evaluators/pii_regex.py` line 15
- **Issue:** The built-in credit card pattern `\b(?:\d[ -]?){13,16}\b` is vulnerable to catastrophic backtracking (ReDoS). A malicious payload like `1111111111111111111111111!` would cause exponential backtracking, stalling the event loop and causing a denial-of-service. The email pattern also used `[A-Z|a-z]` (the `|` is treated as a literal character, making it subtly wrong), and user-supplied patterns were compiled without any error handling.
- **Fix applied:** Yes
- **Details:** Replaced the credit card pattern with an explicit non-backtracking format. Fixed the email charset. Added input truncation to 64KB before evaluation. Added `try/except re.error` around both compile and search calls. Invalid patterns are skipped with a warning instead of crashing.

---

### [HIGH-2] CORS Wildcard (`allow_origins=["*"]`) with `allow_credentials=True`

- **File:** `apps/api/app/main.py` line 29
- **Issue:** `allow_origins=["*"]` with `allow_credentials=True` is both a security misconfiguration and actually invalid per the CORS spec (browsers reject credentialed requests to wildcard origins). In development this falls back silently; in production it could allow any origin to make credentialed API calls.
- **Fix applied:** Yes
- **Details:** CORS origins are now read from `ALLOWED_ORIGINS` env var (comma-separated). In development mode the default is `["http://localhost:3000"]`. In production with no `ALLOWED_ORIGINS` set, the list is empty (same-origin only, safe fail). The wildcard is gone.

---

### [HIGH-3] Missing Security Headers on All API Responses

- **File:** `apps/api/app/main.py`
- **Issue:** No `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, or `Strict-Transport-Security` headers were set. This allows MIME-type sniffing attacks, clickjacking, and referrer leakage of tokens in URLs.
- **Fix applied:** Yes
- **Details:** Added `SecurityHeadersMiddleware` that injects `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and (in non-development environments) `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.

---

### [HIGH-4] Stack Traces / Infrastructure Details Leaked in Error Responses

- **File:** `apps/api/app/main.py` line 55, `apps/proxy/app/main.py` lines 65–77
- **Issue:** The `/health/ready` endpoint in the API exposed raw exception messages (`detail=str(e)`) to clients, potentially leaking database connection strings, hostnames, or internal error details. The proxy's equivalent exposed a list of raw dependency error strings.
- **Fix applied:** Yes
- **Details:** Both endpoints now log the real error server-side (at `ERROR` level) and return a generic `"Service unavailable"` message to clients.

---

### [HIGH-5] Token Stored in `localStorage` (XSS-Accessible)

- **File:** `apps/frontend/src/lib/api/auth.ts` lines 11, 22; `apps/frontend/src/lib/api/client.ts` line 10
- **Issue:** JWT access tokens are stored in `localStorage`, which is accessible to any JavaScript running on the page. An XSS vulnerability anywhere on the frontend would allow an attacker to steal all session tokens.
- **Fix applied:** No — requires architectural change (see Remaining Recommendations)
- **Details:** The correct mitigation is to store tokens in `httpOnly; SameSite=Strict` cookies set by the server, with the frontend never seeing the raw token. This requires changes to the API auth endpoints (return `Set-Cookie` headers) and the frontend (drop `localStorage` and the `Authorization` header, rely on cookies instead). This is a meaningful refactor tracked in Remaining Recommendations.

---

### [MEDIUM-1] Missing Input Length Limits on Pydantic Schemas

- **File:** `apps/api/app/routers/projects.py`, `apps/api/app/routers/rules.py`, `apps/api/app/routers/auth.py`
- **Issue:** `ProjectCreate`, `ProjectUpdate`, `RuleCreate`, `RuleUpdate`, `LoginRequest`, and `SignupRequest` had no `max_length` constraints. An attacker could submit arbitrarily large strings for any field, causing excessive memory usage and slow bcrypt hashing (on password fields, a bcrypt DoS attack).
- **Fix applied:** Yes
- **Details:** Added `Field(..., max_length=N)` to all string fields in the affected schemas. Added `max_length=1024` specifically on `LoginRequest.password` to prevent bcrypt timing/DoS attacks with very long inputs.

---

### [MEDIUM-2] Weak Password Policy at Signup

- **File:** `apps/api/app/routers/auth.py`
- **Issue:** `SignupRequest` accepted any non-empty string as a password, including single-character passwords.
- **Fix applied:** Yes
- **Details:** Added a `@field_validator("password")` that enforces: minimum 10 characters, at least one uppercase letter, at least one digit.

---

### [MEDIUM-3] Authorization Header Smuggling in Proxy Forwarder

- **File:** `apps/proxy/app/pipeline/forwarder.py` lines 35–41
- **Issue:** The forwarder stripped `x-cb-key` but did not strip the incoming `Authorization` header before injecting the upstream key. A crafted request that included its own `Authorization` header could potentially influence upstream behavior (header precedence is implementation-defined in `httpx`). Additionally, client `Cookie` headers were forwarded upstream, potentially leaking session cookies to the AI provider.
- **Fix applied:** Yes
- **Details:** Explicitly strip `authorization` and `cookie` from all forwarded headers. The upstream `authorization` header is only injected if an `upstream_api_key` is present.

---

### [MEDIUM-4] OpenAPI Schema Exposed in Production

- **File:** `apps/api/app/main.py`
- **Issue:** FastAPI exposes `/openapi.json` and `/docs` by default in all environments, giving attackers a complete map of all routes, parameters, and schemas.
- **Fix applied:** Yes
- **Details:** Set `openapi_url=None` when `ENVIRONMENT != "development"`, which also disables the Swagger UI and ReDoc endpoints.

---

### [MEDIUM-5] Predictable Redis Rate-Limit Keys

- **File:** `apps/proxy/app/cache/rule_cache.py` line 43
- **Issue:** Rate limit keys use the format `ratelimit:{project_id}:{rule_id}`. Both IDs are UUIDs and are not secret, but they are passed in the API response and could be used to identify and potentially manipulate rate limit counters if Redis is misconfigured without auth.
- **Fix applied:** No — requires Redis AUTH configuration (see Remaining Recommendations)
- **Details:** Redis should require authentication (`requirepass` in `redis.conf`). The `REDIS_URL` should include credentials. This is an infrastructure-level control.

---

## Fixes Applied

| # | File | Change |
|---|------|--------|
| 1 | `apps/api/app/routers/keys.py` | Replaced SHA-256 hashing with bcrypt to match proxy verification |
| 2 | `apps/api/app/auth/jwt.py` | Added production startup validation for SECRET_KEY; warning in dev |
| 3 | `apps/proxy/app/config.py` | Added `validate_production_secrets()` called at module load |
| 4 | `apps/api/app/routers/projects.py` | Fixed `_get_fernet()` fallback logic; added production key enforcement |
| 5 | `apps/proxy/app/evaluators/pii_regex.py` | Fixed ReDoS-vulnerable credit card regex; added input truncation; fixed email charset; added error handling on compile and search |
| 6 | `apps/api/app/main.py` | Replaced CORS wildcard with env-driven origin list; added SecurityHeadersMiddleware; fixed health endpoint error leak; disabled OpenAPI in production |
| 7 | `apps/proxy/app/main.py` | Fixed readiness error leak (log server-side, return generic message) |
| 8 | `apps/api/app/routers/auth.py` | Added password strength validator; added max_length on password field; added length validators on full_name and org_name |
| 9 | `apps/api/app/routers/projects.py` | Added Field constraints (min_length, max_length) on ProjectCreate and ProjectUpdate |
| 10 | `apps/api/app/routers/rules.py` | Added Field constraints on RuleCreate and RuleUpdate |
| 11 | `apps/proxy/app/pipeline/forwarder.py` | Strip `authorization` and `cookie` headers before forwarding; only inject upstream auth when key is present |

---

## Remaining Recommendations

These require manual attention, architectural changes, or infrastructure-level configuration and were not fixed in-code:

1. **Token storage — move from localStorage to httpOnly cookies.** This is the single most impactful remaining change. Refactor the `/auth/login` and `/auth/signup` endpoints to return `Set-Cookie: access_token=...; HttpOnly; Secure; SameSite=Strict` instead of a JSON body, and update the frontend to rely on cookies rather than `localStorage` / `Authorization` headers.

2. **Rate limiting on `/api/auth/login` and `/api/auth/signup`.** These endpoints have no brute-force protection. Add `slowapi` or a Redis-backed rate limiter middleware (e.g., 10 requests per minute per IP on login). Without this, credential stuffing attacks are trivial.

3. **Redis authentication.** The `REDIS_URL` defaults to no-auth Redis. In production, set `requirepass` in `redis.conf` and include credentials in `REDIS_URL`. Unauthenticated Redis allows manipulation of rate-limit counters and cache poisoning.

4. **Rotate the default `.env.example` instructions.** The `ENCRYPTION_KEY` field comment says "32-char string" but Fernet requires a URL-safe base64-encoded 32-byte key (44 chars). Update `.env.example` with a `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` generation instruction.

5. **API key prefix length.** `keys.py` stores `full_key[:12]` as the prefix (including the `sk-` prefix). The proxy looks up keys by `raw_key[:8]`. These do not match — `full_key[:12]` is `sk-XXXXXXXXX` (12 chars) but the lookup uses 8 chars. Verify and align prefix lengths to avoid lookup failures.

6. **Refresh token revocation.** There is no token revocation list. Once a refresh token is issued it is valid for 7 days even if the user changes their password or an admin deactivates the account. Add a `jti` (JWT ID) claim and store issued refresh token IDs in Redis with the token TTL; reject any token whose `jti` is not in the store.

7. **Upstream SSRF protection.** `ProjectCreate.upstream_base_url` accepts any URL. An authenticated user could point it at internal services (e.g., `http://169.254.169.254/` for AWS metadata, `http://localhost:5432/` for the database). Add a validator that rejects private IP ranges and loopback addresses.

8. **Nginx security headers.** The `docker/nginx.conf` frontend reverse proxy does not add security headers. Add `add_header X-Content-Type-Options nosniff; add_header X-Frame-Options DENY; add_header Content-Security-Policy "default-src 'self'...";` at the nginx level as a defense-in-depth measure.

9. **Database password in docker-compose.yml.** `POSTGRES_PASSWORD: cb_pass` is committed in plaintext. For non-local environments, use Docker secrets or a `.env` file that is gitignored.

10. **Secrets rotation policy.** Document a rotation procedure for `SECRET_KEY` and `ENCRYPTION_KEY`. Rotating `ENCRYPTION_KEY` requires re-encrypting all `upstream_api_key_enc` values; rotating `SECRET_KEY` invalidates all active JWTs (acceptable if refresh tokens are supported).
