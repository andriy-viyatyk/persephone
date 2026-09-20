# US-1482: Demo-board capability fixture and EPIC-108 documentation

## Goal

Ship the Demo board as a working `demo.greet` capability handler and caller, and document the
EPIC-108 manifest and bridge contract for board authors, users, and Persephone developers. The
documentation must describe the renderer-local architecture and the lifecycle guarantees without
turning broker policy into an OS-level promise.

## Background

EPIC-108 D1-D10 and US-1479/1480/1481 are landed. The capability registry is populated from the
trusted-board manifest's `capabilities` array; `permissions` discloses the axis but is not the
functional registration gate. `CapabilityInfo` is returned by `app.capabilities.list()` and
`handlers()` with `id`, `version`, `priority`, `handlerKey`, `origin`, and optional declaration
metadata. Board calls travel through `BoardCapabilityTransport` in the caller's renderer, while
`BoardWebview` and `src/board-shim.ts` carry intent delivery and board-originated invocations over
the host-frame `postMessage` channel.

The Demo board's main page is `assets/demo-board/index.html` with behavior in
`assets/demo-board/app.js`; it already has a Capabilities tab and a shared output console. Its
manifest currently requires bridge `1.7.0` and discloses service/provider surfaces. The fixture
will add the `demo.greet` declaration at priority 60, disclose `capabilities`, require bridge
`1.8.0`, register an `onRequest` handler, explicitly consume `intent.get()` for an initial
request, and expose a visible button that invokes the same capability.

The authoring references are `assets/board-template/CLAUDE.md`, `assets/guides/boards.md`, and the
agent-facing bridge/reference copy at `assets/guides/agents/boards.md`. Developer architecture
documentation currently describes boards and the pre-EPIC-108 built-in capability handoff but has
no standalone capability-bus subsystem page. `doc/architecture/key-files.md` already indexes
older board files and will gain rows for the capability-bus wire contract, lifecycle/index,
transport, and the board shim/host implementation.

The landed script-facing `capabilities.d.ts` files already contain `handlerKey`, board invocation
options, and the ten-code error surface. The board-frame IntelliSense declaration
`src/renderer/editors/board/board-api.d.ts` still omitted `handlerKey`, so it will be aligned with
the runtime list result; it is not part of the `assets/editor-types/` flat-copy set and does not
change `_imports.txt`.

## Implementation Plan

1. **Create the shipped fixture manifest.** In `assets/demo-board/board-manifest.json`, change
   `minBridgeVersion` from `1.7.0` to `1.8.0`, append `"capabilities"` to `permissions`, and add:

   ```json
   "capabilities": [
     { "id": "demo.greet", "version": 1, "priority": 60, "title": "Demo greeting" }
   ]
   ```

   This is the manifest declaration that `normalizeCapabilities()` and
   `registerCapability()` will expose as a board-origin candidate.

2. **Make the Demo page both handler and caller.** In `assets/demo-board/index.html`, extend the
   existing Capabilities panel with a short explanation of the declared `demo.greet` capability,
   the one-shot intent behavior, and a `data-test="capabilityInvoke"` button. Keep the existing
   `.row`, `.p-btn primary`, and shared `#out` styling.

   In `assets/demo-board/app.js`, add a small handler helper near the existing bridge setup or
   capability tests. Register it with `P.intent.onRequest`, and use `P.intent.get()` to consume an
   initial request delivered in the handshake. The helper must settle with a structured object
   containing the request id, the received name, and a greeting; it must not stringify the payload.
   Guard request ids so the explicit `get()` path cannot settle a request twice when
   `onRequest()` immediately delivers an already-active intent. Add a `tests.capabilityInvoke`
   action that calls `P.capabilities.invoke("demo.greet", { name: "Demo board" })`, prints the
   returned `{ pageId, result }` shape, and reports typed errors through the existing catch path.
   Register this only for the main view, preserving the existing secondary-view early return.

   Before → after behavior:

   ```js
   // Before: the Capabilities tab demonstrates execute()/call() only.
   // After: the page is a handler and exposes a visible caller control.
   P.intent.onRequest(handleGreeting);
   const initial = P.intent.get();
   if (initial) handleGreeting(initial);

   const reply = await P.capabilities.invoke("demo.greet", { name: "Demo board" });
   print(JSON.stringify(reply, null, 2));
   ```

3. **Update the board authoring references.** In each of
   `assets/board-template/CLAUDE.md`, `assets/guides/boards.md`, and
   `assets/guides/agents/boards.md`:

   - update bridge references and examples to `1.8.0`, explaining that it adds intent delivery and
     board-to-board capability invocation;
   - document the `capabilities` manifest array (`id`, optional `version`, `priority`, `accepts`,
     `payloadSchema`, `title`) and that `permissions: ["capabilities"]` is disclosure/lifecycle
     hygiene while the array is the functional trigger;
   - document `persephone.intent.get()`, `onRequest()`, `resolve()`, and `reject()`, including the
     mandatory settlement rule: a handler that never calls `resolve` or `reject` leaves its caller
     waiting until the deadline, after which the platform sends cancel but cannot stop handler work;
   - document `persephone.capabilities.list()` and `invoke(id, payload, options?)`, with a
     `list()` example that visibly includes `handlerKey`;
   - state that timeout stops platform waiting, not handler execution; cancellation is best-effort,
     agents may retry, handlers needing idempotency must key work by `requestId`, and intents are
     at-most-once because the platform never re-delivers;
   - state that payloads are structured-cloned in memory and delivered once, never put in page
     state or on disk, and are not delivered again to a restored page. Explicitly qualify this as
     broker policy rather than an OS guarantee because memory may be paged and Chromium may retain
     its own caches;
   - document all ten `CapabilityErrorCode` values and what each means to a caller;
   - retain the existing service/provider/editor/secondary-view material and point the Demo board
     at the new working example.

4. **Add developer architecture documentation.** Create
   `doc/architecture/capability-bus.md` covering:

   - the manifest-derived candidate index and registration/release rules, including priority,
     platform tie-breaking, trusted-board order, version pinning, filters, and discovery without
     opening a handler;
   - the D3 request lifecycle: resolve in the caller's window, reuse/open a handler page, deliver
     the initial handshake intent or a later host-frame intent, await settlement, and return the
     `{ pageId, result }` board envelope;
   - the ten-code failure taxonomy, deadlines, best-effort cancel, at-most-once delivery, page and
     trust teardown, chain/depth cycle detection, outstanding-request cap, and inline payload cap;
   - D1's renderer-local design and its explicit trade-off: no cross-window routing to a handler
     page already living in another window; a future main routing table/forwarding envelope would
     be required for that use case;
   - ownership of `src/ipc/capability-bus-channels.ts`, `src/renderer/api/capability-bus.ts`,
     `src/renderer/api/capabilities.ts`, `src/renderer/api/board-capability-transport.ts`,
     `src/renderer/editors/board/BoardWebview.ts`, `src/renderer/editors/board/board-manifest.ts`,
     and `src/board-shim.ts`.

   Add a capability-bus subsystem entry and link to this page in `doc/architecture/overview.md`.

5. **Extend the developer file index.** Add rows in `doc/architecture/key-files.md` for the
   capability-bus wire contract, lifecycle state machine, public/indexed capability service,
   board transport, and the board host/shim intent implementation. Keep the existing rows intact.

6. **Keep scope and copies correct.** Do not touch `.persephone/boards/Demo`, add tests or test
   harnesses, or alter the already-landed script API declaration copies. Align the board-only
   `src/renderer/editors/board/board-api.d.ts` `handlerKey` field with the runtime. If any file under
   `src/renderer/api/types/*.d.ts` changes, copy it to `assets/editor-types/` and verify
   `_imports.txt`.

7. **Verify.** Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`. Inspect the final
   diff for the three live-tested user-visible contract fixes: reused handler pages receive later
   intents, board invocations return the `{ pageId, result }` envelope, and `handlerKey` appears in
   capability discovery documentation/examples. Do not commit.

## Concerns

- The generic board template and the user/agent guide have overlapping bridge prose. Keep their
  examples consistent, but preserve each document's existing audience and surrounding content.
- `P.intent.onRequest()` immediately delivers an active intent. The Demo page must therefore use a
  request-id guard around the explicit `P.intent.get()` consumption rather than relying on a
  timing assumption.
- The transport returns a page envelope even for board-originated calls, while a built-in may
  resolve without a page. The fixture should show the board-to-board envelope exactly as the shim
  currently resolves it, without claiming every capability has a `pageId`.
- The manifest is read at trust/registration time, not by an ordinary board reload. Manual live
  verification of a copied Demo board may require re-trusting or scaffolding a fresh copy; the
  user's installed `.persephone/boards/Demo` must remain untouched.
- Documentation must distinguish broker policy from guaranteed physical memory behavior and must
  describe timeout cancellation as a signal, not cooperative task termination.

## Acceptance Criteria

- [x] `assets/demo-board/board-manifest.json` declares `demo.greet` at version 1, priority 60, and
  a title; includes `"capabilities"` in `permissions`; and requires `minBridgeVersion: "1.8.0"`.
- [x] The Demo main page registers `persephone.intent.onRequest`, explicitly handles an initial
  `persephone.intent.get()`, resolves a structured greeting, and has a visible control invoking
  `persephone.capabilities.invoke("demo.greet", ...)` with the result shown in the existing output.
- [x] The template guide and the `persephone://guides/boards` corpus document the capabilities
  manifest axis, bridge 1.8.0, all four intent methods, both capability methods, the mandatory
  settlement rule, timeout/cancel/idempotency/at-most-once behavior, one-shot in-memory payload
  policy and its caveat, and all ten typed rejection codes.
- [x] A guide `list()` example includes `handlerKey`.
- [x] `doc/architecture/` has a capability-bus subsystem page with registration/resolution rules,
  lifecycle, failure taxonomy, and the D1 renderer-local trade-off; `overview.md` links it.
- [x] `doc/architecture/key-files.md` indexes the new capability-bus files and relevant bridge
  ownership.
- [x] No tests/harnesses, commits, or changes under `.persephone/boards/Demo` are made; no public
  declaration copy or `_imports.txt` edit is needed.
- [x] `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass.

## Files that need NO changes

- `.persephone/boards/Demo/**` — installed user copy explicitly out of scope.
- `src/ipc/capability-bus-channels.ts`, `src/renderer/api/capability-bus.ts`,
  `src/renderer/api/capabilities.ts`, `src/renderer/api/board-capability-transport.ts`,
  `src/board-shim.ts`, and `src/renderer/editors/board/board-manifest.ts` — landed implementation
  is inspected for the fixture/docs contract, not changed by this task.
- `src/renderer/api/types/capabilities.d.ts` and `assets/editor-types/capabilities.d.ts` — already
  contain `handlerKey` and the landed public API shape; no changes are needed.
- `assets/editor-types/_imports.txt` — no declaration file is changed.
- `doc/active-work.md` and `doc/epics/EPIC-108.md` — both already link/list US-1482.
- Any unit test or test harness file — verification is by the required project checks and live
  observations, as specified by the epic.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1482-capability-fixture-docs/README.md` | This investigation, implementation plan, scope, and acceptance criteria. |
| `assets/demo-board/board-manifest.json` | Declare `demo.greet`, disclose capabilities, and require bridge 1.8.0. |
| `assets/demo-board/index.html` | Explain the capability fixture and add its visible invoke control. |
| `assets/demo-board/app.js` | Register/consume the intent handler and add the board-side invoke action. |
| `src/renderer/editors/board/board-api.d.ts` | Add the already-runtime `handlerKey` field to board list IntelliSense. |
| `assets/board-template/CLAUDE.md` | Update manifest and bridge authoring reference for EPIC-108. |
| `assets/guides/boards.md` | Update the user-facing `persephone://guides/boards` manifest/bridge reference. |
| `assets/guides/agents/boards.md` | Update the agent-facing board authoring reference. |
| `doc/architecture/capability-bus.md` | New developer architecture description of the capability bus. |
| `doc/architecture/overview.md` | Link and summarize the capability-bus subsystem. |
| `doc/architecture/key-files.md` | Add rows for capability-bus ownership and implementation files. |
