---
title: "Boards — capability handlers and intents"
audience: agent
summary: "Capability handlers, in-memory intents, request routing and resolution for boards that provide or consume capabilities."
---

# Boards — capability handlers and intents

## Capability handlers and in-memory intents

Use the manifest's `capabilities` array to register named work. For new providers and consumers,
see <!-- board-template:exclude -->[Capabilities](../capabilities/index.md)<!-- /board-template:exclude --> for method declarations, `getCapability`, discovery and grants.
`appScripting` gates `persephone.call()`; a trusted board's unified capability access instead
requires an exact `uses` id/version grant. Legacy `persephone.capabilities.invoke` requires trust
only. The example below is a legacy page-intent declaration.

```json
{
  "minBridgeVersion": "1.30.0",
  "permissions": { "execute": false, "service": false, "fileSystem": false, "openExternal": false, "appScripting": true, "network": false, "clipboardRead": false, "camera": false, "microphone": false, "computerAudio": false, "geolocation": false, "notifications": false, "themes": false },
  "capabilities": [
    { "id": "demo.greet", "version": 1, "priority": 60, "title": "Demo greeting" },
    { "id": "content.view", "representation": "pdf", "priority": 70 }
  ]
}
```

Each declaration may provide `id`, integer major `version` (default `1`), `priority` (default
`50`), `accepts`, `payloadSchema`, `title`, `headless`, and the optional boolean
`alwaysOpensNewPage`. Set it when every request needs a fresh handler page; otherwise an open page
is reused. IDs cannot contain whitespace or `@`; use a vendor
prefix for board-owned ids. Multiple boards can compete for one id. An explicit provider or the
user's eligible `capabilities.preferredProviders` choice takes precedence; otherwise priority wins,
platform handlers win ties, and trusted-board registration order breaks board ties. Discovery never
opens a handler page. For `persephone.capabilities.invoke()`, if neither the id nor options pins a
major version, resolution can choose any eligible major version using the same provider preference
and ordering. A declaration's `methods.open.timeoutMs` also bounds app-originated opens to it.
`representation` is an open string. A `content.view` declaration requires a non-empty value; add
one entry for every format the board supports and set `minBridgeVersion` to `1.21.0`. Other
capability ids may omit it.

Well-known platform capabilities include `http.request.open` (open a REST request collection),
`image.edit` (open an image in an editor), and `certificate.view` (render a site's TLS certificate
chain). A board may declare `certificate.view` normally and handle v1 requests through
`persephone.intent.onRequest()`. The payload is `{ title, certificates, source? }`, where
`certificates` is a leaf-first array of base64 DER strings and optional `source.url` is the HTTPS
page URL. Persephone validates the payload and limits decoded DER to 256 KiB before dispatch.

Settings uses the platform-provided `theme.edit@1` capability for its theme-tile Edit and New
actions. Its payload is `{ mode: "edit", themeId: string }` or `{ mode: "new" }`; Persephone
validates the exact mode, requires a non-empty id for edit, and rejects `themeId` in new mode before
resolving a handler. A Theme Editor board declares
`{ "id": "theme.edit", "version": 1, "priority": 50, "title": "Theme Editor" }` and receives
both initial page-open and later reused-page requests with `persephone.intent.onRequest()`. Validate
the intent and resolve it promptly before loading a theme or showing a dialog, since the capability
deadline includes cold startup. Without `alwaysOpensNewPage`, Persephone focuses and reuses the
board's existing page. Settings applies and persists the selected theme before Edit; New leaves the
active theme unchanged. The `themes: true` permission gates only `persephone.themes.*`, not this
platform-to-board dispatch. If no handler exists, Settings opens Tools & Editors on Search boards
with installation guidance; a timeout receives a separate warning.

The winning declaration is served in the caller's window. An existing handler page there is reused;
otherwise the platform opens one there and sends the first request in the handshake. Later requests
use the host-frame channel. The handler receives a structured value and must always settle it:

```js
function handleRequest(request) {
    if (handled.has(request.requestId)) return;
    handled.add(request.requestId);
    const name = request.payload.name ?? "friend";
    request.resolve({ greeting: `Hello, ${name}`, requestId: request.requestId });
}

const handled = new Set();
persephone.intent.onRequest(handleRequest);
const initial = persephone.intent.get();
if (initial) handleRequest(initial); // consume a page-open initial request
```

`persephone.intent.get()` reads the active request;
`persephone.intent.onRequest(callback)` returns an unsubscribe and also delivers an already-active
request; `persephone.intent.resolve(value)` and `persephone.intent.reject(reason)` settle the
current request. Prefer the request-bound `request.resolve` and `request.reject` methods in
callbacks. Pass `{ discardPage: true }` as the second argument to `request.resolve(value, options)`
when a failed request should discard the page it opened. The handler value remains opaque, and the
option has no effect on a reused page. **`resolve`/`reject` is mandatory.** If a handler never
settles, its caller
waits until the deadline. The platform sends cancel after that deadline, but cannot stop the
handler's work.

`persephone.capabilities.list()` discovers unified, grant-filtered registrations without activation;
`persephone.capabilities.providers(id)` lists candidates for one id. Use
`await persephone.getCapability(id, { version, provider, filter })` to bind a proxy, or omit the
options to use normal resolution. It returns `null` when no candidate matches. Include `handlerKey`
when identifying a candidate because several handlers may share an id:

```js
const entries = await persephone.capabilities.list();
// [{ id: "content.view", representation: "pdf", version: 1, priority: 70,
//    handlerKey: "board:/work/Demo", origin: "board" }]
```

For voice sessions, the reserved `audio@1` capability provides `audio.muteApp()`, which returns
a global playback-mute lease. Boards using it require `minBridgeVersion: "1.52.0"` and an exact
`audio@1` entry in `uses`; capture methods also need their source permission. Release the lease
when listening ends, including error paths. See the <!-- board-template:exclude -->[audio guide](../audio.md)<!-- /board-template:exclude --> for lifecycle and
playback scope.

The legacy wrapper invokes by id with `persephone.capabilities.invoke(id, payload, { version, deadlineMs })`. A board
result is `{ pageId, result }`; `pageId` is optional when a handler resolves without a page, and
`result` preserves the handler's exact value, including primitives, arrays, and empty objects. The
caller can receive these ten typed rejection codes:

Requests to one handler page are delivered serially in FIFO order, with one active intent context
in the frame. Additional requests wait for the active request to settle or be cancelled. Main
enforces the 32-active-invocation per-handler cap; `busy` keeps its error code, with a concise
message. Timeouts are owned by the main capability router, which sends a best-effort cancel to the
renderer and board frame. The code is stable even when the error message is shorter.

| Code | Meaning |
|---|---|
| `no-handler` | No declaration matches the id, version, or filter; headless winners are out of scope. |
| `untrusted` | The handler board was untrusted at resolution or during the request. |
| `handler-closed` | The handler page/frame closed before settlement. |
| `crashed` | The handler frame errored or reloaded. |
| `cancelled` | The caller cancelled, its page closed, or the renderer is tearing down. |
| `timeout` | The main-owned deadline elapsed; the platform sends best-effort cancel. |
| `cycle` | The request would re-enter a handler in its chain or exceed the depth limit. |
| `payload-too-large` | The board-bound inline payload is over 8 MiB. |
| `busy` | The handler reached the main-owned cap of 32 active invocations. |
| `rejected` | The handler called `reject()`, the payload could not be structured-cloned, or another unclassified transport failure occurred. |

Timeout does not stop the handler. An agent can retry, so idempotent work must key on
`requestId`. Intents are at-most-once: Persephone never re-delivers a request. Payloads are
structured-cloned, delivered once, and kept in broker memory; they never enter page state or disk,
and a restored page does not receive them again. This is broker policy, not an OS guarantee: memory
can be paged and Chromium may retain its own caches.
