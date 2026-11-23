# rcooni

<img width="635" height="356" alt="rcooni-social-2" src="https://github.com/user-attachments/assets/e06a61a4-b2aa-4d9d-9878-ca6f40054e27" />


A minimal, **write-capable** issue tracker exposed over MCP — the Chapter 14 counterpart to the
read-only [Kamori](https://ghcr.io/usekamori/kamori) log store. Same MCP protocol, opposite end of
the consequence ladder: where Kamori is _queried_, rcooni is _written to_. Filing an issue crosses
external state, and that is the whole point of the chapter.

Deliberately barebones so a chapter can show the entire thing: **one entity, one JSON file, one
write tool, one audit view.**

## What it exposes

| Endpoint          | Port     | Purpose                                                            |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `POST /mcp`       | **3121** | Streamable-HTTP MCP endpoint (mirrors Kamori's `:3111/mcp`)        |
| `GET /issues/:id` | **3120** | Minimal HTML **audit view** — where a human opens a filed issue    |
| `GET /healthz`    | 3120     | Readiness probe (used by Docker's healthcheck + `claude mcp list`) |

### The one MCP tool — `create_issue` (WRITE)

- **input:** `{ title: string, body: string (markdown), idempotency_key?: string }`
- **effect:** creates **exactly one** issue; nothing else changes.
- **returns:** `{ id, url, status: "open", created_at }` — the `url` is the audit trail.
- **idempotency:** if `idempotency_key` matches an existing issue, the existing issue is returned
  unchanged (no duplicate) — so a retry is safe.

There are no read/update/delete tools by design. A human verifies a filing by opening its `url`.

Issues persist as a JSON array under `/app/data` (mount a volume so filed stays filed).

## Configuration (env)

| Var               | Default                 | Notes                          |
| ----------------- | ----------------------- | ------------------------------ |
| `MCP_PORT`        | `3121`                  | MCP endpoint port              |
| `VIEW_PORT`       | `3120`                  | Audit view + health port       |
| `DATA_DIR`        | `/app/data`             | Where `issues.json` is written |
| `PUBLIC_BASE_URL` | `http://localhost:3120` | Baked into each issue's `url`  |

## Run locally

```bash
npm install
npm run dev          # tsx src/server.ts
# or:  npm run build && npm start
```

## Build & push (GitHub Container Registry — same registry as Kamori)

git@github.com:martinkr/rcooni.git

```bash
docker build -t ghcr.io/martinkr/rcooni:latest .
# Github -> setting -> create token (fine-grained or classic) PAT needs write:packages
export GHCR_PAT="your_actual_token_here"
echo "$GHCR_PAT" | docker login ghcr.io -u martinkr --password-stdin
docker push ghcr.io/martinkr/rcooni:latest
```

## Use it in the book's stack

Add to `chapter-14/todo-mate/docker-compose.yml` (pulls the published image, exactly like Kamori):

```yaml
  rcooni:
    image: ghcr.io/martinkr/rcooni:latest
    ports: ["3120:3120", "3121:3121"]
    environment:
      PUBLIC_BASE_URL: http://localhost:3120
    volumes:
      - rcooni-data:/app/data
volumes:
  rcooni-data:
```

Register the MCP server once (mirrors Kamori's line), recorded in `.mcp.json`:

```bash
claude mcp add --transport http --scope project rcooni http://localhost:3121/mcp
```

```json
{
  "mcpServers": {
    "kamori": { "type": "http", "url": "http://localhost:3111/mcp" },
    "rcooni": { "type": "http", "url": "http://localhost:3121/mcp" }
  }
}
```

## Where the approval gate lives (important)

**rcooni does not gate the write — the harness that calls it does.** The service just offers the
`create_issue` capability. The two-layer approval boundary from the spec is enforced by the
_caller_:

1. **`PreToolUse` hook (deterministic invariant):** deny `mcp__rcooni__create_issue` unless the
   ticket passed the Chapter 12 validator (`check-required-ticket-fields.ts`). Configured in Claude
   Code settings (CLI) or the Agent SDK `hooks` option. This is what "never file an unvalidated
   ticket" means, and it doubles as the chapter's hooks example.
2. **`canUseTool` / interactive prompt (human judgment):** once the invariant holds, stop and ask a
   person to approve _this_ filing. Do **not** run the write under `permissionMode: "dontAsk"`.

Pipeline order: deny rules → `PreToolUse` hook → allow rules / `permissionMode` → `canUseTool` /
prompt. That is the chapter's contrast with Kamori, whose read-only tools _do_ run under `dontAsk`.

## Honesty caveat

This is a local stand-in. It softens the real external-state properties the consequence rung is
about — third-party credentials, rate limits, network failure, irreversible public side effects. In
production the target is GitHub or Linear with a real token; here it runs with no account so the
whole workflow is demonstrable. To file for real, point the identical workflow at `gh issue create`
or the official `github-mcp-server`.

## Project layout

```
src/store.ts    the JSON store (Issue type, create/get, idempotency)
src/view.ts     the minimal HTML audit page
src/server.ts   the two listeners (MCP on 3121, audit view + health on 3120)
Dockerfile      multi-stage build -> ghcr.io/martinkr/rcooni
```
