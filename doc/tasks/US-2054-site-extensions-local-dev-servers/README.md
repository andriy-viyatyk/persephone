# US-2054: Site extensions for local dev servers (port-scoped loopback hosts)

**Status:** Planned (recorded 2026-11-17). Not yet investigated.

## Goal

Let a site extension target **one local dev server**: a loopback host plus a port, such as
`localhost:5173`. Today it can only target a bare host name, and only over HTTPS. The motivating
use is agent-driven UI testing of web apps under development: an extension exposes the app's
screens as a stable `.app` model, and re-runnable test scripts (Agent Tools) drive that model
instead of parsing snapshots, which cuts agent token spend per run.

## Problem (as of 2026-11-17)

- **Matching ignores the port.**
  - `isExactSiteExtensionHost` (`src/shared/site-extension-validation.ts`) rejects a port.
  - `BrowserSiteExtensionController` matches `location.hostname` only:
    - `currentDocument` (around line 148);
    - `inject` (around line 301);
    - the injected guard expression (around line 342).
  - Effect: an extension for `localhost` attaches to **every** HTTPS page on `localhost`, whatever
    the port. A developer who runs several apps locally (each on its own port) can't give each its
    own extension, because a second claim on the same host is a conflict.
- **Plain HTTP is refused.**
  - Injection requires `https:`: `inject`, `currentDocument`, the guard expression, and `reload()`
    `currentHost`.
  - Effect: most dev servers (Vite, CRA, `dotnet run`) serve plain `http://localhost:<port>` by
    default, so the developer must first set up a trusted dev certificate. Their sign-in provider
    also needs the HTTPS redirect URI registered, which is often an admin-only change.

## Proposal (to be investigated)

1. Accept `host:port` entries in `hosts` **only for loopback names**: `localhost`, `127.0.0.1`,
   `[::1]`, and possibly `*.localhost`. Match host and port exactly.
   - A bare `localhost` keeps today's meaning, or becomes "any port" explicitly; decide which.
   - Conflict detection compares host and port.
2. Allow `http:` for loopback `host:port` entries only. Public hosts stay HTTPS-only.
3. The Trust bar and `siteExtensionTrustPrompt` show the port and the scheme, so the user sees
   exactly which local server is trusted.
4. `fetchHosts` rules stay unchanged: no loopback. This task is only about where an extension
   injects.
5. Update the agent guide `assets/guides/agents/site-extensions.md` ("use exact lower-case
   hostnames … do not include a scheme, wildcard, or port") and the user guide.

## Questions to settle when investigating

- What does a bare `localhost` entry mean after this change: any port (today) or port-less only?
- Is a loopback HTTP page a weaker trust boundary than HTTPS? Any local process can serve on that
  port. Probably acceptable, since the user trusts a specific `host:port` they run, but call it out
  in the Trust bar copy.
- Do the main-process grant checks (`site-extension-fetch-service.ts`, trust records) key on host
  only anywhere else?

## Acceptance

- [ ] Two extensions, one on `localhost:5173` and one on `localhost:3000`, both valid with no
  conflict; each injects only on its own port.
- [ ] An extension on `localhost:5173` injects on `http://localhost:5173/...`.
- [ ] A non-loopback host with a port, or over HTTP, is still rejected.
- [ ] The guides are updated; integration tests cover matching and conflicts.
