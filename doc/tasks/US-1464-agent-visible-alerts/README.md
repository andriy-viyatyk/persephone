# US-1464: Agent-visible and dismissable alerts

## Goal

Give the agent a first-class way to read the toast notifications currently on screen and to dismiss
them, the way it can already see and answer dialogs. Today `app.ui` can *raise* a notification but
nothing can read or close one.

## Background

**The gap, verified 2026-09-20.** `describeUserInterface` in
`src/renderer/scripting/ai-vision/namespaces/ui.ts` exposes `confirm`, `input`, `password`,
`notify`, `textDialog`, `showProgress`, `createProgress`, `notifyProgress`, `addScreenLock`,
`highlightElement`, `clearHighlights` and the `guide` node. Every one of them writes. There is no
member that reads the alert list and none that closes an alert.

**Where alerts live.** `alertsBarModel` is a `TModel` in
`src/renderer/uikit/Notification/AlertsBar.ts:34-106`, exported through `uikit/index.ts:52`. Its
state is `{ alerts: AlertData[], height: AlertHeight }`. `AlertData`
(`src/renderer/uikit/Notification/AlertItem.ts:3-8`) is:

```ts
export interface AlertData {
    message: string;
    type: TMessageType;          // "info" | "success" | "warning" | "error"
    key: number;
    createdAt: number;
    onClose: (value?: unknown) => void;
}
```

`ui.notify()` (`src/renderer/api/ui.ts:62-63`) delegates straight to `alertsBarModel.addAlert`,
which returns a Promise resolved by `onClose(value)` — so closing an alert is what settles any
caller awaiting `ui.notify(...)`.

**Three facts that shape the design:**

1. **The list is longer than what is drawn.** `maxAlerts = 3` (`AlertsBar.ts:9`) and
   `AlertsBarView` renders `alerts.slice(0, maxAlerts)` (`:158`), but the state array holds every
   alert that has not been closed. A live session during EPIC-105 held **16**.
2. **Errors accumulate on purpose.** When the array exceeds `maxAlerts`, the eviction at
   `AlertsBar.ts:54-62` looks for a **non-error** alert to drop and removes that one. An error
   alert is therefore never evicted automatically — it stays until something calls its `onClose`.
   That is correct for a human, who clicks it away, and is exactly why an agent working
   autonomously needs to be able to clear them.
3. **They are already visible — through the wrong door.** `window.screen.snapshot()` renders each
   one as an `alert` node with a nested close `button` and a `ref`, so an agent *can* read and
   click them today. That is a full-page accessibility snapshot with no severity field, no stable
   identity, and no way to ask "are there errors?" without dumping the whole tree. This task
   replaces that workaround with a real node; it does not change the snapshot.

**The motivating incident.** While verifying US-1461, the duplicate-registration report
("Duplicate scheme registration: `"mneme"`. The existing platform registration remains active.")
fired correctly, but the agent could not confirm it and had to infer the behaviour from source.
The same session then accumulated 16 unread error toasts, discovered only by reaching into
`uikit` internals from a script. A signal the platform raises specifically to tell someone that a
registration was rejected is worth nothing if the only party acting is unable to read it.

**Precedent for the shape.** `ui.guide` is a child node provided by `describeUserInterface` via
`provide: (name) => name === "guide" ? { value: guideNode } : elements.provide(name)`
(`namespaces/ui.ts`). `describeDownloads` (`namespaces/downloads.ts`) is the model for a namespace
that mixes read properties with acting methods and carries `caution` text on the actions.

## Implementation plan

### 1. `ui.alerts` node in the ai-vision layer

- Add `src/renderer/scripting/ai-vision/namespaces/ui-alerts.ts` exporting an `alertsNode` object
  and its descriptor, following `namespaces/downloads.ts` for member declarations and
  `namespaces/ui.ts`'s `guide` handling for wiring.
- Extend `USER_INTERFACE_MEMBERS` in `namespaces/ui.ts` with
  `{ name: "alerts", kind: "property", node: true, summary: "Read and dismiss the toast notifications currently on screen." }`
  and extend its `provide` so `"alerts"` returns the node beside `"guide"`.
- Members:
  - `list()` — every alert currently held, in insertion order, as plain data:
    `{ key: number; type: "info" | "success" | "warning" | "error"; message: string; visible: boolean }`.
    `visible` is `index < maxAlerts`, so the caller can tell what the user is actually looking at.
  - `count(type?)` — number held, optionally filtered by type. Cheap "are there errors?".
  - `close(key)` — dismiss one, returning `true` when a matching alert was found.
  - `closeAll(type?)` — dismiss all, or all of one type; returns the number closed.
- **`close` must call the alert's own `onClose()`**, not splice the state array. `onClose` both
  removes the alert and resolves the promise `addAlert` returned, so a caller awaiting
  `ui.notify(...)` settles exactly as it does on a user click. Splicing would leave that promise
  pending forever.
- The node reads `alertsBarModel` directly. **Do not add agent-facing code to `uikit/`** — UIKit
  stays Persephone-agnostic per `src/renderer/uikit/CLAUDE.md`; the ai-vision layer imports the
  model, not the reverse.

### 2. Script API parity on `app.ui`

The agent reaches this through ai-vision, but a script should have the same members, as it does
for every other `ui` capability.

- Add `alerts` to `IUserInterface` in `src/renderer/api/types/ui.d.ts` with the four members above.
- Implement on the `ui` singleton in `src/renderer/api/ui.ts`.
- **Sync the flat copy**: `assets/editor-types/ui.d.ts` is a hand-maintained duplicate of
  `api/types/ui.d.ts`, fetched by `configure-monaco.ts:189-201` from the list in
  `assets/editor-types/_imports.txt`. `ui.d.ts` is already listed, so only the file contents need
  copying — but they must be copied, or script IntelliSense silently drifts.

### 3. Documentation

- `assets/guides/scripting/api/` — document the four members, the visible-versus-held distinction,
  and that closing resolves a pending `notify()` promise.
- The node's `help` text should say plainly when to use it: after an action that may have reported
  a failure, and before concluding that an operation succeeded.

## Concerns

- **Timestamp — resolved.** Adopt `createdAt: number` on `AlertData` and set it to `Date.now()` in
  `addAlert`. A timestamp is a generic, Persephone-agnostic property, so it does not violate the
  UIKit rules; it costs one line and lets an autonomous agent distinguish an error caused by its
  last action from one already on screen. `ui.alerts.list()` includes it.
- **`key` wraps — resolved.** `getAlertId()` (`AlertsBar.ts:10-14`) resets to 0 above 1,000,000,
  so keys are unique in practice but not guaranteed across a very long session. `close(key)`
  returns `false` for a missing key and never throws.
- **Promise settlement — resolved.** `close` and `closeAll` call each matching alert's own
  `onClose()` instead of splicing the state array, preserving the existing behavior that settles a
  promise awaiting `ui.notify(...)`.
- **Closing someone else's alert — resolved.** An agent clearing alerts removes information the user
  may not have read, so `closeAll()` is documented as an explicit user-serving action ("clear the
  errors I just caused"), and the members carry `caution` text like the `downloads` actions do.
- **Multi-window.** `alertsBarModel` is a module singleton per renderer, so `ui.alerts` is
  window-scoped like the rest of `ui`. Nothing to do; worth one line in the help text.
- **PII.** Alert text can contain file paths and error details. This exposes nothing that
  `window.screen.snapshot()` does not already expose to the same caller.

## Acceptance criteria

- [ ] `ui.alerts.list()` returns an empty array when no toast is on screen.
- [ ] After `ui.notify("x", "error")`, `list()` contains one entry with `type: "error"`,
      `message: "x"` and `visible: true`, and `count("error")` is 1.
- [ ] Raising five notifications shows three on screen while `list()` returns all five, with
      `visible: false` on the last two.
- [ ] `close(key)` removes that alert from the screen and returns `true`; calling it again with
      the same key returns `false`.
- [ ] A script that does `const p = ui.notify("y", "info")` and then closes that alert through
      `ui.alerts.close(key)` sees `p` resolve — the same way it resolves when the user clicks the
      close button.
- [ ] `closeAll("error")` clears every error toast and leaves other types on screen.
- [ ] The members appear under `ui` in the MCP object model with their `caution` text, and a
      script sees `app.ui.alerts.*` with working IntelliSense in a Monaco page.

## Files changed

| file | change |
|---|---|
| `src/renderer/scripting/ai-vision/namespaces/ui-alerts.ts` | New node and descriptor |
| `src/renderer/scripting/ai-vision/namespaces/ui.ts` | Declare and provide the `alerts` child node |
| `src/renderer/api/types/ui.d.ts` | `alerts` on `IUserInterface` |
| `src/renderer/api/ui.ts` | Implement `alerts` on the singleton |
| `assets/editor-types/ui.d.ts` | Hand-maintained flat copy, synced |
| `assets/guides/scripting/api/*` | Document the members |
| `src/renderer/uikit/Notification/AlertsBar.ts` | Only if `createdAt` is adopted |
