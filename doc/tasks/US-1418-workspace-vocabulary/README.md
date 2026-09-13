# US-1418: Name the "workspace" concept and expose each page's Explorer root

## Goal

Introduce **workspace** as the documented name for a Persephone page whose Explorer panel is
rooted at a project folder, and surface that root in the `pages` object model so an agent can
answer "which page has my project open?" without walking every page's panels.

## Background

Developers arriving from VS Code think in workspaces, and Persephone *looks* like VS Code on
first sight — VS Code themes, a left Explorer panel, Monaco. Persephone has no workspace
feature, but it has the thing itself: **a page whose Explorer panel is rooted at a project
folder is that project's workspace**, and the user keeps several open at once, one per page.

Today that concept is nameless. The guides describe only the mechanics ("opens a new tab with
the File Explorer panel rooted at that folder" — `getting-started.md:19`, `:50`;
`tabs-and-navigation.md:230`), so an agent asked "open my workspace" or "show me a file in the
project workspace" has no way to connect the request to `pages.openFile(folderPath)`.

### Verified findings (checked live against the running app, not inferred)

1. **A folder page is an empty page plus a rooted Explorer.** `resolvers.ts:133-146` routes a
   directory to `pagesModel.addEmptyPageWithNavPanel(data.url)`
   (`PagesLifecycleModel.ts:246-257`), which builds an `ExplorerEditor` with
   `rootPath: folderPath`. The page has no main editor at all.

2. **Ordinary FILE pages also carry an Explorer rooted at the project folder** — this is the
   finding that shapes the whole task. A page showing `doc/active-work.md` reports
   `rootPath: C:\projects\persephone`, *not* the file's own folder. So the workspace root is a
   property of nearly every page, not only of folder pages, and listing it per page really does
   tell an agent which project each tab belongs to.

3. **Roots differ per page**, confirming the several-projects-at-once picture: three pages open
   during investigation reported three unrelated roots.

4. **`page.findExplorer()` is the existing accessor idiom** — see `PagesLifecycleModel.ts:445-448`,
   which reads `explorer.state.get()` and checks `type === "fileExplorer"` before using
   `rootPath`.

5. **Two different discriminators exist and must not be confused.** The MCP *panel node* reports
   `kind: "explorer"`; the *editor state* discriminator is `type: "fileExplorer"`. Only the
   state's `type` is authoritative here.

6. **`PageWrapper.explorerRootPath()` already exists** (added in US-1417 for the editorless-page
   note) as a private helper. This task promotes it rather than adding a second reader.

7. **An archive page also has an Explorer**, rooted at the `.zip` / `.asar`
   (`PagesLifecycleModel.ts:443-452`). That is NOT a workspace and must be excluded —
   `providerType` does not discriminate it (it reads `null` for genuine folders too), so gate on
   the path itself with `isPlainLocalPath` + `!isArchivePath` from `core/utils/file-path`.

## Implementation plan

### 1. `src/renderer/scripting/api-wrapper/PageWrapper.ts`

- Promote the private `explorerRootPath()` to a public **`workspaceFolder`** getter returning
  `string | undefined`. Keep the existing `type === "fileExplorer"` check and ADD the archive
  gate from finding 7. Document it as: *the folder this page's Explorer is rooted at —
  Persephone's equivalent of a VS Code workspace folder; `undefined` when the page has no
  Explorer or is browsing an archive.*
- Add it to the page member list so it is discoverable, with summary:
  `"The project folder this page's Explorer is rooted at — this page's workspace (Persephone's
  equivalent of a VS Code workspace folder). Nothing when the page has no folder Explorer."`
- Include `workspaceFolder` in `aiSummary()` when present.
- Reword the editorless-page note added in US-1417 to lead with the term:
  *"This tab has no editor because it is a workspace page: its Explorer panel is rooted at
  `<root>` … "*.

### 2. `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`

- In `aiChildren()`, append the workspace root to each page's summary line when present:
  `"active-work.md" id=… (md-view) — workspace C:\projects\persephone`
  This is the change that lets one `pages` call answer "which page has my project open?".
- Extend the `openFile` member summary to name the concept — a folder open is *"Persephone's
  equivalent of opening a VS Code workspace"*.
- Add a short **Workspaces** paragraph to `PAGES_HELP` stating: Persephone has no separate
  workspace feature; a page whose Explorer is rooted at a project folder IS that workspace; open
  one with `pages.openFile(folderPath)`; several may be open at once, one per page; find them by
  reading `workspaceFolder` across `pages`.

### 3. `src/renderer/scripting/ai-vision/namespaces/fs.ts`

- In the `help` string, follow the existing folder sentence with the term, so an agent that
  reached `fs` first still learns it: opening a folder for the user gives them a **workspace**
  page.

### 4. User guides

- `assets/guides/getting-started.md` (lines 19, 50) and
  `assets/guides/tabs-and-navigation.md` (line 230): after each existing "File Explorer panel
  rooted at that folder" phrase, name it — *"this is Persephone's equivalent of a VS Code
  workspace"*. Do not restructure these sections.
- `assets/guides/agents/pages.md`: add a short **Workspaces** section covering the same three
  facts as `PAGES_HELP`, plus `workspaceFolder`.
- `assets/guides/screens/sidebar.md`: one sentence noting that the Explorer's root folder is the
  page's workspace.

### 5. Dashboard

Entry already added under **Active**; mark `[x]` only at completion.

## Concerns / Open questions

- **Every page gets a workspace line.** Because of finding 2, most pages will now carry a
  `— workspace <path>` suffix in the `pages` listing, which lengthens an already-verbose hint.
  Judged worth it: that repetition is exactly what makes "find the user's project page"
  answerable in one call. Do not add a separate `pages.workspaces` collection — it would be a
  second way to say the same thing.
- **"Workspace" is vocabulary, not a feature.** Every doc change must say a workspace *is* a
  page with a rooted Explorer. Nothing may imply Persephone has workspace files, workspace
  settings, or multi-root workspaces — it has none of these, and a confident agent inventing
  `workspace.json` is the specific failure this task must avoid.
- Not changing `addEmptyPageWithNavPanel` or any other method name; this is naming and
  discoverability only.

## Acceptance criteria

- [ ] `pages[i].workspaceFolder` returns the Explorer root for a folder page AND for a file page
      opened under that root; `undefined` for an archive page and a page with no Explorer.
- [ ] A single `pages` call shows each page's workspace root, so the open projects are visible
      at a glance.
- [ ] `openFile`'s summary, `PAGES_HELP`, and the `fs` help all name the concept and tie it to
      `pages.openFile(folderPath)`.
- [ ] The four guide files name the concept without implying a workspace feature exists.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build-prod` pass.
