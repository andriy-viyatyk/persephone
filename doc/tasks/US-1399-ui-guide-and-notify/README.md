# US-1399: `ui.guide.step` / `ui.guide.end`, and a board's `notify` over the shim

This task is part of [EPIC-099](../../epics/EPIC-099.md). The existing EPIC-099 dashboard row
already links this task, so no dashboard change is needed.

## Goal

Let an agent walk a user through one curated Persephone shell control at a time, waiting for the
user's **Skip** or **Next** choice and reporting that choice without confusing unrelated events
for a button press. Also deliver a board's AiVision `remote.notify(text)` call to the host event
log with board attribution, the owning page path, and bounded ingress.

## Background

### UI ownership and the installed overlay

`src/renderer/scripting/ai-vision/namespaces/ui.ts` registers the `ui` singleton through
`describeUserInterface()`. It currently builds both `ui.elements` and `ui.highlight` with
`createElements(HEADER_ELEMENTS, ui.highlightElement.bind(ui))`. `HEADER_ELEMENTS` is the
curated shell list containing names such as `persephone-menu` and `mcp-indicator`; it is not the
complete accessibility tree. `src/renderer/api/ui.ts` owns
`UserInterface.highlightElement(selector, text?, options?, reveal?)` and
`clearHighlights(id?)`.

The current descriptor has no guide member:

```ts
// src/renderer/scripting/ai-vision/namespaces/ui.ts — current
const elements = createElements(HEADER_ELEMENTS, ui.highlightElement.bind(ui));
return {
    kind: "UserInterface",
    members: [...USER_INTERFACE_MEMBERS, ...elements.members],
    provide: elements.provide,
    elements: HEADER_ELEMENTS,
    help: "... use ui.elements ... and ui.highlight ...",
};
```

The descriptor factory runs during resolution, so the guide state must not be held by a new
`GuideNode` made inside `describeUserInterface()`. A module-level node returned by
`provide("guide")` is required for an outstanding wait to survive the next MCP call. Put that
node and its descriptor in new
`src/renderer/scripting/ai-vision/namespaces/ui-guide.ts`; move the declaration array to new
`src/renderer/scripting/ai-vision/namespaces/ui-elements.ts` so both files consume one source
without a circular import or a much larger `ui.ts`.

The installed package was read directly from `node_modules`:

- `node_modules/ai-vision/dist/dom/types.d.ts` declares `buttons?: readonly string[]` and
  `onButton?: (label: string, id: string) => void`. Supplied buttons replace the default single
  Close button.
- `node_modules/ai-vision/dist/dom/elements.js` resolves an explicit declaration selector, or
  `[data-name="<name>"]`, applies scope/reveal rules, validates the name, runs
  `beforeHighlight`, and passes the resolved selector to its highlight callback. This provider is
  the guide's name-resolution seam.
- `node_modules/ai-vision/dist/dom/ui-highlight.js` calls `clear(item.id)` before adding a reused
  id, then clears the item before calling `onButton(label, item.id)`. The default Close button has
  `data-name="ai-vision-highlight-close"`; supplied buttons have
  `data-name="ai-vision-highlight-button-<slug>"`, with lowercasing, collapsed non-alphanumeric
  runs, trimming, and duplicate-slug suffixes. An empty/invalid supplied list falls back to
  Close. Its `onKeyDown` handler calls `clear()` directly for Escape and does not invoke
  `onButton`; any other clear that removes the card has the same observable behavior. Guide
  defaults must therefore be an explicit non-empty `[`"Skip"`, `"Next"`]` list.

`src/renderer/api/ui.ts` currently deletes only `reveal` from copied public options:

```ts
// src/renderer/api/ui.ts — current
const highlightOptions = { ...options } as IHighlightOptions;
delete (highlightOptions as IHighlightOptions & { reveal?: unknown }).reveal;
return api.show({ ...highlightOptions, selector, text: text ?? options?.text, ...(reveal ? { reveal } : {}) });
```

It does not strip `buttons` or `onButton` at runtime, but the public local
`IHighlightOptions` in `src/renderer/api/types/ui.d.ts` declares neither. Add a declaration-only
helper in `src/renderer/api/ui.ts` that accepts only guide-owned `id`, `buttons`, and `onButton`
(plus the internal reveal request) and uses the same loader/API. Do not widen public
`app.ui.highlightElement()` or `IUserInterface` into a general style/callback override.

### US-1397 infrastructure

The committed `src/renderer/scripting/ai-vision/event-log.ts` owns one
`EventLog({ cap: 200, hostOrigin: "persephone" })` and has reserved
`logGuideButton(elementName, button, path?)` and `logRemoteNotify(text, path?)` seams.
`src/renderer/scripting/ai-vision/namespaces/events.ts` uses `EventLog.subscribe()` for its
generic cursor wait, with a 50,000 ms default and explicit timeouts clamped to 110,000 ms.

The guide must not use the generic cursor as its completion condition. `IAiEvent` has only
`seq`, `time`, `kind`, `path?`, `text`, and `origin`; it has no correlation field. Extend the
guide seam with a renderer-local typed signal carrying `stepId`, `elementName`, `button`, and the
ring entry. The ring entry remains the normal `guide-button` event so another MCP session, or the
same session after `pending`, learns through the existing events block.

`src/main/mcp/tools/call-tools.ts` already contains the required bridge wiring:

```ts
// current and sufficient
const BLOCKING_RENDERER_PATHS = ["events.wait", "ui.guide.step", "ui.guide.end"] as const;
const bridgeTimeoutMs = isBlockingRendererCall(forward.path) ? 125_000 : undefined;
```

Keep this 125 s bridge timeout and the 50,000/110,000 ms renderer bounds; do not change the
general 30 s bridge default.

### Board transport

`src/board-shim.ts` runs in a plain board iframe. `exposeAiVision()` currently calls
`expose(root, { publish: false, onWarning })`; its returned `notify(text)` delegates to
`remote.notify(text)`. The installed `node_modules/ai-vision/dist/remote/expose.js` sends that
signal to `window.__aiVisionHostSignal` by default, but that global is absent in a board frame.
The existing `persephone.notify()` is a separate MessagePort toast and must not be changed.

The board-to-host `window.postMessage` types live in dependency-free
`src/ipc/board-bridge-channels.ts`. `src/renderer/editors/board/BoardWebview.ts` first requires
the live board origin and exact iframe source, then dispatches `"board:aiVision"` to
`handleAiVisionRegistration()`. That handler additionally requires the current main frame,
valid schema/shape, and `boardTrust.isTrusted(boardRoot)`. The notify message must use the same
authentication and trust gate.

The current `logRemoteNotify(text, path?)` hardcodes `origin: "board"`. US-1398 changes it to
`logRemoteNotify(text, path?, origin: "board" | "page" = "board")`. This task must integrate
with that signature and must not clobber the page-origin change, regardless of implementation
order.

## Implementation Plan

### 1. Add `ui.guide` and its descriptor prose

Change `src/renderer/scripting/ai-vision/namespaces/ui-elements.ts` (new) to export the current
`HEADER_ELEMENTS` unchanged. Change new
`src/renderer/scripting/ai-vision/namespaces/ui-guide.ts` to export `GuideNode` and one module
singleton. Its descriptor has `kind: "UiGuide"`, `step` and `end` members, and help that states:

- `ui.elements` names curated controls and their purposes;
- `ui.highlight` points at one and returns when drawn;
- `ui.guide.step` points at one **and waits for the user**;
- call one `step` per control, call the same `step` again when it returns `pending` (including
  after the user dismissed the card without pressing a button), and call `ui.guide.end()` after
  a step has returned to clear the final guide overlay and finish the walkthrough. `end()` cannot
  interrupt a `step` call that is currently blocked in the same one-call-at-a-time MCP client;
  the timeout is the escape from that blocked call.

Change `src/renderer/scripting/ai-vision/namespaces/ui.ts` to import the shared declarations and
node, add a `node: true` `guide` member, return the node from `provide("guide")`, and add one
walkthrough line to the UI help. Preserve `elements.provide` for every other member. No separate
registration is needed in `namespaces/index.ts`: the node is provided by the already-registered
`ui` descriptor.

`step` accepts `elementName`, `message`, and optional
`{ buttons?: readonly string[]; timeoutMs?: number }`. Use package argument validation for the
required strings and argument count, and an explicit narrow object guard because the package has
no object-rule helper. Reject non-plain options, non-empty-string button violations, empty button
lists, and non-positive/non-finite/non-integer timeouts. Default buttons are exactly
`["Skip", "Next"]`. `end()` clears only the current guide id through `ui.clearHighlights(id?)`,
resolves an active step as `{ ended: true, elementName }`, clears retry state, and returns
`{ ended: true }`.

### 2. Resolve names through `createElements` and draw the card

For each logical step, invoke a `createElements(HEADER_ELEMENTS, guideHighlightCallback)` instance
and call its `provide("highlight").value(elementName, message)`. Do not map names to selectors
again. The callback receives the package-resolved selector/reveal and calls the declaration-only
helper in `src/renderer/api/ui.ts`:

```ts
// src/renderer/scripting/ai-vision/namespaces/ui-guide.ts — planned
const elements = createElements(
    HEADER_ELEMENTS,
    (selector, text, _options, reveal) => highlightDeclarationElement(
        selector, text, { id: stepId, buttons, onButton }, reveal,
    ),
);
await elements.provide!("highlight")!.value(elementName, message);
```

This reuses the package's exact unknown-name error, explicit selector, scope, reveal, and
`beforeHighlight` behavior. If the selector has no match, clean up and return an actionable error
telling the agent to re-read `ui.elements`; do not wait for an impossible button.

The helper in `src/renderer/api/ui.ts` should have the narrow shape:

```ts
// current public surface
async highlightElement(selector, text?, options?: IHighlightOptions, reveal?): Promise<IHighlightResult>

// planned declaration-owned path, not added to IUserInterface
export function highlightDeclarationElement(
    selector: string,
    text: string | undefined,
    options: { readonly id: string; readonly buttons: readonly string[];
        readonly onButton: (label: string, id: string) => void },
    reveal?: IHighlightRevealRequest,
): Promise<IHighlightResult>;
```

Share the existing loader and call `api.show()` with only those declaration-owned fields,
`selector`, `text`, and internal `reveal`. The public method continues stripping only `reveal`.

### 3. Correlate presses and wait only for the active step

Change `src/renderer/scripting/ai-vision/event-log.ts` from the reserved seam to a local signal
seam:

```ts
// current
export function logGuideButton(elementName: string, button: string, path?: string): void;

// planned
interface GuideButtonSignal {
    readonly stepId: string;
    readonly elementName: string;
    readonly button: string;
    readonly event: IAiEvent;
}
export function subscribeGuideButton(listener: (signal: GuideButtonSignal) => void): () => void;
export function logGuideButton(elementName: string, button: string, stepId: string, path?: string): void;
```

`logGuideButton()` pushes the normal ring entry and synchronously publishes the typed signal;
listener failures cannot prevent the entry or other listeners. The `onButton` callback verifies
the overlay id equals the active step id, calls `logGuideButton(elementName, label, stepId,
"ui.guide.step")`, and the waiter matches both `signal.stepId` and `signal.elementName`.

Each new logical step receives a unique id such as `ui-guide-step-<counter>`, which is used as
the overlay id and event correlation id. A retry after `pending` for the same element reuses that
id, so the shipped overlay replaces the card rather than stacking it. A second call while a
previous step is actively waiting allocates a new id, clears the old guide highlight, and settles
the abandoned wait as `{ superseded: true, elementName: oldElementName }`; it never hangs.

Subscribe and arm the timer before drawing so an immediate click cannot win a race. Never resolve
from `EventLog.unseen(cursor)`, generic `EventLog.subscribe()`, or any event merely newer than the
MCP cursor. Unrelated dialog, board, navigation, and guide events must not complete this step.

On a match, clean up and return exactly `{ pressed: label, elementName }`. Escape and any other
external clear dismiss the card without invoking `onButton`, so the step remains waiting; do not
add a disappearance poll. At the bound, clean up and return
`{ pending: true, waitedMs, elementName, message }`, where `message` says both that the card may
have been dismissed without a button press and that the agent must call
`ui.guide.step(...)` again for the same element to re-draw it in place. Use 50,000 ms by default;
clamp explicit `timeoutMs` to 110,000 ms and include the same `timeoutMs: 110000` /
`clampedFrom` metadata as `events.wait`. Do not replay an old press observed only in the event
log when a retry starts.

### 4. Carry board AiVision notify over the host-frame bridge

Change `src/ipc/board-bridge-channels.ts` with a dependency-free type and add its kind to
`BoardToHostMsg`:

```ts
export interface BoardAiVisionNotifyMsg {
    __persephone: "board:aiNotify";
    text: string;
}
```

Change `src/board-shim.ts` so `exposeAiVision()` passes `onHostSignal` to `expose()`. For a
`notify` signal in the main board view, post `{ __persephone: "board:aiNotify", text }` to the
existing authenticated host-frame target. Ignore `shape` in this callback because the wrapper's
`refresh()` already posts the full `board:aiVision` registration. Retain generation checks and
the `remote.notify(text)` delegation. Bump `persephone.version` from `"1.3.0"` to `"1.4.0"` for
the new bridge contract.

Change `src/renderer/editors/board/BoardWebview.ts` to include the message type and dispatch it
beside `board:aiVision`:

```ts
// current
case "board:aiVision":
    this.handleAiVisionRegistration(data as BoardAiVisionRegistrationMsg, model, frame);
    break;

// planned addition
case "board:aiNotify":
    this.handleAiVisionNotify(data as BoardAiVisionNotifyMsg, model, frame);
    break;
```

`handleAiVisionNotify()` requires the main frame, current iframe, trusted board, and the existing
outer origin/source checks. Obtain `model.page?.id` and use
`pages[${JSON.stringify(pageId)}].editor.app`; drop if no owning page id. Require a runtime string,
collapse whitespace to one space, trim, drop empty text, and truncate to 512 characters as the
first 509 characters plus `...`.

Use an aggregate module-scope limiter shared by all `BoardWebview` instances in the renderer:
at most 5 accepted board notifications in each rolling 60,000 ms. Rejected notifications create
no event. This is 2.5% of the 200-entry ring per minute at most and protects host/dialog/navigation
events even when several board frames are mounted. Then call the US-1398-compatible
`logRemoteNotify(text, path, "board")`.

### 5. Preserve delivery and verify existing wiring

The new producers push the existing renderer `EventLog`, so `resolveWithAttention()` and the
existing events block deliver them to every MCP session by its own cursor. The guide's local
signal, not that cursor, controls completion. Do not change `call-tools.ts`, `events.ts`,
`attention.ts`, `root.ts`, or cursor plumbing. Do not route AiVision notify through
`src/main/board-bridge.ts` or the existing toast endpoint.

`ui.guide.end()` is a post-step cleanup operation: after `step` returns from a press, timeout, or
supersession, a later `end()` clears the guide overlay and returns `{ ended: true }`. It is not a
second channel that can rescue a `step` call currently blocked in the same MCP client, because
that client issues one call at a time; a blocked step must return `pending` at its bound before
the agent can call `end()`.

The gate's button action is directly addressable without an accessibility ref. The exact logical
sequence is: start `call({ path: "ui.guide.step", args: ["persephone-menu", "This opens the Menu Bar."] })`;
while it is blocked, issue from a second MCP session or the gate harness
`call({ path: "window.screen.click", args: ["[data-name=\\"ai-vision-highlight-button-next\\"]"] })`;
and assert the first call returns `{ pressed: "Next", elementName: "persephone-menu" }`.
This works because `src/renderer/api/window-screen.ts` delegates to
`src/renderer/automation/operations.ts`, where a string locator is passed to
`document.querySelector()` and `.click()`; only an object `{ ref: "..." }` requires a ref from
`window.screen.snapshot()`.

No tests or test harnesses are added. The EPIC-099 gate will verify overlay clicks, stale-event
rejection, supersession, retry idempotence, cross-session event delivery, board origin/path,
sanitization, trust rejection, and rate limiting.

## Concerns

- The local `GuideButtonSignal` is necessary because the installed `IAiEvent` has no correlation
  field; do not encode a step id into the public event path or make generic `events.wait()` infer it.
- Subscribe before drawing and clean up on press, pending, supersession, end, missing target, and
  draw failure. A pending card remains visible for a same-element retry; a later press is still
  logged but is not replayed by the retry.
- Escape and any external `clear()` can dismiss the card without a button event. The honest result
  is to keep waiting until the 50,000/110,000 ms bound and tell the agent that dismissal may have
  happened and that a same-element `step` redraws the card; do not poll for overlay disappearance.
- `ui.guide.end()` cannot rescue a blocked step in a one-call-at-a-time MCP client. It only clears
  the overlay after the step has returned, normally at the end of the walkthrough; the timeout is
  the escape from a blocked call. The later-step supersession path remains the cleanup for an
  abandoned wait that is replaced by another `step`.
- The public `app.ui.highlightElement()` options remain unchanged. The narrow helper is required
  for TypeScript even though the current spread would preserve undeclared runtime fields.
- `logRemoteNotify()` is a US-1398 overlap. Preserve the origin-aware `(text, path?, origin =
  "board")` implementation and call it with the explicit board origin.
- Trusted-board status does not make board-authored text trusted event content. The 512-character,
  one-line and aggregate five-per-minute policy remains mandatory.
- `ui.guide.end()` clears only its own id so unrelated agent highlights survive.

## Acceptance Criteria

- [ ] `ui.guide` is a persistent `node: true` child of `ui`, with its own descriptor and help;
      UI help explicitly distinguishes `elements`, `highlight`, and waiting `guide.step`.
- [ ] `step` accepts exactly the shared curated names through `createElements`' highlight
      provider, defaults to `Skip`/`Next`, validates custom buttons/options, and does not wait on
      a missing target.
- [ ] A unique per-step id is carried into the overlay id and typed press signal; only a matching
      step id plus element resolves the waiter. Press returns `{ pressed, elementName }` and logs
      a `guide-button` event for other/same sessions.
- [ ] Pending uses 50,000 ms by default, clamps explicit values at 110,000 ms, includes
      `{ pending: true, waitedMs, elementName, message }`, and tells the agent that the card may
      have been dismissed without a button and that retrying the same element re-draws it in
      place. Same-element retry after pending reuses the id and replaces the card; an active
      second step supersedes its old waiter. `end()` clears the overlay after a step returns; it
      is not an escape from a currently blocked same-client call.
- [ ] `src/renderer/api/ui.ts` passes only declaration-owned button options through an internal
      helper; public `IUserInterface` and `IHighlightOptions` are not widened.
- [ ] Existing `BLOCKING_RENDERER_PATHS` continues to give guide methods the 125 s bridge timeout;
      no global timeout change is made.
- [ ] The gate starts `call({ path: "ui.guide.step", args: ["persephone-menu", "..."] })`,
      then, while that call is blocked and from a second MCP session/harness, runs
      `call({ path: "window.screen.click", args: ["[data-name=\\"ai-vision-highlight-button-next\\"]"] })`.
      The selector is accepted directly by `window.screen.click()` via
      `document.querySelector().click()`; no `window.screen.snapshot()` ref is required.
- [ ] `remote.notify()` posts `board:aiNotify`, keeps `persephone.notify()` as a toast, and
      bumps the shim bridge version to `1.4.0`.
- [ ] Only a trusted current main board frame is accepted; text is one line, max 512 characters,
      origin-labelled `board`, stored at `pages["<id>"].editor.app`, and limited to 5 accepted
      board notifications per rolling 60,000 ms per renderer window.
- [ ] The board call integrates with US-1398's origin-aware `logRemoteNotify` without clobbering
      page-origin logging. No tests, dependency changes, or commits are added.

### Files that need NO changes

| File/area | Reason |
|---|---|
| `src/main/mcp/tools/call-tools.ts` | Both guide paths are already in `BLOCKING_RENDERER_PATHS` and already use 125 s. |
| `src/renderer/scripting/ai-vision/namespaces/events.ts`, `attention.ts`, `root.ts`, `call.ts` | US-1397 already owns generic event waiting, cursor transport, and event-block delivery. |
| `src/renderer/scripting/ai-vision/namespaces/index.ts` | The guide is provided by the already registered `ui` descriptor. |
| `src/renderer/api/types/ui.d.ts` | Guide is an AiVision descriptor-only member; public script API must not gain callbacks/buttons. |
| `src/main/board-bridge.ts`, `src/renderer/api/internal/RendererEventsService.ts` | The existing MessagePort `persephone.notify()` toast path is separate. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Existing registration and trust context suffice; notify is handled by `BoardWebview`. |
| `node_modules/ai-vision`, `package.json`, `package-lock.json` | The required 1.1.0 overlay/remote contract is already installed. |
| `src/renderer/api/events/` | Unrelated `EventChannel` system. |
| Tests/test harnesses | Explicitly out of scope. |
| `doc/active-work.md`, `doc/epics/EPIC-099.md` | The task is already linked under the active epic. |

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/scripting/ai-vision/namespaces/ui-elements.ts` | New shared export of the existing curated shell declarations. |
| `src/renderer/scripting/ai-vision/namespaces/ui-guide.ts` | New persistent guide descriptor, correlated wait, buttons, retry, supersession, and end. |
| `src/renderer/scripting/ai-vision/namespaces/ui.ts` | Shared declarations, guide member/provider, and discovery prose. |
| `src/renderer/api/ui.ts` | Narrow declaration-owned helper for overlay `id`, `buttons`, and `onButton`. |
| `src/renderer/scripting/ai-vision/event-log.ts` | Correlated guide-button signal seam and origin-aware notify integration. |
| `src/ipc/board-bridge-channels.ts` | New dependency-free `board:aiNotify` message type/union. |
| `src/board-shim.ts` | AiVision notify host-signal transport and `persephone.version` `1.4.0`. |
| `src/renderer/editors/board/BoardWebview.ts` | Trusted notify dispatch, normalization, length cap, rate limit, page path, and event logging. |
