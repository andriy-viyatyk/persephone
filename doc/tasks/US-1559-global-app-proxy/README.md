# US-1559: Global app proxy — route all of Persephone's own network traffic through one proxy

**Status:** Planned · standalone (no epic) · follows [US-1557](../US-1557-browser-profile-network/README.md)

## Goal

Add one app-wide proxy setting so that Persephone's own network traffic uses a configured
SOCKS5/HTTP proxy, not only browser pages: the app renderer, main-process downloads, module
services, and the raw Node HTTP clients. Browser profiles keep their own US-1557 setting, and
Tor pages always use Tor.

## Background

US-1557 adds `BrowserNetwork` (`{ kind: "direct" } | { kind: "proxy"; protocol; host; port }`)
and the shared main helper `src/main/session-proxy.ts` (apply/clear proxy on a session +
egress lookup). This task reuses both.

Persephone has five separate network stacks, and one `session.setProxy` call covers only some:

| Stack | Users | Mechanism to proxy it |
|---|---|---|
| App renderer session (`appPartition` = `nopersist`, `src/main/constants.ts`) | `<img>`, CSS, renderer `fetch()`, Link editor tiles on non-browser pages, Monaco | `session.fromPartition(appPartition).setProxy(...)` |
| `session.defaultSession` (main `net.fetch`) | `version-service.ts`, `published-boards-service.ts`, `board-download-service.ts` | `session.defaultSession.setProxy(...)` |
| Utility processes' `net` | module-service host (`module-service-supervisor.ts`) | Electron `app.setProxy(...)` |
| Raw Node `http`/`https` in the renderer | `src/renderer/api/node-fetch.ts` → `app.fetch()`, REST Client (`RestClientEditor.ts:674`), `HttpProvider.ts:76/102`, `NodeFetchHlsLoader.ts:67`; `components/icons/favicon-cache.ts` | Not covered by Chromium. Needs a proxy `Agent` passed to `http(s).request` — SOCKS: an agent dependency (e.g. `socks-proxy-agent`); HTTP: a CONNECT tunnel agent (e.g. `https-proxy-agent`). Rerouting through `net.fetch` is rejected: it injects headers, which breaks the REST Client's "no automatic headers" contract (`node-fetch.ts` header comment). |
| Child processes | git (`git-service.ts`), `command-runner.ts`, terminals, `tor.exe` | Only by exporting `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` into spawned environments; tools honour them inconsistently. |

Local schemes (`app-asset://`, `board://`, `session-src://`, `tor-src://`, `profile-src://`) are
protocol handlers, not network, and are unaffected.

## Implementation Plan

1. **Setting:** `network.global-proxy: BrowserNetwork` in `src/renderer/api/settings.ts`
   (default direct), with a Settings UI line in a "Network" section.
2. **Main service:** extend `src/main/browser-network-service.ts` (US-1557) with
   `applyGlobal(network)`: apply to `appPartition` + `defaultSession` via `session-proxy.ts`,
   and call `app.setProxy`. Invoked by the renderer at startup (before any remote load where
   possible) and on setting change.
3. **Node HTTP:** in `src/renderer/api/node-fetch.ts`, choose the agent from the current global
   proxy (cached, rebuilt on change). `favicon-cache.ts` switches to `nodeFetch` or the same agent.
4. **Child processes:** decide (open question 2) whether to inject proxy env vars in
   `command-runner.ts` / `terminal-launcher.ts` / `git-service.ts`.
5. **Precedence:** Tor pages → Tor; a proxied profile → its proxy; a Direct profile → direct
   (open question 1); everything else → global.
6. **Bypass:** keep Chromium's implicit loopback bypass so the Vite dev server, MCP
   (`localhost:7865`), mneme, and local services keep working; mirror it for Node agents
   (no agent for `localhost`/`127.0.0.1`/`::1`).
7. **Docs:** `assets/guides/` settings guide, `doc/architecture/key-files.md`.

## Concerns / Open Questions

1. Should a browser profile set to Direct mean "really direct" or "use global"? Proposal: add a
   third profile option "Use global" as the new default, keeping explicit Direct.
2. Child-process env injection: include, or leave out and document?
3. New npm dependency for SOCKS/HTTP agents (size, licence) vs a small in-house CONNECT/SOCKS5
   agent.
4. Startup ordering: the renderer owns settings, so the first app-session requests before the
   renderer pushes the global proxy go direct. Options: main reads the settings file at
   startup, or accept the short window.
5. `tor.exe` itself connects direct; chaining it via torrc `Socks5Proxy` is out of scope.

## Acceptance Criteria

- [ ] With a global proxy set, renderer images/fetches, main downloads, module-service network,
  `app.fetch()`, REST Client, `HttpProvider`, and HLS requests egress through the proxy
  (verified with the US-1557 test VPN's dnsmasq log and Check IP).
- [ ] Local dev server, MCP, and local protocols keep working.
- [ ] Profile and Tor precedence behave as decided above.
- [ ] Clearing the global proxy returns everything to direct without restart.

## Files Changed

| File | Change |
|---|---|
| `doc/tasks/US-1559-global-app-proxy/README.md` | This task document. |
| `doc/active-work.md` | Planned entry. |
