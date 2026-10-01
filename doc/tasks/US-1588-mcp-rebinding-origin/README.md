# US-1588: DNS-rebinding and Origin protection for the Persephone and Mneme MCP servers

**Epic:** [EPIC-118 — Security hardening](../../epics/EPIC-118.md) · finding F2 · **High**

## Goal

No web page, in Persephone's browser or in any other browser on the machine, can talk to
Persephone's or Mneme's MCP server. Agent clients (Claude Code, Codex, the in-app MCP Inspector,
Persephone's own Mneme connection) keep working unchanged.

## Background

### Persephone's MCP server (`src/main/mcp-http-server.ts`)

- `:219` listens on `127.0.0.1:<mcp.port>` (default `7865`, `:13`). It is never reachable from
  another machine.
- `:92-144` `handleHttpRequest` routes `/mcp` only: POST (parse JSON body; known session →
  `transport.handleRequest`; no session + initialize → `startSession`), GET/DELETE (known session
  only), everything else 405 (`OPTIONS` included, with no CORS headers).
- `:148-183` `startSession` builds `StreamableHTTPServerTransport({ sessionIdGenerator,
  onsessioninitialized })` with **no** `enableDnsRebindingProtection`, `allowedHosts` or
  `allowedOrigins`.
- SDK 1.29.0 (`node_modules/@modelcontextprotocol/sdk/dist/cjs/server/webStandardStreamableHttp.js`):
  - `:73` sets `enableDnsRebindingProtection` to `false` by default.
  - `:110-133` `validateRequestHeaders`: when enabled, checks `Host` against `allowedHosts`.
    It checks `Origin` against `allowedOrigins` only **when an `Origin` is present**.
  - `:379-388` POST requires `Accept: application/json, text/event-stream` and
    `Content-Type: application/json`.
- No authentication. Any MCP session can call `script.execute`, which runs code in the renderer,
  which has Node access.

**Attack paths today:**

1. **Plain cross-site request** from `https://evil.example` to `http://127.0.0.1:7865/mcp`.
   Already stopped: `Content-Type: application/json` makes the browser send an `OPTIONS`
   preflight first. The server answers 405 with no CORS headers, so the browser never sends the
   POST. This relies on browser behaviour and the SDK's content-type check, not on a decision
   this server makes.
2. **DNS rebinding:** `evil.example` re-resolves to 127.0.0.1. The page's requests are now
   same-origin, so no preflight happens. The `Host` header is `evil.example:7865`. Nothing
   checks it, so the page can initialize, read `mcp-session-id`, and call `script.execute`.
   **This is the hole.**

### Who connects, and what they send (verified 2026-10-01)

- Claude Code, Codex and other CLI agents use Node HTTP clients. They send
  `Host: 127.0.0.1:<port>` (or `localhost:<port>`) and **no `Origin` header**.
- The in-app MCP Inspector and Persephone's Mneme connection
  (`src/renderer/editors/mcp-inspector/McpConnectionManager.ts:149`, reused by
  `src/renderer/api/mneme-connection.ts`) use the SDK's `StreamableHTTPClientTransport`. Its
  default `fetch` (`node_modules/@modelcontextprotocol/sdk/dist/cjs/client/streamableHttp.js:93`)
  is the **renderer's Chromium `fetch`**, not Node's. A live probe from the dev renderer
  (page origin `http://localhost:5273`) to a loopback echo server saw: no `Origin` header
  (Chromium omits it because the main window runs with `webSecurity: false`,
  `src/main/open-window.ts:54`), `Host: 127.0.0.1:<port>`, `Sec-Fetch-Site: cross-site`.
  So "reject any request that has an `Origin`" does not break in-app clients **today**.
  `Sec-Fetch-Site` **cannot** be used as a signal, because the app's own requests carry it.
- **Coupling with US-1590:** if `webSecurity: false` is ever removed, the renderer starts sending
  `Origin` and the in-app clients would be rejected. US-1590 must then give
  `McpConnectionManager` a Node-based `fetch`. Recorded in the epic.

### Mneme's MCP server (`mneme/src/mcp/server.rs:337-370`)

- It runs `axum::Router::new().nest_service("/mcp", StreamableHttpService::new(…,
  StreamableHttpServerConfig::default()))` on `bind:port`, with the default bind `127.0.0.1`
  (`mneme/src/config.rs:68-70`).
- rmcp 1.7.0 (`mneme/Cargo.lock:1880-1882`), `src/transport/streamable_http_server/tower.rs`:
  - `:106-119`: the `Default` config already sets
    `allowed_hosts: ["localhost", "127.0.0.1", "::1"]`, and `:251-265` rejects any other
    `Host`. **DNS rebinding is already blocked for Mneme.**
  - `:980-991` requires `Content-Type: application/json`, so plain cross-site requests are
    preflighted and stopped, as for Persephone.
  - `allowed_origins` defaults to empty, which disables the `Origin` check (`:67-75`, `:378-384`).
    When it is non-empty, a request **with** an `Origin` must match an entry; requests without
    `Origin` still pass. The struct is `#[non_exhaustive]` (`:37`); set it with
    `StreamableHttpServerConfig::default().with_allowed_origins(…)` (`:134`).
- What Mneme lacks is the explicit `Origin` rejection, as defense in depth.

The MCP specification's transport security section asks servers to validate `Origin`, bind to
localhost, and check `Host` against rebinding. Chrome's own answer to this class of attack is
Private Network Access, which is not in play here.

## Implementation plan

### Persephone (`src/main/mcp-http-server.ts`)

1. **Add a request guard** above `handleHttpRequest`:

   ```ts
   /** Loopback authorities a legitimate client addresses this server by. A DNS-rebinding page
    *  arrives with its own hostname in `Host`, so anything else is refused. */
   function isAllowedHost(host: string | undefined): boolean {
       if (!host) return false;
       const value = host.toLowerCase();
       return value === `127.0.0.1:${currentPort}` || value === `localhost:${currentPort}`;
   }

   /** Refuse requests a web page could make: a foreign Host (DNS rebinding) or any Origin.
    *  Agent clients are Node HTTP clients and send no Origin; a browser always does on a
    *  cross-origin or same-origin POST. Returns true when the request was refused. */
   function refuseUntrustedRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
       const reason = !isAllowedHost(req.headers.host)
           ? "Invalid Host header"
           : req.headers.origin !== undefined
               ? "Browser requests are not accepted"
               : undefined;
       if (!reason) return false;
       res.writeHead(403, { "Content-Type": "application/json" });
       res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: reason }, id: null }));
       return true;
   }
   ```

   - Any `Origin` value is refused, including the literal `"null"`, which sandboxed iframes and
     `data:` pages send.
   - The server binds IPv4 only (`:219`), so `[::1]` is not listed.
2. **Call it first** in `handleHttpRequest` (`:92`), before the path check, the body parse and the
   session lookup: `if (refuseUntrustedRequest(req, res)) return;`. A refused request then
   causes no JSON parse, no session touch, and no `isInitializeRequest`.
3. **Also enable the SDK's protection** in `startSession` (`:167-173`) as a second layer:

   ```ts
   const transport = new StreamableHTTPServerTransport({
       sessionIdGenerator: () => randomUUID(),
       enableDnsRebindingProtection: true,
       allowedHosts: [`127.0.0.1:${currentPort}`, `localhost:${currentPort}`],
       onsessioninitialized: (sid: string) => { … unchanged … },
   });
   ```

   `allowedOrigins` is left unset: the SDK cannot express "no Origin at all", and step 1 covers
   that. Check the option names against the SDK's `StreamableHTTPServerTransportOptions` type
   (`node_modules/@modelcontextprotocol/sdk/dist/cjs/server/webStandardStreamableHttp.d.ts`).
4. Log refusals with one `console.warn` line naming the reason and the `Host`/`Origin` values,
   so a user whose client is refused can see why in the main-process log. Never log bodies.

### Mneme (`mneme/src/mcp/server.rs`)

5. Replace `StreamableHttpServerConfig::default()` at `:355` with:

   ```rust
   // Any request carrying an Origin is a browser page; agent clients send none. Allowing only
   // this server's own origin (which serves no pages) refuses every browser Origin. Host is
   // already restricted to loopback by rmcp's default `allowed_hosts`.
   StreamableHttpServerConfig::default()
       .with_allowed_origins([format!("http://{bind}:{port}")]),
   ```

   `bind` and `port` are already in scope in `serve` (`:339-345`). Keep the default
   `allowed_hosts`. Do not call `disable_allowed_hosts`.
6. `cargo build --release` and `cargo test` in `mneme/`. Skip `/review` and `/userdoc` for the
   Rust part, per `doc/agents-common.md`. Persephone uses the release binary through
   `src/main/mneme-service.ts:36`, so mention in the summary whether the rebuilt binary needs
   copying anywhere for dev.

### Checks

7. `npm run typecheck`, `npm run lint`, `npm run build-prod`.

## Files changed

| File | Change |
|------|--------|
| `src/main/mcp-http-server.ts` | `isAllowedHost` + `refuseUntrustedRequest` guard first in `handleHttpRequest`; SDK `enableDnsRebindingProtection` + `allowedHosts` in `startSession` |
| `mneme/src/mcp/server.rs` | `with_allowed_origins([own origin])` on the server config |

**No changes needed:** `src/main/mcp/server-factory.ts`, `src/main/mcp/renderer-bridge.ts`, the
MCP tool and ai-vision code, `McpConnectionManager.ts`, `mneme-connection.ts`, `mneme-service.ts`,
`video-stream-server.ts` (random-UUID sessions), `pipe-server.ts` (named pipe, not TCP), and the
settings descriptions in `src/renderer/api/settings.ts`. Docs (`assets/guides/mcp-setup.md`: say
that browser-based MCP clients are refused) are done by `/userdoc` at epic close.

## Concerns / Open questions

- **Browser-based MCP clients are refused** (a web-hosted MCP inspector, a browser extension).
  This is intended; the user agreed when the epic was created. `mcp-setup.md` will say so.
- **No bearer token.** `Host` plus `Origin` closes the web-page attack surface, which is this
  epic's threat model. A token would also stop other local processes, but those already run as
  the user and are out of scope. Not added.
- **`Host` without a port.** HTTP clients always send the port when it isn't 80, and the port is
  never 80 here, so `127.0.0.1` without a port is refused on purpose.
- **US-1590 coupling** (see Background). Recorded in EPIC-118.

## Acceptance criteria

Run against the dev build after the main process restarts with the change. The probes use Node's
`http` module from a Persephone script, which can set any header. Replace `<port>` with
`mcp.port`.

- [ ] Normal agent traffic works. This conversation's MCP calls keep succeeding after the restart,
      and a fresh `initialize` with `Host: 127.0.0.1:<port>` and no `Origin` returns 200 with an
      `mcp-session-id`.
- [ ] `initialize` with `Host: evil.example:<port>` → **403** "Invalid Host header", with no
      session created (`getMcpClientCount()` unchanged).
- [ ] `initialize` with `Host: 127.0.0.1:<port>` and `Origin: https://evil.example` → **403**.
- [ ] The same with `Origin: null` → **403**.
- [ ] `localhost:<port>` as `Host`, no `Origin` → accepted.
- [ ] The in-app MCP Inspector can still connect to `http://127.0.0.1:<port>/mcp`, and the Mneme
      sidebar still connects, if Mneme is enabled.
- [ ] Mneme: `initialize` to Mneme's port with `Origin: https://evil.example` → refused;
      without `Origin` → accepted; with `Host: evil.example:<port>` → refused (already the
      case — confirm).
- [ ] `npm run typecheck`, `npm run lint`, `npm run build-prod` pass. `cargo build --release` and
      `cargo test` pass in `mneme/`.

## Progress

- [x] 1–4. Persephone guard + SDK options
- [x] 5. Mneme origin check
- [x] 6. `cargo build --release` and `cargo test` pass (run outside the Codex sandbox, which could not write the Cargo cache)
- [x] 7. `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass
- [x] Manual acceptance (dev build, 2026-10-01), forged `initialize` requests via Node `http`:
      Persephone — `Host: 127.0.0.1:<port>` and `localhost:<port>` → 200 with a session;
      `Host: evil.example:<port>`, `Origin: https://evil.example`, `Origin: null` → 403, no session.
      Mneme (rebuilt binary, restarted) — normal → 200; the same three forged requests → 403.
      The SDK client (the in-app MCP Inspector / Mneme connection path, renderer `fetch`) connects
      to both servers. This session's own MCP traffic kept working.
