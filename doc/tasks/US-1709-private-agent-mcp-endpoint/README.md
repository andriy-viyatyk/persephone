# US-1709: Private agent MCP endpoint

**Epic:** [EPIC-131: Agent sessions in boards](../../epics/EPIC-131.md) — Phase 0, P0-C
**Status:** In progress

## Progress

- [x] Add the private listener, bearer-token session ownership, limits, and lifecycle cleanup.
- [x] Route typed issue/revoke requests through the module-service host and main-owned supervisor checks.
- [x] Revoke endpoint credentials at trust, permission, service-process, and application shutdown boundaries.
- [x] Add the host-service API and separate external/in-app MCP status reporting.
- [x] Append the feature to the existing bridge `1.42.0` documentation and release notes.
- [x] Run the requested typecheck, lint, and production build; address any reported issues.

## Goal

Give agents launched by a board service the full Persephone MCP tool surface for the lifetime of an explicitly issued in-app session, regardless of the user's CLI MCP configuration or `mcp.enabled`. Keep `mcp.enabled` scoped to external clients and preserve the existing external endpoint's behavior.

## Background

### Epic decisions and CLI injection research

EPIC-131 P0-C specifies a private, lazily started second listener bound only to `127.0.0.1` on a random port, independent of `mcp.enabled`, with per-agent-session bearer tokens that remain valid until explicit `revoke()` or board-service/app lifecycle revocation; MCP transport idle eviction does not revoke the token. The grant requires `appScripting`, because MCP grants full app control. The CLI provider injects the endpoint per session and never changes user CLI configuration.

Section 7 of [EPIC-131-cli-research.md](../../epics/EPIC-131-cli-research.md) verifies Claude Agent SDK HTTP server configuration as `mcpServers: { persephone: { type: "http", url, headers } }` and recommends allowing `mcp__persephone__*`; it also verifies Codex streamable HTTP configuration through `-c mcp_servers.<id>.url=...` and `bearer_token_env_var=...`, with the token placed in child environment rather than argv. Claude's SDK setup can receive headers, while Codex's environment-variable setting sources the bearer token. The existing user/project CLI servers remain additive in the researched Codex flow.

The task must implement the board bridge API and lifecycle, not either provider board. The API requires the caller board's `appScripting` grant; service identity must be established from the main-process service ownership records rather than caller-supplied identity.

### Verified source findings

- `src/main/mcp-http-server.ts` owns one `httpServer`, `currentPort` (7865 by default), one global session map, a 30-minute idle timeout, a 60-second sweep, and a 500-session cap. Its request handler restricts `/mcp`, validates `Host` against `127.0.0.1:<port>` or `localhost:<port>`, rejects any `Origin`, and enables SDK DNS-rebinding protection with those allowed hosts. The external status event is `{ running, url, clientCount }`, where `getMcpClientCount()` is the shared map size. `stopMcpHttpServer()` closes the sessions and listener.
- `src/main/mcp/server-factory.ts` uses `createMcpServer()` to create every session's full server: shared instructions, `call`, focused guide resources, and the full API guide. `src/main/mcp/tools/call-tools.ts` routes `main` and `windows[i]` paths in main and forwards renderer paths through `sendToRenderer()` in `src/main/mcp/renderer-bridge.ts`. Reusing `createMcpServer()` preserves tool registration and window targeting for both listeners. `src/main/mcp/manifest.ts` owns server identity, instructions, and guide/resource metadata, not listener lifecycle.
- `src/renderer/api/app.ts` starts MCP at startup only when `mcp.enabled` is true and actuates `api.setMcpEnabled()` on later setting changes. `src/ipc/main/core-handlers.ts` maps that API to `startMcpHttpServer()` / `stopMcpHttpServer()` and returns `McpStatus`. `src/main/main-setup.ts` calls `stopMcpHttpServer()` on app `will-quit`. These are external-listener controls to preserve.
- `src/renderer/api/window.ts` stores only `mcpRunning` and `mcpClientCount`; `src/renderer/ui/app/MainPageView.ts` shows the header MCP indicator only while running and labels/counts active connections. `src/renderer/editors/settings/sections/McpSection.ts` reports the external listener state. The localized connection message is currently `activeMcpConnections` in `src/shared/i18n/en/shell.ts`.
- `assets/module-service-host.mjs` injects `persephone.storage` and `persephone.service` lifecycle helpers. Its `storageRequest()` pending map and `storage-request`/`storage-response` messages provide the closest existing pattern for a typed main RPC. `src/ipc/module-service-channels.ts` defines parent/child protocol messages; `src/main/module-service-handshake.ts` routes child messages to callbacks; the process listener and `ModuleServiceStorageAdapter` are wired in `src/main/module-service-supervisor.ts`.
- The supervisor indexes `ServiceRecord` by normalized `boardRoot`; that record retains the main-owned root, current process, generation, and service lifecycle. `request(boardRoot, ...)` resolves the record from main's map and checks the trust snapshot before starting/routing. Never take the board identity from an MCP endpoint request. `stopRecord()` is the common stop path, `handleUnexpectedExit()` handles a child exit before restart, `disposeAll()` is the graceful quit path, and `forceKillAllSync()` is the final quit path.
- `TrustedBoardSnapshotEntry` in `src/ipc/module-service-channels.ts` already contains granted `permissions` and current `manifestPermissions`. `src/shared/board-manifest-utils.ts` already normalizes `appScripting` and exports `boardPermissionAllows()`. Use the granted snapshot for the check. The supervisor has a previous `trustedSnapshot` field, so it can detect permission loss before replacing that snapshot without adding permission state to `ServiceRecord`.
- `src/main/board-trust-service.ts` builds the grant snapshot and calls `moduleServiceSupervisor.applyBoardServiceTrustSnapshot()` when trust or permission state changes. Permission reductions can be reconciled while a service remains startable, so revocation must react to `appScripting` loss even when the service remains running.
- `src/shared/board-bridge-version.ts` is the one bridge-version constant and currently says `1.41.0`. The current-version text is present in `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `src/renderer/editors/board/board-api.d.ts`, `doc/architecture/overview.md`, and the bridge row in `doc/architecture/key-files.md`. `assets/board-template/CLAUDE.md` contains the board authoring contract and bridge feature history. Historical 1.41.0 feature mentions remain history; update only claims that identify the current version. Repository scan found no bridge-version-specific test/table requiring a new assertion. No test or harness is added per task instruction.

## Implementation Plan

1. **Keep the external listener intact and add a separate private listener.** Refactor `src/main/mcp-http-server.ts` so its HTTP/session handler receives endpoint-specific state (port, allowed hosts, auth policy and session map), with the existing endpoint retaining `DEFAULT_PORT`, its existing DNS-rebinding/Origin behavior, session idle policy, and `mcp.enabled` lifecycle. Add a private endpoint that binds `127.0.0.1` with port `0`, reads the actual bound port from `server.address()`, and starts on the first authorized service issuance. Authenticate every HTTP request before MCP handling, including POST initialize, subsequent POST, GET SSE, and DELETE. Preserve the `/mcp` path, loopback `Host` checks, Origin rejection, and SDK `enableDnsRebindingProtection` with the private listener's own allowed hosts.

   Before, external and private clients would share the process-wide listener/session map:

   ```ts
   const sessions = new Map<string, Session>();
   const server = http.createServer(handleHttpRequest);
   ```

   After, keep two endpoint states and create the same per-client MCP server for either handler:

   ```ts
   const externalEndpoint = createEndpointState({ port: configuredPort, auth: "none" });
   const privateEndpoint = createPrivateEndpointState({ host: "127.0.0.1", port: 0, auth: "bearer" });
   const server = createMcpServer(); // same factory and tool path for both endpoints
   ```

   `src/main/mcp/server-factory.ts` and `src/main/mcp/manifest.ts` need no behavior change: `createMcpServer()` already registers the complete tool and resource surface for each session. `src/main/mcp/tools/call-tools.ts` routes calls through the shared main/window selection logic and `sendToRenderer()` in `src/main/mcp/renderer-bridge.ts`, so private clients inherit the same targeting and renderer bridge.

2. **Implement token issue/revoke and service authorization in main.** Add a typed service-originated `mcp-endpoint-request`/response operation to `src/ipc/module-service-channels.ts` and route it through `src/main/module-service-handshake.ts`, `src/main/module-service-supervisor.ts`, and the existing utility-process message listener. The route uses the `ServiceRecord` selected by the supervisor's captured process and normalized `boardRoot`; never accept a board root from the service payload. Require a live, trusted service record and `boardPermissionAllows(grantedPermissions, "appScripting")` against the main-owned trust snapshot. Add a separate private MCP capability/session manager (recommended new file `src/main/mcp/private-session-endpoints.ts`) that lazily starts the private listener and exposes main-only issue/revoke/revoke-for-board/shutdown operations to `mcp-http-server.ts` and the supervisor.

   On issuance return `{ url, headers: { Authorization: "Bearer <token>" }, token, revoke() }`. Generate 32-byte random tokens with `node:crypto`; require exact `Bearer` syntax and constant-time `timingSafeEqual` after strict fixed-length decoding. After the Host/Origin checks, reject missing, malformed, unknown, and revoked tokens with the same `401 Unauthorized` status and generic body `{"error":"Unauthorized"}`; do not expose whether a token is unknown or revoked, and never include the token value in logs. Authenticate every request against the token. A token may own up to four MCP transport sessions; each new initialize beyond four evicts only that token's least-recently-active transport, never another token's or an external session. Make `revoke()` idempotent; it immediately closes all transports owned by that token. The service host's `revoke()` sends a request to main once and clears its local credential reference; the provider calls it when the agent session ends.

3. **Revoke at every trust and process boundary.** In `src/main/module-service-supervisor.ts`, revoke a board's issued endpoints before `stopRecord()` for untrust, explicit stop, service removal, and quit; also revoke in `handleUnexpectedExit()` before restart recovery. On every `applyBoardServiceTrustSnapshot()` update, compare the previous granted permission snapshot to the new grant and revoke the board's endpoints immediately if `appScripting` is removed, even if the board still has `service` permission and its process remains alive. In `forceKillAllSync()`, synchronously invalidate all tokens before process kill. During app quit, `src/main/main-setup.ts` must shut down the private listener and all private transports independently of `stopMcpHttpServer()`; revoke credentials synchronously before beginning async listener close. Keep explicit `mcp.enabled=false` calling `stopMcpHttpServer()` scoped to the external endpoint.

4. **Extend the static service host API.** In `assets/module-service-host.mjs`, add `persephone.mcp.issueSessionEndpoint()` only for host-API services, using a pending request map patterned after existing `storageRequest()` and the typed main/utility-process protocol. Return a clone-safe object with `url`, `headers`, `token`, and a local `revoke()` method; service-local active handles should be revoked from an injected shutdown callback and clear the local token. Preserve raw-protocol mode behavior. The provider's Claude SDK can use `{ type: "http", url, headers }`; Codex gets the endpoint URL plus a chosen environment variable (for example `PERSEPHONE_MCP_TOKEN`) carrying `token`, with `bearer_token_env_var` in per-process `-c` overrides. Do not persist either CLI configuration.

   Before, the service API has only lifecycle and storage helpers:

   ```js
   persephone.service.onRequest(handler);
   persephone.service.onShutdown(handler);
   persephone.storage.get(key);
   ```

   After, add a service-only MCP helper and host-managed cleanup:

   ```js
   const endpoint = await persephone.mcp.issueSessionEndpoint();
   // Use endpoint.url + endpoint.headers (Claude), or endpoint.token via child env (Codex).
   await endpoint.revoke(); // safe to call more than once
   ```

5. **Set caps and cleanup semantics.** In `src/main/mcp-http-server.ts`/`src/main/mcp/private-session-endpoints.ts`, use a separate cap of 64 issued private endpoints and 64 active private MCP transports. Cap each token at four transports; before admitting its fifth initialize, evict that token's least-recently-active transport. Then enforce the global active-transport cap: reject a new initialize with a stable busy response if 64 transports remain active, without evicting another token's or an external session. Reject issuance at the 64-token cap with the same stable busy category. Share the current 30-minute no-traffic transport idle timeout and 60-second sweep cadence. Idle eviction closes only the transport: its bearer token remains valid, and the CLI can initialize a replacement transport using the same endpoint credentials. Tokens have no time-based expiry, including before first connection; they remain valid until explicit `revoke()` or lifecycle revocation, subject to the 64-issued cap. Session caps and idle cleanup for external clients remain exactly as they are today; do not let either endpoint's cap evict sessions from the other.

6. **Expose separate status counts.** Keep `McpStatus.running` and `clientCount` meaning “external listener running” and “external MCP clients,” respectively, so `mcp.enabled` and the Settings MCP section retain their semantics. Add `inAppAgentCount` to `McpStatus` and the `eMcpStatusChanged` event in `src/ipc/api-types.ts`; calculate it from active private MCP transports. Update `src/renderer/api/window.ts` and `src/renderer/ui/app/MainPageView.ts` so the header indicator appears while either external MCP is running or private agent clients exist, with separate external/in-app counts in its title/badge. Add localized copy in `src/shared/i18n/en/shell.ts` and consume it from `MainPageView.ts`; `McpSection.ts` continues to report only external listener state. Do not broadcast token, board root, or full MCP session IDs.

7. **Document the shared Phase 0 bridge `1.42.0`.** US-1710 performs the one Phase 0 `BOARD_BRIDGE_VERSION` bump from `1.41.0` to `1.42.0`. At US-1709 implementation time, leave `src/shared/board-bridge-version.ts` unchanged if it already reads `1.42.0`; only bump it if it still reads `1.41.0`. Do not create another constant or a second bump. Update current-version descriptions in `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `src/renderer/editors/board/board-api.d.ts`, `doc/architecture/overview.md`, and `doc/architecture/key-files.md`, retaining historical 1.41.0 feature references. Document service-side `persephone.mcp.issueSessionEndpoint()`, returned fields, revocation behavior, the `appScripting` full-access requirement, and `minBridgeVersion: "1.42.0"` in the Boards guide and board template. Add an upcoming feature bullet to `assets/guides/whats-new.md`. Update the developer architecture description for the private endpoint, and the key-files row if ownership changes. Do not edit the epic or active-work dashboard.

8. **Review unchanged surfaces.** `src/shared/board-manifest-utils.ts` already defines and normalizes `appScripting` and exports `boardPermissionAllows()`; use it without changing permission flags. `src/main/mcp/server-factory.ts` and `src/main/mcp/manifest.ts` already define the shared MCP surface; no changes unless the endpoint refactor proves a listener-specific dependency. `src/renderer/api/app.ts` and `src/ipc/main/core-handlers.ts` remain external switch actuators. `src/main/board-trust-service.ts` already builds and pushes grant snapshots; the supervisor consumes them. No bridge-version-specific tests or tables were found, and this task adds no tests or harnesses per the project constraint.

## Concerns

- The private endpoint intentionally keeps a valid token after transport idle eviction so a long-running or reconnecting CLI can initialize again. The provider must call `revoke()` when its agent session ends; service lifecycle revocation remains the backstop.
- The recommended limits are 64 issued endpoints, 64 active private transports, and four transports per token. Per-token LRU eviction runs before the global active-session cap check; global pressure never evicts another token's or an external client's session.
- US-1710 owns the single Phase 0 bridge bump to `1.42.0`. US-1709 must reuse that version and append its feature to the existing version history/guide entries; only bump the source if implementation discovers it is still `1.41.0`.
- Authentication failures use one generic `401 Unauthorized` response for missing, malformed, unknown, and revoked tokens. Logs must not contain token values.

## Acceptance Criteria

- A board service with `appScripting` can issue a session-specific endpoint and can revoke it; a service lacking that permission cannot issue one.
- The private endpoint is loopback-only, uses a random port, starts lazily and works while `mcp.enabled` is false.
- Missing, malformed, unknown, and revoked bearer tokens all receive the same generic `401 Unauthorized` response; comparison is constant-time and logs never include token values. Revocation closes every transport owned by that token.
- The external endpoint retains its existing address, authentication behavior, allowed-host behavior, status events, and `mcp.enabled` start/stop semantics.
- Private and external sessions use the same MCP tools and renderer/window targeting behavior.
- Session counts, caps, and cleanup are explicit and bounded: 64 issued tokens, 64 active private transports, and at most four transports per token; idle eviction closes a transport but preserves its token for reinitialization.
- Tokens remain valid across transport idle eviction and reconnect; they are revoked on explicit endpoint `revoke()`, service stop/exit/restart, trust removal, `appScripting` removal, and application quit.
- The Phase 0 bridge remains `1.42.0` with one bump total; if already at `1.42.0`, this task appends its feature to the existing history instead of bumping again.
- Bridge documentation is updated, including the boards guide and upcoming What's New section.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/main/mcp-http-server.ts` | Parameterize listener/session handling; add private endpoint authentication, per-token session ownership, cap, idle sweep and status counts |
| `src/main/mcp/private-session-endpoints.ts` | New main-owned endpoint/token lifecycle manager; lazy bind, issue, revoke, revoke by board and shutdown |
| `src/main/module-service-supervisor.ts` | Route service MCP endpoint RPC using main-owned service identity; check grant and revoke on permission/trust/process lifecycle |
| `src/main/module-service-handshake.ts` | Route typed service-originated MCP issue/revoke requests |
| `src/ipc/module-service-channels.ts` | Define typed service-originated MCP endpoint request/response messages |
| `assets/module-service-host.mjs` | Add `persephone.mcp.issueSessionEndpoint()`, pending RPC handling, token cleanup on shutdown |
| `src/ipc/api-types.ts` | Add `inAppAgentCount` to MCP status/event shape |
| `src/renderer/api/window.ts` | Retain separate in-app agent count in window state |
| `src/renderer/ui/app/MainPageView.ts` | Show status for external listener or private clients; label counts separately |
| `src/shared/i18n/en/shell.ts` | Add localized status copy for external MCP clients and in-app agents |
| `src/ipc/main/core-handlers.ts` | Include the in-app count in `getMcpStatus()` while preserving external `running`/`clientCount` semantics |
| `src/main/main-setup.ts` | Invoke private endpoint shutdown during app quit, independently of the external setting toggle |
| `src/shared/board-bridge-version.ts` | No change if US-1710 has already set `1.42.0`; bump from `1.41.0` only if still needed, preserving the single Phase 0 bump |
| `assets/guides/boards.md` | Append this API to the existing `1.42.0` guide/history entry; document return value, revocation, `appScripting`, and minimum bridge version without adding a second version entry |
| `assets/guides/agents/boards.md` | Append the service API to the existing `1.42.0` agent guide entry; do not add a separate bridge bump/history entry |
| `assets/board-template/CLAUDE.md` | Document the service endpoint API and `minBridgeVersion` in the existing `1.42.0` board authoring/version history |
| `assets/guides/whats-new.md` | Add an upcoming feature entry |
| `src/renderer/editors/board/board-api.d.ts` | Append the feature to the existing `1.42.0` comment only; do not expose the service-only API on the frame-side `PersephoneServiceApi` |
| `doc/architecture/overview.md` | Append the feature to the existing `1.42.0` bridge history and describe the separate private endpoint and board-service bridge |
| `doc/architecture/key-files.md` | Keep the single `1.42.0` bridge row, append this feature, and add endpoint lifecycle ownership if the new manager is added |

**Inspected files that need no changes:**

| File | Why unchanged |
|---|---|
| `src/main/mcp/server-factory.ts` | Already builds the complete MCP tool/resource set per session; both listeners reuse it |
| `src/main/mcp/manifest.ts` | Contains shared MCP instructions and resource metadata, not listener lifecycle |
| `src/shared/board-manifest-utils.ts` | `appScripting` normalization and `boardPermissionAllows()` already exist |
| `src/main/board-trust-service.ts` | Already provides granted permission snapshots and pushes them into the supervisor |
| `src/renderer/api/app.ts` | `mcp.enabled` startup/change handling remains the external listener control |
| `src/renderer/editors/settings/sections/McpSection.ts` | Settings continues to report external listener state and URL; in-app agent count belongs in the header indicator |
| `doc/epics/EPIC-131.md` | User will maintain the epic |
| `doc/active-work.md` | User explicitly asked not to edit the dashboard |
| CLI config files | The endpoint is injected per process/session and never persisted to user config |
| Tests and test harnesses | This project task must not add them |


