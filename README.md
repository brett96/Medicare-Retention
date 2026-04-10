# Medicare Member Retention — Edge-AI POC

This repository is a **proof of concept** for a Medicare member retention tool built around a **zero-trust, on-device** model: clinical reasoning and LLM inference are intended to run **locally** on the patient’s device. The **backend is not a data lake** for PHI—it acts as an **API gateway**, **OAuth broker**, and **HTTP proxy** so the mobile app can reach Elevance FHIR and public drug APIs without embedding secrets in the client where avoidable.

---

## Design goals

| Goal | How it is addressed |
|------|----------------------|
| **Local AI** | React Native app downloads a quantized `.gguf` model and runs inference via **llama.cpp** (through `@react-native-ai/llama`). |
| **No long-lived PHI on the gateway** | Django exchanges OAuth codes and proxies requests; tokens are handed to the app via a **short-lived one-time code**, not pasted into logs by default. |
| **SMART on FHIR + PKCE in serverless** | PKCE `state` + `code_verifier` are stored in **PostgreSQL**, keyed by OAuth `state`—**not cookies**—so flows that bounce through the system browser / Custom Tabs do not break under strict tracking prevention. |
| **Multi-payer gateway** | **`payers.py`** registers **Elevance**, **Cigna**, and **Aetna** (Patient Access); `/authorize/` lists configured payers. OAuth `aud`/scopes and FHIR URL patterns are payer-specific. |
| **Vercel-safe DB usage** | `CONN_MAX_AGE = 0` and a **pooled** `DATABASE_URL` (e.g. PgBouncer / Supabase pooler) to avoid exhausting Postgres connections from ephemeral functions. |
| **CORS** | `django-cors-headers` is configured so **web** testing (Expo web, simulators) does not fail; native apps still send `Authorization` freely. |

---

## Repository layout

```
.
├── admin-portal/                 # Static Plan-GPT Admin UI (HTML mockup) — optional third Vercel project
│   ├── index.html                # Dashboard + member detail (client-side tab JS)
│   └── vercel.json               # SPA-style rewrites for static hosting
├── api/                          # Vercel serverless entry (WSGI app)
├── gateway/                      # Django app: OAuth session + token exchange models
├── medicare_retention_api/       # Django project (settings, urls, auth_views)
├── mockups/                      # Design references (Medicare Helper iPhone, admin portal HTML)
├── mobile/                       # Expo app: Medicare Helper UI + Dev Client (llama, RAG) + Expo web export
│   ├── src/
│   │   ├── screens/              # HandoffScreen, LoginScreen, MedicareHelperScreen, model setup, etc.
│   │   └── theme/planGpt.ts      # Shared Plan-GPT / Medicare Helper color tokens
│   ├── web/index.html            # Web shell (full-height root, background) for Expo export
│   └── vercel.json               # Expo *web* project: `expo export -p web` → dist/
├── scripts/
│   └── test_fhir_api.py          # Terminal PKCE + FHIR smoke test (Elevance / Cigna / Aetna)
├── manage.py
├── requirements.txt
├── vercel.json                   # Django API: routes + buildCommand (no `builds`; no `functions` for Python path)
└── apiTest.py                    # Legacy one-off script (superseded by scripts/)
```

---

## Recent updates (UI, web, and tooling)

The following landed after the original Edge-AI POC README; together they add a **member-facing Plan-GPT / Medicare Helper** experience and a **deployable admin mockup**, without changing the Django OAuth/FHIR contract unless you wire new APIs yourself.

### Medicare Helper (Expo / React Native + web)

- **`MedicareHelperScreen`** (`mobile/src/screens/MedicareHelperScreen.tsx`) is the default shell after launch: **Chat**, **Save Rx**, **Videos**, **Analytics**, **Best Plan**, and **My Agent** tabs, styled to match the `mockups/plan_gpt_medicare_iphone_mockup_v17.html` reference (green header, plan card, mint/olive accents).
- **Responsive layout:** viewports **`≥ 900px` wide** use a **desktop / tablet-landscape** shell: dark **left sidebar** navigation, **full-width main** column, and a **right context rail** (plan summary, Rx progress shortcuts, My Agent). Narrower viewports keep the **phone-style** UI (horizontal tab bar, optional centered column on web).
- **Chat:** composer is a real **`TextInput`** with send; user messages append to the thread (demo content remains for AI side).
- **Developer / POC tools** (model URL, test prompt, handoff, payer OAuth) moved into a **modal** opened from the header **search** icon on compact layout or **Dev tools** in the sidebar on wide layout.
- **`App.tsx` refactor:** default experience is Medicare Helper; **OAuth handoff** still takes over **full screen** when the URL looks like a callback / `code` + `api_base` handoff (web and native).
- **Theme:** `mobile/src/theme/planGpt.ts` centralizes palette tokens shared by the member UI.
- **Web parity:** `mobile/web/index.html` ensures `html` / `body` / `#root` fill the viewport; flex uses **`minHeight: 0`** where needed so **`react-native-web`** scroll regions behave like native.

### Dependencies

- **`expo-font`** is a **direct** dependency in `mobile/package.json` because **`@expo/vector-icons`** (Feather icons in `MedicareHelperScreen`) imports it; Vercel’s `npm install` + Metro bundler require it to be declared explicitly (transitive-only installs can fail CI).

### Admin portal (static)

- **`admin-portal/`** holds a **standalone HTML/CSS/JS** implementation of the Plan-GPT Admin concept (see **Plan-GPT Admin portal** below). It is **not** generated by Expo; there is **no build step** unless you add one.

### Design mockups

- **`mockups/`** retains the canonical HTML references; **`admin-portal/index.html`** is kept in sync as the folder you point a static host at.

---

## Architecture (high level)

The system is intentionally split into **core deployable surfaces**: a **Django API** (OAuth broker + FHIR proxies) and an **Expo** app (native + **static web export** for handoff and the **Medicare Helper** member UI). A **third**, optional surface is the **static admin portal** in **`admin-portal/`** (HTML mockup only). Native **React Native** uses the same API; it can skip the web handoff and consume a custom-scheme deep link.

```mermaid
flowchart LR
  subgraph device [Patient device]
    RN[React Native app]
    WEB[Expo web handoff]
    LM[llama.cpp via bridge]
    SQL[SQLite RAG store]
    RN --> LM
    RN --> SQL
  end

  subgraph cloud [Gateway]
    DJ[Django on Vercel]
    PG[(PostgreSQL)]
    DJ --> PG
  end

  subgraph external [External APIs]
    EH[Elevance OAuth + FHIR]
    CG[Cigna OAuth + FHIR]
    AT[Aetna OAuth + FHIR]
    DM[DailyMed API]
  end

  RN -->|GET /authorize| DJ
  WEB -->|GET /authorize in browser| DJ
  DJ -->|redirect| EH
  DJ -->|redirect| CG
  DJ -->|redirect| AT
  EH -->|code + state to /callback| DJ
  CG -->|code + state| DJ
  AT -->|code + state| DJ
  DJ -->|302 + one-time code| WEB
  DJ -->|302 custom scheme optional| RN
  WEB -->|POST exchange + FHIR GETs| DJ
  RN -->|POST exchange + FHIR GETs| DJ
  DJ --> EH
  DJ --> CG
  DJ --> AT
  DJ --> DM
```

1. **User starts OAuth** with **`GET /authorize/`** on the **Django host** (HTML picker of configured payers, plus “coming soon” placeholders). Django stores **PKCE** and **`payer_id`** in Postgres (`PkceSession`, keyed by `state`) and redirects to the selected payer’s authorize URL (SMART scopes + PKCE; **`aud`** is the FHIR base for Elevance/Cigna, and a separate **sandbox audience** URL for Aetna—see `payers.py`).
2. The IdP redirects to **`/api/auth/<payer_id>/callback/`** (or legacy **`/callback/`**, which resolves **`payer_id`** from `state` when possible) with **`code` + `state`** (or OAuth **error** query params—Django returns structured JSON instead of a generic `missing_code_or_state`).
3. Django exchanges the Elevance `code` for tokens, encrypts the payload, stores a **short-lived one-time exchange code**, then redirects:
   - **Recommended (desktop + web):** **`APP_HANDOFF_URL_BASE`** — use the **origin only** (e.g. `https://your-expo-web.vercel.app`) so the redirect is **`/?code=...&api_base=...`**. That always loads the static **`index.html`**; a path-only URL like `/handoff` can 404 unless the static host rewrites SPA routes.
   - **Native fallback:** **`APP_DEEPLINK_CALLBACK_BASE`** (e.g. `medicare-retention://oauth/callback?code=...`) if `APP_HANDOFF_URL_BASE` is unset.
4. The **client** (Expo web handoff page or native app) calls **`POST /api/auth/exchange/`** with `{ "code": "<one-time>" }` and receives the token JSON. The handoff page discovers the API via the **`api_base`** query param (or **`EXPO_PUBLIC_API_BASE_URL`**).
5. The client calls **FHIR proxy** on Django with **`Authorization: Bearer <access_token>`** — e.g. **`GET /api/fhir/<payer_id>/Patient/?patient_id=...`** (or legacy Elevance shorthand routes). Django forwards to the payer’s FHIR base (timeouts from `FHIR_HTTP_*` / legacy `ELEVANCE_HTTP_*` env vars).

**Important:** **`/authorize`** and **`/callback`** must hit the **same Django deployment and database** as the PKCE row created for `state`. Mixing local `/authorize` with production `/callback` (or different databases) yields `state_not_found`.

---

## Backend (Django)

### Role

- **OAuth**: SMART Authorization Code + PKCE (**Elevance**, **Cigna**, **Aetna**); callback and token handoff; optional **JWT** `patient` claim decoding when the token response omits top-level `patient`.
- **Proxy**: FHIR compartment reads (Patient, Coverage, Encounter, EOB, MedicationRequest, etc.) and DailyMed `drugnames`.
- **Persistence**: Postgres for PKCE sessions and one-time token exchange records only (not a clinical data warehouse).

### Important endpoints

| Path | Purpose |
|------|---------|
| `GET /` | JSON index of main routes |
| `GET /health/` | Liveness |
| `GET /authorize/` | HTML payer picker → links to `/api/auth/<payer_id>/authorize/` for each configured payer; “coming soon” rows for planned integrations |
| `GET /api/auth/<payer_id>/authorize/` | Start OAuth (`elevance`, `cigna`, `aetna`, …); stores PKCE + `payer_id` in DB |
| `GET /callback/` | Legacy callback; resolves `payer_id` from PKCE `state` when possible, then same logic as payer-specific callback |
| `GET /api/auth/<payer_id>/callback/` | OAuth redirect; token exchange; Cigna uses **`$userinfo`** for `patient_id`; one-time exchange `code` |
| `POST /api/auth/exchange/` | Body: `{"code":"<one-time>"}` → token JSON + `payer_id` + `patient_id` |
| `GET /api/fhir/<payer_id>/<resource_type>/?patient_id=...` | Generic FHIR proxy: `Patient`, `Coverage`, `Encounter`, `ExplanationOfBenefit` / `eob`, `MedicationRequest`, `MedicationStatement`, `MedicationDispense`, `Claim`, `ClaimResponse` (aliases: `rx`, `med`, …) |
| `GET /api/fhir/patient/` … | **Elevance shorthand** (same as `/api/fhir/elevance/...`) |
| `GET /api/drugs/?name=...` | Proxied DailyMed drug name search (POC) |
| `GET /api/debug/oauth/?payer=...` | If **`OAUTH_DEBUG=1`**: redirect URI, client id, **oauth audience** (Aetna), etc. |

### Multi-payer FHIR proxy behavior (`auth_views.py` + `payers.py`)

- **`PayerConfig`** (in **`medicare_retention_api/payers.py`**) drives OAuth URLs, **`aud`** (Aetna uses a sandbox audience **different** from the FHIR API base), scopes, **`patient_lookup_mode`** (`path` vs `Patient?_id=`), and **`fhir_unsupported_resources`** (for **Elevance / Aetna** only: types that return an **empty search `Bundle`** with **200** instead of calling the payer).
- **Patient bundle unwrap**: Cigna (and similar) may return a **search `Bundle`** for `Patient?_id=...`. The proxy returns a **single `Patient`**, preferring **`id`** prefixed with **`gov-`** when multiple entries exist.
- **Cigna FHIR proxy**: **no** `&_count=`; types in **`_CIGNA_FHIR_UNSUPPORTED`** return an **empty search `Bundle` (200)** without calling the payer. For **Coverage**, **Encounter**, **ExplanationOfBenefit**, and **MedicationRequest**, when **`Patient.id`** ≠ token **`patient`** id, the handoff app sends **`merge_patient_id`** (token id); the API **merges** both compartment searches (deduped) and follows **`Bundle.link` “next”** when **`FHIR_PROXY_FOLLOW_BUNDLE_NEXT=1`**. Other compartment types use a **single** GET with pagination when enabled.
- **Elevance / Aetna**: optional **`FHIR_DEFAULT_SEARCH_COUNT`** (`&_count=`); **`FHIR_PROXY_FOLLOW_BUNDLE_NEXT`** (default **`1`**) and **`FHIR_PROXY_MAX_PAGES`** merge paged **`Bundle`** responses. Set **`FHIR_PROXY_FOLLOW_BUNDLE_NEXT=0`** for first-page-only.
- **Aetna authorize URL**: built with **`build_oauth_authorize_query_string`** so **`scope`** keeps a **literal `*`** in `patient/*.read` (some IdP UIs mishandle `%2A`). Optional **`AETNA_APP_NAME`** → `appname` query param. **Claim / ClaimResponse** (and **MedicationStatement**) are treated as unsupported for Aetna where the API returns **404** / not-implemented.
- **OperationOutcome handling**: for some payers, specific **`not-supported`** outcomes are mapped to an empty **`Bundle`**; the match is **narrow** (e.g. wording like “resource not available”) so real errors are not swallowed.

### Environment variables

**Elevance / SMART**

- `ELEVANCE_CLIENT_ID`, `ELEVANCE_CLIENT_SECRET` (optional for public PKCE-only clients)
- `ELEVANCE_REDIRECT_URI` — must match the redirect URI registered with Elevance (e.g. **`https://<your-host>/callback/`** legacy, or **`https://<your-host>/api/auth/elevance/callback/`**)
- `ELEVANCE_AUTH_URL`, `ELEVANCE_TOKEN_URL`, `ELEVANCE_FHIR_BASE_URL`
- `ELEVANCE_SCOPE` (optional; default includes `launch/patient patient/*.read openid fhirUser`)

**Cigna / SMART (public PKCE)**

- **Required:** `CIGNA_CLIENT_ID`, `CIGNA_REDIRECT_URI` (must match the Cigna developer portal; e.g. `https://<your-host>/api/auth/cigna/callback/`)
- **Optional:** `CIGNA_CLIENT_SECRET` — omit when Cigna did not issue a secret (public client + PKCE)
- **Optional URL overrides** (sandbox defaults are built into `payers.py` from [Cigna Patient Access sandbox](https://developer.cigna.com/docs/service-apis/patient-access/sandbox)): `CIGNA_AUTH_URL`, `CIGNA_TOKEN_URL`, `CIGNA_FHIR_BASE_URL`, `CIGNA_USERINFO_URL`
- `CIGNA_SCOPE` (optional)

**Aetna Patient Access (sandbox defaults in `payers.py`; confidential client + PKCE)**

- **Required:** `AETNA_CLIENT_ID`, `AETNA_CLIENT_SECRET`, `AETNA_REDIRECT_URI` (e.g. `https://<host>/api/auth/aetna/callback/`)
- **Optional:** `AETNA_AUTH_URL`, `AETNA_TOKEN_URL`, `AETNA_FHIR_BASE_URL`, `AETNA_SCOPE`
- **`AETNA_AUD`** — OAuth token **`aud`**; defaults to the sandbox audience URL in code (separate from the FHIR API base)
- **`AETNA_APP_NAME`** — if the Aetna login page shows **`null`**, set this to the **App Name** from the developer portal (sent as **`appname`** on authorize)
- **`AETNA_USERINFO_URL`** — if Aetna documents a userinfo endpoint and the token response lacks `patient`, set when needed

**App handoff**

- `APP_HANDOFF_URL_BASE` — **recommended** Expo web **origin** only, e.g. `https://your-expo-web-host.vercel.app` (backend appends `?code=...&api_base=...`; avoid `/handoff` unless your static host rewrites that path to `index.html`)
- `APP_DEEPLINK_CALLBACK_BASE` — native fallback, e.g. `medicare-retention://oauth/callback` (custom scheme; desktop browsers cannot open this). Used only if `APP_HANDOFF_URL_BASE` is unset.
- `PUBLIC_API_BASE_URL` (optional) — explicit API host used when generating handoff redirect `api_base=...` query param for the web handoff page

**Token encryption at rest (exchange table)**

- `TOKEN_ENCRYPTION_KEY` — Fernet key, e.g.  
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

**Database**

- `DATABASE_URL` — use a **pooler** connection string in production (Supabase pooler, PgBouncer, etc.)
- `DB_SSL_REQUIRE` — default `1` when using `DATABASE_URL`

**Django**

- `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_TIME_ZONE`

**CORS**

- `CORS_ALLOW_ALL_ORIGINS` — default `1` for POC; set `0` and `CORS_ALLOWED_ORIGINS` for production

**FHIR proxy HTTP timeouts**

- `FHIR_HTTP_CONNECT_TIMEOUT_S`, `FHIR_HTTP_READ_TIMEOUT_S` — override defaults (**20** / **90** s); legacy aliases `ELEVANCE_HTTP_*` still work

**FHIR proxy pagination / page size** (Elevance and Aetna only; not used for Cigna)

- `FHIR_DEFAULT_SEARCH_COUNT` — optional; appended as **`&_count=`** on compartment searches when set
- `FHIR_PROXY_FOLLOW_BUNDLE_NEXT` — default **`1`**; set **`0`** to disable following **`Bundle.link`** **`next`**
- `FHIR_PROXY_MAX_PAGES` — max pages to fetch when following **`next`** (default **50**, including the first response)

**Debug (temporary)**

- `OAUTH_DEBUG` — set to **`1`** only while troubleshooting; enables **`GET /api/debug/oauth/?payer=elevance`** (or `cigna`, `aetna`). Remove or set **`0`** afterward.

### Local development

```powershell
cd "c:\Users\brtom\Documents\Medicare Retention"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**`.env`:** With `python-dotenv` installed, both Django and `scripts/test_fhir_api.py` load a `.env` file from the **project root** (same folder as `manage.py`). Variable names must match the documented `ELEVANCE_*` / `CIGNA_*` / `AETNA_*` / `DJANGO_*` keys—creating `.env` alone does nothing until you run `pip install -r requirements.txt` (or `pip install python-dotenv`).

**Postgres on localhost:** If `.env` sets `DATABASE_URL` to Postgres (e.g. for Vercel) but **no Postgres is running on your PC**, `runserver` will fail with *connection refused* on port 5432. For local API work, either:

- Set **`DJANGO_USE_SQLITE=1`** in `.env` (uses `db.sqlite3` in the project folder and ignores `DATABASE_URL` for Django), **or**
- Remove / comment out `DATABASE_URL` locally so Django falls back to SQLite, **or**
- Install and start PostgreSQL locally to match `DATABASE_URL`.

Set env vars (at minimum for OAuth views: Elevance vars + `TOKEN_ENCRYPTION_KEY`; for DB: use `DJANGO_USE_SQLITE=1` locally or a reachable `DATABASE_URL`).

```powershell
python manage.py migrate
python manage.py runserver
```

Open `http://127.0.0.1:8000/` — you should see JSON describing the API. A 404 on `/` before the root route was added meant no route existed; the project now serves **`GET /`** as a small JSON index.

**Phone or another PC on the same LAN:** `runserver` only binds to localhost by default, so **`http://192.168.x.x:8000` will not work** from other devices until you run:

`python manage.py runserver 0.0.0.0:8000`

Allow **Python** through Windows Firewall if prompted. (This is separate from **Expo/Metro on port 8081** — see [mobile/README.md](mobile/README.md).)

### Vercel (Django API project)

- Repo **root** `vercel.json` uses **`routes`** to `api/index.py`, plus **`buildCommand`: `python vercel_build.py`**. **No legacy `builds`** (it skips `buildCommand`). **No `vercel.json` `functions` block for `api/index.py`** — Vercel matches that pattern only for Node handlers; Python is auto-discovered and a `functions` entry breaks the build.
- **Deploy checklist:** see **[DEPLOY_VERCEL.md](DEPLOY_VERCEL.md)** — env vars, Postgres + `migrate` on build, Elevance redirect URI, and troubleshooting.
- **Template:** [`.env.example`](.env.example) lists variable names (no secrets).
- Keep handlers **fast**: outbound HTTP uses short timeouts; no long-running tasks.

---

## Expo web static app (“frontend project”) and how it connects to the backend

The **browser handoff** experience is a **separate static site** produced by **`npx expo export -p web`** from **`mobile/`**. It is **not** the Django server: Django only returns JSON APIs, not the React bundle.

### Why multiple Vercel projects?

| Project | Root in repo | Config file | Build | Output |
|--------|----------------|------------|-------|--------|
| **API (Django)** | Repository root (default) | Root `vercel.json` — **`routes`** + `vercel_build.py` (no `builds` / no Python `functions` pattern) | `pip` + `vercel_build.py` (collectstatic + migrate) | Serverless Python |
| **Expo web (member app + handoff)** | **`mobile`** | **`mobile/vercel.json`** | `npm install` + `npx expo export -p web` | Static **`dist/`** |
| **Plan-GPT Admin (static mockup)** | **`admin-portal`** | **`admin-portal/vercel.json`** | None (static files) | **`index.html`** at project root |

Create **separate** Vercel projects linked to the **same GitHub repo** as needed: **API** at repo root, **Expo web** with **Root Directory = `mobile`**, **Admin** with **Root Directory = `admin-portal`**. Each project reads only its own `vercel.json` (the subdirectory config), not the root Django config.

See **[Plan-GPT Admin portal (static UI)](#plan-gpt-admin-portal-static-ui)** for admin-only deploy settings.

### Repository `.vercelignore` (important)

The repo root **`.vercelignore`** must **not** ignore the entire **`mobile/`** tree. A line like `mobile` was used originally to shrink API uploads; that **removes** `mobile/package.json` from the upload and breaks **`npm install`** when Root Directory is `mobile`. Ignore only heavy paths (e.g. `mobile/node_modules`, `mobile/android`, `mobile/ios`) instead.

### How the handoff page talks to the API

1. After OAuth, Django redirects the browser to  
   **`https://<expo-web-host>/?code=<one-time-exchange-code>&api_base=https%3A%2F%2F<api-host>`**  
   (optional **`PUBLIC_API_BASE_URL`** on the API can force `api_base` if you need a canonical API URL).

2. The **Expo web** bundle loads from **`/`** (always **`index.html`**). The handoff screen reads **`code`** and **`api_base`** from the query string.

3. The browser sends **`POST https://<api-host>/api/auth/exchange/`** with the one-time `code` (CORS allows this for POC; lock down **`CORS_ALLOWED_ORIGINS`** in production).

4. With the returned **`access_token`**, the handoff UI calls **`GET`** on the FHIR proxy on the **same API host** — e.g. **`/api/fhir/<payer_id>/Patient/?patient_id=...`** (Elevance shorthand **`/api/fhir/patient/`** still works) — with **`Authorization: Bearer ...`**. The handoff loads Patient with the token **`patient`** id, then uses the returned **`Patient.id`** for Coverage, EOB, and other compartment reads when available (all payers, including Cigna).

5. **`EXPO_PUBLIC_API_BASE_URL`** (optional) can override the API base for local web dev; production usually relies on **`api_base`** from the redirect.

See **[mobile/README.md](mobile/README.md)** for Vercel dashboard pitfalls (Python build logs on the Expo project = wrong root or root `builds` winning), `.vercelignore`, and local web testing URLs.

---

## Plan-GPT Admin portal (static UI)

The **admin portal** is a **self-contained static site** that implements the **Plan-GPT Admin — Cerca Health** experience from the design mockup (`mockups/plan_gpt_admin_portal_mockup_v2.html`). It is intended for **demos, UX review, and front-end iteration**—not as a production admin back office unless you add authentication, APIs, and data binding yourself.

### What it is

- **Single-page HTML** with embedded **CSS** and **JavaScript** (`admin-portal/index.html`): browser chrome frame, **dark sidebar** (Dashboard, Members, Agents, Analytics, Campaigns, Appointments, App Config), **dashboard** metrics, charts, **Recent Members** table, and a **member detail** view (profile, stats, **Member App Activity** tabs: Chat, Save on Rx, Analytics, Best Plan).
- **Client-side navigation only:** `showMember()` / `showDashboard()` toggle views and update the fake URL bar text; **`switchMemTab`** swaps panels on the member screen. There is **no** call to the Django API and **no** environment variables required for the HTML to load.
- **Source of truth for copy/layout:** the **`mockups/`** file; **`admin-portal/index.html`** is the copy you deploy so the admin app can live in its own Vercel **Root Directory** without pulling the whole repo’s build pipeline.

### What it is not

- Not generated by **Expo** or **Metro**.
- Not authenticated; anyone with the URL can see the static content.
- Not connected to Postgres, member records, or FHIR—numbers and names are **placeholder** content.

### Local preview

From the repository root:

```powershell
# Any static server works; example with npx:
cd admin-portal
npx --yes serve -s . -l 3000
```

Open `http://localhost:3000` (or the port `serve` prints). Opening `index.html` directly via `file://` may still run, but prefer a local server for consistent behavior.

### Deploy on Vercel

1. In Vercel, **Add New Project** → import the **same GitHub repo** as the API / mobile apps.
2. **Root Directory:** set to **`admin-portal`** (critical—do not use repo root).
3. **Framework Preset:** **Other** (or Vercel’s static detection).
4. **Build Command:** leave **empty** (there is nothing to compile).
5. **Output Directory:** leave **empty** or set to **`.`** so the published site root is `admin-portal/` (where `index.html` lives).
6. **Install Command:** leave default or **empty** / `echo skip` if Vercel insists on a step—no `package.json` is required in `admin-portal/`.

**`admin-portal/vercel.json`** contains:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

That sends all paths to `index.html`, which future-proofs **client-side routes** if you add a router later. For the current mockup, every view is toggled in one document.

7. **Environment variables:** none required for the static mockup.
8. Deploy. Your production URL will serve the admin UI at `/`.

**`.vercelignore` (repo root):** ensure you do **not** ignore `admin-portal/` entirely. If you exclude it from the API project upload, that only affects the **root**-scoped project; a Vercel project whose root is **`admin-portal`** still receives that folder. If you use a monorepo-wide ignore rule, confirm it does not strip `admin-portal/index.html` from the admin deployment.

### Optional hardening (if you productize this later)

- Put the site behind **Vercel Deployment Protection** or **SSO**.
- Replace static data with **fetch** calls to your Django (or other) API and add **CORS** + **auth** on the server.
- Split HTML/CSS/JS into a small build (Vite, etc.) and point Vercel **Build** / **Output** at the build result.

---

## Phase 1: Terminal PKCE test

`scripts/test_fhir_api.py` mirrors the same OAuth parameters as the Django app (scopes, `aud`, PKCE S256, Aetna authorize query encoding) but runs entirely in the terminal for integration testing. Use **`--payer 1`** / **`elevance`**, **`--payer 2`** / **`cigna`**, **`--payer 3`** / **`aetna`**, or omit **`--payer`** for an interactive prompt.

```powershell
# Elevance example (set the matching *_REDIRECT_URI and client vars per payer)
$env:ELEVANCE_CLIENT_ID="..."
$env:ELEVANCE_CLIENT_SECRET="..."
$env:ELEVANCE_REDIRECT_URI="https://your-registered-callback"
python .\scripts\test_fhir_api.py --payer 1

# Cigna: CIGNA_CLIENT_ID, CIGNA_REDIRECT_URI
# Aetna: AETNA_CLIENT_ID, AETNA_CLIENT_SECRET, AETNA_REDIRECT_URI
```

See `scripts/README.md` for a shorter quick start.

---

## Mobile app (`mobile/`)

See **[mobile/README.md](mobile/README.md)** for dependency hygiene (avoid `npm audit fix --force`, use `npx expo install`), OAuth handoff, and **Expo web on Vercel** troubleshooting.

- **Expo + Dev Client** so native modules (llama, SQLite) are usable on **iOS/Android**.
- **Medicare Helper / Plan-GPT member UI** (`MedicareHelperScreen`): default home experience with six tabs (chat, Rx savings, videos, analytics, best plan, agent). **Wide layout** (viewport width **≥ 900px**) uses a sidebar + main + right rail; narrow layouts match the phone-style mockup. **Developer tools** (model download, prompts, handoff, payer login) live in a **modal** so the demo UI stays primary.
- **Expo web** (`npx expo start --web` / `npx expo export -p web`): same React Native code targets a **static** bundle. The **handoff** flow still uses **`HandoffScreen`** when the URL contains OAuth handoff parameters (`code` + `api_base`, etc.). Otherwise users see **Medicare Helper** in the browser. Handoff shows patient summary, coverage, encounters, EOB / pharmacy-oriented summaries, medication requests where returned; payer-specific FHIR behavior is handled by the API (**`HandoffScreen`** uses **`Patient.id`** from the Patient response for compartment calls when present). **Technical details** (tokens, raw FHIR JSON) are behind a toggle.
- **`ModelManager`**: downloads `.gguf` from an HTTPS URL into app document storage with progress.
- **`LlamaService`**: loads the model via `@react-native-ai/llama` (`languageModel` + `textEmbeddingModel`), exposes completion and embedding helpers used by the RAG scaffold.
- **`LocalVectorStore`**: SQLite persistence for chunk text + embedding vectors; similarity search is implemented in-process in the POC (ready to swap for **sqlite-vss** when the native extension is available in your build).
- **`process_medical_data`**: chunks FHIR-shaped JSON, calls **llama embeddings** (not random hashes), and stores rows for later retrieval.

Install and run (from `mobile/`):

```powershell
cd mobile
npm install
npx expo prebuild   # if you use custom native modules / dev client builds
npx expo start
```

Exact native build steps depend on your machine (Xcode / Android Studio); Dev Client is required for full llama + SQLite extension workflows.

---

## Security notes (POC)

- Treat **`ELEVANCE_CLIENT_SECRET`**, **`AETNA_CLIENT_SECRET`**, **`CIGNA_CLIENT_SECRET`** (if used), and **`TOKEN_ENCRYPTION_KEY`** as secrets; never commit them.
- The one-time exchange code is **single-use** and short-lived; still protect your API host with HTTPS and rate limits in production.
- FHIR access tokens are **highly sensitive**; store them only in platform secure storage on device. The **web handoff** page intentionally shows **masked** tokens and **summaries**; raw JSON is hidden behind a **technical details** toggle—do not treat the handoff URL as a long-term PHI surface in production without hardening.

---

## Related files

- OAuth + FHIR proxies: `medicare_retention_api/auth_views.py`, `medicare_retention_api/payers.py`
- URL routing: `medicare_retention_api/urls.py`
- Models: `gateway/models.py`
- Settings (Postgres, CORS, `CONN_MAX_AGE`): `medicare_retention_api/settings.py`
- Member shell + tabs: `mobile/App.tsx`, `mobile/src/screens/MedicareHelperScreen.tsx`, `mobile/src/theme/planGpt.ts`
- Handoff UI + FHIR display helpers: `mobile/src/screens/HandoffScreen.tsx`, `mobile/src/utils/fhirDisplay.ts`
- Expo web shell + Vercel: `mobile/web/index.html`, `mobile/vercel.json`
- Admin static UI: `admin-portal/index.html`, `admin-portal/vercel.json`
- Design references: `mockups/plan_gpt_medicare_iphone_mockup_v17.html`, `mockups/plan_gpt_admin_portal_mockup_v2.html`
