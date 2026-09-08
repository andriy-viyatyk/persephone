# EPIC-099: The agent event channel — what changed since the agent last looked

## Status

**Status:** Active
**Created:** 2026-09-08

Follows the [AiVision library roadmap](../ai-vision-library-roadmap.md), whose closing note recorded
three unexplored ideas from `scratches/ai-vision-prior-art-and-events.md`. This epic implements two
of them — a shape-change signal from mounted remote trees, and a blocking `ui.guide.step` for user
walkthroughs — on top of one new mechanism: a host-side event log the agent reads by side effect on
every `call`.

Depends on [EPIC-096](EPIC-096.md) (the published `ai-vision` package), [EPIC-097](EPIC-097.md)
(Persephone consumes it and mounts remote trees at `pages[i].editor.app`) and
[EPIC-098](EPIC-098.md) (the todo board is the proving board for a board-side `refresh()`).

## Overview

`attention` (EPIC-084) answers *what blocks the agent right now*. Nothing answers *what changed
since the agent last looked*. Three concrete gaps follow from that:

1. A browser page whose model changes without navigating — an SPA route change, a lazily loaded
   screen, a `remote.refresh()` — leaves the host's cached shape stale until the next navigation.
2. A guided walkthrough is impossible: the agent can draw a highlight with a **Next** / **Skip**
   card, but has no way to learn which button the user pressed.
3. Anything the user did between two of the agent's calls — answered a dialog, reloaded a board —
   is invisible unless the agent happens to re-read the exact state it touched.

The answer is one **event log per window**, read by side effect on every `call`, plus one blocking
wait. `events` is a **sibling of `attention`, not a replacement**: `attention` stays a snapshot of
blocking UI; `events` is a cursor over history. Nothing pushes to the agent, and nothing depends on
an MCP client surfacing server notifications to the model — no client does today.

## Goals

- One `EventLog` per renderer window, capped ring, entries `{ seq, time, kind, path?, text, origin }`.
- Every `call` result carries an `events` block with the **newest three unseen** entries and a
  `+N earlier events` count line, advancing a **per-MCP-session** cursor so nothing is shown twice.
- An `events` node: `recent(limit = 50)`, `since(seq)`, `count`, and `wait(timeoutMs?)` — the
  long-poll, bounded safely under every client's tool-call timeout.
- A mounted remote tree signals a shape change: a board's `refresh()` registration and a browser
  page's `refresh()` through a CDP `Runtime.addBinding` function, plus lazy revalidation as the
  correctness floor.
- `ui.guide.step(elementName, message, { buttons? })` and `ui.guide.end()` — highlight with
  Skip / Next, wait, return the pressed button. The primitive a weak model handles best: one call
  per step.
- The library grows the shared parts (`IAiEvent`, `EventLog`, `ICallResult.events`, proxy
  `revalidate`, remote `version` / change callback / `notify`, overlay buttons) in an additive
  **`ai-vision@1.1.0`**; `schemaVersion` stays 1.

## Confirmed decisions

**D1 — "unseen" is per MCP session, not global.** *(User decision, 2026-09-08.)* The cursor lives
in the main process beside the existing per-session `seenKinds` closure in
`src/main/mcp/tools/call-tools.ts` — one `McpServer` per MCP session, one factory run per server,
so that closure already *is* the per-session state. Two agents connected at once each see their own
unseen set; an event caused by session A is still news to session B. The log itself is shared and
per-window; only the cursor is per session.

**D2 — the three events shown on a result are the newest three, not the oldest.**
*(User decision, 2026-09-08.)* When more than three are unseen, the older ones are summarized by a
count line (`+5 earlier events; read events.recent()`), because the newest is what the agent must
react to and the earlier ones are recoverable by an explicit read. The cursor then advances to the
newest, so the same entry is never shown twice.

**D3 — `+N` counts unseen entries only**, not everything since the session began. Proposed in the
scratch note, confirmed here: the block answers "what have you not seen", and a count of already-
delivered entries would grow without bound and mean nothing.

## Investigation results (2026-09-08)

### I1 — Client MCP tool-call timeouts, and the size of `events.wait`

Documented values, not measured — the brief's preferred route.

| Client | Setting | Default | Configurable |
|---|---|---|---|
| Claude Code | `MCP_TOOL_TIMEOUT` (per tool call) | ~28 h when unset; values under 1000 ms ignored | env var globally; `timeout` per server in `.mcp.json` |
| Claude Code | `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (aborts a stalled call) | **5 min** for HTTP/SSE/WebSocket; 30 min for stdio | env var (v2.1.187+) |
| Claude Code | `MCP_TIMEOUT` | server **startup** only — not the call bound | env var |
| Codex CLI | `mcp_servers.<name>.tool_timeout_sec` | **120 s** (300 s in recent builds) | `config.toml` per server |

Persephone registers as an **HTTP** server (`.mcp.json` → `http://localhost:7865/mcp`), so the
binding Claude Code limit is the 5-minute idle timeout, not the 28-hour call timeout. The tightest
bound across the two clients is **Codex's 120 s**.

**Sizing decision:** `events.wait()` defaults to a **50 s** bound and accepts an explicit
`timeoutMs` **capped at 110 s** (clamped, with the clamp reported). 50 s is under half of the
tightest client bound and an order of magnitude under Claude Code's idle timeout, so a `pending`
return is always the host's decision and never the client's abort. On timeout it returns
`{ pending: true, waitedMs }` with a hint saying to call `events.wait()` again — the agent's loop is
explicit and restartable, which is what a weak model handles.

### I2 — CDP `Runtime.addBinding` in a Persephone browser webview: **works**

Spiked live against the running dev app through `main.script.execute` on the browser webview hosting
the library's `examples/demo-page`. Verified, in order:

1. `Runtime.enable` then `Runtime.addBinding { name: "__aiVisionHostChanged" }` →
   `typeof window.__aiVisionHostChanged` in the page is `"function"`.
2. The page calling it delivers `Runtime.bindingCalled` to the host with the payload intact:
   `{ executionContextId: 1, name: "__aiVisionHostChanged", payload: "{\"v\":7,\"why\":\"refresh\"}" }`,
   `sessionId: ""` (a browser webview is its own `WebContents`; no flattened session needed, unlike
   a board frame).
3. **The binding survives a reload.** After `wc.reload()` the function is present in the new
   execution context (`executionContextId: 3`) and still fires. So it is installed once per
   `WebContents`, not once per navigation — and re-adding it on each probe is harmless anyway.

**The gap it exposes — this is the real work item.** `src/main/cdp-service.ts` has **no CDP event
path to the renderer at all**: it exposes `cdpAttach` / `cdpDetach` / `cdpSend` (request/response
over `ipcMain.handle`) and never subscribes to `wc.debugger.on("message", …)`. Every CDP consumer in
the renderer today is call/response. This epic therefore adds:

- a `wc.debugger.on("message")` subscription in `cdp-service.ts`, **filtered to
  `Runtime.bindingCalled` for the AiVision binding name only** — `Runtime.enable` also delivers
  `Runtime.consoleAPICalled` and `Runtime.executionContextCreated`, which must not cross the IPC
  boundary;
- one new main → renderer event on the browser IPC channel carrying `{ registrationKey, payload }`;
- installation of the binding at attach time, keyed to the `WebContents`, and removal on detach.

**Fallback if it regresses:** lazy revalidation alone (layer 1 below) is correct without any event;
the binding only makes the change *visible* rather than *discovered on next use*. It does not
regress — it is verified — so both layers ship.

### I3 — Why not MCP notifications, elicitation, or subscriptions

Recorded so the question is not reopened. MCP has `notifications/message`,
`notifications/resources/updated` and `notifications/tools/list_changed`, plus server-initiated
sampling and elicitation. Whether any of them reaches **the model mid-turn** is the client's choice,
and no current client turns a notification into a model turn. Elicitation would draw client-native
UI, which takes the user's eyes off the highlighted control and defeats a walkthrough. The design
below needs no client cooperation; if a client later surfaces notifications, the same entries can be
emitted as notifications with no change to the object model.

## Design

### The log

One `EventLog` per renderer window, in memory, dropped on window close. Cap **200** entries (100 is
the floor). Each entry:

```ts
interface IAiEvent {
    readonly seq: number;       // monotonic within the window, never reused
    readonly time: string;      // ISO timestamp
    readonly kind: string;      // "shape-changed" | "board-reloaded" | "navigated" | "guide-button" | "dialog-answered" | "remote-notify"
    readonly path?: string;     // the object-model path the event is about
    readonly text: string;      // one line for the agent
    readonly origin: "persephone" | "board" | "page";
}
```

`origin` carries the EPIC-097 page-origin labelling: text written by an untrusted remote is labelled
as such and is rate-limited.

### Producers (the minimal first set)

| Producer | Kind | Where |
|---|---|---|
| A remote tree registered or re-registered its shape (board `reason: "refresh"`, browser-page binding) | `shape-changed` | board registration handling; the new CDP binding path |
| A board reloaded | `board-reloaded` | `BoardEditorModel.reload()` / re-registration |
| A browser page the agent has touched navigated | `navigated` | `BrowserWebviewModel` navigation handling, only for tabs the agent used |
| The user pressed an overlay button (Skip / Next) | `guide-button` | the library overlay's pressed-button callback |
| The user answered a dialog | `dialog-answered` | the dialog resolution path `attention` already watches |
| A board called `notify(text)` | `remote-notify` | a new shim message, origin-stamped `board` |

### Delivery on every call

Main sends the session's cursor with each forwarded call (beside `seenKinds`); the renderer returns
the entries newer than it, and the result carries an `events` block:

```
Events since your last call:
  [seq 41] A web page you are driving changed its model; re-read pages["…"].editor.app.
  [seq 42] The user pressed "next" on the guided step for "settings-theme".
  [seq 43] …
+5 earlier events; read events.recent().
```

The cursor advances to the newest delivered `seq`. A session whose cursor fell off the ring tail
gets one extra line — `older events were dropped` — and then the newest three.

`main` and `guides` paths are resolved locally in the main process and never reach a renderer; the
`events` block is attached only to forwarded (renderer) calls, and the block is omitted entirely
when nothing is unseen.

### Explicit reads and the wait

`events` node at the renderer root:

- `events.recent(limit = 50)` — newest first, with `seq`.
- `events.since(seq)` — a precise slice.
- `events.count` — how many the ring holds.
- `events.wait(timeoutMs?)` — resolves on the first entry newer than the caller's cursor, or
  returns `{ pending: true }` at the bound (I1: default 50 s, clamp 110 s).

### Browser-page shape signal — two layers, both

1. **Lazy revalidation (the correctness floor).** `createRemoteProxy` gains
   `revalidate?: () => Promise<boolean>`; the browser facade's implementation reads the page's
   `window.__aiVision.version` with one CDP evaluate before a remote request and rebuilds the proxy
   when it moved. Correct with no events at all.
2. **The binding (the signal).** `Runtime.addBinding` per I2; the library's `refresh()` calls the
   host callback when the page published one; `Runtime.bindingCalled` writes the `shape-changed`
   entry. Boards already send `reason: "refresh"`; they only need to log.

### `ui.guide`

Built entirely on the two primitives above:

- `ui.guide.step(elementName, message, { buttons? })` — highlight the named shell element with a
  card carrying the buttons (default `["Skip", "Next"]`), then `events.wait`. Returns
  `{ pressed: "next" }`, or `{ pending: true }` under the bound with a hint to call `step` again for
  the same element (idempotent: reusing the element's highlight id replaces rather than stacks).
- `ui.guide.end()` — clear the overlay.

### Library vs Persephone

Per the scratch note's split section. **Library (`1.1.0`, additive, `schemaVersion` unchanged):**
core `IAiEvent` + `EventLog` (cap, cursor slicing, the newest-3-plus-count **formatter — the wording
lives here**), `ICallResult.events?`, `createRemoteProxy` `revalidate`; remote `version` counter
bumped by `refresh()`, an optional host change callback invoked by `refresh()`, `notify(text)` on the
handle; dom overlay configurable buttons and a pressed-button callback. README section per item.
Release, confirm on npm, then bump Persephone's dependency — the EPIC-097 order.

**Persephone:** the per-window `EventLog` instance, every producer, the per-session cursor in main,
the `events` node, the `ui.guide` node, the CDP binding plumbing, and the shim message carrying a
board's `notify`.

## Not doing

- Agent subscriptions or MCP notifications (I3).
- Merging events into `attention` — the two answer different questions.
- Pushing to sessions that are not calling.
- Letting a page write arbitrary entries without the origin label and a rate limit.
- Section 2 items 1 (next-action hints), 2 (defer/budget signal) and 4 (one-hop `_links`) of the
  scratch note: out of scope for this epic.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1396 | `ai-vision@1.1.0`: `EventLog`, `ICallResult.events`, proxy `revalidate`, remote `version` / change callback / `notify`, overlay buttons | Planned |
| US-1397 | The event log, its producers, the per-session cursor, and the `events` block on every result | Planned |
| US-1398 | Browser-page shape signal: lazy revalidation and the CDP `Runtime.addBinding` path | Planned |
| US-1399 | `ui.guide.step` / `ui.guide.end`, and a board's `notify` over the shim | Planned |
| US-1400 | Guides, What's New, and the gate (`qa/surfaces/` page + `qa/runs/` entry, mechanical and weak-agent) | Planned |

## Gate

A new `qa/surfaces/` page and a `qa/runs/2026-09-08-epic-099-events.md` run over MCP `call`:

- an event appears on the next call of a session that did **not** cause it, and not again after;
- two sessions see independent unseen sets;
- `+N` counts unseen only;
- `recent` / `since` / `count` agree with the ring;
- `wait` returns on a new event, and returns `pending` at the bound;
- a board `refresh()` and a demo-page `refresh()` each yield a `shape-changed` event and the proxy
  then serves the new shape;
- a `ui.guide.step` highlight with Next / Skip returns the pressed button (pressed through
  `window.screen.click` on the overlay button);
- a board `notify` arrives origin-labelled.

Then the **weak-agent walkthrough test**: one `haiku` subagent with only the `call` tool, asked to
walk the user through the Settings page, three controls, one at a time, waiting for the user to
press Next. Judged on whether it reached `ui.guide.step` and `events` from hints alone. Up to three
iterations; each iteration's failure and the descriptor text that fixed it is the evidence.
