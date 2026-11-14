---
title: "Boards — capability handlers and in-memory intents"
audience: both
summary: "Handle capability and intent requests from a board: handlers, in-memory intents, resolution and request routing."
---

# Boards — capability handlers and in-memory intents

## Capability handlers and in-memory intents

A board can provide named work without making callers know which board handles it. For new `methods`,
`getCapability` and `uses` declarations, see [Capabilities](../agents/capabilities/index.md). Declare the
capability in `board-manifest.json`; the declaration array controls registration. A handler that
calls Persephone scripts, object model APIs, or agent tools also needs `appScripting: true`; declare
only the permissions its code uses.

The following manifest is a legacy compatibility example:

```json
{
  "minBridgeVersion": "1.30.0",
  "permissions": {
    "execute": false, "service": false, "fileSystem": false,
    "openExternal": false, "appScripting": false, "network": false,
    "clipboardRead": false, "camera": false, "microphone": false,
    "geolocation": false, "notifications": false, "themes": false
  },
  "capabilities": [
    { "id": "demo.greet", "version": 1, "priority": 60, "title": "Demo greeting" },
    { "id": "content.view", "representation": "pdf", "priority": 70 }
  ]
}
```

Declarations support `id`, integer major `version` (default `1`), numeric `priority` (default
`50`), optional MIME `accepts`, descriptive `payloadSchema`, display `title`, `headless`, and the
optional boolean `alwaysOpensNewPage`. Set that flag when each request must open a fresh handler
page, even when another page for the board is already open. Without it, Persephone reuses an open
handler page. IDs cannot contain whitespace or `@`; vendor prefixes are recommended. Multiple
boards may declare the same id. The
highest priority wins, platform handlers win exact ties, and trusted-board registration order
breaks board-to-board ties. A caller may pin a major version with `invoke("demo.greet@1", payload)`.
`representation` is an open string. `content.view` requires a non-empty value; use one declaration
per supported format and set `minBridgeVersion: "1.21.0"`. Other capability ids may omit it.

Well-known platform capabilities include `http.request.open` (open a REST request collection),
`image.edit` (open an image in an editor), and `certificate.view` (render a site's TLS certificate
chain). A board may claim `certificate.view` with a normal manifest declaration and handle v1
requests through `persephone.intent.onRequest()`. Its payload is `{ title, certificates, source? }`:
`title` is the hostname, `certificates` is a leaf-first array of base64 DER strings, and optional
`source.url` identifies the HTTPS page. Persephone validates the shape and limits decoded DER to
256 KiB before dispatch.

Settings also uses the platform-provided `theme.edit@1` capability to open an installed Theme Editor
board. The payload is `{ mode: "edit", themeId: string }` or `{ mode: "new" }`. Persephone validates
that shape before handler resolution: edit requires a non-empty theme id and new must not include a
`themeId`. A board claims it with `{ "id": "theme.edit", "version": 1, "priority": 50,
"title": "Theme Editor" }` and receives fresh or reused requests through
`persephone.intent.onRequest()`. Settings applies the selected theme before edit; new leaves the
active theme unchanged. Accept a valid intent before loading its source or showing UI, because the
caller deadline covers board startup. Without `alwaysOpensNewPage`, an existing page is focused and
reused. The `themes: true` permission is needed only for the board's `persephone.themes.*` access,
not for capability dispatch. If no handler is registered, Settings opens Tools & Editors → Search
boards and explains how to install Theme Editor; timeout is reported separately.

The winning board is served in the caller's window. Persephone reuses an already-open handler page
there or opens one there and delivers the initial request in its handshake. Later requests to that
page use the host-frame channel. This applies to any trusted board that declares the winning
capability, regardless of its editor kind. The handler receives a structured request and must
settle it:

```js
function handleGreeting(request) {
    if (handled.has(request.requestId)) return;
    handled.add(request.requestId);
    const name = request.payload.name ?? "friend";
    request.resolve({ greeting: `Hello, ${name}`, requestId: request.requestId });
}

const handled = new Set();
persephone.intent.onRequest(handleGreeting);
const initial = persephone.intent.get();
if (initial) handleGreeting(initial); // the page was opened for this request
```

`persephone.intent.get()` returns the current request, if one is active.
`persephone.intent.onRequest(callback)` returns an unsubscribe function and also delivers an
already-active request. `persephone.intent.resolve(value)` and `persephone.intent.reject(reason)`
settle the current request. Prefer the request-bound `request.resolve` and `request.reject`
methods in callbacks. Use `request.resolve(value, { discardPage: true })` when a failed request
should discard the page it opened. The value remains opaque, and the option is ignored when
Persephone reused an existing page. **Settlement is mandatory:** a handler that never
calls either method leaves its caller waiting until the deadline. The platform then sends a
best-effort cancel, but cannot stop the handler's work.

`persephone.capabilities.list()` discovers unified providers for granted id/version pairs without
opening a handler or requiring `appScripting`. The following replaces the legacy list projection;
`handlerKey` distinguishes registrations:

```js
const handlers = await persephone.capabilities.list();
// Entries include id, version, provider, handlerKey, origin, priority and methods.
```

The `persephone.capabilities.invoke(id, payload, options?)` wrapper resolves by id; without a version
pin it honors `capabilities.preferredProviders` and may select any available major version. Set
`version` to pin a major or `deadlineMs` to set a caller deadline. The selected declaration's
`methods.open.timeoutMs` also applies to opens initiated by `app.capabilities.invoke()`. A board result
is `{ pageId, result }` (the page id is optional for handlers
that resolve without a page); `result` preserves the handler's exact value, including primitives,
arrays, and empty objects. Handle the ten typed rejection codes as follows:

Invocations to the same handler page are delivered serially in FIFO order: only one request is
active in a frame, and later requests wait for it to settle or be cancelled. `busy` means the
handler has reached the 32-request limit across its active and queued work. Error codes are
unchanged; limit errors use concise messages. When a deadline expires, the platform sends a
best-effort cancel.

| Code | Meaning to the caller |
|---|---|
| `no-handler` | No registered declaration matches the id, version, or filter; headless winners are out of scope. |
| `untrusted` | The handler board was untrusted at resolution or while the request was in flight. |
| `handler-closed` | The handler page or frame closed before it settled. |
| `crashed` | The handler frame errored or reloaded during the request. |
| `cancelled` | The caller cancelled, its page closed, or the renderer is tearing down. |
| `timeout` | The deadline elapsed; a best-effort cancel is sent. |
| `cycle` | The winning handler is already in the request chain or the depth limit was exceeded. |
| `payload-too-large` | A board-bound inline payload exceeds 8 MiB. |
| `busy` | The handler has reached the limit of 32 outstanding requests, including queued work. |
| `rejected` | The handler called `reject()`, the payload could not be structured-cloned, or the transport failed without another code. |

Timeout does not stop handler execution. An agent may retry, so a handler that needs idempotency
must key its work on `requestId`. Intents are at-most-once: Persephone never re-delivers the same
request. Payloads are structured-cloned, kept in broker memory, and delivered once; they never
enter page state or disk, and a restored page does not receive them again. This is a broker policy,
not an OS guarantee — memory can be paged and Chromium may retain its own caches.

Scripts running in Persephone can discover or invoke the same indexed handlers through
[`app.capabilities`](../scripting/api/app-capabilities-and-vars.md#capabilities). Board pages use the asynchronous
`persephone.capabilities` bridge documented above.

For new declarations and clients, see [Capabilities](../agents/capabilities/errors-agent-calls-examples.md); `app.capabilities.invoke()` keeps its compatibility signature while using the current provider selection rules.

---
