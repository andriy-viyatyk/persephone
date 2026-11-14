---
title: "Boards — custom editors and folder boards"
audience: both
summary: "Associate a board with a file type or folder: fileMasks, folderMasks, folderEditorMasks, direct-folder boards, priority, simple editors and board metadata."
---

# Boards — custom editors and folder boards

## Custom editors — associate a board with a file type

A board can register itself as an **editor for a file type**. When you open a matching file, the board appears in the toolbar's editor-switch control right next to the file's normal editor(s) (Text Editor, Grid, Preview, …) — click it to flip between them, exactly like switching between any other pair of editors. Depending on the board's settings, it can also become the **default** editor that opens automatically for that file type.

Declare the association with fields in `board-manifest.json`:

```json
{
  "fileMasks": ["*.drawio"],
  "editorPriority": 100,
  "editorName": "DrawIO",
  "editorKind": "content-host"
}
```

| Field | Purpose |
|-------|---------|
| `fileMasks` | One or more glob masks matched against the file's name — `*` matches any run of characters, `?` matches a single character. A bare extension (e.g. `drawio` or `.drawio`) is treated the same as `*.drawio`. A mask with no wildcard but a dot inside it is an **exact file name** — `"DASHBOARD.md"` claims files named exactly that, not every `.md` file. Masks also support compound extensions, e.g. `*.grid.json`. |
| `contentMasks` | Optional regular-expression sources tested case-insensitively against the page's text. A match adds the board to the editor switch, including on an untitled in-memory page. Content detection is a switch option only: it never chooses the editor that opens a file. A board may use `contentMasks` alone or together with `fileMasks`; only the first 64 KB is checked and invalid expressions are ignored. |
| `folderMasks` | Optional — one or more glob masks matched against the file's *parent folder*, narrowing where `fileMasks` applies. See [Scoping to a folder](custom-editors.md#scoping-to-a-folder--foldermasks) below. |
| `editorPriority` | A number that decides whether the board also becomes the **default** editor for matching files (not just a switch option). Persephone's built-in editors each sit at their own priority level; set a value higher than the built-in editor for that file type to make the board the one that opens automatically. Ties go to the first registered match. Omit it (or leave it `0`) and the board is offered only as a switch option — the normal editor keeps opening by default. Built-in priority levels include Text Editor `0`, Markdown Preview `10`, compound-name editors such as `*.grid.json`/`*.grid.csv` `20`, and the bundled Excalidraw board `50`. For example, a board claiming `.md` files (like the `folderMasks` example below, which uses `fileMasks: ["DASHBOARD.md"]`) needs `editorPriority` **above 10** to open by default — Markdown Preview claims that slot. |
| `editorName` | The label shown for the board in the editor-switch control. Falls back to the board's folder name if omitted. |
| `editorKind` | Optional — `"simple"` (default), `"content-host"`, or `"stream-host"`. A simple board reads/writes a path; a content-host board receives text through `persephone.host.*`; a stream-host board receives an origin-local pipe URL through `persephone.host.streamUrl()` without materialization. |
| `editorSources` | Optional — `"local"` (default, if omitted) or `"any"`. A **simple** board only handles a plain local file by default; set `"any"` to also have it offered for a file inside an archive or at an `http(s)` URL. Persephone copies those non-local sources into a local cache file first, so the board's own code can use `persephone.getFilePath()`. It is the copy-based alternative to `stream-host` and is ignored by content-host and stream-host boards. |

When an HTTP(S) URL has an extension claimed by an eligible custom editor board, Persephone can
open it in that board directly, including from a Browser **Show Resources** collection.

### Inspecting board metadata from scripts

Scripts running on an open board can call `page.editor.getManifest()` after narrowing the editor id
to `board-view` or `board-editor:<id>`. It returns a copied snapshot of the normalized manifest
values Persephone applies; it returns `undefined` if the manifest is missing or malformed. The
snapshot includes the supported manifest fields, including `browserUrlMasks`, `contentMasks`,
`singleInstance`, `singleInstanceMasks`, `settings`, `guides`, and capability `alwaysOpensNewPage`.

Normalization is visible in the returned values. `permissions` are trimmed and deduplicated while
preserving case; browser URL masks are lowercased, deduplicated, filtered, and capped at 64; file
masks and `singleInstanceMasks` are lowercased and bare extensions become globs such as `*.drawio`; folder masks normalize
slashes; content masks omit invalid or overlong expressions. Provider types are trimmed and blank
types removed, while schemes are lowercased and deduplicated. Capability ids, representations, and
titles are trimmed, accepted values are deduplicated, and malformed `alwaysOpensNewPage` values
reject that declaration. Service paths are returned only when they pass the safe board-relative
path check. Settings keep only valid declarations with supported types and defaults; duplicate ids
are first-wins, and enum options are trimmed and deduplicated. Secondary views normalize their text
and omit malformed or duplicate ids. Guides paths are normalized and rejected if unsafe. Empty
`editorName` values are omitted; a declared numeric priority is returned as applied (invalid or
non-positive values become `0`). Other descriptive strings and valid authored enum/boolean values
keep their authored text. Optional fields remain absent when not declared. Nested declarations and
arrays are copies, so changing a returned value does not change the board's manifest or Persephone's
state.

The same snapshots are available to scripts through an open Board Info page's `properties` facade.
That snapshot combines normalized manifest values with Board Info state such as the board root,
trust status, compatibility, and registration issues. See the [Page API reference](../scripting/api/page.md)
for an example using `app.pages.all`.

### Direct-folder boards

Use a manifest such as:

```json
{
  "folderEditorMasks": ["*/projects/*"],
  "folderEditorPriority": 200
}
```

This claims the matching folder itself. In folder mode, `boardRoot` is the folder where the board
app is installed and `folderPath` is the absolute directory the board claims and operates on. Use
`await persephone.getFolderPath()` to read the latter. `getFilePath()` remains `undefined` in folder
mode, and `editorKind: "content-host"` / `"stream-host"` still applies only to a board's file association.

When a trusted board claims a folder, its board icon appears on that folder's File Explorer row and
clicking the row opens the board for the folder. The page toolbar's editor switch offers **Folder
View** and the matching board(s) in the documented order, so you can browse the folder and return to
the board without opening another tab. If the board is later untrusted, an already-open page keeps a
recovery-only switch entry so you can return to Folder View; the board does not run while untrusted.

For example, a board that recognizes force-graph JSON by its content can offer itself for both
saved files and untitled JSON pages without taking over normal file opening:

```json
{
  "contentMasks": ["\"type\"\\s*:\\s*\"force-graph\""],
  "editorName": "Force Graph"
}
```

**Requirements and behavior:**

- **The board must be trusted.** An untrusted board's file association is completely ignored — no switch option, no default-editor behavior — until you trust it. Un-trusting a board removes the association immediately.
- **The tab and icon follow the file, not the board.** When a board is opened as a file's editor, the page tab shows the **file's name** (not the board's folder name). Wherever that board wins as the file's *default* editor, its icon also replaces the generic file icon — in the File Explorer tree, other file lists, and page tabs (see [Board icon](getting-started.md#board-icon)).
- **Unsaved changes are protected.** Switching away from a modified built-in editor to a **simple** board runs the usual "Save changes?" prompt (Save / Don't Save / Cancel) before the switch happens, the same prompt used when navigating away from unsaved changes anywhere else in Persephone. A **content-host** board doesn't need this — its content transfers directly with nothing to lose (see below).
- A change to `fileMasks` / `contentMasks` / `folderMasks` / `folderEditorMasks` / `editorPriority` / `folderEditorPriority` / `editorName` / `editorKind` in the manifest takes effect the next time the board or trust list is refreshed, not while a page is already showing the board.
- **The full set of switch buttons stays visible while the board is active.** Whichever editor is currently showing — the board or one of the file's built-in editors — the same switch buttons appear in the same order, so you can jump directly from the board to any other available editor (e.g. Preview) without detouring through the Text Editor first.

### Scoping to a folder — `folderMasks`

By default, a board's `fileMasks` claim every matching file name, anywhere on disk. `folderMasks` narrows that to files that also sit in a matching folder:

```json
{
  "fileMasks": ["DASHBOARD.md"],
  "folderMasks": ["*/tasks"]
}
```

This claims only a `DASHBOARD.md` that lives directly inside a folder named `tasks` (for example `…/dev/tasks/DASHBOARD.md`) — any other `DASHBOARD.md` elsewhere on disk is left to Monaco (or whichever editor would normally open it).

**Matching rules:**

- Matched against the file's **parent folder**, case-insensitive, and either slash style (`/` or `\`) is accepted.
- A mask is anchored at the **end** of the path — it's a folder-path *suffix*, so it doesn't need to spell out the drive letter or every ancestor folder.
- `*` and `?` stop at a folder separator; `**` crosses them:
  - `*/tasks` — exactly one folder segment above `tasks` (matches `…/dev/tasks`, not `…/dev/sub/tasks`).
  - `tasks` — a folder named `tasks` at **any** depth.
  - `**/dev/tasks` — `dev/tasks` anywhere in the path, with any number of segments in between.
  - `c:/projects/acme/**` — anything under that tree (the tree root itself, `c:/projects/acme`, is not matched — only what's inside it).
- **Narrowing only.** `folderMasks` with no `fileMasks` registers nothing — there's nothing to narrow.
- **Icons follow folder scope when a path is available.** Path-based file lists and local File Explorer rows show a folder-scoped board icon only when the file is inside a matching folder. A name-only icon lookup (including `persephone.icons.forFiles(names)`) cannot check the folder and uses the ordinary file icon for boards with `folderMasks`. The explicit **Open with** menu can still offer a board whose `fileMasks` match, regardless of folder scope; default editor resolution continues to honor `folderMasks`.
- The Board Info page's **"Editor for"** row shows both `fileMasks` and, when present, `folderMasks`, and folder masks are carried through the [published-boards catalog](published-boards.md#published-boards-catalog--discover-install-update) alongside `fileMasks`.

### Simple editors — reading the file directly

This is the default (`editorKind` omitted or `"simple"`): the board reads and writes the associated file itself, directly on disk.

```js
const filePath = await persephone.getFilePath();   // undefined if the board was opened with no associated file
if (filePath) {
    const text = await persephone.readFile(filePath);
    // ... parse and render it ...
}
```

**Local files only.** Because the board handles the file itself, this only works for a real local file — a simple board is never offered as an editor for a file opened over `https://` or from inside an archive.
