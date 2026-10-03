# US-1613: Site Extensions tab in Tools & Editors

**Epic:** [EPIC-120](../../epics/EPIC-120.md) · follow-up to [US-1605](../US-1605-site-extension-trust/README.md)

## Goal

Move the full site-extension list from the Settings page into a new **Site Extensions** tab on the
Tools & Editors hub. The Settings section becomes a short summary: how many extensions are
installed and trusted, plus an **Open site extensions** button that opens the hub on that tab.

## Background

- A user may install many extensions, one or more per site. A full list makes the Settings page
  long, and the hub already holds similar long lists: boards, tools and the board catalog.
- The hub is `src/renderer/editors/tools-hub/`:
  - `ToolsHubEditor.ts` holds `HubTab` and `VALID_HUB_TABS`, persisted in editor state;
  - `ToolsHubView.ts` builds one body view per tab;
  - `SearchBoardsTab.ts` is the pattern for a full-height tab: a toolbar with a filter input and
    refresh, then a scrolling content panel.
- `HubTab` is duplicated in `src/renderer/api/types/tools-hub-editor.d.ts`, the script type, and in
  `ToolsHubEditorFacade.ts`'s `VALID_HUB_TABS` and help text.
- `pagesModel.showToolsHubPage({ tab })` opens the singleton hub page, or reuses it, and selects the
  tab.
- US-1605's list lives in `src/renderer/editors/settings/sections/SiteExtensionsSection.ts`. Its row
  logic is reused unchanged: trust and enabled state, revoke, open folder, remove, the
  conflict, invalid and orphan details, and the reload notice.

## Implementation plan

- [x] **New tab.** Add `"site-extensions"` to `HubTab` in `ToolsHubEditor.ts`,
  `api/types/tools-hub-editor.d.ts` and the facade (`VALID_HUB_TABS`, the `setTab` summary and the
  help text). Add the "Site extensions" item to the hub's tab switcher.
- [x] **Tab view.** Create `src/renderer/editors/tools-hub/SiteExtensionsTab.ts` and `.css`, built
  from the Settings list:
  - toolbar: a description, a filter input (`site-extensions-filter`, matching name, id or host),
    refresh (`site-extensions-refresh`) and open-folder for the store root
    (`site-extensions-open-root`);
  - scrolling list; the row `data-name`s are unchanged from US-1605.
- [x] **Facade elements.** Declare `site-extensions-filter` and `site-extensions-refresh` in the
  hub facade.
- [x] **Settings summary.** Rewrite `SiteExtensionsSection.ts` to show:
  - "N installed, M trusted", plus a warning count for problems: invalid, conflict, or a trust
    left by a deleted folder;
  - the button **Open site extensions** (`site-extensions-open`), which calls
    `pagesModel.showToolsHubPage({ tab: "site-extensions" })`.

  It refreshes on trust broadcasts.
- [x] The sidebar's Tools & Editors panel is unchanged. It is narrow, and its "Open in new tab"
  maps only its own three tabs.

## Configurable folder (added 2026-10-03, at the user's request)

- **Setting `site-extensions.path`.** Empty, the default, means `<userData>/data/site-extensions`.
  `siteExtensionStore.getRoot()` reads it on every call, so a change applies at the next
  injection or list with no restart.
- **Settings section.** A folder row shows the effective path, with "(default)" when the setting
  is empty, plus **Browse...** (`site-extensions-folder-browse`) and **Use default**
  (`site-extensions-folder-reset`). A configured folder that does not exist shows a warning. The
  hub tab shows the folder path above the list (`site-extensions-tab-folder`).
- **The manifest cache is cleared on a root change.** Cached manifests hold absolute script
  paths, and a folder copied in Windows Explorer keeps its modification times. Without the clear,
  a copied extension could keep running the old folder's script.
- **Trust is bound to the folder (user decision: a folder change drops all trust).**
  - Main's `trustedSiteExtensions.json` now records `folder`.
  - The store's `getRoot()` calls `bindSiteExtensionFolder(root)` whenever the effective root
    changes, and waits for it, so no grant is read before main has bound the folder.
  - Main drops every grant when the folder differs. Paths compare case-insensitively on Windows.
  - A file written before this change (no `folder`) adopts the first folder it is bound to and
    keeps its grants.
  - `trustSiteExtension` now carries the folder and is refused if it no longer matches.
  - Binding the trust file, not watching the setting, covers a settings file edited while
    Persephone is closed.
- **Known edge.** If a second window still holds the old setting, it can bind the old folder back
  until its settings catch up. That only clears grants again, which fails closed.

## Concerns / Open questions

- **Persisted state.** An older saved `tab` value is still valid. A newer value that an older
  build doesn't know falls back through the facade's `isHubTab` check, and the view treats any
  unknown tab as the last branch. Accepted.
- **Reload notice.** This is per-view state, so it resets when the tab remounts. That matches
  US-1605, where it reset when Settings remounted.

## Acceptance criteria

- The hub shows a **Site extensions** tab listing every extension, with the same actions and
  details as US-1605's Settings list. The filter narrows the list by name, id or host.
- Settings shows only the summary line and **Open site extensions**. Clicking the button opens the
  hub, or focuses it if it is already open, on the Site extensions tab.
- `pages[i].editor.setTab("site-extensions")` works, and the facade help lists the new tab.
- `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.

## Verification (2026-10-03)

- `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.
- Live: `showToolsHubPage({ tab: "site-extensions" })` mounts the tab and lists both installed extensions.
- Filter: "example.net" leaves one row, and "zzz" shows "No site extensions match the filter." Clearing the filter restores both rows.
- Settings shows "2 installed, 1 trusted." **Open site extensions** switches the hub from Built-in to this tab, and the facade reports `activeTab: "site-extensions"`.
- The "open folder" buttons, per row and in the toolbar, open the folder in a new Persephone page with an Explorer sidebar (`pagesModel.addEmptyPageWithNavPanel`), not in Windows File Explorer. Live check: the new page's `panels.explorer.rootPath` was the extension's folder.
- Folder setting (live):
  - Before the change, main recorded the default folder and kept the existing grant.
  - After pointing `site-extensions.path` at a new folder holding a copy of one extension, the trust file recorded the new folder with no grants. The hub showed the folder and the extension as "not trusted"; Settings showed the folder, "1 installed, 0 trusted." and **Use default**.
  - `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.
