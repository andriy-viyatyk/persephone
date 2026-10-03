# US-1612: Quieter page-model events

**Epic:** [EPIC-120](../../epics/EPIC-120.md) · from the [US-1603 report](../US-1603-outlook-poc/README.md#changes-us-1604-onward-need), items 4 and 5

## Goal

Stop two events that tell an agent to re-read a model when nothing it can see has changed:
- `shape-changed`, logged when a `refresh()` published the same shape;
- `navigated`, logged for a same-document navigation in a browser tab whose model is live.

## Background

Agents read these events from `events.wait()`. Each one asks the agent to re-read a path, so a
false event costs a call and, on a long-running page, crowds out real events (the event log
holds 200 entries; `src/renderer/scripting/ai-vision/event-log.ts`).

### Shape-changed, browser pages

- `BrowserWebviewModel.handleAiVisionSignal()` (`src/renderer/editors/browser/BrowserWebviewModel.ts`,
  the `signal.type === "shape"` branch) handles a `refresh()` signal like this:
  1. it returns early when `registration.version === signal.version`;
  2. otherwise it calls `logBrowserShapeChanged(pageId)` straight away;
  3. then it calls `reprobeAiVision()`.
- The remote's `version` goes up on every `refresh()` (`node_modules/ai-vision/dist/remote/expose.js`),
  so step 1 never matches and every `refresh()` logs an event. The Outlook PoC logged two for a
  single search.
- `reprobeAiVision()` clears the registration, which advances the generation, then calls
  `probeAiVision()`. The probe registers the new shape through `setAiVisionRegistration()`.
- `IAiVisionShape` (`node_modules/ai-vision/dist/core/remote-types.d.ts`) holds `schemaVersion` and
  `root`, and no version. Two equal shapes therefore serialize to equal JSON. `probeAiVision()`
  already uses `JSON.stringify(current.shape) === JSON.stringify(probe.shape)` to skip a duplicate
  registration.

### Shape-changed, boards

- `BoardWebview.handleAiVisionRegistration()` (`src/renderer/editors/board/BoardWebview.ts`) calls
  `logShapeChanged(pageId)` for every accepted registration whose `reason === "refresh"`.
- The previous shape is still available before the new one is stored:
  `BoardEditorModel.getAiVisionRegistration()?.shape` (`src/renderer/editors/board/BoardEditorModel.ts`).

### Navigated, browser pages

- `handleBrowserEvent()` treats the two navigation events differently:
  - `did-navigate`, a new document, clears the registration and logs `logBrowserNavigated()` when
    the tab was ever registered (`hasAiVisionRegisteredTab`). This stays.
  - `did-navigate-in-page`, a same-document change such as an SPA route or opening a message,
    logs `navigated` whenever the tab was ever registered, even while its model is live.
- With a live model, the model is the agent's view of the page. It refreshes itself through
  `refresh()`, and the host checks the remote's version before every request, so a same-document
  route change needs no event. Without a live model (the model is gone, or the agent works through
  snapshots after a model once existed), the event is still useful.

## Implementation plan

- [x] **Browser shape-changed: compare, then log.** In `BrowserWebviewModel`:
  1. In `handleAiVisionSignal()`'s shape branch, drop the immediate `logBrowserShapeChanged()`.
     Before calling `reprobeAiVision()`, remember the old shape for that tab in a new
     `pendingShapeComparisons: Map<internalTabId, { generation: number; shape: string }>`. Store
     `JSON.stringify(registration.shape)` and the generation the probe will run at, which is the
     registration's generation + 1, because the clear advances it.
  2. In `probeAiVision()`, after a successful `setAiVisionRegistration(...)`: if a pending
     comparison for this tab matches the probe's `generation`, delete it, and log
     `logBrowserShapeChanged(pageId)` only when the serialized new shape differs from the
     remembered one.
  3. If the probe finds no model (the `typeof serialized !== "string"` branch) while a comparison
     is pending for that generation, delete it and log `logBrowserShapeChanged(pageId)`. The model
     going away is a real change.
  4. Delete the tab's pending entry on `did-navigate`, `did-start-loading` and in
     `disposeIpcHandler()`. A navigation is reported by its own event.
- [x] **Board shape-changed: compare, then log.** In `BoardWebview.handleAiVisionRegistration()`,
  read `model.getAiVisionRegistration()?.shape` before `model.setAiVisionRegistration(...)`. Log
  `logShapeChanged(pageId)` for an accepted refresh only when
  `JSON.stringify(previous) !== JSON.stringify(message.shape)`. Registration, token and proxy
  rebuild behaviour stay exactly as they are: only the event becomes conditional.
- [x] **Browser navigated: skip same-document navigation under a live model.** In the
  `did-navigate-in-page` case, log `logBrowserNavigated()` only when the tab was ever registered
  and `this.model.getAiVisionRegistration(internalTabId)` is currently undefined. The
  `did-navigate` case is unchanged.
- [x] **Docs.**
  - `assets/guides/agents/events.md`: if it describes when `shape-changed` and `navigated` fire,
    update it to say that an identical refresh logs nothing, and that a same-document navigation
    under a live model logs nothing.
  - `assets/guides/agents/ai-vision.md`: the board `refresh()` section says "the host logs a
    `shape-changed` event each time"; reword it to "each time the shape actually changes".

## Concerns / Open questions

- **A model whose shape is identical but whose values changed.** Values are read live through the
  proxy on every request, so the agent needs no event for them. A page that wants to announce new
  data uses `notify(text)` (documented in US-1607).
- **Pending comparison and a newer reprobe.** Two quick `refresh()` signals: the second
  `reprobeAiVision()` returns early because the registration's token no longer matches (it was
  cleared). The pending entry for the first probe stays keyed to that probe's generation, so it
  cannot be mis-applied to a later one.
- **Shape size.** Both shapes are already bounded by `MAX_AI_VISION_SHAPE_BYTES` before
  registration, so the string comparison is cheap.

## Acceptance criteria

- Calling `remote.refresh()` with an unchanged shape on a browser page or a board logs no
  `shape-changed` event. A refresh that changes the shape, such as a collection becoming non-empty,
  still logs exactly one.
- A same-document navigation in a browser tab with a live model logs no `navigated` event. A full
  navigation still logs one, and a same-document navigation in a tab whose model is gone still
  logs one.
- `npm run typecheck`, `npm run lint` and `npm run build-prod` pass. Live check through MCP
  `events.wait()` with a test site extension on example.com (needs the user's Trust click) and with
  a board.

## Files changed summary

| File | Change |
|---|---|
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Pending shape comparison; conditional `shape-changed`; `navigated` skipped for an in-page navigation under a live model. |
| `src/renderer/editors/board/BoardWebview.ts` | `shape-changed` only when the refreshed shape differs. |
| `assets/guides/agents/events.md`, `assets/guides/agents/ai-vision.md` | Event wording. |
| `src/renderer/scripting/ai-vision/event-log.ts` | **No change.** The loggers stay; only their callers change. |
| `src/renderer/editors/board/BoardEditorModel.ts` | **No change.** `getAiVisionRegistration()` already exposes the previous shape. |

## Verification (2026-10-03, live through MCP `events.recent`)

The test site extension `test-events` on example.com was trusted by the user. Its model has
three methods: `same()` refreshes with an identical shape, `grow()` adds a member and refreshes,
and `nav()` calls `history.pushState`.

- Three `same()` calls logged **no** events. Before this change they logged three.
- `grow()` logged exactly **one** `shape-changed`.
- `pushState`, through `evaluate()` and through the model's `nav()`, under a live model logged
  **no** `navigated`.
- With the model disposed (`__persephoneSiteRuntime.dispose()`), the next in-page navigation
  logged **one** `navigated`.
- `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.
- **Not live-tested:** the board change. It mirrors the browser comparison, compares the previous
  registration's shape with the incoming one, and leaves registration itself unchanged.

### Finding during verification

Chromium fires `did-start-loading` for a same-document `pushState` too, and that handler clears
the registration *before* `did-navigate-in-page` arrives. So "is the model live right now" was
always false at that point, and the first version of the fix still logged `navigated`. A debug
capture confirmed the order: `start-loading` with a live registration, then `navigate-in-page`
with none. The fix records `liveModelAtLoadStart` per tab in `did-start-loading`. It is cleared on
`did-navigate` and on dispose. `did-navigate-in-page` treats the model as live if it is registered
now or was registered when that load started.
