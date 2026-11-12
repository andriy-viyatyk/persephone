# US-1873: Board docs — folder-editor boards and in-page navigation

## Status

**Status:** Planned
**Priority:** Medium
**Started:** —
**Completed:** —

## Summary

An agent building a board **without Persephone's source code** cannot find out from the built-in
documentation how to (1) make a board the editor for a folder, and (2) open a file in the board's
own hosting page. Fix the docs (and consider a small API addition) so both are discoverable through
the MCP `call` tool alone.

## Why

Found while building a calendar board that claims a folder and opens a clicked item in place. The
agent needed the Persephone source to finish the job:

- **Folder claims are effectively invisible to agents.**
  - `guides.agents.boards` is about 61 KB. At the default `maxLength` it is cut off, and even
    `maxLength: 60000` stops before the manifest reference that mentions `folderEditorMasks` /
    `folderEditorPriority`.
  - The clear explanation ("Direct-folder boards", with a manifest example, `getFolderPath()`, the
    Explorer icon and the switch behaviour) exists only in the **user** guide `assets/guides/boards.md`,
    not in the agent guide.
  - `helpSearch("folderMasks")` / `helpSearch("board file masks folder source onOpen")` return nothing
    about folder claims. The only hint is `page.editor.folderPath` ("folder claimed by this board").
- **No documented way for a board to navigate its own page to a file.**
  - `persephone.openRawLink()` always opens a new tab (or focuses an existing one).
  - `persephone.source.navigate(href)` accepts only items of the initial source context. For a
    folder-editor board opened from Explorer, that context is the clicked folder's **siblings**, not
    its children, so it is useless for "open the item the user double-clicked".
  - Working approach, found by reading the source: grant `appScripting: true`, then
    `await persephone.call("page.id")` + `persephone.call("pages.navigatePageTo", { args: [id, file] })`.
    No guide shows this recipe.
- **Stale Explorer after (re)trusting a folder board.** The Explorer resolves each folder's `target`
  when it lists the directory. After a manifest change plus a trust toggle, an already-open Explorer
  keeps opening Folder View until the folder is listed again (for example in a newly opened
  workspace page). The Explorer has no refresh control, and the docs only say "toggle trust or
  restart".
- **`panels.explorer.openItem(item)` silently falls back to Folder View** when the item has no
  `target`. An agent passing a hand-built `{ href, isDirectory: true }` gets Folder View with no hint
  why.

## Acceptance Criteria

- [ ] `guides.agents.boards` has a short, early **"Folder-editor boards"** section, or a link to a
      separate small agent guide. It covers:
      - `folderEditorMasks` (suffix glob semantics, e.g. `*/my-folder`);
      - `folderEditorPriority` (Folder View is `0`, git/mneme folders `20`);
      - `persephone.getFolderPath()`;
      - the Explorer icon and editor-switch behaviour;
      - that a manifest change needs a trust toggle **and** a fresh Explorer listing.
- [ ] A documented recipe for **"open a file in this board's own page"** (the `appScripting` +
      `pages.navigatePageTo` route), or a new bridge option (e.g. `openRawLink(href, { inPlace: true })`,
      or allowing `source.navigate` for files under `folderPath`) together with its docs.
- [ ] `helpSearch` finds the folder-claim docs for queries like `folder`, `folderEditorMasks`,
      `claim folder`, `navigate page` (index the guide text or add help-text lines).
- [ ] The agent boards guide is reachable in full: either split it into smaller pages or state the
      `maxLength` needed / a table of contents with section paths near the top.
- [ ] Optional: an Explorer refresh action (or automatic re-resolution of folder targets on trust
      change), and `openItem` resolving `target` itself when it is missing.
- [ ] No regressions in existing functionality.

## Technical Approach

To be investigated. Start from `assets/guides/agents/boards.md` (manifest reference around the
`fileMasks` paragraph, bridge list around `getFolderPath()`), `assets/guides/boards.md` ("Direct-folder
boards"), `BoardEditorModel.navigateSource()`, `FileTreeProvider` (folder `target` resolution) and
`custom-editor-registry.ts` (`resolveEditorIdForFolder`).

## Files to Modify

- `assets/guides/agents/boards.md` — folder-editor section, in-page navigation recipe, TOC/split
- possibly the bridge (`board-shim`, `BoardEditorModel`) if an in-place open option is added
- possibly the Explorer panel / `FileTreeProvider` for refresh on trust change

## Implementation Progress

- [ ] Investigation
- [ ] Docs
- [ ] (optional) API / Explorer changes
