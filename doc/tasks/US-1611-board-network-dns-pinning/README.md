# US-1611: Close the DNS-rebinding gap in `network: "internet"` for board session fetches

**Origin:** the EPIC-119 `/review` (2026-10-03). Finding confirmed by Claude; not yet investigated
for a fix.

## Goal

A board granted `network: "internet"` must never reach a loopback, private or link-local address,
even when DNS answers differently between the check and the connection.

## Background (verified)

- `src/main/session-src-protocol.ts:218` resolves the target with Node's
  `dns.lookup(..., { all: true })`. Line 227 refuses a private address when the grant is
  `"internet"`.
- The request is then made with `entry.session.fetch(currentUrl, …)` (line 167). Chromium resolves
  the host again on its own. A hostile domain with a short TTL can return a public address to the
  check and a private address to Chromium, so the check is time-of-check-to-time-of-use (TOCTOU).
- This adds to the known limit already recorded in EPIC-119: with a proxy or Tor route, the proxy
  resolves DNS.

## Options to investigate

1. Connect only to the address that was checked:
   - for `"internet"` requests, make the request through Node `http`/`https` with a custom `lookup`
     that validates every resolved address at connect time;
   - keep TLS SNI and the `Host` header set to the original host name;
   - accept losing the Chromium session (cookies and proxy) for these requests, or replicate
     whatever is needed.
2. Use `session.resolveHost()` (Chromium's resolver) for the check, so check and fetch share
   Chromium's host cache. This narrows the window but does not close it.
3. Check the connected peer address after the connection (`webRequest`'s `ip` in `onCompleted` /
   `onResponseStarted`) and abort when it is private. Determine whether the request has already
   been sent by then.

## Acceptance criteria

- With `network: "internet"`, a host that resolves to a private address at connect time is refused
  even if an earlier lookup returned a public address.
- `network: "full"` and the MCP-endpoint rule are unchanged.
