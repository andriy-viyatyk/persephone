# US-1397: The event log, its producers, the per-session cursor, and the `events` block

## Goal

Add the renderer-owned event history and its first host-side producers, then deliver unseen
events through the MCP `call` result with one cursor per MCP session and target renderer window.
Expose the same history as a renderer-root `events` node, including a bounded `wait()` loop that a
weak agent can follow.

This task is part of [EPIC-099](../../epics/EPIC-099.md). The epic's **Confirmed decisions** and
**Investigation results** are settled design inputs for this task, including the newest-three
formatter behavior, per-session cursor, and the 50,000 ms / 110,000 ms wait bounds.

## Background

### Fixed `ai-vision@1.1.0` contract

`package.json` already declares `"ai-vision": "^1.1.0"`; no dependency change belongs in this
task. The shipped declarations were read from `node_modules/ai-vision/dist/core/events.d.ts` and
`node_modules/ai-vision/dist/core/resolver.d.ts`.

The host must construct the library class, not recreate its behavior:

```ts
new EventLog({ cap: 200, hostOrigin: "persephone" })
```

`EventLog` exposes `push`, `recent`, `since`, `unseen`, `format`, `subscribe`, `count`, and
`lastSeq`. `format(cursor, showCount = 3)` returns `undefined` when there is nothing unseen; when
there is unseen history it returns an `IAiEventsBlock` containing the formatted `text`, the newest
delivered `cursor`, `shown`, `unseen`, and `dropped`. The library owns the exact “newest 3 + `+N
earlier`” wording and the remote-origin attribution suffix; Persephone must call `format()` and
must not reimplement that text.

`IAiEvent` is `{ seq, time, kind, path?, text, origin }`, with a monotonic sequence in the
window. `IAiEventsBlock` is the result block described above. `IEventLogOptions` supplies `cap` and
`hostOrigin`; `IAiHostSignal`, `AI_VISION_HOST_SIGNAL`, and `STALE_REMOTE_SHAPE_MESSAGE` belong to
the later remote-signal work and are not implemented here. `ICallResult.events?: IAiEventsBlock`
already exists in the resolver declaration.

The shipped implementation in `node_modules/ai-vision/dist/core/events.js` confirms that:

- the ring drops its oldest entry past capacity;
- `recent()` is newest first, while `since(seq)` is ascending and includes entries with `seq > seq`;
- `unseen(cursor)` reports whether the cursor fell behind the retained tail;
- `subscribe()` returns an unsubscribe function and isolates listener failures;
- `format()` selects the newest three unseen entries, advances its returned cursor to the newest
  unseen sequence, and reports a dropped-tail condition.

### Existing MCP routing and result shaping

`src/main/mcp/tools/call-tools.ts` documents that one `McpServer` and one factory run exist per MCP
session. Its `callTools()` closure currently creates `seenKinds` at the top, passes
`seenKinds: [...seenKinds]` only with forwarded renderer calls, and adds the returned hint kind
back into that set. `main` and `guides` are resolved locally against `MainAiRoot`; they have no
renderer window and therefore cannot receive an `events` block.

`src/main/mcp/renderer-bridge.ts` currently defaults `sendToRenderer()` to
`REQUEST_TIMEOUT_MS = 30_000`, but its fourth `timeoutMs` parameter can override that per request.
The current `callTools.ts` forwarding call does not supply that argument. A renderer-side
`events.wait()` therefore cannot use the epic's 50-second bound until the forwarding call supplies
the blocking timeout described below.

The current forwarding path is:

```text
main callTools handler
  -> sendToRenderer("call", params including seenKinds and eventCursor)
  -> renderer handleCall(params)
  -> aiCall(request, seenKinds, eventCursor)
  -> resolveWithAttention(request, resolve, eventCursor)
  -> resolveCall(new AiRoot(...), request, seenKinds)
```

For the per-window cursor, the map key is the actual `openWindows` index of the renderer selected
by the call. When `windowIndex` is omitted, that is the index of
`openWindows.windows.find(windowData => windowData.window)`, not necessarily `0`. The same lookup
already used for `targetWindowData` and native attention must be hoisted before forwarding and
reused for both the map key and attention lookup.

`src/renderer/api/mcp/types.ts` intentionally types MCP params as `Record<string, unknown> | null |
undefined`, so `eventCursor` must be narrowed from the untyped parameter object at the renderer
boundary in the same style as `seenKinds`. `src/renderer/scripting/ai-vision/root.ts` currently
passes only `timeoutMs` in `IAiCallContext`; that context is the existing renderer-only seam used
by board/browser facades and is the right place to carry the cursor into the `events` node.

`src/renderer/scripting/ai-vision/attention.ts` races the resolver against the `dialogsState`
watcher. A pending result is built directly with `{ path, pending: true, attention }`; a completed
result goes through `withAttention()`. Both branches must apply the event block so the block is
available on ordinary and pending forwarded calls. `toCallResult()` in `call-tools.ts` currently
destructures `hint`, `attention`, and `warning`, emits attention before the result body, and emits
the hint last. The new `events` text block belongs immediately after `attention` and before the
body: attention is the action the agent must resolve now; events are context for the state it is
about to read.

Before → after for the session state and forwarding shape:

```ts
// src/main/mcp/tools/call-tools.ts — current
const seenKinds = new Set<string>();

// current forwarded params
{ ...params, path: forward.path, seenKinds: [...seenKinds] }
```

```ts
// planned
const seenKinds = new Set<string>();
const eventCursors = new Map<number, number>();

// planned forwarded params
{ ...params, path: forward.path, seenKinds: [...seenKinds], eventCursor: eventCursors.get(targetWindowIndex) ?? 0 }
```

After a forwarded response, update only the map entry for the resolved target window, and only from
a returned `result.events.cursor`; local results, route errors, and a renderer transport timeout do
not advance it. This preserves the epic's per-session state rule while respecting each renderer's
independent sequence space. The cursor map is the per-session state; each `callTools()` factory owns
one map, and two sessions therefore remain independent.

### Existing renderer namespace pattern

`src/renderer/scripting/ai-vision/namespaces/index.ts` imports descriptor factories and registers
them with `registerAiVisionFor()` for the app singleton namespaces. `src/renderer/scripting/ai-vision/root.ts`
imports that index for registration side effects, owns the root member list, and exposes members
through getters. Existing namespace descriptors use `IAiMember`, `IAiVisionDescriptor`, and the
package's `numberRule` / `stringRule` / `validateCallArguments` helpers rather than ad-hoc argument
checks. A new `namespaces/events.ts` should follow that pattern; its per-call cursor must be read
from the `IAiCallContext` passed by the MCP resolver, not stored in the shared event log.

Before → after for root registration:

```ts
// src/renderer/scripting/ai-vision/root.ts — current root members (relevant tail)
{ name: "menuFolders", kind: "property", node: true, summary: "Configured folders shown in the sidebar." },
{ name: "windows", kind: "property", summary: "All Persephone windows (open and closed). ..." },
```

```ts
// planned
{ name: "events", kind: "property", node: true,
  summary: "What changed in this renderer window; call events.wait(), and call it again when pending." },
{ name: "windows", kind: "property", summary: "All Persephone windows (open and closed). ..." },
```

The `events` descriptor must document in plain words: read `events.recent()` or
`events.since(seq)` for history; call `events.wait()` to wait for a new event; if it returns
`pending: true`, call `events.wait()` again. `events.count` is the current retained ring size.

## Implementation Plan

### 1. Create the per-renderer log and producer seams

- Add `src/renderer/scripting/ai-vision/event-log.ts`, beside `attention.ts`. Export one module
  singleton constructed as `new EventLog({ cap: 200, hostOrigin: "persephone" })`.
- Export small typed producer helpers so producers pass semantic data rather than constructing
  `{ kind, text, origin, path }` themselves. The concrete first-set helpers should cover the
  verified producers below: board shape refresh, board reload, browser navigation, native dialog
  answered, and Log View dialog answered. Export named seams for the later producers as well:
  `logRemoteNotify(...)` and the guide-button helper, but do not wire their out-of-scope producers
  in US-1397.
- Keep the event text one line and include the canonical object-model path in the text wherever the
  agent needs to re-read state. Also populate `path` on the entry so `events.recent()` exposes the
  structured target. Board/page-origin entries must pass `origin: "board"` / `origin: "page"`
  respectively; host observations and dialog answers use the default `persephone` origin. Do not
  include dialog values or passwords in event text.
- Use explicit, actionable producer wording: shape refresh says `The board shape changed; re-read
  <path>.`; reload says `The board reloaded; re-read <path>.`; navigation says `The browser page
  navigated; re-read <path>.`; a native dialog answer says `The user answered a dialog.`; and the
  Log View variant says `The user answered Log View dialog <id> with <button>; re-read <path>.`,
  quoting the id and button with `JSON.stringify`. The library's `format()` adds sequence labels,
  punctuation, the “Events since your last call” heading, and any `+N earlier` line around these
  one-line texts.
- Do not place this module under `src/renderer/api/events/`: that directory owns the unrelated
  synchronous/asynchronous `EventChannel` system.

### 2. Wire board registration events

Verified source path: `src/renderer/editors/board/BoardWebview.ts` receives the cross-origin board
message in `handleMessage()`, dispatches `"board:aiVision"` to `handleAiVisionRegistration()`,
normalizes `message.reason` to `"refresh" | "register"`, rejects pending requests only for a new
registration, and calls `BoardEditorModel.setAiVisionRegistration(...)`. The model preserves the
same remote incarnation for refresh and increments it for a new registration.

`BoardEditorModel.reloadBoard()` clears the registration and increments `state.reloadToken`.
`BoardEditorView.syncBranch()` includes `reloadToken` in the branch key, so reload remounts
`BoardWebview`; its `handleLoad()` registers the frame and the board then sends the next
`board:aiVision` registration. An initial registration also has reason `register`, so a reload
marker is required to distinguish it from the initial case.

Plan:

- Add a model-owned one-shot “reload awaiting registration” marker set by `reloadBoard()` and
  consumed only after a valid `register` registration is accepted. Clear it when `selectBoard()`
  changes the selected board and during `dispose()`, so a marker cannot survive the board identity
  or model that created it. Ensure a stale/disposed frame cannot consume it before
  `setAiVisionRegistration()` accepts the registration.
- In the validated registration path, call the event-log helper after a successful model update:
  `reason === "refresh"` emits `shape-changed`; `reason === "register"` plus the consumed reload
  marker emits `board-reloaded`. The initial `register`, a second `expose()` registration not
  preceded by `reloadBoard()`, rejected/untrusted shapes, and secondary-view registrations emit
  none of these events.
- Use the owning page's verified `page.id` to form `pages["<id>"].editor.app` and the board helper
  to form the text. Mark the shape event origin as `board`; the reload observation is host-originated
  `persephone`.

Before → after seam:

```ts
// BoardWebview.handleAiVisionRegistration() — current ending
model.setAiVisionRegistration(
    message.shape, frame, this.generation, this.requestAiVision,
    (warning) => this.appendLog("warn", warning), reason,
);
```

```ts
// planned ending
const accepted = model.setAiVisionRegistration(
    message.shape, frame, this.generation, this.requestAiVision,
    (warning) => this.appendLog("warn", warning), reason,
);
if (accepted && reason === "refresh") logShapeChanged(boardAppPath(model));
if (accepted && reason === "register" && model.consumeReloadRegistration()) {
    logBoardReloaded(boardAppPath(model));
}
```

Change `setAiVisionRegistration()` to return `true` only after its existing trust/frame/generation
checks and registration assignment succeed, otherwise `false`. Add
`consumeReloadRegistration()` on `BoardEditorModel`; it returns `true` once and clears the marker,
or returns `false` when no reload is awaiting registration. Both operations are synchronous, so
the caller can only consume the marker after the accepted assignment in the snippet above.

### 3. Wire browser navigation only for a touched tab

Verified source path: `src/renderer/editors/browser/BrowserWebviewModel.ts` receives browser IPC in
`handleBrowserEvent()`. Full navigation (`did-navigate`) currently clears the tab's AiVision
registration and then calls `applyNavigation(..., false)`; in-page navigation
(`did-navigate-in-page`) calls `applyNavigation(..., true)` without clearing it. The existing
registration is stored by tab in `BrowserEditor`'s `aiVisionByTab` map, and successful probes in
`probeAiVision()` call `BrowserEditor.setAiVisionRegistration()`.

Chosen touched-tab signal: maintain a historical set of internal tab IDs that have ever accepted
an AiVision registration. This is the cheapest honest signal permitted by the epic: it reuses the
existing successful registration path, does not treat every browser tab/navigation as agent news,
and survives the `did-navigate` cleanup long enough to classify that navigation. Retain the set
until `BrowserEditor.dispose()` clears it; a closed tab has no future navigation event, and
`createInternalTabId()` increments a process-local counter, so a closed ID cannot be confused with
a future tab. This deliberately chooses the epic's “ever had an AiVision registration” signal over
instrumenting every agent address/automation action.

Plan:

- Add the historical registration set and a narrow query/mark seam to `BrowserEditor`, updating it
  only after `setAiVisionRegistration()` accepts a registration.
- In `BrowserWebviewModel.handleBrowserEvent()`, snapshot the historical touched flag before
  `clearAiVisionRegistration()` for `did-navigate`; for both full and in-page navigation, call the
  navigation helper only when that flag is true. Keep the existing state synchronization and URL
  history behavior unchanged.
- Emit `navigated` with a path of `pages["<page id>"].editor`, host origin `persephone`, and text
  telling the agent to re-read that browser editor. Do not emit for `about:blank` view setup,
  untouched tabs, audio/popup/context-menu events, or AiVision shape changes (US-1398).

Before → after seam:

```ts
// BrowserWebviewModel.handleBrowserEvent() — current
case "did-navigate": {
    this.model.clearAiVisionRegistration(internalTabId);
    this.applyNavigation(internalTabId, data, false);
    break;
}
case "did-navigate-in-page": {
    this.applyNavigation(internalTabId, data, true);
    break;
}
```

```ts
// planned
case "did-navigate": {
    const touched = this.model.hasAiVisionRegisteredTab(internalTabId);
    this.model.clearAiVisionRegistration(internalTabId);
    this.applyNavigation(internalTabId, data, false);
    if (touched) logBrowserNavigated(browserEditorPath(this.model));
    break;
}
case "did-navigate-in-page": {
    this.applyNavigation(internalTabId, data, true);
    if (this.model.hasAiVisionRegisteredTab(internalTabId)) {
        logBrowserNavigated(browserEditorPath(this.model));
    }
    break;
}
```

### 4. Wire dialog answers without leaking values

There are two verified renderer surfaces.

- `src/renderer/ui/dialogs/Dialogs.ts` is only a re-export. Native renderer dialogs are registered
  and resolved through `src/renderer/ui/dialogs/DialogsView.ts`. Its `showDialog()` assigns
  `model.onClose`; that callback removes the exact dialog object from `dialogsState` and resolves
  `model.result`. All native dialog views call their model's `close(...)`, and
  `TDialogModel.close()` in `src/renderer/core/state/model.ts` invokes `onClose` only after any
  `canClose` check succeeds. This callback is the single resolution seam for dialogs represented in
  `dialogsState`.
- Log View inline dialogs are resolved by `LogViewEditor.resolveDialog(id, button)` in
  `src/renderer/editors/log-view/LogViewEditor.ts`. It sets `entry.button`, updates the rendered
  entry, then resolves/removes the pending promise. `ButtonsPanelView` calls its supplied
  `onClickButton` only while `props.button` is undefined; each inline dialog view routes that to
  `resolveDialog()`.

Plan:

- In the native `showDialog()` close callback, log a generic `dialog-answered` event after the
  dialog is removed and before the result promise is resolved. Include only a safe dialog
  kind/identity (or generic text); do not serialize `result`, because password dialogs resolve
  with the password string and several dialogs resolve with paths or other user data. Canceled /
  Escape-closed dialogs use the same event kind because the shared `onClose` seam is the verified
  resolution boundary for the user-visible dialog.
- In `LogViewEditor.resolveDialog()`, after confirming the entry and setting its `button`, log a
  `dialog-answered` event with the dialog ID, safe page identity, and selected button. Do not log
  input text, selected values, checkbox contents, or other entry fields. Use the page's exact
  `pages["<id>"].editor` path when available.
- Keep `attention.ts`'s inspection behavior unchanged. The event producer must be at the actual
  resolution callbacks above, not at `collectAttention()`, because attention is a read-only
  snapshot and inline dialogs are not in `dialogsState`.

Before → after seam:

```ts
// src/renderer/ui/dialogs/DialogsView.ts — current showDialog() callback
data.model.onClose = res => {
    dialogsState.set(oldState => oldState.filter(item => item !== data));
    resolve(res as R);
};
```

```ts
// planned
data.model.onClose = res => {
    dialogsState.set(oldState => oldState.filter(item => item !== data));
    logDialogAnswered();
    resolve(res as R);
};
```

```ts
// LogViewEditor.resolveDialog() — current relevant operation
entry.button = button;
// update content/state, then pending.resolve(updatedEntry)
```

```ts
// planned relevant operation
entry.button = button;
logLogViewDialogAnswered(this.page?.id, entry.id, button);
// update content/state, then pending.resolve(updatedEntry)
```

### 5. Give only blocking renderer calls a longer bridge timeout

`src/main/mcp/renderer-bridge.ts` exposes the fourth `sendToRenderer()` argument specifically for
this per-request choice. Add this small named predicate in
`src/main/mcp/tools/call-tools.ts` and document why its future entries are present:

```ts
// Planned: canonical renderer-relative method paths that may deliberately block.
export function isBlockingRendererCall(path: string): boolean {
    return path === "events.wait"
        || path === "ui.guide.step" // US-1399
        || path === "ui.guide.end"; // US-1399
}
```

Use it only for the forwarded `call` request:

```ts
// call-tools.ts — current
response = await sendToRenderer("call", { ...params, path: forward.path, seenKinds: [...seenKinds] }, forward.windowIndex);
```

```ts
// planned
const targetWindowData = forward.windowIndex !== undefined
    ? openWindows.windows.find(windowData => windowData.index === forward.windowIndex)
    : openWindows.windows.find(windowData => windowData.window);
const targetWindowIndex = targetWindowData?.index;
const eventCursor = targetWindowIndex === undefined
    ? 0
    : eventCursors.get(targetWindowIndex) ?? 0;
const bridgeTimeoutMs = isBlockingRendererCall(forward.path) ? 125_000 : undefined;
response = await sendToRenderer(
    "call",
    { ...params, path: forward.path, seenKinds: [...seenKinds], eventCursor },
    forward.windowIndex,
    bridgeTimeoutMs,
);
```

`undefined` preserves the bridge's existing 30,000 ms default for every non-blocking renderer
call. Do not raise `REQUEST_TIMEOUT_MS` globally. The renderer's `events.wait()` bound is 50,000
ms by default and 110,000 ms after the explicit clamp; the bridge timeout is 125,000 ms, giving
the invariant `renderer bound < bridge timeout < client timeout`. This ordering is required so
the renderer always returns `{ pending: true, waitedMs }` before the bridge, and the bridge before
the MCP client. It must remain true for the configured client timeout used by the call; EPIC-099 I1
documents Claude's 300,000 ms HTTP idle bound and recent Codex builds at 300,000 ms, while its
older/default Codex value is 120,000 ms and is therefore not sufficient for the 125,000 ms bridge
choice. Record that 120,000 ms exception rather than claiming the invariant holds under it; the
renderer bound itself remains below 120,000 ms.

### 6. Carry the per-window cursor and attach the renderer result block

Update these exact stages end to end:

1. `callTools()` creates `const eventCursors = new Map<number, number>()` beside `seenKinds`.
   Resolve `targetWindowData` with the existing explicit-index/default-live-window lookup before
   sending, use `targetWindowData?.index` as the map key, and send
   `eventCursors.get(targetWindowIndex) ?? 0` with forwarded params. Read a numeric
   `result.events.cursor` after the renderer response and update only that target's map entry. Do
   not add events to the local `main` / `guides` branch.
2. `src/renderer/api/mcp/call-command.ts` reads/narrows `params.eventCursor` beside
   `params.seenKinds`, accepts it only when it is a finite non-negative number and otherwise
   defaults it to `0`, passes it as the third value to `aiCall`, and keeps `McpParams` unchanged as
   the generic transport type.
3. `src/renderer/scripting/ai-vision/call.ts` accepts the per-window cursor as the third
   `aiCall()` value,
   passes it to `resolveWithAttention()`, and supplies it in `AiRootOptions.callContext` when it
   calls `resolveAiCall()`. `resolveAiCall()` preserves that context field while adding the
   request's existing `timeoutMs`.
4. `src/renderer/scripting/ai-vision/attention.ts` accepts the cursor and clamps it at each
   renderer result-formatting point before calling `EventLog.format()`:

   ```ts
   // A renderer restart creates a fresh EventLog whose sequence starts at 1; an old main-side
   // cursor ahead of this log can otherwise suppress every new event forever.
   const effectiveCursor = cursor > eventLog.lastSeq ? 0 : cursor;
   const events = eventLog.format(effectiveCursor);
   ```

   Apply that same `effectiveCursor` to both the completed resolver result and the pending-dialog
   result. Spread the result rather than mutating the library-owned block; omit `events` when
   `format()` returns `undefined`.
5. `call-tools.ts` adds `events` to its local `ICallEnvelope`, destructures it in `toCallResult()`,
   and pushes `{ type: "text", text: events.text }` after attention and before the result body.
   Keep pending/error/body/image/truncation behavior otherwise unchanged.

Before → after for attention attachment and output order:

```ts
// attention.ts — current completed path
return withAttention(raced);

// call-tools.ts — current
const { hint, attention, warning, ...rest } = envelope;
if (attention) content.push({ type: "text", text: attention.text });
// body follows
```

```ts
// planned
return withAttentionAndEvents(raced, eventCursor);

const { hint, attention, events, warning, ...rest } = envelope;
if (attention) content.push({ type: "text", text: attention.text });
if (events) content.push({ type: "text", text: events.text });
// body follows
```

### 7. Keep forwarded paths consistent

`call-tools.ts` currently restores an explicit `windows[i].` prefix after a forwarded call:
`prefixHintPaths()` rewrites renderer-relative hint lines, and `prefixAttentionPaths()` rewrites
`dialogs[...]` / `menus[...]` paths. Event text is also renderer-relative because producer text
uses `pages[...]` paths. Add a dedicated event-text prefix step in the same forwarding block,
rewriting the event block's path references consistently with the existing helper (at minimum
`pages[` references; include any other renderer-root spelling used by the finalized helper text).
Preserve the block's `cursor`, `shown`, `unseen`, and `dropped` fields unchanged.

Before → after:

```ts
// call-tools.ts — current prefix block
if (envelope.hint) envelope.hint.text = prefixHintPaths(...);
if (envelope.attention) envelope.attention.text = prefixAttentionPaths(...);
```

```ts
// planned
if (envelope.hint) envelope.hint.text = prefixHintPaths(...);
if (envelope.attention) envelope.attention.text = prefixAttentionPaths(...);
if (envelope.events) envelope.events = {
    ...envelope.events,
    text: prefixEventPaths(envelope.events.text, prefix),
};
```

### 8. Add the `events` namespace and caller-cursor wait

Create `src/renderer/scripting/ai-vision/namespaces/events.ts` and register its descriptor in
`src/renderer/scripting/ai-vision/namespaces/index.ts` with the package's
`registerAiVision(EventsNode, describeEvents)` constructor registry; the existing index imports
use `registerAiVisionFor()` only for app-singleton objects. Expose a per-`AiRoot` `EventsNode` from
`AiRoot` and add its `events` row to `ROOT_MEMBERS`.

The node surface is:

- `recent(limit = 50)`: validate one optional number with `numberRule`, use the log's `recent()`;
- `since(seq)`: validate one required non-negative sequence number with `numberRule`, use the log's
  `since()`;
- `count`: read the log's `count` getter;
- `wait(timeoutMs?)`: validate one optional positive number with `numberRule`, resolve against the
  caller cursor carried in `IAiCallContext`, and return a JSON-safe result.

Set these exact descriptor strings in `events.ts`:

```text
events summary: "Recent changes in this renderer window; read them or wait for the next one."
recent summary: "Read the newest retained events, newest first."
since summary: "Read retained events newer than seq (up to the 200 retained entries; use call maxLength to bound the returned text)."
count summary: "How many events are currently retained in this window's event log."
wait summary: "Wait for an event newer than this call's cursor; if pending is true, call events.wait() again."
```

The `$help` text must say: “Call `events.recent()` to read the newest events or
`events.since(seq)` for a precise range. `since(seq)` has no additional limit and can return all
200 retained entries; use the call's `maxLength` when the returned text must be bounded. Call
`events.wait()` to wait for a change. If it returns `pending: true`, call `events.wait()` again.”
It must also state that `recent()` is newest first, `since(seq)` uses sequence numbers, `count` is
the retained ring size, and the wait is bounded.

Reject extra positional arguments through `validateCallArguments(..., { maxArgs: 1 })`. Keep the
library's own limit normalization; namespace validation is for argument type/requiredness and the
documented sequence/timeout lower bounds.

The non-obvious wait wiring is resolved as follows: `callTools()` owns the per-window
`eventCursors` map; it selects the target window index and sends that window's cursor as a
forwarded MCP parameter. Renderer `handleCall()` reads it beside `seenKinds`; the third `aiCall()`
argument passes it to `resolveWithAttention()` and into the `callContext` supplied to
`resolveAiCall()`; `resolveAiCall()` preserves it in `IAiCallContext`; `AiRoot` constructs the
per-call `EventsNode` with an accessor to that context; and `EventsNode.wait()` reads that accessor
when it subscribes. Therefore `events.wait()` receives the same cursor that
`resolveWithAttention()` uses for the result block, without putting session state in the renderer
singleton log or exposing a cursor argument that agents could accidentally desynchronize. Direct
renderer `app.call()` / board-owned calls have no MCP session cursor, so their context defaults to
zero and they do not receive the MCP result `events` block.

Implement `wait()` with `EventLog.subscribe()` and cleanup on every branch:

1. At the start of the call, clamp a caller cursor ahead of the current log before any read:

   ```ts
   // A renderer restart resets this module's sequence space; an old main-side cursor can then
   // be ahead of lastSeq and would otherwise make the restarted session permanently deaf.
   const effectiveCursor = cursor > eventLog.lastSeq ? 0 : cursor;
   ```

   Resolve immediately with the first retained entry newer than `effectiveCursor` if one already
   exists. Use `effectiveCursor` for the post-subscribe re-check and callback comparison too.
2. Subscribe, re-check after subscribing to close the check/subscribe race, and resolve on the first
   callback whose `entry.seq > effectiveCursor`.
3. Set a timer for the effective bound; on expiry unsubscribe and return
   `{ pending: true, waitedMs }`. If an explicit request was clamped, add
   `{ timeoutMs: 110000, clampedFrom: requestedTimeoutMs }` to that result so the clamp is visible.
4. The default effective bound is 50,000 ms. An explicit timeout is capped at 110,000 ms. For an
   explicit value greater than 110,000, the result always includes exactly
   `{ timeoutMs: 110000, clampedFrom: requestedTimeoutMs }`. These numbers are quoted from
   EPIC-099 Investigation I1, not re-derived here.

On success return `{ pending: false, waitedMs, event }`, where `event` is the first matching
`IAiEvent`; add the same `{ timeoutMs: 110000, clampedFrom: requestedTimeoutMs }` metadata when
the explicit request was clamped. On pending, the descriptor/help text must repeat: “call
`events.wait()` again.”

The node itself is per `AiRoot` call so its cursor accessor is call-specific; the `EventLog`
instance remains the one module singleton for the renderer window. `recent()` and `since()` return
the library's plain event records, including sequence numbers and paths.

Before → after for the call context:

```ts
// root.ts — current
export interface IAiCallContext {
    readonly timeoutMs?: number;
}
```

```ts
// planned
export interface IAiCallContext {
    readonly timeoutMs?: number;
    readonly eventCursor?: number;
}
```

The root wiring is also per call, not a singleton property:

```ts
// root.ts — planned
private readonly eventsNode = new EventsNode(
    eventLog,
    () => this.options.callContext?.eventCursor ?? 0,
);
get events(): EventsNode { return this.eventsNode; }
```

`app.call()` and the board-owned `persephone.call()` path already construct `AiRoot` directly;
they will see the same read-only `events` node but have no MCP session cursor and no
`resolveWithAttention()` delivery wrapper. Their `events.wait()` cursor is therefore `0`, while
only the MCP `call` path supplies the per-session cursor described above.

## Concerns

- A reload registration has the same wire reason (`register`) as an initial registration and a
  second `expose()`. The model-owned one-shot reload marker is required; do not infer reload from
  `reason` alone.
- `did-navigate` clears the current browser registration before `applyNavigation()`. The historical
  tab set must be consulted before that clear, or the navigation event will be lost. It must not be
  confused with `openedByAgent`, which is a privacy/access flag for private browser pages, not a
  general navigation-touch record.
- Native dialog results can be passwords, paths, or free-form values. Only Log View's explicit
  `button` is safe to report, and even there the event must exclude entry input/selection data.
- Event text is formatted by the installed library. Do not duplicate the newest-three or `+N`
  wording in Persephone; only prefix renderer-relative paths at the main-process boundary.
- The bridge's default is 30,000 ms, so a 50,000 ms wait would otherwise become a bridge error.
  Only the named blocking renderer paths get the 125,000 ms fourth-argument timeout. The intended
  ordering is renderer bound (50,000/110,000) < bridge timeout (125,000) < the configured client
  timeout; the EPIC-099 I1 Codex default of 120,000 ms is a documented exception that cannot satisfy
  that strict ordering, while the documented 300,000 ms client bounds do.
- `EventLog.subscribe()` can fire while `events.wait()` is resolving. Every success, timeout, and
  immediate path must remove the subscription and timer; a late callback must not resolve twice.
- A session cursor is one number per resolved renderer window, stored in a map beside
  `seenKinds`; the renderer logs have independent sequence spaces. It is advanced from that
  window's returned block, not when a caller reads `events.recent()` or when a local main-process
  call completes.
- An event caused by the current session is delivered back to that same session: normally on its
  next forwarded call, or on the current result when the blocking `events.wait()` itself observes
  it. This is intentional confirmation of the action, and the shared log plus per-window cursor
  makes filtering it out unsafe and unnecessary.
- If `events.wait()` resolves on entry N, the same call's result `events` block can list entry N
  again because attention formats from the call's incoming cursor after the resolver returns. This
  is intentional: the block is the authoritative delivery and cursor advance, not a duplicate
  cursor protocol to engineer around.
- `events.since(seq)` deliberately has no namespace-imposed limit, so it can return the full
  200-entry retained ring. Resolver result shaping through the call's `maxLength` is the documented
  bound when an agent needs a smaller response.
- The browser-page shape binding, lazy revalidation, overlay button callback, and board `notify`
  shim are US-1398 / US-1399. Leave named helper seams only; do not add their producers here.
- Do not modify `src/renderer/api/events/`; it is the unrelated `EventChannel` system. Do not add
  tests or a test harness: this project does not use them. Do not change the dependency, dashboard,
  or commit history.

## Acceptance Criteria

- [ ] `src/renderer/scripting/ai-vision/event-log.ts` exports exactly one renderer-window log with
      `{ cap: 200, hostOrigin: "persephone" }` and typed producer helpers; no producer constructs
      raw event entries directly.
- [ ] A valid board `reason: "refresh"` registration emits one `shape-changed` event with board
      attribution; a valid `register` after `reloadBoard()` emits one `board-reloaded` event; initial
      registration and invalid/untrusted/secondary registrations emit neither.
- [ ] A full or in-page browser navigation emits `navigated` only for a tab in the historical
      successful-AiVision-registration set; untouched tabs emit none.
- [ ] Native `dialogsState` resolution and Log View `resolveDialog(id, button)` each emit
      `dialog-answered`; no password, free-form input, selected value, or checkbox content is
      recorded.
- [ ] A forwarded renderer call receives `eventCursor`, returns an `events` block only when
      `EventLog.format(cursor)` has unseen entries, and advances the main-process cursor to the
      block cursor. The cursor map is keyed by the resolved target window index, including the
      actual default-live window index when `windowIndex` is omitted. Two sessions retain
      independent maps; local `main` / `guides` results have no events block.
- [ ] Only `events.wait`, `ui.guide.step`, and `ui.guide.end` forwarded paths receive the
      125,000 ms bridge timeout; all other forwarded calls retain the 30,000 ms default. The
      renderer bound fires before the bridge timeout, and the configured client timeout exceeds
      the bridge timeout.
- [ ] A cursor greater than the renderer log's `lastSeq` is clamped to `0` in both event-block
      formatting and `events.wait`, with the restart rationale documented at the clamp; a
      restarted renderer is not permanently deaf to its session.
- [ ] `toCallResult()` emits text blocks in the order pending (when applicable), attention, events,
      result body/image, truncation, warning, and hint; event wording remains the library's wording.
- [ ] Forwarded `windows[i].` calls restore renderer-relative event paths consistently with hint and
      attention paths.
- [ ] Root discovery lists `events`; `recent`, `since`, `count`, and `wait` validate arguments with
      package rules and expose the documented summaries/help. `wait()` uses the forwarded session
      cursor, resolves on a newer subscribed event, and returns a bounded `pending` result that says
      to call `events.wait()` again. The default is 50,000 ms and explicit values are capped at
      110,000 ms with the clamp reported. `since(seq)` has no additional limit and its output is
      bounded by call `maxLength` when requested.
- [ ] No browser CDP binding, page shape signal, overlay-button producer, or board `notify` producer
      is implemented in this task.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/scripting/ai-vision/event-log.ts` | New singleton and typed producer helpers/seams. |
| `src/main/mcp/tools/call-tools.ts` | Per-session/per-window cursor map, blocking bridge timeout, forwarded cursor, event path prefix, and result text block. |
| `src/renderer/api/mcp/call-command.ts` | Read forwarded `eventCursor`. |
| `src/renderer/scripting/ai-vision/call.ts` | Carry cursor into renderer call context. |
| `src/renderer/scripting/ai-vision/attention.ts` | Clamp restarted-log cursors and attach formatted events to completed and pending renderer results. |
| `src/renderer/scripting/ai-vision/root.ts` | Carry context field, expose root `events`, and add `ROOT_MEMBERS` row. |
| `src/renderer/scripting/ai-vision/namespaces/events.ts` | New `events` descriptor/node, bounded wait, and ahead-cursor recovery. |
| `src/renderer/scripting/ai-vision/namespaces/index.ts` | Register the events namespace descriptor. |
| `src/renderer/editors/board/BoardWebview.ts` | Emit board refresh/reload events after accepted registrations. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Track/consume reload-before-registration marker. |
| `src/renderer/editors/browser/BrowserEditor.ts` | Track historical successful AiVision-registered tab IDs. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Emit navigation events only for touched tabs. |
| `src/renderer/ui/dialogs/DialogsView.ts` | Emit safe native dialog-answer events at `showDialog()`'s `onClose`. |
| `src/renderer/editors/log-view/LogViewEditor.ts` | Emit safe inline dialog-answer events after `button` is set. |

### Files that need NO changes

| File/area | Reason |
|---|---|
| `package.json`, `package-lock.json` | `ai-vision@^1.1.0` is already installed. |
| `src/main/mcp/renderer-bridge.ts` | Its existing fourth `sendToRenderer()` timeout argument is sufficient; only `call-tools.ts` selects 125,000 ms for blocking paths. |
| `src/renderer/api/events/` | Unrelated `EventChannel` system. |
| `src/main/cdp-service.ts` and browser CDP binding paths | US-1398. |
| `src/renderer/scripting/ai-vision` guide/overlay implementation | Overlay buttons and `ui.guide` are US-1399. |
| Board shim/message definitions for `notify` | Board `notify` is US-1399. |
| Tests/test harnesses | The project does not use them and the task forbids adding them. |
| `doc/active-work.md` | The EPIC-099 dashboard entry already links this task, per user instruction. |
