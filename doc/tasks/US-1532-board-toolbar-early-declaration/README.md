# US-1532: Board toolbar declarations made before the frame's load event are lost

**Status:** Implemented 2026-09-27, awaiting user testing. Verified live: a top-level `toolbar.set()` + `setText()` in the Torrent Viewer survived two Reload board cycles. The `content.open()`-during-parse concern is confirmed by code reading only (`handleLoad` calls `abortPendingContentOpen()`); not filed.

## Goal

A board that calls `persephone.toolbar.set()`, `toolbar.update()` or `toolbar.setText()` while its
document is still parsing (top-level script code, the natural place) must keep those controls. Today
the host clears them a moment later, so the button silently never appears.

## Background

### The defect, reproduced

The Torrent Viewer called `P.toolbar.set([...])` at the top level of its classic `app.js`. The
button did not appear. The same call made later from the automation console did appear. The board
now works around it by declaring on `window` `load` (`persephone-boards`
`boards/torrent-viewer/app.js`, the `window.addEventListener("load", ...)` block).

### Why it happens

- The shim posts toolbar messages to the host frame immediately:
  `postToolbarMessage()` (`src/board-shim.ts:552`) and `toolbar.setText()` (`src/board-shim.ts:~1471`).
- The host applies them tagged with the frame's CURRENT generation:
  `BoardWebview.onMessage` case `"board:setToolbarControls"` (`src/renderer/editors/board/BoardWebview.ts:558-566`)
  passes `this.generation` to `onToolbarSet`; `"board:setToolbarText"` (`:579-588`) does the same.
- When the iframe's `load` event fires, `handleLoad` (`BoardWebview.ts:403-414`) treats everything
  tagged with that generation as belonging to the previous document:
  `clearToolbarControlsForFrame(retiredGeneration)`, `clearToolbarTextForFrame(retiredGeneration)`,
  `onToolbarClear(retiredGeneration)`, then `this.generation++`.
- The board's top-level script runs during parsing, BEFORE the iframe `load` event. So its
  declaration is tagged with the generation that `handleLoad` retires, and is cleared.

The bundled Excalidraw board (`assets/boards/excalidraw/index.html:718`) calls `toolbar.set` from a
module script after large imports and has not been seen to lose its controls; it is timing-dependent,
not safe.

### What the order of events guarantees

In the child document, `window` `load` fires before the parent's `<iframe>` `load` event is
dispatched, and a `postMessage` sent from the child's `load` handler is delivered as a later task.
So a message the shim posts from (or after) the child's own `load` event reaches the host after
`handleLoad` has bumped the generation. Measured with the Torrent Viewer workaround: the
controls survive every Reload board.

## Implementation plan

Fix it in the shim, so every board gets it without changing its code.

1. `src/board-shim.ts` — add a load gate for host-frame toolbar messages, next to
   `postToolbarMessage` (`:552`):

   ```ts
   // Toolbar messages posted before this document's load event would be tagged with the
   // generation the host retires in `BoardWebview.handleLoad`, and cleared. Hold them until
   // `load`, then flush in order.
   let documentLoaded = document.readyState === "complete";
   const pendingToolbarMessages: object[] = [];
   if (!documentLoaded) {
       window.addEventListener("load", () => {
           documentLoaded = true;
           for (const message of pendingToolbarMessages.splice(0)) postToHost(message);
       }, { once: true });
   }

   function postToolbarMessage(message: BoardToolbarSetMsg | BoardToolbarUpdateMsg | BoardToolbarTextMsg): void {
       if (!documentLoaded) {
           pendingToolbarMessages.push(message);
           return;
       }
       postToHost(message);
   }
   ```

   where `postToHost` is the existing `try { window.parent.postMessage(message, hostPostTarget) } catch {}`.
2. Route `toolbar.setText()` (`src/board-shim.ts:~1471-1484`) through the same
   `postToolbarMessage`, so text declared early is held too. The message type for text is the
   existing `{ __persephone: "board:setToolbarText", toolbarText }` shape; add it to the parameter
   union (or type the parameter as the union of the three message interfaces from
   `src/ipc/board-bridge-channels.ts`).
3. Keep the queue in call order: `set` then `update` must replay as `set` then `update`.
4. No host change. `BoardWebview.handleLoad` keeps clearing the retired generation, which is still
   correct for a previous document's controls.
5. Docs: `assets/guides/boards.md` and `assets/guides/agents/boards.md`, where `toolbar.set` is
   documented (~line 74 in `boards.md`): state that declaring at startup is supported. Add a
   `whats-new.md` line.
6. Once this ships in a release, the Torrent Viewer's `load` workaround can be dropped when its
   `minAppVersion` reaches that release. Record that in `persephone-boards`
   `boards/torrent-viewer/CLAUDE.md`, not here.

### Files that need NO change

`BoardWebview.ts`, `BoardToolbar.ts`, `BoardToolbarControls.ts`, `BoardEditorModel.ts`
(`clearToolbarControlsForFrame` / `clearToolbarTextForFrame`), and `board-bridge-channels.ts` beyond
the optional type union.

## Concerns

- **Bridge version: no bump.** The `persephone.*` surface does not change. A board cannot detect the
  fix through `version`. Boards that must run on older apps keep a `load`-time declaration, which
  stays correct after the fix.
- **Other early host-frame messages.** `handleLoad` also runs `abortPendingContentOpen()` and
  `releaseContentResources(this.tabId, retiredGeneration)`. So a `content.open()` issued during
  parsing is probably aborted too. That is out of scope here, but verify it once during
  implementation and file it separately if confirmed. Do not widen the queue to it without a design:
  `content.open` is request/reply, and holding it changes latency.
- **A frame that never fires `load`** (a document that keeps a request pending forever) would never
  flush. The page toolbar is then empty, which is today's outcome anyway. It is acceptable, but note
  it in the shim comment.

## Acceptance criteria

1. A board that calls `persephone.toolbar.set([...])` at the top level of a classic script shows the
   controls after first open and after every Reload board.
2. `toolbar.update()` and `toolbar.setText()` called at the top level take effect, in call order.
3. Calls made after `load` behave exactly as today (no added delay).
4. Excalidraw's toolbar is unchanged.
5. `npm run typecheck`, `npm run lint`, `npm run build-prod` pass.

## Files changed

| File | Change |
|---|---|
| `src/board-shim.ts` | Load gate + ordered queue for toolbar set/update/setText |
| `assets/guides/boards.md`, `assets/guides/agents/boards.md` | Startup declaration is supported |
| `assets/guides/whats-new.md` | One line |
