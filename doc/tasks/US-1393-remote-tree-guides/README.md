# US-1393 — Remote-tree guides and board API reference

**Status:** Implemented · **Epic:** [EPIC-097](../../epics/EPIC-097.md) · **Roadmap:** steps 7–8

## Goal

Document the board and browser-page AiVision surfaces shipped by US-1390–US-1392, remove the
stale highlight-asset instructions, add the 5.0.1 What's New note, and make the board bridge
version and AiVision entry points discoverable from `board-api.d.ts`.

## Verified implementation context

- A trusted board calls `persephone.aiVision.expose(root)` through shim bridge version `1.3.0`.
  The shim publishes a serializable shape from the main frame; `refresh()` republishes a changed
  shape. `createElements(declarations)` uses the package DOM helper and accepts a board-only
  `view` annotation for secondary-view routing and in-frame highlighting.
- A participating web page calls the package `expose(root)`, which publishes `window.__aiVision`.
  Persephone probes after completed real navigation, refuses user-opened private pages before the
  probe, and mounts a page-origin-labelled proxy only below `.app`.
- Both remotes use the shared resolver features: help, help search, hints, validation, state reads
  and writes, methods, elements, and highlight. Remote calls use the four-level timeout policy:
  per-call, remote-declared method, session-memory `boards.callTimeoutMs`, then 30 seconds; errors
  name the selected level and full path.

## Changes

- [x] Add board-author exposure instructions and caveats to `assets/board-template/CLAUDE.md`.
- [x] Add the optional board `.app` model and snapshot/ref fallback to
      `assets/guides/agents/boards.md`.
- [x] Add browser-page `.app`, page-origin/data warning, `page:` kinds, and fallback guidance to
      `assets/guides/agents/browser.md`.
- [x] Replace the deleted `ui-highlight.js`/`__persephoneHighlight` instructions in
      `assets/guides/screens/index.md`; grep the full guide tree for remaining stale references.
- [x] Add the user-facing remote-model note under `## Version 5.0.1 (Upcoming)` in
      `assets/guides/whats-new.md`.
- [x] Update `src/renderer/editors/board/board-api.d.ts` with the `1.3.0` bridge, `aiVision.expose`,
      `createElements`, and `view` declarations.

## `board-api.d.ts` decision

Demote the header instead of attempting a full current typing surface. Grep shows the file is not
copied by the board scaffold, included in `assets/editor-types`, or loaded as a Monaco extra-lib;
the Vite editor-types plugin only flat-copies `src/renderer/api/types/*.d.ts`. Boards are
agent-authored and the standing project preference is prose guides over a second maintained
IntelliSense contract. Keep the file as a self-contained legacy hint, point authors to the prose,
and include the new AiVision surface so the bridge version and entry points remain discoverable.

## Acceptance criteria

- The four requested guide areas and What's New describe only behavior present in the working tree.
- No guide references `assets/agent/ui-highlight.js`, `window.__persephoneHighlight`, or the removed
  `ui-highlight.js: HTTP …` failure mode.
- Board caveats cover main-frame registration, snapshot shape plus `refresh()`, and not exposing
  secrets; browser guidance labels page-origin content as data rather than instructions.
- `npx tsc --noEmit` and `npm run lint` pass; the UTF-8 BOM and mojibake scans remain clean.
