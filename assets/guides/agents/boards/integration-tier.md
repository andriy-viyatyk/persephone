---
title: "Boards — dialogs, opening content and navigation returns"
audience: agent
summary: "Confirm/alert/prompt, navigation returns for third-party sites, openBoard, openRawLink, openContent, content.open and notifications."
---

# Boards — dialogs, opening content and navigation returns

## Integration tier (in-app effects `execute()` can't express)

### Confirmations and prompts — `window.confirm` / `alert` / `prompt`

Persephone replaces these functions in every board frame with synchronous calls to its app dialog,
titled with the board name. They return the user's choice: `alert()` returns `undefined`,
`confirm()` returns `true` or `false`, and `prompt()` returns the entered text (including an empty
string) or `null` on Cancel. An agent can answer the dialog too. While it is open, every board
pauses because boards share one renderer process; if the page or window goes away, the call returns
the cancel result. For richer UI, use a native `<dialog>` with `showModal()` and the recommended
`dialog.css`; it does not pause other boards. Child `about:blank` and `srcdoc` frames retain
Chromium's native dialogs, and `beforeunload` prompts are not covered.

### Navigation returns

For a third-party site that needs to return to this board, mint one opaque URL and give that exact
value to the site's return/redirect option. There is no pattern argument and a board cannot claim a
real origin:

```js
const returnUrl = await persephone.navigation.createReturnUrl();
const stop = persephone.navigation.onReturn(({ url, query, hash }) => {
    const selected = query.item?.[0];
    const library = hash.addLibrary?.[0];
    console.log({ url, selected, library });
});
thirdParty.start({ returnUrl });
// stop(); // unsubscribe when the board no longer needs returns
```

`url` is the complete returned URL. `query` and `hash` are plain records whose values are arrays;
duplicate keys stay in order, a key without a value is `""`, and `URLSearchParams` percent-decodes
each component once. The API is available to trusted and bundled boards, and requires bridge
version `1.11.0` or newer (`minBridgeVersion: "1.11.0"`). A claim belongs to the current board frame:
disposing the frame or reloading it invalidates the claim, so the reloaded document must mint a new
URL. A late return for an invalidated claim is consumed and the browser navigation is restored when
possible, but it is never delivered to a replacement board or frame.

**The site must open the return URL in a new tab or window** (Excalidraw does this by asking for
`?target=_blank`, so the library site calls `window.open(returnUrl)`). The minted host is under the
reserved `.invalid` suffix and can never resolve, so a site that navigates to it *in place* dies at
DNS before Persephone sees anything: the return is lost and that tab is left on a browser error
page. Persephone closes the tab the return created and leaves the tab the user was reading alone.

- `persephone.openBoard(folder)` → `Promise<void>` (bridge 1.48.0) — open a board folder this caller is authorized to list. Relative paths resolve against the caller board root. The target uses the normal trust and permission-change dialogs; this call does not grant trust. Requires list-equivalent `fileSystem` access and `minBridgeVersion: "1.48.0"` in the caller manifest.
- `persephone.openRawLink(href, options?)` — open a file/URL through Persephone's page pipeline. Main accepts absolute paths (`path.isAbsolute` under Windows, including `/docs/x.md` and `\docs\x.md`), `file:`, `http:`, `https:`, `mailto:`, `data:image/png;base64,` and schemes claimed by the calling board's accepted content-provider declaration; relative paths and other unclaimed schemes are rejected.
  Bridge **1.46.0+** returns a `Promise<void>`; feature-detect with
  `if (persephone.version >= "1.46.0")` before using the new options in older supported apps.
  Pass `{ editor }` to request an editor (e.g. `"md-view"`), `{ revealLine, highlightText }` to
  open a source file at a line, or `{ editor: "browser-view", reuseKey }` for a board-owned Run
  page. The reuse key must be non-empty and at most 256 characters; ownership is scoped to this
  board's trusted root and key, and the board cannot choose a page id. Repeating a Run hard-reloads
  only when the active tab still shows that URL; if the user switched tabs or navigated away, it
  navigates the owned page back to the requested URL. Web URL path and query case is significant
  when matching the active tab.
  Bridge **1.57.0** adds `{ inPlace: true }` to navigate the page hosting this board to content.
  It needs no `appScripting` grant and can be combined with `editor`, `revealLine`, and
  `highlightText`, but not `reuseKey`. The page is resolved from this board's verified owner, not
  from whichever tab is active. This uses the normal page navigation lifecycle: save/discard/cancel
  prompts still apply, and cancel leaves the page in place. A successful navigation can dispose the
  calling frame before its promise settles, so do not rely on code after `await`; the void API does
  not report whether a navigation was cancelled. External/action links keep their regular action
  semantics. In-place image-view requests use the normal data URL pipeline; `image.edit` remains an
  image-edit action. Declare `minBridgeVersion: "1.57.0"` when using this option.
  This is user-visible page navigation and intentionally does not require a `fileSystem` grant,
  including for local paths and `file://` URLs. It returns no file contents. A navigation failure
  shows an error notification and rejects the promise; await and catch it when the board needs to
  handle failure. The bridge internally handles
  ignored promise rejections for compatibility with older fire-and-forget callers.
  An **image `data:` URL** with `{ editor: "image.edit" }` opens the image as a **new editable
  Excalidraw drawing** (rasterize your view to a PNG data URL first) — see the how-to recipe
  linked below.
  - **External links are auto-routed.** A plain `<a href="https://…">` click inside a board is
    intercepted (any link leaving the board's `board://` origin) and routed through `openRawLink`
    automatically — so a stray link never navigates the board frame into a blank screen. Relative
    and `#fragment` links navigate in-frame as normal; call `e.preventDefault()` first to handle a
    link yourself.
  - **Default context menu is built in.** Right-click gives Open/Copy Link (links), Open Image in
    New Tab / Copy Image / Save Image As… (images), Cut/Copy/Paste (text fields), and Copy
    (selection) with no board code. Call `e.preventDefault()` on `contextmenu` to render your own.
- `persephone.openContent({ editor, language, title, content })` → `Promise<string>` — create a
  **new in-memory, untitled Persephone page in another editor** and resolve to its page id. This is
  the board equivalent of the script API's `pages.addEditorPage(...)`, and the right call whenever
  the content lives in the board's memory rather than in a file `openRawLink` could point at (a
  rendered Markdown summary, an extracted subgraph, a table to open in the JSON grid). `editor` is a
  registered editor id (`"md-view"`, `"grid-json"`, `"monaco"`, `"mermaid-view"`, …);
  `language` defaults to `"plaintext"`, `title` to `"untitled"`.
  ```js
  const pageId = await persephone.openContent({
      editor: "md-view", language: "markdown", title: "Node report", content: markdown,
  });
  ```
  It **rejects** with a readable message for an unknown editor id or language, a standalone editor
  that cannot be built this way, another board's id, or content over 16 M characters — handle the
  rejection, don't fire and forget. It is **create-only**: the id it returns belongs to a page the
  board just made, and there is no counterpart call to read, list, navigate, close, or modify any
  other page, so `persephone.call` keeps its scoping to the page hosting this board.
- `persephone.content.open(link, options?)` → `Promise<{ url, size, contentType }>` — resolve a
  supported link to bytes without opening a Persephone page. Built-in file paths, `file:` URLs,
  archive-entry paths, HTTP/HTTPS URLs, `data:` URLs, and registered board schemes are supported;
  unsupported or unresolvable links reject. The returned URL is origin-local to the calling board:
  `board://<host>/__pipe/resource/<opaque-id>`. It is intended for in-frame consumers such as
  `fetch`, `<img>`, `<video>`, and pdf.js, supports byte ranges, and is revoked when the calling
  board frame is reloaded/replaced or its page closes. An outstanding request may be cancelled and
  reject during that teardown. This works for simple boards and is the migration path from
  `getFilePath()` when the source is not a local file.

  Size is eager: without a deadline, `open()` may wait for provider metadata or a transformed read.
  Pass `{ timeoutMs: 5000 }` when an escape hatch is needed; the timeout aborts and disposes the
  pending resource. The URL is not an HTTP/127.0.0.1 URL for external consumers.
  ```js
  const resource = await persephone.content.open("https://example.com/report.pdf", { timeoutMs: 10000 });
  const response = await fetch(resource.url, { headers: { Range: "bytes=0-1023" } });
  ```
