# `src/renderer/components/` — KEEP-only folder

This folder holds **persephone-coupled components only**. Each remaining sub-folder depends on `app.*` APIs, the page model, the file system, or the scripting system — that's the criterion for living here.

**New reusable primitives do NOT go here.** They go in [`src/renderer/uikit/`](../uikit/CLAUDE.md).

Remaining folders:
- `icons/` — uses Persephone's icon registration system
- `page-manager/` — coupled to `PageModel` lifecycle
- `file-search/` — uses `app.fs`
- `tree-provider/` — coupled to `ITreeProvider` contracts; holds both the tree (`TreeProviderView`) and the folder page it navigates to (`CategoryView`), plus the plural / drop actions they share
- `file-list/` — single-column flat file list (icons + single-click, title search, selected-path highlight, per-item menu, trailing slot) built on `ListBox` + `FileIcon`; used by the Recent files panel and the Git Tree commit diff file list
- `file-grid/` — `DataGrid`/av-grid-based flat file list (icon / path / status columns, header-as-label, sorting, range selection + range-copy, single/double click, context-menu passthrough); built on `DataGrid` + `FileIcon`. Used by the Git Tree "Changes" panel. Kept beside `file-list/` on purpose (EPIC-173): a header, cell focus and sorting suit the multi-select Changes panel, not a click-to-open list. Both build row icons with `createFileRowIconElement`
- `git-tree/` — Git Tree component (`DataGrid`/av-grid + SVG branch graph) and the git data submodels (`GitTreeModel`, `GitChangesModel`)

See [`/doc/standards/uikit-vs-components-split.md`](../../../doc/standards/uikit-vs-components-split.md) for the permanent contract.
