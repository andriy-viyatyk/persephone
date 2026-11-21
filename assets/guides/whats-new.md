---
title: "What's New"
audience: both
summary: "Release notes, newest first — the last 10 releases in full, older ones condensed to features and breaking changes; call guides.whatsNew instead for just the running version's section."
---

# What's New

Release notes and changelog for Persephone (formerly js-notepad).

---

## Version 5.0.21 (Upcoming)

### Improvements

- **Drop a folder to browse it:** dropping one folder from Windows Explorer onto Persephone now
  opens a new page with the Explorer panel rooted at that folder. Dropping several files or folders
  still opens a link collection page.

### Bug Fixes

- **Browser: sites ask before editing your files, and embedded frames don't inherit
  permissions.** A site that wants to edit files in a folder you picked, view a folder's files, or
  save to a file now shows the permission bar with the path; picks of drive roots, your user folder,
  AppData, Windows or Program Files are refused, as in Chrome. An iframe from another site can no
  longer ask for notifications or external links, or use the notification permission you gave the
  page around it.
- **Browser: pages can no longer open local files or `data:` documents in a tab.** **Open Link in
  New Tab**, `target="_blank"` links and `window.open()` now open only web addresses, as in Chrome,
  and **Open Image in New Tab** refuses local images. Local files and `data:` URLs still open when
  you paste them into the URL bar.
- **Browser: Incognito and Tor pages no longer leave traces on disk.** Their pages are not saved
  with the window and do not reopen after a restart, their search queries are neither saved nor
  suggested in normal pages (and normal search history is not suggested in them), and their
  downloads appear only in their own page's Downloads list, not in normal pages or the saved
  recent-downloads list.
- **Browser: Tor and proxied pages no longer leak around their route.** Pop-up windows of a Tor or
  proxied page now get the same WebRTC restriction as the page; a closed Tor page's session stays on
  Tor instead of switching to a direct connection; Tor, Incognito and proxied pages never send a TLS
  client certificate; site-extension `fetchText` requests use the page's own route; and a page's
  favicon or clicked thumbnail pointing at a local file or network share is ignored. Markdown opened
  from the web shows only web images, and the bookmark favicon download no longer follows a page to
  another host on your local network.
- **Browser: pages can no longer flood you with windows, downloads or dialogs.** As in Chrome, a page
  opens a tab or pop-up window only right after your click, pop-up windows fit the screen and show
  their site in the title, and **Allow** on the blocked-popup bar now applies to that tab's site only
  instead of every page. A page gets one automatic download; more need a click, Save dialogs come one
  at a time, and a download waiting for its Save dialog pauses at 32 MB. Alerts appear one at a time
  with an option to stop more, the "Unsaved changes" question no longer freezes Persephone while it is
  open, and very long page titles are shortened.

---

## Version 5.0.20

### New Features

- **Board data per profile:** a board's background service now gets its own data folder from
  Persephone (`PERSEPHONE_BOARD_DATA`). The default profile keeps `%LOCALAPPDATA%\Persephone\board-data`;
  a named profile (`--profile`) and test runs keep board models and data inside the profile's own
  folder. Nothing is moved or deleted. Translate, Agent Chat and the speech boards use it.
- **Clearer board permissions:** the trust dialog now says that a board's background service, and any
  program a board starts, can use your files and the network whatever the board's other permissions.
- **More for agents over `call`:** `pages.openFolder(path)` opens a folder in its editor,
  `pages[i].save()` saves any page with content, `window.screen.pressKey` reaches the app's own
  window shortcuts as a real key press does, interactive snapshots name icon buttons and tree rows
  the way you see them, and `$help` shows what each method returns.
- **Web-app regression tests:** Write `.test.mjs` checks for a web app and run them with
  `persephone-test.exe` in a Persephone profile, reusing a logged-in browser profile. Reports,
  screenshots, console output, and network logs help diagnose failures. See [Web-app regression
  tests](./agents/web-app-tests.md).
- **Downloads in web-app tests:** in an app launched by the test runner, a browser download no
  longer opens the Save dialog that a test cannot answer. It is saved to the profile's
  `test-downloads` folder and its path is listed in `app.downloads`.
- **HTTPS in web-app tests:** an app launched by the test runner accepts a self-signed certificate
  whose SHA-256 fingerprint is listed in `PERSEPHONE_TEST_TRUSTED_CERTIFICATES`, so tests can use a
  local HTTPS server. Other certificate errors, and every certificate error outside a test run, are
  still rejected.
- **URL patterns over `call`:** `waitForURL` and `waitForResponse` accept `{ regex, flags? }` where a
  script would pass a RegExp, because a `call` carries only JSON.
- **Fake board catalog in web-app tests:** an app launched by the test runner reads the published-boards
  catalog from the loopback URL in `PERSEPHONE_TEST_BOARDS_CATALOG_URL` and never from GitHub, so catalog
  install, update and roll back can be tested offline. Outside a test run the variable is ignored.
- **Board data stays in the test profile:** in an app launched by the test runner, `%LOCALAPPDATA%`
  points at the profile's `test-local-app-data` folder for the app and every process it starts, and
  board processes also get a profile-local home, Claude and Codex settings and a `PATH` without your
  own command-line tools. Boards never read or change your own data during a test. Outside a test
  run nothing changes.
- **Assigning properties in web-app tests:** `ctx.set(path, value)` assigns a writable call-tree
  property, such as a board model's `searchText`. Assigning through `ctx.app` used to do nothing
  silently; it now throws and names `ctx.set`.

### Bug Fixes

- **Text editor find box colors:** the find box, suggestion list and hover popups in the text editor
  used Monaco's own gray instead of the current theme's colors. They now match the theme.
- **EPIPE error dialog on exit:** Persephone no longer shows a main-process EPIPE error dialog when
  the console that started it has closed.
- **Error codes over `call`:** a call that failed through the MCP `call` tool reported only its
  message, so an agent could not tell `no-handler` from `rejected`. A coded error from any part of
  the app now reads `Error [<code>]: <message>`; an error without a code is shown as before. Web-app
  tests see the code as `error.code`, and `app.call()` in a script throws an error that keeps it.
- **Board on/off settings could not be found by name:** a board's checkbox and folder settings on
  the Settings page had no `data-name`, unlike its text, number and choice settings. They now carry
  `board-setting-<id>` like the others, so automation and tests can address them.
- **`call` results with a `pending` field:** a value that happened to contain `pending: true`, such
  as a board model's status object, was reported as "script execution is still in progress" and
  could not be read. Only a running `script.execute` is reported as pending now.
- **Environment Variables editor kept the last edit:** closing the Environment Variables page right
  after changing a value and choosing Save in the unsaved-changes prompt saved the file without that
  change, and a close with only that change did not prompt at all. The pending change is now written
  before the prompt, as the Links editor already did.
- **Clicks on elements inside a scrolled panel:** `window.screen.click` and the other trusted actions
  scrolled an element into view only when it was outside the window. An element clipped by a
  scrolling panel (for example a button low in the Settings page) failed with "covered by" its own
  panel until the timeout; it is now scrolled into view and clicked.
- **Board automation during a reload:** while a board was reloading (for example after accepting the
  permissions-changed dialog), `pages[i].editor.reload()` failed at once with "Board frame not ready"
  and a frame call such as `evaluate` could hang. Reload now starts without needing the old frame,
  automation waits for a loading frame, and a call cut off by the frame being replaced is retried on
  the new frame or fails promptly.
- **Capability `open` results in `$help`:** the `Returns:` line of a capability's `open` method now
  shows the `{ pageId?, result }` envelope the call returns, not only the inner result.
- **Opening a board twice:** `boards.openBoard(root)` opened a second tab for a board that was
  already open. It now switches to the board's existing tab, as documented.
- **Demo board settings on a fresh profile:** a board created with `boards.createDemoBoard` (or the
  New board dialog's Demo template) lost the template's author when no default board author was
  set, so the Demo board's own settings were rejected with an error notification. The template's
  author is now kept unless a default author is configured.
- **Error-like strings in web-app tests:** a test step whose result was a string starting with
  `Error: ` (for example a page returning `String(error)` from `evaluate`) was reported as a failed
  call. Only real call failures fail a step now.
- **Board services over `call`:** `boards.requestService`, `boards.startService` and
  `boards.stopService` were available to scripts but missing from the `call` tree.
- **Held keys in browser automation:** `keyDown("Shift")` (or Control, Alt, Meta) was forgotten by
  the next `pressKey()`, so `keyDown("Shift")` + `pressKey("b")` typed "b" instead of "B". Held keys
  now stay down until `keyUp()`.
- **Typing into a page just opened by an agent:** a new browser page focused its URL bar 100 ms after
  opening, even when it had already started loading a page, so text that `type()` sent right after
  opening could land in the URL bar. The late focus is skipped once a page is loading, and a trusted
  click (and `pressKey()` without a target) focuses the page first, as a real click does.
- **Site action URL results:** a site-extension action returning `{ kind: "url" }` that opened as a
  new tab of the same browser page reported `not-current` although the URL had opened; it now reports
  `opened`.
- **Browser page queries over `call`:** `getText`, `getValue`, `getAttribute`, `getHtml` and `exists`
  worked in scripts but were missing from `pages[i].editor` in the `call` tree, although the guide and
  `$help` pointed agents at them. The `select()` help also wrongly said it hit-tests the pointer.
- **Browser `reload()` for agents and scripts:** `pages[i].editor.reload()` returned before the page
  had reloaded, and on a page that was still loading it stopped the load instead of reloading. It now
  always reloads and waits for the reloaded page, like `back()` and `forward()`, returning its URL
  and HTTP status.
- **Downloads popup:** a finished download could keep showing the size it had at its last progress
  update instead of its full size, and scripts read the same stale byte count from `app.downloads`.
  While a download was running, the popup rebuilt its rows on every progress update, so a click on
  **Cancel** could be lost; the rows now update in place.
- **Link editor Tags and Hostnames panels:** after a link was deleted or edited, the tag and hostname
  lists kept their old entries and counts until the panel was opened again. They now follow every
  change, including in the browser's bookmarks drawer.
- **Web-app test cleanup:** a test that left a page with unsaved changes, a dialog, or a popup menu
  open made every later test in the file fail at its start. Cleanup now discards the test's own
  unsaved pages, dismisses a leftover dialog or menu (the test that left it is reported failed), and
  also closes workspace pages a test opened.
- **Mneme status error on stop:** stopping Mneme while the Mneme page was still loading its status
  showed a "Mneme status failed: Connection closed" error. A request cut off by the stop is no longer
  reported.
- **Agent file access over MCP:** `call` on `fs.read`, `fs.write`, `fs.exists` and the other `fs`
  methods ran nothing and returned a "function" placeholder instead. Agents can call them again.
- **Named profiles kept some data in the default profile:** a `--profile` instance read and wrote the
  default profile's window position, board and site-extension trust, site permissions, download and
  UI preferences. Each profile now keeps these in its own folder.
- **Clipboard history limit:** setting `clipboard.max-items` outside 1–1000 through a script or the
  settings file stored the invalid value. It now falls back to 100, as the setting describes.
- **Highlights in the app window:** highlighting a Settings section, page element, or UI control works
  again.
- **Settings scroll-spy:** after clicking an entry in the Content tree, scrolling the panels before the
  jump settled stopped the tree from following the scroll until the next click. It follows again.
- **JSONL in the grid:** a file with a malformed line showed the lines before it as a table, and an
  edit there would save only those lines. The grid now shows only the parse error, as for JSON.
- **Grid Edit Columns:** picking a filter type with the mouse closed the Edit Columns popup without
  applying the change. The choice now stays in the popup.
- **Duplicate Tab:** duplicating a text page opened an empty tab with no editor. The copy now opens
  in the same editor with the same content, including unsaved changes.
- **Ctrl+Tab order:** `Ctrl+Tab` and `Ctrl+Shift+Tab` moved through tabs in the order they were last
  used, so from the active tab they often jumped to the first tab. They now follow the tab strip.
- **Open Tabs list:** the sidebar's Open Tabs list could keep showing only the pages it listed first.
  Pages opened later were missing until the list was rebuilt. It now updates as pages open and close.
- **App-window drag automation:** `window.screen.drag` on an Explorer file row froze Persephone. The
  row handed the drag to a Windows file drag, which waits for a real mouse release. That drag now
  fails at once with an error that points to the Explorer's own commands, and the app stays
  responsive.
- **Links pages opened as Empty tabs:** **Show Resources** (HTML and Browser), `app.pages.openLinks`,
  site-extension link lists, and several files or a folder dropped on the window opened an `Empty`
  tab with no editor. They now open in the Link editor.
- **Link editor changes lost on a quick close or switch:** a change made in the Link editor less than
  a moment before closing the tab or switching to Text Editor was dropped without a save prompt. The
  tab now counts it as unsaved and keeps it when you switch.
- **Board event feeds stuck on old events:** a board that waited for events with
  `persephone.call("events.wait")` (such as the AiVision Explorer's Events tab) got the oldest
  retained event back on every call and never saw a new one. Each board now waits from where its
  last wait left off.

---

## Version 5.0.19

### New Features

- **Microphone noise removal:** managed microphone capture uses DTLN noise removal, with an
  optional per-device resonance cut in Microphone Audio settings. On Windows, Transcript, voice
  typing, and compatible boards can also cancel computer sound, keeping noise removal when that
  reference is unavailable. Boards can request raw capture through `audio@1`.
- **Page-wide navigation history:** Back and Forward work across page navigation with page-toolbar buttons next to File Explorer, keyboard and mouse shortcuts, and the `page.history` scripting API. Browser webview history remains separate.
- **Mermaid diagram choices:** choose a Classic, Neo, or Hand-drawn look and a Dagre or ELK layout in
  the Mermaid toolbar. Each page remembers its choices; Markdown and Log View diagrams keep the
  Classic look and Dagre layout.
- **Settings help:** Hover over a **?** beside a setting or section, or focus it with Tab, to read
  its explanation. Press Escape to dismiss it. See [Settings](./screens/settings.md).

### Improvements

- **Transcript and voice typing follow default audio devices:** If the microphone or speakers change while recording, capture reconnects to the current default device and continues.
- **Voice Typing stops on transcription inactivity:** an optional timer stops voice typing when the
  live transcription provider sends no new text, even if background noise keeps the microphone active.
- **HLS stream controls:** HLS playback now uses the browser's native media controls.
- **More text files open with the right encoding:** Windows-1252 and BOM-less UTF-16 files are now
  detected when opened.
- **Capability selection:** Unpinned `app.capabilities.invoke()` and board `persephone.capabilities.invoke()` calls honor `capabilities.preferredProviders` and can select any eligible major version. A board's declared `methods.open.timeoutMs` also applies when an app script opens it.
- **Board lifecycle:** Disabling a bundled board makes its open pages unavailable until it is enabled again. Removing a board closes its pages and stops its service; renaming preserves its category pin and position.
- **Board frame cleanup:** Requests fail immediately when board trust is removed, with an `untrusted`
  error. Reloading or changing grants clears that frame's toolbar, status, and mute contributions;
  pending AiVision calls end on reload. Closing a secondary view preserves the main view's items.
- **Board bridge reliability:** Late messages or replies from a replaced board port are ignored,
  stale folder cursors return `invalid-argument`, and service or dialog permission denials expose
  the stable `permission-denied` code while keeping their existing messages.

### Bug Fixes

- **Explorer remembers restored folders:** Expanding another folder no longer causes previously
  restored expanded folders to disappear the next time the Explorer state is saved.
- **Autoload refreshes shared scripts:** Reloading autoload scripts also picks up changes in the
  library modules they import.
- **Relative requires in Script Library modules:** A library module can import a neighbour with
  `require("./helper")` or an ES `import` from `"../utils/x"` again; the target gets the same script globals.

---

## Version 5.0.18

### Breaking change: Notebook moves to a board

**Save all open notebooks before updating, including untitled notebooks.** Install the Notebook board from the catalog to open `.note.json` files; if it is absent, use the `+` install entry. Restored Notebook tabs and old pins are not migrated. Reopen saved files through the board; an unsaved cache may be orphaned.

The dedicated New Notebook entry is gone. Create or open an empty `*.note.json` file, or create a text page, rename its tab to `untitled.note.json`, select Notebook in the editor switch, and save. The board provides its own guides.

The move removes note script execution; HTML, Mermaid, and SVG previews; Monaco IntelliSense and commands; file/link-to-category and note-to-category drag (use the card category field); and content-only Notebook switching. The `INotebookEditor` API and `pages.addEditorPage("notebook-view", ...)` are removed; use the board's `page.editor.app` API.

### New Features

- **Global audio mute for board voice sessions:** Boards can mute Persephone playback while listening. The header indicator shows which boards hold the mute and lets you release it across all app windows.
- **Monitors and full screen for agents:** Agents can list your monitors, move a Persephone window
  to another one (`window.moveToDisplay("largest")`), make the window full screen, and play a
  browser video full screen with `pages[id].editor.fullscreen()`, including videos in an embedded
  player that allows it. A full-screen video stays full screen when the window moves. Opening a
  browser tab with search text, rather than an address, now runs a search instead of showing a blank tab.
- **Site extension actions:** Trusted extensions can add a **Site actions** menu to the Browser URL bar
  and open their results in Persephone. Extensions can separately request limited, cookieless text
  fetches from approved hosts. See the [Site Extensions guide](./site-extensions.md).

---

## Version 5.0.17

### New Features

- **Optional agent tips:** MCP agents may suggest a site extension for recurring site automation
  after finishing their current task. Control suggestions with **Allow optional agent tips** in
  Settings → MCP Server / Mneme.
- **Site extension trust:** Agents trust extensions they build at your request; downloaded or
  received extensions remain your choice unless you ask an agent to review and trust one. See the
  [Site Extensions guide](./site-extensions.md).
- **Separate application profiles:** Launch with `--profile demo` to keep a separate set of data
  and run it alongside the usual instance. See [Getting Started](./getting-started.md#separate-application-profiles).
- **Script folder watches:** `app.fs.watch()` reports local file changes to scripts and can resume
  watching a folder after it is recreated. See the [filesystem reference](./scripting/api/fs.md#watching-paths).
- **Browser page zoom:** Adjust each browser tab independently with the toolbar slider, presets,
  keyboard shortcuts, or mouse wheel.
- **Editor categories:** Organize built-in editors and trusted boards into ordered categories. The
  **+** menu groups editors under Top, named categories, and Other; the Tools & Editors hub includes
  a category manager beside the merged Editors tree.
- **Boards as standalone apps:** Create a Windows shortcut from a board's context menu and open it
  in its own window. The board stays locked in the first tab while pages it opens use regular tabs.
  You can also ask an AI agent to create the shortcut or open the board window for a trusted or
  bundled board. See the [Boards guide](./boards/getting-started.md#run-a-board-in-its-own-window).
- **Recover pages after a restore error:** A page that fails to restore stays available with its
  error and a **Retry** action. Closing it can discard unrecovered changes after confirmation.

### Improvements

- **Browser downloads:** Completed downloads can be opened in a matching Persephone editor or board,
  or handed to their Windows default app.
- **Lazy browser tab restore:** After restart, only the active tab loads right away. Other tabs keep
  their saved titles and icons and load when you first activate them; restored muted tabs stay muted.
- **Show Resources:** Browser resource collections include loaded fonts. Open favicons in Image
  Viewer and audio or video resources in Video Player; compatible custom editor boards can open
  matching web resources such as fonts.
- **Board dialogs:** a board's `alert`, `confirm` and `prompt` now show as Persephone dialogs that
  you and agents can answer; a lost dialog can no longer freeze every board.
- **Runtime update:** Persephone now uses Electron 44 and Chromium 152.

### Bug Fixes

- **Git Changes panel:** the changed-files lists fill the panel and follow it when you resize it,
  instead of stopping short until you switched tabs.

---

## Version 5.0.16

### New Features

- **Cinema mode:** Expand videos across the browser page, including videos embedded in nested frames;
  press `Esc` or use the on-screen button to restore the page.
- **Voice typing translation:** Use `Alt+Shift+V` to ask the Speech to Text provider for English
  output. The translation shortcut can be changed independently in Settings.
- **Project TypeScript IntelliSense for boards:** Register a project folder to give Monaco pages
  completions for project files, declarations, and supported JSON imports. Project pages can also
  show TypeScript errors from the toolbar.
- **Board toolbar breadcrumbs:** Bridge 1.49.0 lets boards place path navigation in the page toolbar.
- **Board bridge 1.48.0:** Boards can open a board folder they are authorized to list with
  `persephone.openBoard(folder)`. The target still uses the normal trust dialog; boards that use
  this method should declare `minBridgeVersion: "1.48.0"`.
- **HTML Preview loads local page resources:** Preview plain HTML files with sibling stylesheets,
  scripts, and images, safely confined to the file's folder. Use the globe button to open a local or
  HTTP(S) source in Browser.

---

## Version 5.0.15

### New Features

- **Speech to text:** Install the Speech to Text catalog board from `persephone-boards` to provide
  transcription. Agent Chat shows a voice button when a provider is installed and can stop dictation
  after silence using the shared Voice Typing setting. Both boards require Persephone 5.0.15 or later;
  board authors can also use the reserved `speech.transcribe` v1 service contract.
- **Voice typing:** Dictate into a focused input with `Alt+V`; configure the shortcut in Settings, including a tap of the right `Ctrl` key alone. Install and trust the Speech to Text board to use it.
- **Transcript in the Text Editor:** Capture microphone audio, computer audio, or both into a text
  page. Computer audio capture is available on Windows; committed speech is added to the page as you
  speak.
- **Translation:** Translate a text selection or page into a new tab, or translate a browser page
  in place and restore its original text. Install and trust the **Translate** board to provide the
  local translation service; missing language models are downloaded with your consent.

---

## Version 5.0.14

### Improvements

- **Agent sessions:** Expanded the v1 `agent.session` contract with provider routing, opaque resume
  ids, capability flags, and session status fields.

### Bug Fixes

- **Boards:** A board page tab follows a renamed board: after a board changes its name, the tab
  shows the new name when the board is reloaded or the app restarts.

---

## Version 5.0.13

### New Features

- **Right-pinned pages:** Keep reference pages in chips at the right of the header and open them in
  a resizable popover while your active work page stays in place. Right-click a tab to pin it left
  or right; scripts can inspect `app.pages.popoverPage` and open or close the popover.
- **Board bridge 1.42.0:** Boards can declare multi-line settings. String settings with
  `format: "multiline"` use a multi-line editor in Persephone's Settings page and save when focus leaves the field. Boards that
  rely on this behavior require bridge `1.42.0` through `minBridgeVersion`.
- **Service board settings:** Host-managed module services can read their board's declared settings
  and subscribe to effective changes, including manifest defaults after reset.
- **Private MCP sessions for board agents:** Authorized board services can issue a loopback MCP
  endpoint for one agent session, then revoke it when that session ends. Issuance requires the
  board's `appScripting` permission and uses the existing bridge `1.42.0` release.
- **Board service channels:** Board frames can open ordered, two-way streaming channels to their
  own module service, with bounded backpressure and lifecycle cleanup under the same bridge release.
- **Cross-board service interfaces:** Trusted boards can declare exact-version service interfaces
  and connect through the existing bounded channel. Consumer `uses` grants are disclosed as Full
  access; provider trust and service permission are checked independently.
- **Footer chips for boards:** Board footer text items accept `variant: "chip"`, which shows the
  text as a compact bordered pill, so several values can sit side by side and stay distinct. Part of
  bridge `1.42.0`.
- **Agent Session guide:** Board authors can follow the `agent.session` v1 contract for streaming,
  resumable CLI sessions with bounded permissions and approvals.

### Bug Fixes

- **Mermaid diagrams with line breaks render again.** A label containing `<br/>` left the
  diagram blank, showing only a "Mermaid Diagram" placeholder, in Mermaid pages, Markdown
  previews, and the Log View.
- **Explorer and open files keep following disk changes.** Dropping a file onto the window or
  clicking a file or external link could silently stop every file and folder watch in that window
  until restart, so new files never appeared in Explorer.
- **Pasting cells copied from Excel into an editor or grid pastes the data.** Excel also puts a
  picture of the range on the clipboard, and that picture opened as a "Pasted image" tab instead.
  A screenshot pasted anywhere still opens in the Image viewer.

---

## Version 5.0.12

### Bug Fixes

- **Quitting no longer shows a main-process error.** Closing the app after a file or folder had been watched raised "Object has been destroyed".

---

## Version 5.0.11

### New Features

- **Audio Player board:** a music player with a queue, visualizer, equalizer, crossfade, and its own
  music catalog with ratings, tags, play counts and playlists. Install it from the board catalog, or
  open an audio file and pick it from the editor switch's **+** button.
- **Boards can route files and follow their sources:** `singleInstanceMasks` sends selected file
  types to one board page while other matching files open in place. Boards can step through the
  Explorer folder or Link Editor list a file was opened from, react to page visibility, show the tab's
  mute button, and move an authorized file to the Recycle Bin. Board toolbar inputs get a clear (x)
  button. See the [Boards guide](./boards/index.md).
- **Boards can watch authorized files and folders:** `persephone.watch()` reports file changes in
  batches, respects the board's existing file access, and stops when access is revoked or the board
  closes.
- **Open files follow moves:** renaming or moving a file from Persephone's Explorer keeps its tab
  open at the new location, including unsaved edits. Renames made outside Persephone are followed
  when the file watcher can see both paths; deleted files remain marked as deleted.

### Breaking Changes

- **Video Player audio uses native controls:** audio files still play in Video Player, with themed
  controls for play/pause, seeking, and volume. The audio visualizer, Next and shuffle moved to the
  Audio Player board; see the [Video Player guide](./editors/video.md).

---

## Version 5.0.10

### New Features

- **Interface languages:** choose the app language in Settings; 17 built-in translations, and agents can add or fix packs.
- **Translated boards and installer:** boards and the installer follow the chosen language.
- **Locale-aware formatting:** numbers, byte sizes and day labels follow the active language.

---

## Version 5.0.9

### New Features

- **Custom themes:** derive a full palette from three colors with the Theme Editor board, or through `app.themes`.
- **Persephone and Persephone Light themes:** new installs start on the dark Persephone theme.
- **WebMCP tools:** tools a page registers through `document.modelContext` appear in its agent model.

---

## Version 5.0.8

### New Features

- **Open with:** choose an editor or board for a file from Explorer or Recent Files.
- **HTTPS certificates in Browser:** view a site's certificate from the site-info popover.

### Breaking Changes

- **REST Client is now a bundled board:** scripts must use the board page's `editor.app`; old REST Client tabs and pins are not migrated.

---

## Version 5.0.7

### Breaking Changes

- **Script `ai` global removed:** connect external agents through the MCP server instead.
- **Markdown preview removes active raw HTML** (scripts, iframes, forms and styles).
- **MCP servers refuse browser-based clients** that send an `Origin` header.
- **Release builds ignore `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS`.**
- **Browser cookies are encrypted:** older versions can no longer read them.
- **Web pages cannot open internal Persephone links or schemes.**

### New Features

- **Screen recording:** record the window, active page or editor area from the header.
- **Agents can cancel native dialogs** through `windows[i].nativeDialog.dismiss()`.

---

## Version 5.0.6

### New Features

- **Windows single sign-on for Microsoft work and school accounts:** opt in under **Settings → Browser Profiles** to use the device's sign-in on supported Microsoft pages.
- **Browser site permissions:** pages ask before using sensitive capabilities; review choices from the URL bar or Settings.
- **F12 opens Persephone's DevTools** when no browser page claims the shortcut.

---

## Version 5.0.5

### New Features

- **Segmented board toolbar control:** boards can show a row of joined choice buttons in the page toolbar.

---

## Version 5.0.4

### Breaking Changes

- **Removed legacy board intent inputs:** `app.boards.openBoard()` accepts only `boardRoot`; use `app.capabilities.invoke()` for capability requests.

### New Features

- **Trusted page automation:** drive browser pages, boards, and the window with trusted mouse and keyboard input.
- **Live content-pipe status:** a status-bar badge shows source loading and errors; boards can add status-bar items.
- **Tor and proxy routing:** `app.fetch` and browser profiles can route through Tor or a SOCKS5/HTTP proxy.
- **Custom content providers and URL schemes** for scripts, and inline Image Viewer pixels for agents.
- **Toast alerts for scripts and agents** through `app.ui.alerts`.
- **Board platform:** supervised module services, content providers with ranged reads, capability handlers, toolbar controls, user settings, clipboard writes, and inspectable manifests.
- **Torrent Viewer** opens and restores torrent sources in one shared list.
- **Excalidraw ships as a bundled board,** and Video Player plays media from archives.
- **Unbounded programmatic `call()` results;** pass `maxLength` to set a limit.

---

## Version 5.0.3

### New Features

- **Structured descriptors:** append `.$describe` to a live model path to get its members and children as data.
- **MCP discovery recovers after lost context:** a `call` with no path returns the overview and resets remembered hints.
- **Special folders open their editors:** `.git` and `.mneme` rows open Git Tree or Mneme directly.
- **Boards can edit folders:** a trusted board can declare `folderEditorMasks` to become the editor for matching folders.
- **Clipboard tool and history:** an opt-in clipboard history page, also readable by agents through `clipboard`.
- **Quick settings in the header:** snip actions and live switches for MCP, Mneme, and the clipboard listener.
- **Drag-and-drop pinning** of editors and boards in **Tools & Editors**.

---

## Version 5.0.2

### Breaking Changes

- **Force Graph is now a board:** install it from the board catalog; without it `.fg.json` opens as raw JSON.

### New Features

- **Workspaces:** project folder tabs are workspaces that agents can see and open.
- **Word Wrap:** a Text Editor toolbar toggle, remembered per page, with a default in Settings.
- **Patch/diff highlighting** for `.patch` and `.diff` files.
- **Board guides:** installed boards ship their own guides, plus new AI Vision authoring and board-review guides.
- **`page-activated` event** tells agents when the active page changes.

---

## Version 5.0.1

### New Features

- **Board and web-page models for agents:** a trusted board or an `ai-vision` web page can publish a model that agents inspect and drive through `call`.
- **Change events for agents:** every `call` result carries unseen events, with `events.recent()` and waiting instead of polling.
- **Guided walkthroughs:** agents can tour Persephone, Settings, boards and web pages one highlighted control at a time.

---

## Version 5.0.0

### Breaking Changes

- **MCP and editor scripting APIs changed:** MCP now exposes a single call tool, editor methods live on page.editor, and editor switching uses page.editorSwitches.
- **Browser interaction setting removed:** connected agents can automate browser pages by default, while user-opened Incognito and Tor pages remain protected.

### New Features

- **Agents can inspect and operate the application:** named page models and a shared call surface expose editor state, controls, services, and actions.
- **Shared screen automation:** agents can inspect and interact with browser pages, boards, and the Persephone window.
- **Agent tools and board inventory:** the tools registry supports discovery and execution, and boards.list() reports installed and trusted boards.
- **In-app User Guide browser:** read guides and release highlights from About or with F1.

---

## Version 4.0.23

### Breaking Changes

- **Removed the React script global:** scripts that reference it must now import or bundle their own dependency.

---

## Version 4.0.22

*Maintenance release: bug fixes and improvements.*

---

## Version 4.0.21

*Maintenance release: bug fixes and improvements.*

---

## Version 4.0.20

*Maintenance release: bug fixes and improvements.*

---

## Version 4.0.19

*Maintenance release: bug fixes and improvements.*

---

## Version 4.0.18

### Breaking Changes

- **Built-in PDF viewer removed:** install the published PDF Viewer board to open local, archived, and web PDFs.
- **Markdown custom-editor priority changed:** boards must use an editorPriority above 10 to take precedence over Markdown Preview.

### New Features

- **Markdown opens in Preview by default:** switch to Text Editor when you need the raw source.
- **Tor connection details:** view the exit IP and location, and reconnect to request a fresh circuit.
- **Board and Grid improvements:** manage board folders from context menus, filter Grid columns by text, and scope board editors to folders.

---

## Version 4.0.17

### Breaking Changes

- **Built-in Todo editor removed:** install the published Todo board for the dedicated task-list interface.

### New Features

- **Boards can store private secrets:** boards get isolated, optionally encrypted environment-variable storage outside their folders.
- **Agents can provision board secrets:** scripts can set up and manage board variables before a board runs.
- **Boards gain app-style interactions:** a default context menu works automatically, and content-host boards can set footer status text.

---

## Version 4.0.16

### New Features

- **Boards can run bundled Node.js scripts:** persephone.executeNode() works without a system Node installation.
- **Boards gain theme chrome tokens:** new background, hover, and selection colors match Persephone's interface.

---

## Version 4.0.15

*Maintenance release: bug fixes and improvements.*

---

## Version 4.0.14

### New Features

- **Boards can act as custom editors:** content-host boards share file handling and live content with built-in editors, and boards can add synchronized sidebar panels.
- **Published board catalog:** discover, install, update, roll back, and uninstall project boards.
- **Tools & Editors hub:** browse editors and boards in a full-page view with catalog search.
- **File and folder shortcuts:** drag Explorer files to Windows Explorer or Teams, open custom folders in tabs, and launch a terminal from folders.

---

## Version 4.0.13

### New Features

- **File Explorer works more like Windows Explorer:** use clipboard cut/copy/paste, real selection, keyboard navigation, and an Add Folder button.
- **MCP can read images and automate Persephone:** agents can receive image pages and explicitly interact with the app window.

---

## Version 4.0.12

### New Features

- **Agent Tools registry:** register reusable scripts as parameterized tools discoverable and runnable over MCP.

---

## Version 4.0.11

### New Features

- **Boards can run in dedicated tabs:** opening a board in its own tab keeps it running while you work elsewhere.
- **Long-running board processes:** boards can keep spawned jobs alive across navigation and reconnect to them later.

---

## Version 4.0.10

*Maintenance release: bug fixes and improvements.*

---

## Version 4.0.9

*Maintenance release: bug fixes and improvements.*

---

## Version 4.0.8

### New Features

- **Screen Snip:** capture a region of the window from the header.
- **Markdown Preview navigation:** follow in-page links with Back history and use an image hover toolbar.
- **Mermaid to Excalidraw:** convert a Mermaid diagram into an editable drawing.

---

## Version 4.0.7

### Breaking Changes

- **Removed .persephone project mode:** the legacy board project mode is no longer supported.

### New Features

- **Boards integrate with Explorer:** browse boards in a switcher, use in-board toolbar actions, and inherit trust where appropriate.

---

## Version 4.0.6

### New Features

- **Boards:** add-on boards provide extensible app tools and editors.
- **Quick folder opening and richer paste:** open folders from Tools & Editors and paste HTML-only images from Office applications.

---

## Version 4.0.5

*Maintenance release: bug fixes and improvements.*

---

## Version 4.0.4

### New Features

- **Mneme knowledge base:** use the built-in knowledge base, which is off by default.
- **Image paste and HTML export:** paste images globally and export HTML Preview images from its toolbar.

---

## Version 4.0.3

### New Features

- **Git integration:** browse repositories with a Git Tree, Branches & Tags, and Changes panels.
- **Git operations and diffs:** commit changes and compare revisions in the Git Diff editor.
- **Image export and browser profiles:** save rendered images as PNG and let MCP recognize browser profiles.

---

## Version 4.0.2

### New Features

- **Folder View navigation:** browse folders with breadcrumb navigation.
- **Editor sidebar panels (through 5.0.17):** Links, Bookmarks, Notebook, Todo, and REST Client gain persistent sidebar views.

---

## Version 4.0.1

### Breaking Changes

- **Persephone 4.0 resets session data on first launch:** the major release also removed IEditorInfo.category from the script API.

### New Features

- **Azure DevOps Mermaid syntax:** Markdown Preview supports Mermaid diagrams using Azure DevOps wiki syntax.

---

## Version 3.0.9

### New Features

- **Cross-editor drag and drop:** move content between editors and drag pinned tabs.

---

## Version 3.0.8

*Maintenance release: bug fixes and improvements.*

---

## Version 3.0.7

### New Features

- **Audio and Links improvements:** Audio Player adds Next Track and Shuffle, while Links gains tag editing and a save button.

---

## Version 3.0.6

*Maintenance release: bug fixes and improvements.*

---

## Version 3.0.5

### New Features

- **Audio Player:** play audio with a spectrum visualizer.

---

## Version 3.0.4

### Breaking Changes

- **Link and scripting APIs changed:** the Link Editor browser selector and three link-event classes were removed.

### New Features

- **Video Player:** play video files in the application.

---

## Version 3.0.3

### New Features

- **Claude scripting and MCP resources:** scripts can use ai.ClaudeSession, and the MCP Inspector supports interactive resource templates.

---

## Version 3.0.2

### New Features

- **Browser automation:** scripts and MCP tools can inspect and control browser tabs, wait for page events, and manage tabs.

---

## Version 3.0.1

### Breaking Changes

- **Script and content APIs updated:** page.sourceLink and io.ZipTreeProvider were removed, archive and editor values were renamed, and tree-item fields changed.

### New Features

- **Browser controls:** add Tor mode, a page menu, and network capture in Show Resources.
- **Expanded script page API:** add page closing, opening links, editor creation, and MCP Inspector navigation.
- **File and archive support:** handle multi-file drops, extract HTML resources, and open more archive formats.

---

## Version 2.0.4

### New Features

- **Archive Editor:** browse files inside supported archives.
- **Page source links:** scripts can inspect a page's sourceLink.

---

## Version 2.0.3

### New Features

- **HTTP and archive content:** open remote and archived content in compatible editors.
- **Folder navigation:** use the File Explorer panel and dedicated Folder View.
- **Script I/O APIs:** use the io namespace and synchronous or asynchronous app events.
- **Open URL dialog:** navigate to a URL with Ctrl+O.

---

## Version 2.0.2

### New Features

- **Background scripts:** app.runAsync() runs work in a background worker.
- **Graph View export:** copy graphs to the clipboard or open them in the Drawing editor.
- **Explorer drag and drop:** move files by dragging them in File Explorer.

---

## Version 2.0.1

### Breaking Changes

- **Rebranded as Persephone:** the app received a new icon and versioned release identity.

---

## Version 1.0.31

*Maintenance release: bug fixes and improvements.*

---

## Version 1.0.30

*Maintenance release: bug fixes and improvements.*

---

## Version 1.0.29

*Maintenance release: bug fixes and improvements.*

---

## Version 1.0.28

### New Features

- **HTTP scripting and REST Client:** scripts can make HTTP requests with app.fetch(), and REST collections have a dedicated editor.

---

## Version 1.0.27

### New Features

- **Browser bookmarks and DRM video:** scripts can react to browser bookmarks, and protected video playback is supported.

---

## Version 1.0.26

### New Features

- **Browser and bookmark controls:** add Tor mode, bookmark menus, rich link tooltips, tab reordering, and page audio indicators.
- **Script automation:** scripts can autoload and report progress.

---

## Version 1.0.25

*Maintenance release: bug fixes and improvements.*

---

## Version 1.0.24

### New Features

- **MCP Inspector and request log:** inspect MCP connections and review requests.
- **Tools & Editors panel:** browse and pin editors, with a script API to open panels.

---

## Version 1.0.23

### New Features

- **Drawing Editor:** create and export Excalidraw drawings, including images captured with Screen Snip.
- **Open in Drawing Editor:** send images, SVGs, and Mermaid diagrams to a new drawing.

---

## Version 1.0.22

### New Features

- **Graph View editing and grouping:** select and group nodes, edit graph data, and control visibility with legends and search.
- **Graph View exports and scripting:** inspect graphs with a script API, export selections to Markdown or Grid, and keep long scripts responsive with await ui().

---

## Version 1.0.21

### New Features

- **Graph View editor:** explore and edit force graphs with node search, properties, links, layout controls, and expandable visibility.

---

## Version 1.0.20

### New Features

- **Archive browsing:** open ZIP and ASAR archives.
- **MCP URL tool:** agents can open URLs with the open_url tool.

---

## Version 1.0.19

### New Features

- **Log View and MCP interactions:** view streamed logs and let agents use dialogs, progress, and formatted outputs.

---

## Version 1.0.18

### New Features

- **Script Library:** import reusable libraries with IntelliSense and a setup wizard.
- **Script Panel controls:** select and save scripts from the panel.

---

## Version 1.0.17

### New Features

- **AI agent integration:** connect through the MCP HTTP server and run TypeScript scripts.
- **Script interactions:** add text dialogs, output suppression, and page.runScript().

---

## Version 1.0.16

### New Features

- **Browser Download Manager:** manage downloads from browser pages.

---

## Version 1.0.15

*Maintenance release: bug fixes and improvements.*

---

## Version 1.0.14

### New Features

- **Browser Bookmarks:** save and manage bookmarks in browser pages.

---

## Version 1.0.13

### New Features

- **Browser and Link editors:** browse the web, organize links, and quickly create link collections.

---

## Version 1.0.12

### New Features

- **Search in Files:** find text across a folder tree with filters and incremental results.

---

## Version 1.0.11

### New Features

- **Todo Editor:** organize tasks in lists with tags, filtering, and search.

---

## Version 1.0.10

### New Features

- **Folder tabs and Markdown search:** open folders in new tabs and find text in Markdown Preview.

---

## Version 1.0.9

### New Features

- **Pinned Tabs:** keep important tabs compact, visible, and preserved across restarts.

---

## Version 1.0.8

### New Features

- **File Explorer, themes, and HTML Preview:** browse files alongside documents, customize the app theme, and preview HTML.
- **Quick Add menu:** create common editor pages from the tab bar.

---

## Version 1.0.7

### New Features

- **Markdown View enhancements:** add syntax-highlighted code blocks, copy actions, and Mermaid diagrams.

---

## Version 1.0.6

### New Features

- **Mermaid editor and Notebook (before its 5.0.18 move to a board):** preview diagrams and organize structured notes.
- **Copy images:** copy images from Image Viewer and SVG Preview to the clipboard.

---

## Version 1.0.5

### New Features

- **About and updates:** view app details and check for new releases.
- **Image and SVG viewers:** preview image files and rendered SVGs.

---

## Version 1.0.4

*Maintenance release: bug fixes and improvements.*

---

## Version 1.0.3

### New Features

- **Grid and file operations:** improvements to JSON/CSV viewing and file handling.

---

## Version 1.0.2

*Maintenance release: bug fixes and improvements.*

---

## Version 1.0.1

### New Features

- **Initial public release:** Monaco editing, JavaScript execution, JSON/CSV grids, Markdown and PDF previews, tab management, and file encryption.

---

## Planned Features

See [GitHub Issues](https://github.com/andriy-viyatyk/persephone/issues) for planned features and known issues.

### Coming Soon

- Testing infrastructure
- Keyboard shortcut customization
