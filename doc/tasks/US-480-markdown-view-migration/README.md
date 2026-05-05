# US-480: MarkdownView — UIKit migration

## Status

**Placeholder** — full investigation, audit table, and implementation plan will be written when this task is picked up. Per [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration loop.

## Goal

Migrate `src/renderer/editors/markdown/MarkdownView.tsx` (markdown preview chrome) to UIKit primitives — `Panel`, `IconButton`, `Text`, plus any small UIKit extensions identified during audit.

The find bar for this view was already migrated in US-461 (shared `FindBar`). This task covers the surrounding scroll container, action chrome, and any view-specific overlays.

After this task, the file contains zero `@emotion/styled` imports, zero `style={...}`, zero `className={...}` (Rule 7), and uses `data-type` / `data-*` for state (Rule 1).

## Notes

- The rendered markdown body itself comes from a third-party renderer (e.g. `react-markdown` or similar) — that internal HTML stays as-is. Only the surrounding chrome migrates.
- Code blocks inside the rendered markdown go through `ColorizedCode` (`editors/shared/`); confirm during audit that this path is unaffected.
- Likely UIKit needs: scroll container Panel with `overflow="auto"`, possibly a `whiteSpace` setting on inner code panes (already added in US-462).

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related precedents: US-461 (Shared FindBar — find bar already lifted out)
