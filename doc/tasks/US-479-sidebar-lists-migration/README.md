# US-479: Sidebar lists — UIKit migration

## Status

**Placeholder** — full investigation, audit table, and implementation plan will be written when this task is picked up. Per [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration loop.

## Goal

Migrate the four sidebar list surfaces to UIKit primitives, primarily on top of `ListBox` (delivered in US-468):

- `src/renderer/ui/sidebar/FileList.tsx`
- `src/renderer/ui/sidebar/OpenTabsList.tsx`
- `src/renderer/ui/sidebar/RecentFileList.tsx`
- `src/renderer/ui/sidebar/FolderItem.tsx`

After this task, all four files contain zero `@emotion/styled` imports, zero `style={...}`, zero `className={...}` (Rule 7), and use `data-type` / `data-*` for selected / active / hover state (Rule 1).

## Notes

- Bundled because all four share the same row-list shape — single audit pass picks up shared drift / shared UIKit gaps.
- Likely audit findings: row hover/active styling, icon slot, badge for unsaved state, context menu trigger.
- Trait integration (Design Decision #9): list items should be passed as `Traited<T[]>` if the upstream data shape doesn't already match the ListBox item interface.
- If the audit reveals one of the four needs a meaningfully different layout, split that one into its own follow-up task rather than forcing it into the shared rewrite.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Depends on: US-468 (UIKit ListBox — done)
