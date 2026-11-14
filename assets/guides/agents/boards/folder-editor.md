---
title: "Boards — folder-editor boards"
audience: agent
summary: "Make a board claim folder with folderEditorMasks and folderEditorPriority, and navigate page content in the board's own page."
---

# Boards — folder-editor boards

Make a board the editor for a directory by declaring `folderEditorMasks` in
`board-manifest.json`. This claim applies to the folder itself. For file associations and the
related `folderMasks` behavior, see the [custom editors guide](../../boards/custom-editors.md).

## Claim a folder

```json
{
  "folderEditorMasks": ["*/projects/*"],
  "folderEditorPriority": 200
}
```

`folderEditorMasks` matches the claimed folder path, not a file's parent folder. Patterns use
case-insensitive path-suffix matching at a segment boundary, and `/` and `\\` are normalized to
the same separator. Leading/trailing whitespace is trimmed, duplicate masks are removed, leading
`./` and edge slashes are removed, and an empty result is discarded. `*` matches any text within
one segment, `?` matches one character within one segment, and `**` crosses separators. Other
characters are literal.

Examples:

| Mask | Matches |
|---|---|
| `projects` | A folder named `projects` at any depth. |
| `*/projects/*` | A matching folder with one segment above and one segment below `projects`. |
| `**/team?/calendar` | A `calendar` folder below any-depth path containing a segment such as `team1`. |
| `c:/work/**` | Folders below `c:/work` at any depth. |

The rules are the same folder-suffix glob rules described for `folderMasks` in the
[custom editors guide](../../boards/custom-editors.md), with the match applied to the claimed
directory itself. For example, `folderEditorMasks: ["*/projects/*"]` claims a directory such as
`c:/work/projects/calendar`; the `folderMasks` field instead narrows which files a file editor
claims based on their parent directory.

`folderEditorPriority` defaults to `0`; invalid or nonpositive values also normalize to `0`.
Higher priority wins between matching claims, and a built-in editor wins a tie with a board.
Folder View has priority `0`; Git and enabled `.mneme` folder editors use priority `20`. Choose a
positive value above competing folder editors when the board should win.

The board must be trusted for the folder claim to apply. The Explorer shows the board's icon for a
claimed folder. Opening it switches to the board, and the page editor switch offers Folder View and
the matching board so the user can switch to Folder View and back without opening another tab.
In Folder View, `await persephone.getFolderPath()` returns the claimed folder; `boardRoot` remains
the directory where the board app is installed. `getFilePath()` is not set for folder mode.

After editing the board manifest, toggle trust off and on to refresh the registered claim. Explorer
clicks resolve the current claim at click time, so an already-listed folder opens the newly claimed
board without relisting. Its displayed icon can remain stale until Explorer lists the directory
again. If the same Explorer item is already selected, selecting it again is an existing no-op;
select another item first.

## Open a file in the board's page

To navigate the page hosting this board to an absolute file path, use the bridge directly:

```js
await persephone.openRawLink(href, { inPlace: true });
```

This option does not require an `appScripting` grant. It uses the normal validated `openRawLink`
link pipeline and selects the page hosting the board even if another page is active. You can also
pass `editor`, `revealLine`, or `highlightText` as with other `openRawLink` calls. `inPlace` cannot
be combined with `reuseKey`.

For older bridge versions, the alternative uses trusted `appScripting: true` access:

```js
const id = await persephone.call("page.id");
await persephone.call("pages.navigatePageTo", { args: [id, href] });
```

`persephone.source.navigate(href)` has a narrower scope: it can navigate only to an item in the
page's initial source context. For a board opened as a folder editor, that context contains the
clicked folder's siblings, not arbitrary files within the claimed folder.

Navigation follows the page's normal save/discard/cancel lifecycle. A modified content-host board
prompts before its host is released; a busy ordinary board may survive as a hidden ownership handle.
Cancel leaves the page in place. If navigation succeeds and replaces the board editor, the calling
frame may be disposed before the returned promise settles. Do not rely on code after `await` running,
and treat the `Promise<void>` as completion of the request rather than proof the page navigated: a
cancelled navigation is not reported as success or failure by this API. External and other
non-content links retain their normal action behavior. Image data opened with an image-view target
uses the ordinary link pipeline for in-place navigation; `image.edit` remains an image-edit action.
