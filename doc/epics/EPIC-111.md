# EPIC-111: Board settings

## Status

**Status:** Planned
**Created:** 2026-09-20
**Completed:** —

## Overview

Boards can persist state, but the user cannot see or change any of it. `persephone.storage`
(`board-shim.ts:1284-1287`) is a private key/value store keyed on the board root, and nothing in
`board-manifest.json` declares user-facing configuration — `board-manifest.ts` has no settings
concept at all. So a board that needs a choice from the user has three bad options: hardcode it,
hide it in storage where it cannot be changed, or ask for it in its own UI, inconsistently with
every other board and with Persephone itself.

This epic gives a board a way to **declare** settings in its manifest and have Persephone render
them in its own Settings page, storing the values in the board's existing scoped storage.

*(User decision, 2026-09-20, raised while planning the Excalidraw board's library flow: "probably
excalidraw library path should be moved to board settings, and we do not have any boards settings
for now".)*

## Why now

EPIC-109 D11 commits to the bundled Excalidraw board matching the built-in editor **from the user's
perspective** before EPIC-110 removes `editors/draw`. One gap cannot be closed inside EPIC-109:
the drawing library location is a user-visible setting today (`drawing.library-path`, consumed by
`drawLibrary.ts:29`), and when the built-in editor is deleted that setting is orphaned — it would
either remain an app-level setting serving a board, or vanish into board storage where the user can
no longer reach it.

So this epic is **a prerequisite of EPIC-110**, not an improvement that can follow it.

## Goals

- A board declares settings in `board-manifest.json`: id, type, label, description, default.
- Persephone's Settings page shows a sub-page per declaring board, grouped so boards do not crowd
  the app's own settings.
- Values persist in the board's scoped storage and are readable by the board with change
  notification.
- The Excalidraw board's library path becomes one of these, adopting the existing configured value.

## Non-goals

- Arbitrary board-authored UI inside Persephone's Settings. Boards declare typed fields; Persephone
  renders them. A board wanting a bespoke control can build it in its own page.
- Per-page or per-file settings. These are per board, like the board's storage.
- Replacing `persephone.storage`. Settings are the subset a user is meant to see; storage stays the
  place for everything else.

## Open decisions

These need resolving during epic planning, before any task document is written.

**Trust gate.** Every manifest field that Persephone *acts on* — `fileMasks`, `editorPriority`,
`capabilities` — is honored only when the board is trusted (EPIC-042), and bundled boards are
permitted by provenance (EPIC-109 D2). Settings almost certainly follow the same rule, since the
alternative is an untrusted board placing controls inside Persephone's own Settings UI. Confirm and
record it.

**Where the values live.** Board storage is keyed `sha256(normalized root)`, with bundled boards
domain-separated as `bundled:<id>` (EPIC-109 D5). The bundled keying is what makes settings survive
a reinstall to a different path, so settings should reuse it rather than introduce a second scheme.

**Migration of `drawing.library-path`.** The user has a real library at the existing location. The
Excalidraw board's setting must adopt that value rather than default fresh; a silent reset loses
what they have collected. Decide whether the app setting is migrated, read as a fallback, or left in
place and shared.

**What a type system needs to cover.** At minimum a folder path, which is what the library needs.
Resist a broad schema language on the first pass: the set of types should be driven by boards that
actually exist.

**Relationship to EPIC-106 D1.** `permissions` as disclosure rather than a security boundary has now
been parked four times (most recently EPIC-109 D8). Settings are a UI surface, not a capability, so
this epic probably does not force that question — but check rather than assume, because a settings
page is the first thing a board contributes *into Persephone's own chrome*.

## Exit criteria

1. A board declaring settings in its manifest gets a Settings sub-page, with no code change in
   Persephone for that board.
2. Values persist across restart and across a reinstall to a different path (bundled boards).
3. The board reads values and is notified of changes without a reload.
4. An untrusted board contributes no settings page (per the trust decision above).
5. The Excalidraw board's library path is configured here, and a user who had a library before the
   change still has it afterwards.

## Notes

### 2026-09-20

- Epic created from a user observation while planning EPIC-109's US-1490. Recorded as a prerequisite
  of EPIC-110 under EPIC-109 D11 (parity before removal).
