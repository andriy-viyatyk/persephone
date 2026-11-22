# US-2168: Declarative request routing

## Goal

Let a test configure deterministic, page-scoped request responses through declarative JSON using `route(urlOrRegex, response, options?)`, `unroute(urlOrRegex?)`, and `unrouteAll()`. Route only test-power pages, use CDP `Fetch`, and preserve useful network and failure diagnostics without adding a renderer event channel or a second request protocol.

## Background

### EPIC-207 decisions and API shape

- This task implements proposal F3 under [EPIC-207](../../epics/EPIC-207.md). Decisions 1, 2, 3, 5, and 8 bind the ownership, access, cleanup, protocol, and bridge-version plan. The review's [section 3 F, including Owner and guardrails](../../reviews/web-app-testing-review.md#f-control-of-the-page-environment) requires a new CDP collaborator, reuse of the browser IPC primitives, and planning against existing session request handling; [section 6 Q4](../../reviews/web-app-testing-review.md#6-open-questions) limits routes to test runs and agent-opened pages, never a page the user opened.
- The new main-process owner is `src/main/cdp/cdp-request-routes.ts`. It owns route validation, URL matching, precedence, per-page records, `Fetch.enable` patterns, paused-request completion, delay timers, and cleanup/restore. `src/main/cdp-service.ts` only composes the module and its target lifecycle.
- Renderer members belong in a browser-facade collaborator and the existing `BrowserEditorFacade` composition; do not grow `BrowserWebviewModel.ts` or another roadmap §2.3 god file. Use a collaborator such as `src/renderer/editors/browser/BrowserRequestRoutes.ts` to own facade-side validation and typed CDP calls.
- `src/renderer/editors/browser/agent-access.ts` now exports `agentMayUseBrowserTestPower(state)` alongside `agentMayAccessBrowserPage(state)`. Reuse that predicate and the shared refusal helper/message from US-2166; do not reproduce `openedByAgent`, adoption, or incognito/Tor rules in this feature. The state helper composes the ordinary page rule with `openedByAgent || testPowerAdopted`, so user-opened private pages stay refused.
- Add board-callable browser-editor members by extending the existing **Bridge 1.61.0** history paragraph in `assets/guides/agents/boards/bridge-versions.md`. US-2165 already performed the epic's `BOARD_BRIDGE_VERSION` bump; do not bump it again.

### Verified request path and diagnostics

- `src/main/network-logger.ts` hooks every Electron `Session` once. Its only request-stage listener is `webRequest.onBeforeSendHeaders`; it logs metadata, normally calls back with the same headers, and may asynchronously add Windows SSO headers for eligible Microsoft sign-in traffic. `onCompleted` and `onErrorOccurred` finish or remove those log entries. There is no repository `webRequest.onBeforeRequest` listener or ad/content blocker answering browser requests. `src/main/permission-policy-service.ts` handles permissions, not request responses.
- Electron's [`WebRequest` documentation](https://www.electronjs.org/docs/latest/api/web-request/) says `onBeforeSendHeaders` is called before an HTTP request is sent and its callback can replace request headers. The CDP [`Fetch` documentation](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/) says `Fetch.enable` pauses matching requests until `continueRequest`, `failRequest`, or `fulfillRequest`, and that request-stage interception is before the request is sent. Neither reference specifies the relative dispatch order between Electron `webRequest` and CDP Fetch in Electron's embedded Chromium. **Assumption to validate in implementation:** a request paused by Fetch is decided before normal HTTP dispatch; a continued request then proceeds through session `onBeforeSendHeaders`, while a Fetch fulfil/abort completes without a second response answer from that listener. Do not claim this ordering as documented. Add an integration acceptance check for a continued request (including SSO-header behavior where testable), fulfil, abort, and delay.
- Session proxy and Tor configuration (`src/main/session-proxy.ts`, `src/main/tor-service.ts`) choose the network transport and do not synthesize a response. `src/main/browser/navigation-scheme-guards.ts` prevents blocked/local schemes from navigating; `BrowserGuest` also applies the main-frame navigation policy. These remain policy gates outside HTTP routing. A blocked scheme never becomes a Fetch route response. The route module must not alter proxy, permission, navigation, or scheme policy.
- Board URL claims in `src/main/download-service.ts` are checked only from Electron's `will-download` path: a claimed download is cancelled and handed to the owning board, optionally through a session source handle for proxied/Tor traffic. They do not answer an HTTP request or intercept ordinary page fetches. Keep this download ownership behavior separate; a route that causes a download still flows through the existing download gate and board claim policy.
- The CDP collector in `src/main/cdp/cdp-network-collector.ts` records `Network.requestWillBeSent`, `Network.responseReceived`, and `Network.loadingFinished`, keyed by target/session/request ID. Its OOPIF helper explicitly attaches iframe targets for collectors and waiters; this route feature will not attach those targets. The collector currently does not retain `Network.loadingFailed` details. The CDP [`Network` documentation](https://chromedevtools.github.io/devtools-protocol/tot/Network/) describes `Network.requestWillBeSent` and `Network.loadingFailed`; Fetch exposes `networkId` when the paused request has a corresponding Network event. Fulfil should be visible as a response when Chromium emits those normal Network events; an abort is expected to produce `loadingFailed`. Confirm the actual event sequence with Electron's pinned Chromium and add a narrow `loadingFailed` outcome to the collector if needed so `networkRequests()` and failure capture can show a routed abort.
- `waitForResponse()` in `src/main/cdp/cdp-waits.ts` waits on `Network.requestWillBeSent`, `Network.responseReceived`, and `Network.loadingFailed`; it returns matching status/headers on response and rejects if the request fails before a response. Thus a fulfilled route should resolve with the synthetic response status, and an aborted route should reject with the network error. Preserve that behavior; do not make a route handler answer the waiter directly.
- Public `networkRequests()` in `src/renderer/automation/page-state.ts` reads Electron's per-page log via `src/main/network-logger.ts`, while optional response bodies are resolved by `src/main/cdp-network-response-bodies.ts` against CDP collector records. A Fetch fulfil could bypass `onBeforeSendHeaders`, so do not assume that `networkRequests()` already reports synthetic responses. First verify the pinned runtime. Only if the session logger misses fulfil/abort, add exactly one exported metadata-only function to `src/main/network-logger.ts` and call it from `src/main/cdp/cdp-request-routes.ts`, keyed by browser registration key and CDP request identity; deduplicate if both paths observe an outcome. The logger never imports the route module. Record URL, method, resource type, final status/error and timing only; never route bodies or response headers into network logs. The existing failure bundle in `src/test-host/failure-bundle.ts` keeps requests with `error` or 4xx/5xx status, so routed aborts and synthetic error statuses must be present there without a parallel diagnostic channel.
- `src/main/browser/navigation-scheme-guards.ts` is the actual path; there is no `src/main/navigation-scheme-guards.ts`. The existing `cdp-network-response-bodies.ts` is at `src/main/cdp-network-response-bodies.ts`, beside `cdp-service.ts`, not under `src/main/cdp/`.

### CDP target scope and lifetime

- Browser CDP registration keys identify one browser guest/page. `BrowserTargetModel.cdp(tabId)` and the browser `CdpSession` use that key. `clearCdpTargetState(key)` in `src/main/cdp-service.ts` is called when a guest is released and composes feature `clearKey` methods. Key the route registry by that registration key and its `WebContents`; never by profile, session, or window.
- `CdpTarget.subscribeCdpEvents()` dispatches debugger events in main. The route module itself subscribes to `Fetch.requestPaused`; the renderer only sends typed add/remove/clear calls over `BrowserChannel` and the existing invoke/reply and error-unwrapping path. No renderer Fetch event channel, request correlator, `PendingRequests`, wire envelope, or new frame method map is needed.
- `Fetch.enable` must receive patterns compiled from currently active route records. With zero routes, do not enable Fetch or use a global `"*"` pattern. When the final route is removed or exhausted, call `Fetch.disable`. A paused request that no longer matches after a concurrent update, or whose handler throws, must be continued best-effort so it cannot hang the page.
- Call `Fetch.enable` with `handleAuthRequests: false` explicitly and set `requestStage: "Request"` on every pattern. This feature does not handle HTTP authentication challenges; enabling `handleAuthRequests` would emit `Fetch.authRequired` pauses that this module does not answer. Keep routing at the request stage only.
- The installed `node_modules` has no `devtools-protocol` package or shipped protocol schema to inspect. As a fallback, the upstream [`Fetch.pdl` definition](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Fetch.pdl) defines `Fetch.fulfillRequest.responseCode` as required, `responsePhrase` as optional (when omitted, CDP uses the standard phrase for the status), `responseHeaders` as an optional array of `{ name, value }`, and `body` as binary protocol data encoded as base64 over JSON. Encode UTF-8 route text to base64 in the main module before calling CDP; pass response headers as the array form. A status does not require `responsePhrase`.
- The page target covers its main frame and same-process child frames. Out-of-process iframes are separate targets and are intentionally not attached, consistent with US-2165. A dedicated worker is a separate CDP target and is not covered without worker target auto-attachment; this feature adds no auto-attach. Service-worker-intercepted requests may be served before the page target's network path and can bypass page Fetch interception. These target/service-worker details are CDP scope inferences to validate on the pinned runtime, not guarantees stated by Electron's webRequest docs.
- On explicit debugger detach (including DevTools), clear active CDP identifiers, pending paused-request bookkeeping, and all delay timers, but retain declarative route records by page key; re-enable Fetch and rebuild patterns on the next attach, following `src/main/cdp/cdp-init-scripts.ts`'s retained-source / cleared-CDP-ID restore pattern. The browser will not be routed while DevTools owns the debugger. CDP detach is expected to release paused requests; verify it, and if a command is still possible during a detach callback, best-effort continue before discarding the active request. Guest close (`clearCdpTargetState`) deletes route records and timers.
- Routes remain active through navigations within the adopted test page so tests can route bootstrap and subsequent requests. At test-run cleanup, `src/test-host/browser-helpers.ts:closePagesOpenedSince()` must call `unrouteAll()` on each adopted `sessionPages` entry before releasing test-power adoption; owned pages are closed and cleared through guest teardown. Do not use a route on a user page or a page that only happens to share a profile.

## Implementation Plan

### Declarative contract

Expose browser-editor members usable as `page.editor.route(...)` from the runner's returned page handle (the site/page test facade may alias these as `site.route(...)` if that is its established naming surface):

```ts
type BrowserUrlPattern = string | RegExp | { regex: string; flags?: string };
type BrowserRouteAbortReason =
    | "Failed" | "Aborted" | "TimedOut" | "AccessDenied" | "ConnectionClosed"
    | "ConnectionReset" | "ConnectionRefused" | "ConnectionAborted" | "ConnectionFailed"
    | "NameNotResolved" | "InternetDisconnected" | "AddressUnreachable"
    | "BlockedByClient" | "BlockedByResponse";
type RouteResponse = "abort" | { abort: BrowserRouteAbortReason } | {
    status?: number;
    body?: string;            // UTF-8 text
    bodyBase64?: string;      // binary payload; mutually exclusive with body
    headers?: Record<string, string>;
    contentType?: string;     // fills Content-Type only when headers omit it
    delayMs?: number;         // optional delay before fulfil
};
type RouteOptions = {
    times?: number;
    method?: string | string[];
    resourceTypes?: string[];
};
```

`route(urlOrRegex, { delayMs }, options?)` waits, then continues the original request unchanged. `delayMs` may also accompany a fulfil response to wait before fulfilling. Abort has no delay. Abort is either the string `"abort"` (CDP reason `"Failed"`) or `{ abort: reason }`, where `reason` is one of the `Network.ErrorReason` names listed in `BrowserRouteAbortReason`; the object form contains no other fields. The accepted enum is verified against upstream [`Network.pdl`](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Network.pdl) because no local protocol package is installed. A fulfil response with no body fulfils an empty body; default status is 200. Encode UTF-8 `body` as base64 inside the module; decode `bodyBase64` to validate its byte limit, then pass the selected bytes as CDP's base64 `body`. Convert the response header record to CDP's `responseHeaders: Array<{ name, value }>`; add `contentType` as Content-Type only when an explicit header has not supplied it. `responsePhrase` is optional and omitted unless a later API requirement needs a custom phrase. Validate status, header strings/names, base64, pattern flags, methods, resource types, positive `times`, and reject unknown keys. Keep route payloads JSON-only; functions are rejected. As with the existing network and failure logs, do not store response body or headers.

Cross-origin fetch/XHR responses still pass the page's CORS checks after CDP fulfils them. The route must provide the appropriate `access-control-allow-origin` response header (and `access-control-allow-credentials` where credentials are used); for preflighted requests, the `OPTIONS` preflight is a separate request that must also be routed/fulfilled with the needed allow-origin, allow-methods, and allow-headers headers. A `method` filter can keep the actual method and `OPTIONS` routes distinct.

URL matching is over the complete request URL, using Playwright-like glob rules: `*` matches zero or more characters except `/`, `**` also matches `/`, `?` is a literal question mark, and `\\` escapes a wildcard. A `RegExp` or JSON descriptor `{ regex, flags? }` uses JavaScript regular-expression semantics; normalize it in the renderer using the pattern conversion style in `src/renderer/automation/navigation.ts`, then validate/compile it again in main. The JSON key is `regex` (not `source`), matching `waitForURL`, `waitForResponse`, and locator JSON patterns. CDP's Fetch glob syntax differs (`?` is a wildcard and `*` crosses `/`), so use a safe superset pattern derived from active routes (a broad `"*"` pattern is acceptable while one or more routes are active) and perform the exact route matcher in the main event handler. With no active routes, disable Fetch; do not leave broad interception enabled.

Choose **last registered matching route wins**, matching Playwright. Evaluate routes newest-first after URL, method, and resource-type filters. `times` counts matching requests only; when it reaches zero, remove the record and refresh/disable Fetch patterns. `unroute(pattern)` removes every route with an equivalent normalized URL pattern (regardless of response/options); `unroute()` and `unrouteAll()` clear all routes on that page. This makes removal declarative and avoids exposing internal IDs across the board bridge.

Before:

```js
await page.evaluate(() => {
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    if (String(input).includes("/api/items")) return new Response("[]");
    return originalFetch(input, init);
  };
});
```

After:

```js
await page.editor.route("**/api/items", {
  status: 503,
  body: "temporarily unavailable",
  contentType: "text/plain",
  delayMs: 250,
}, { method: "GET", times: 1 });
```

### Steps

1. **Add renderer API and route collaborator.** In `src/renderer/api/types/browser-editor.d.ts`, define the URL pattern, route response/options types, and `route`, `unroute`, `unrouteAll` signatures. Add the named members and descriptions to `BROWSER_EDITOR_MEMBERS`/`BROWSER_EDITOR_HELP` in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, delegating to a new `src/renderer/editors/browser/BrowserRequestRoutes.ts`; keep `BrowserWebviewModel.ts` unchanged. Use `agentMayUseBrowserTestPower` and its shared refusal. Reuse the renderer URL normalizer `toWirePattern` in `src/renderer/automation/navigation.ts` (export the existing helper and any required pattern type); the browser editor already depends on the automation layer through `BrowserTargetModel`, and this direction is allowed by the current import zones. The collaborator calls `this.model.target.cdp(tabId)` through the existing `CdpSession`; do not create a route-specific access check or duplicate regex normalization.
2. **Add typed CDP calls on the existing boundary.** Add route add/remove/clear payloads to `src/ipc/browser-ipc.ts`, invoke handlers to `src/ipc/main/cdp-handlers.ts`, and convenience methods in `src/renderer/automation/CdpSession.ts`. Reuse the typed `BrowserChannel` call/reply, existing invoke error unwrapping, and registration-key target resolution. Do not modify service channels, `PendingRequests`, wire error serialization, frame method maps, or renderer event subscriptions.
3. **Implement `src/main/cdp/cdp-request-routes.ts`.** This new module owns main-process schema validation and compiled matcher records keyed by registration key; a route order counter; `times` consumption; limits; per-key operation serialization; active Fetch patterns; `Fetch.requestPaused` event processing; a once-only pause resolution guard; delay timers; attach-generation/CDP identifier state; and `clearKey`, `onTargetAttached`, `onTargetDetached`, `restoreRoutes`. Use `CdpTarget.enableDomain` and `CdpTarget.subscribeCdpEvents`; check the event session is the page target's root session. Call `Fetch.enable` with `{ handleAuthRequests: false, patterns }`, with every active pattern explicitly marked `requestStage: "Request"`; do not handle `Fetch.authRequired` or response-stage pauses. Compile glob/regex matcher once, set `lastIndex = 0` before each regex test, match reverse registration order, and keep exact route evaluation in main. For fulfil, base64-encode text bodies, pass `body` as base64, and convert headers to `responseHeaders: [{ name, value }]`; omit `responsePhrase` because the protocol makes it optional and supplies a standard phrase. A matching response action has at most one CDP terminal command. Unknown/no-longer-active route and caught handler/validation/CDP command failure fall back to `Fetch.continueRequest` best-effort; no exception may leave a request paused. Keep payloads and bodies out of errors and logs.
4. **Add a tuning-constants block in the new module.** Start with `MAX_ROUTES_PER_TARGET = 50`, `MAX_ROUTE_BODY_BYTES = 1_048_576`, `MAX_ROUTE_DELAY_MS = 30_000`, and `MAX_ROUTE_URL_PATTERN_CHARS = 2_000`. Reject a route count/pattern/body over limit with a bounded error; clamp finite `delayMs` to `[0, MAX_ROUTE_DELAY_MS]` and reject non-finite values. Base64-decode before checking body byte size. Do not impose an unrelated total byte budget unless tests show it is needed; the max route count and per-route cap bound memory.
5. **Compose lifecycle in `src/main/cdp-service.ts`.** Add imports and thin methods for add/remove/unroute-all using `resolveTarget(key, sender, "browser-only")`; attach/detach hooks in the existing `attachTarget` / target detach callbacks; and route restoration on the same browser CDP attach/send path used by init scripts. Ensure route records are restored before a new command returns to renderer. Extend `clearCdpTargetState(key)` composition so guest close clears all route records, in-flight request guards, and timers. On explicit `cdpDetach`, clear CDP-side state/timers but preserve route declarations for later reattach, as above. `cdp-service.ts` gains composition only; the rules stay in `cdp-request-routes.ts`.
6. **Make network observations cover routed outcomes.** Confirm the runtime sequence for fulfil, abort, and continue. Extend `src/main/cdp/cdp-network-collector.ts` only if the collector misses `loadingFailed` or synthetic responses; preserve its request IDs and duplicate replacement behavior. If the Electron session logger misses fulfil/abort, add exactly one exported metadata-only function (for example `recordRoutedNetworkOutcome`) to `src/main/network-logger.ts`, called by `cdp-request-routes.ts` with route outcome metadata and a CDP request correlation identity; deduplicate where session events also appear. The logger must never import `cdp-request-routes.ts`, so there is no reverse dependency or cycle. If runtime verification proves `onBeforeSendHeaders`/completion already records fulfil and abort correctly, make no change to `network-logger.ts`. Do not add body/header storage or have the logger answer requests. Keep `src/main/cdp-network-response-bodies.ts`'s response-body behavior bounded and unchanged unless the verified synthetic response requires a small adaptation. Ensure `waitForResponse()` continues to derive results from `cdp-waits.ts`'s Network events; an abort remains a failed request, not an HTTP response.
7. **Clear routes for adopted pages at run end.** In `src/test-host/browser-helpers.ts`, update `closePagesOpenedSince()` to call `pages[pageId].editor.unrouteAll()` for every `sessionPages` page before it releases adoption and records cleanup outcome using the existing best-effort cleanup logging. Preserve its current `clearInitScripts()` behavior. Do not add new runner protocol methods; use the browser-editor typed member through current `McpClient` calls. Owned pages are closed, which triggers `clearCdpTargetState`.
8. **Extend the existing board bridge history.** Add route members to the existing Bridge 1.61.0 paragraph in `assets/guides/agents/boards/bridge-versions.md`; do not change `src/shared/board-bridge-version.ts` again.
9. **Update implementation-facing guides when implementing.** Update `assets/guides/agents/browser-automation.md`, `assets/guides/agents/browser.md`, `assets/guides/agents/web-app-tests/index.md`, and `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` with signatures, glob/JSON-regex syntax, last-registered precedence, method/resource/times filters, UTF-8/base64 body examples, delay and abort behavior, CORS response headers and separate `OPTIONS` preflight routing, per-page/test-power scope, OOPIF/worker/service-worker limitations, DevTools detach/reattach, limits, and runner cleanup. Extend the bridge guide from step 8. `npm run guides:check` is part of implementation verification when guide files change.
10. **Keep prohibited surfaces unchanged.** No protocol implementation beyond the existing typed browser IPC, no board-specific rule outside `src/shared/board/` and registries, no new logic in `BrowserWebviewModel.ts`, no import-zone exception, no `await import()` or wrapper introduced to cross an import zone, and no root `CLAUDE.md`, `.gitignore`, or demo-board edits. Fixes in a strict folder are type-only unless the implementation records a runtime behavior change.

## Concerns

- **Relative request-hook ordering is not specified by the public docs.** Fetch-before-HTTP-dispatch is a reasoned assumption, not a verified Electron guarantee. The implementation must verify pinned Electron/Chromium behavior. The one existing header modifier is the Windows SSO hook; continue must preserve it, while fulfil/abort must not create a second answer or a duplicate log entry.
- **Network observability may need a small collector/logger change.** The CDP `waitForResponse()` and public `networkRequests()` use different event sources. Verify both with fulfil, abort, and continue; failure bundles only include requests with error or status 400–599. Do not claim parity until the observed route outcome is present once with status/error and no body or header.
- **Process and service-worker scope must be runtime checked.** Same-process frames share the page target; OOPIFs do not. Dedicated worker targets are not auto-attached. A service worker may serve a response without page-target Fetch seeing the network request. Do not broaden scope with `Target.setAutoAttach` in this task.
- **Detach can interrupt in-flight paused requests.** Retain declarative route data like init scripts, clear timers and transient pauses on detach, and restore on attach. Confirm Chromium releases a paused request on debugger detach; never let a timeout or detached target retain a timer or make the page hang.
- **CORS still applies to synthetic responses.** A fulfilled cross-origin fetch/XHR can be rejected by the page unless the route supplies the required `access-control-allow-origin` (and credential policy when applicable). Preflight is a separate `OPTIONS` request; the test must add a matching route for it or avoid excluding it with a method filter. Document this in the browser automation and web-app-test examples so a mocked 200 is not mistaken for a CORS-permitted response.
- **No response bodies or headers in diagnostics.** Route payloads can contain fixture data or credentials. Network history may expose bounded URL/method/status/error only, consistent with the existing failure bundle policy.

## Acceptance Criteria

- `route(pattern, response, options?)`, `unroute(pattern?)`, and `unrouteAll()` are available through the browser editor/page test facade and use the existing typed browser IPC path. JSON calls accept `{ regex, flags? }`; no route accepts a callback/function.
- The newest matching route wins. Glob and regex match the full URL. Method and resource-type filters are applied before `times` is consumed. An exhausted route is removed and active Fetch patterns are refreshed. `unroute(pattern)` removes all equivalent URL-pattern registrations; no-argument `unroute()` and `unrouteAll()` clear the page.
- Fulfil supports status, UTF-8 text or base64 bytes (mutually exclusive), headers, content type, and optional bounded delay. Delay-only continues the original request; a delay may precede fulfil. Abort maps to an appropriate `Fetch.failRequest` reason. Unmatched requests continue.
- Fetch is enabled explicitly with request-stage patterns and `handleAuthRequests: false`; this feature does not create auth challenge pauses. Fulfil encodes the body as base64, sends response headers as `{ name, value }` entries, and omits optional `responsePhrase` so CDP supplies the standard status phrase. Abort accepts only `"abort"` (default `Failed`) or `{ abort: reason }`, where reason is one of `Failed`, `Aborted`, `TimedOut`, `AccessDenied`, `ConnectionClosed`, `ConnectionReset`, `ConnectionRefused`, `ConnectionAborted`, `ConnectionFailed`, `NameNotResolved`, `InternetDisconnected`, `AddressUnreachable`, `BlockedByClient`, or `BlockedByResponse`.
- Cross-origin fulfilled fetch/XHR remains subject to CORS. Route examples show `access-control-allow-origin` and, where needed, `access-control-allow-credentials`; a preflighted request routes `OPTIONS` separately with allow-origin, allow-methods, and allow-headers headers.
- The module enforces 50 routes per target, 1 MiB body per route, 30,000 ms maximum delay, and a 2,000-character URL pattern limit. No `Fetch.enable` is issued when the page has no routes; the final unroute/exhaustion issues `Fetch.disable`.
- A Fetch pause is answered exactly once. Unmatched, stale, concurrently removed, malformed-at-runtime, or handler-failure cases continue best-effort. Delay timers and pending transient pause state clear on detach/close; retained route declarations restore on reattach. Guest close clears all route state. A closed or detached target has no outstanding route timer.
- Calls are refused unless `agentMayUseBrowserTestPower` passes. An ordinary page the user opened is refused, as is a user-opened incognito/Tor page; `ctx.openBrowser()` pages and `ctx.usePage()` adopted eligible pages are allowed.
- Routes are keyed to one browser guest registration key and target, never a session/profile. No Fetch domain enable occurs on unrelated targets or idle pages. Same-process frames share the target. OOPIFs and dedicated worker targets are not covered; service-worker interception may bypass the route. These limits appear in the guides.
- Source investigation is backed by an integration verification of the pinned Electron/Chromium ordering: a continued request reaches the existing session logger/header modifier once; fulfil and abort do not cause a second responder; proxy/Tor routing remains effective. Findings and any divergence are recorded in the implementation task progress.
- Fulfilled responses appear in `waitForResponse()` with the synthetic status and in `networkRequests()` exactly once with useful status metadata. Aborts reject `waitForResponse()` with the network failure and appear in `networkRequests()` and the failure bundle as errors. Request/response bodies and headers do not enter network logs or bundles.
- `closePagesOpenedSince()` best-effort calls `unrouteAll()` on every adopted session page, logs the result, then releases adoption; test-owned pages clear routes on close. Routes remain scoped across navigation during the test run.
- Bridge history 1.61.0 documents the route members; no second version bump occurs. The listed guides document syntax, precedence, limitations, test-only access, cleanup, and tuning limits.
- No new protocol primitive, board rule, renderer event channel/correlator, `BrowserWebviewModel.ts` growth, import-zone bypass, or unrelated source/doc edit is introduced.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-2168-request-routing/README.md` | This implementation brief and verified investigation. |
| `doc/epics/EPIC-207.md` | Link US-2168 in the Linked Tasks table. |
| `doc/active-work.md` | Link the existing EPIC-207 US-2168 entry to this brief. |
| `src/main/cdp/cdp-request-routes.ts` | New per-target Fetch route registry, matchers, pause handler, timers, limits, and lifecycle owner. |
| `src/main/cdp-service.ts` | Thin browser-only route composition and target lifecycle hooks. |
| `src/main/cdp/CdpTarget.ts` | No change; reuse existing target attach, event subscription, and detach lifecycle. |
| `src/main/cdp/cdp-network-collector.ts` | Only if verified Network events need `loadingFailed` or fulfilled-route visibility. |
| `src/main/cdp-network-response-bodies.ts` | No change expected; bounded resolver already consumes CDP collector records. |
| `src/main/network-logger.ts` | If needed, one exported `recordRoutedNetworkOutcome()` metadata function called by the route module; the logger never imports the route module. No change if runtime verification shows existing session hooks already record outcomes correctly. |
| `src/main/cdp/cdp-waits.ts` | No change expected; keep waitForResponse based on existing Network events. |
| `src/main/browser/navigation-scheme-guards.ts` | No change; route logic does not alter scheme policy. |
| `src/renderer/editors/browser/agent-access.ts` | No change; reuse `agentMayUseBrowserTestPower` and shared refusal. |
| `src/renderer/editors/browser/BrowserRequestRoutes.ts` | New renderer facade collaborator, validation and typed CDP delegation. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Compose route collaborator and expose/help the three browser-editor methods. |
| `src/renderer/api/types/browser-editor.d.ts` | Add public route pattern, response, option, and member types. |
| `src/renderer/automation/CdpSession.ts` | Add route invoke methods over existing typed RPC. |
| `src/renderer/automation/navigation.ts` | Export and reuse existing `toWirePattern()` (and its pattern type) for `{ regex, flags }` normalization; the browser editor already uses the automation layer and this allowed import direction adds no import-zone exception. |
| `src/ipc/browser-ipc.ts` | Add typed route request/result payloads on `BrowserChannel`. |
| `src/ipc/main/cdp-handlers.ts` | Dispatch route add/remove/clear through existing invoke handlers. |
| `src/test-host/browser-helpers.ts` | Best-effort `unrouteAll()` for adopted `sessionPages` in `closePagesOpenedSince()`. |
| `src/test-host/failure-bundle.ts` | No change expected if routed outcomes appear through the existing `networkRequests()` result. |
| `assets/guides/agents/boards/bridge-versions.md` | Extend Bridge 1.61.0 history paragraph; no new bump. |
| `assets/guides/agents/browser-automation.md` | Document route API, matching and response examples. |
| `assets/guides/agents/browser-request-routing.md` | Full route reference; split out to keep the browser automation guide below its 20,000-character read limit. |
| `assets/guides/agents/browser.md` | Document browser-editor route surface and scope. |
| `assets/guides/agents/web-app-tests/index.md` | Document test-only route setup and cleanup. |
| `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` | Add typed runner examples, response body and delay examples. |
| `src/shared/board-bridge-version.ts` | No change; US-2165 already bumped to 1.61.0. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | No change; roadmap §2.3 god file. |
| `src/main/permission-policy-service.ts`, `src/main/session-proxy.ts`, `src/main/tor-service.ts` | No change; permission and transport policy remain separate from page Fetch routing. |
| `src/main/browser/navigation-scheme-guards.ts` | No change; existing scheme guards remain authoritative. |
| `.gitignore`, shipped demo boards, root `CLAUDE.md` | No change. |

## Implementation Progress

- [x] Renderer API, facade collaborator, pattern normalization, and typed browser IPC.
- [x] Main-process page-scoped Fetch routing, validation, limits, route precedence, timers, and lifecycle composition.
- [x] Adopted-page cleanup and browser/runner/bridge guide updates.
- [x] `npm run typecheck` and `npm run lint` pass.
- [ ] Live verification on the pinned Electron/Chromium runtime remains for Claude; this checkout cannot start Persephone.

Claude must verify live: (1) a continued request reaches `webRequest.onBeforeSendHeaders` exactly once and retains the Windows SSO header behavior where testable; (2) fulfil and abort each produce one terminal answer, and delay works for both continue and fulfil; (3) Fetch ordering relative to Electron's session hooks, including that fulfil/abort do not trigger a second response answer; (4) proxy/Tor transport remains effective; (5) `waitForResponse()` sees fulfilled status and rejects routed aborts, while `networkRequests()` and the failure bundle show each routed outcome exactly once with status/error and no body or response headers; (6) explicit DevTools detach releases paused requests, clears timers, and the next attach restores declarations before returning; (7) route behavior on same-process frames, OOPIFs, dedicated workers, and service-worker-served requests matches the documented scope; and (8) guest close and adopted-page cleanup remove route records without leaving Fetch enabled or requests paused.
