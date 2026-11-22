---
title: "Browser request routing"
audience: agent
summary: "Configure declarative, page-scoped browser request routes in web-app tests, including URL matching, mock responses, CORS, cleanup, and target limits."
---

# Browser request routing

The browser editor exposes `route(urlOrRegex, response, options?)`, `unroute(urlOrRegex?)`, and
`unrouteAll()`. Routing is available only on an agent-opened page (`ctx.openBrowser()`) or a page
adopted for the current run with `ctx.usePage()`. An ordinary user page is refused, including a
user-opened Incognito or Tor page. The declarations belong to one browser guest and remain active
through navigation; they are not shared by tabs that use the same profile.

Routes are declarative JSON. Callbacks and functions are not accepted, so the same API works through
the test runner's MCP call boundary.

## Match a request

Patterns are matched against the full request URL. A string uses glob syntax:

- `*` matches zero or more characters except `/`.
- `**` can match `/` too.
- `?` is a literal question mark.
- `\\` escapes a wildcard.

Renderer code may pass a `RegExp`. JSON callers use `{ regex, flags? }`:

```js
await site.route({ regex: "api/items\\?id=\\d+", flags: "i" }, {
    status: 200,
    body: "[{\"id\":1}]",
    contentType: "application/json",
});
```

The newest registered matching route wins. Optional filters are applied before a route's `times`
count is consumed:

```js
await site.route("**/api/items", response, {
    method: ["GET", "HEAD"],
    resourceTypes: ["Fetch", "XHR"],
    times: 1,
});
```

`method` accepts an HTTP method or a non-empty array of methods. `resourceTypes` accepts CDP
resource types. `times` must be a positive integer; an exhausted route is removed. `unroute(pattern)`
removes every registration with the same normalized pattern, regardless of its response or filters.
`unroute()` and `unrouteAll()` clear every route on the selected tab.

## Fulfil, delay, or abort

An object response fulfils the request with status 200 and an empty body by default:

```js
await site.route("**/api/items", {
    status: 503,
    body: "temporarily unavailable",
    contentType: "text/plain",
    delayMs: 250,
}, { method: "GET", times: 1 });
```

Use `body` for UTF-8 text or `bodyBase64` for binary bytes; they are mutually exclusive. `headers`
is a string record. `contentType` supplies `Content-Type` only when `headers` does not contain it.
The body is sent to Chromium as base64, and route bodies and response headers are not written to
network logs or failure bundles.

`delayMs` on a fulfil response delays the fulfilment. An object with only `delayMs` waits, then
continues the original request unchanged. Delay is not supported with abort. Abort with the string
`"abort"` (CDP reason `Failed`) or `{ abort: reason }`, where reason is one of `Failed`, `Aborted`,
`TimedOut`, `AccessDenied`, `ConnectionClosed`, `ConnectionReset`, `ConnectionRefused`,
`ConnectionAborted`, `ConnectionFailed`, `NameNotResolved`, `InternetDisconnected`,
`AddressUnreachable`, `BlockedByClient`, or `BlockedByResponse`.

The limits are 50 routes per page, 1 MiB per route body, 30,000 ms per delay, and 2,000 characters
per URL pattern. Non-finite delays and invalid status, headers, base64, flags, methods, resource
types, or unknown fields are rejected. Fetch interception is disabled when the page has no routes.

## CORS and preflight

Chromium still applies CORS checks to fulfilled cross-origin fetch and XHR responses. Include
`access-control-allow-origin`; credentialed requests also need the appropriate
`access-control-allow-credentials` value. A preflight is a separate `OPTIONS` request. Route and
fulfil it with allow-origin, allow-methods, and allow-headers, then route the actual request too if
needed. A method filter can keep the preflight and actual method separate.

## Scope, detach, and cleanup

Fetch interception is enabled at request stage on the page's CDP target. The main frame and
same-process child frames share that target. Out-of-process iframes and dedicated workers are
separate targets and are not attached; service workers may serve requests before page Fetch sees
them. Proxy and Tor still choose the transport, and existing navigation and blocked-scheme policy
still applies.

DevTools can take ownership of the debugger. Routes pause while CDP is detached; declarative routes
are retained and Fetch patterns are restored on the next automation attach. Delay timers and
transient paused-request state are cleared on detach. Closing the guest deletes its route records.
At run cleanup, the runner calls `unrouteAll()` on adopted pages before releasing their test-power
adoption; pages opened by `ctx.openBrowser()` close and clear routes during guest teardown.

The relative event ordering between Chromium Fetch interception and Electron's session-level
`webRequest` hooks is runtime-dependent. Verify continued-request headers and routing diagnostics
on the pinned Electron build before relying on details such as the Windows SSO header hook.
