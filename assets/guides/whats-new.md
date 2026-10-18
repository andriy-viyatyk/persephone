---
title: "What's New"
audience: both
summary: "Release notes, newest first — the last 10 releases in full, older ones condensed to features and breaking changes; call guides.whatsNew instead for just the running version's section."
---

# What's New

Release notes and changelog for Persephone (formerly js-notepad).

---

## Version 5.0.13 (Upcoming)

*No changes yet.*

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
  button. See the [Boards guide](./boards.md).
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

- **Choose the interface language:** In Settings > General > Language, select Automatic or an
  available language pack. A selection reloads all open windows and restores their pages. Compatible
  packs can be placed in `%APPDATA%\persephone\data\languages\`; the picker shows each pack's
  completeness. Persephone now ships 17 built-in translations alongside English. Ask your AI agent
  to add a language, update a pack, or fix a translation; it can validate changes before saving.
- **The whole interface is translatable:** every menu, dialog, panel and editor now reads its text
  from the language pack. The text editor's own find box, context menu and command palette follow
  the language for the languages Monaco ships (German, French, Spanish, Polish, Japanese and more).
- **Boards follow the app language:** the bundled REST Client and Excalidraw boards and the
  catalog boards show their text, names and descriptions in the chosen language. Board authors can
  ship language packs in a board's `lang` folder.
- **Installer in your language:** the installer starts with a language choice and shows all its
  screens in that language.
- **Locale-aware formatting:** Numbers, byte sizes, and relative day labels follow the active
  language where available.

---

## Version 5.0.9

### New Features

- **Create and manage custom themes:** Persephone derives a full palette from background, text, and
  accent colors. Install the Theme Editor board from **Tools & Editors** to create, edit, export,
  and import themes; saved themes appear in Settings and theme cycling. Scripts and MCP can also
  inspect, preview, save, and apply themes through [`app.themes`](./scripting/api/themes.md).
- **Persephone themes and a new starting theme:** Choose the dark **Persephone** theme or the light
  **Persephone Light** theme. New settings use Persephone by default; an existing valid saved theme
  remains selected.
- **Browser pages can provide WebMCP tools to agents:** tools registered through
  `document.modelContext` appear in the page's agent model, with cautions for tools that may have
  side effects. This integration is disabled in Incognito and Tor.

### Bug Fixes

- **Browser find-in-page keeps searches responsive:** typing updates the current search without
  freezing the app, and Enter/F3 or Shift+Enter/Shift+F3 moves through matches in the same search.
- **Boards can open web links without external-launch permission:** when link behavior is set to
  the OS default browser, HTTP(S) links from boards without `openExternal` open in an internal
  Browser tab and are noted in the board log. Other external schemes remain blocked.
- **Lists and trees fit their scrollbar right away:** when expanding or collapsing items in Explorer
  (or any list or grid) shows or hides the scrollbar, the rows and the selection resize at once
  instead of on the next mouse move.

---

## Version 5.0.8

### New Features

- **Choose an editor before opening a file:** right-click a file in Explorer or Recent Files and choose **Open with**. Compatible built-in editors and matching boards appear beneath the default choice; **Default App** hands the file to Windows.
- **View HTTPS certificates in Browser:** open the site-info popover and choose **View certificate**.
  Install the **Certificate Viewer** board from the Boards catalog to see decoded certificate details;
  without it, Persephone opens the certificate chain as PEM text.

### Breaking Changes

- **REST Client is now a bundled board:** scripts that used `pages[i].editor.id === "rest-client"`
  must select the REST Client board page (whose editor id starts with `board-editor:`) and use
  `pages[i].editor.app` for its model. The old built-in editor id and facade are removed; the
  `.rest.json` collection format remains supported. Tabs saved by an older version may restore
  empty or be dropped, and old REST Client pins are ignored; reopen the collection file to continue.

### Improvements

- **Agents can automate Persephone more reliably:** script execution returns a pollable run ID when
  it is waiting on a dialog or a long-running script, and shared UI automation supports text
  locators plus coordinate clicks and drags. Scripts can resize the sidebar, expand Explorer
  folders, set a Board Info install directory, and hide recording controls and the MCP indicator
  during capture. See the [Page API](./scripting/api/page.md), [window API](./scripting/api/window.md),
  and [editor API](./scripting/api/editors.md).
- **New installations start with Open Folder and Open File pinned:** the **+** new-page menu now
  opens with **Open Folder**, **Open File**, TypeScript script, **Excalidraw**, CSV grid, and Browser.
  An existing pinned list is kept; pin the new items from **Tools & Editors**.

### Bug Fixes

- **Automation and navigation edge cases are fixed:** board paths work with either slash style,
  local folder labels use canonical Windows paths, search results stay visible below sticky scroll,
  and switching away from Archive no longer leaves an empty sidebar. Tooltips no longer block
  automation clicks, and Explorer folders can be expanded by path.
- **Slow board methods no longer time out at 30 seconds over MCP:** an agent's `call` into a board's
  or web page's `.app` model now honors its `timeoutMs` and the method's declared timeout, so a
  board can offer waits such as "wait for the user's move".

---

## Version 5.0.7

### Breaking Changes

- **Removed the script-level Claude API integration:** scripts no longer expose the `ai` global. Scripts that use it now fail with `ReferenceError: ai is not defined`. Connect external agents to Persephone through the MCP server instead; see the [MCP Server Setup guide](./mcp-setup.md).

- **Markdown preview removes active raw HTML:** scripts, iframes, forms, and styles in Markdown are removed. Documents that relied on those elements may look different.

- **Browser-based MCP clients are refused:** requests sent from web pages include an `Origin` header and are no longer accepted by the Persephone or Mneme MCP servers. Desktop agents and Persephone's in-app MCP Inspector are unaffected; see the [MCP Server Setup guide](./mcp-setup.md).

- **Release builds ignore `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS`:** Persephone no longer reads these environment variables.

- **Browser cookies are now encrypted:** if you return to an older Persephone version after using 5.0.7, that version cannot read the encrypted cookies and you will need to sign in to websites again.

- **Browser pages cannot open internal Persephone links or schemes:** web pages can no longer launch Persephone's internal links. Popup windows are also blocked from navigating to local files or non-web schemes.

### Security

- **Browser site extensions require your trust:** agents can build reusable page models with scripts, but a script runs with the signed-in site's capabilities only after you choose **Trust**. Manage extension folders and trust in Settings and Tools & Editors. Incognito and Tor pages never run extensions. See the [Site Extensions guide](./site-extensions.md).

- **Boards now enforce declared permissions:** the Trust board dialog shows the requested access, marks broad grants as **Full access**, and when a trusted board adds or expands a permission it shows **Board permissions changed** with the kept, added and removed permissions in one list and two choices: **Accept** or **Unregister board**. Boards without an object-form permissions declaration are marked **Unrestricted** and deprecated; trusted legacy boards show a persistent warning when opened. See the [Boards guide](./boards.md#board-trust-gate).

- **Board file access follows the permissions granted at trust time:** boards can be limited to their own folder or files selected in their dialogs, while object-form boards' `board://` assets stay inside their folder.

- **Internet-only boards are protected from DNS rebinding:** Persephone checks DNS results and connects to the checked public addresses; requests resolving to local or private addresses are blocked. See the [Boards guide](./boards.md#service-declarations-in-board-manifestjson).

- **Markdown and Mermaid previews are safer:** raw HTML in Markdown is filtered; scripts, iframes, forms, and styles are removed. Mermaid diagrams render in strict mode.

- **MCP servers reject browser requests:** Persephone and Mneme refuse requests from web pages to prevent DNS-rebinding and Origin-based attacks. Desktop agents and the in-app MCP Inspector continue to work; see the [MCP Server Setup guide](./mcp-setup.md).

- **The main window has a stricter security policy, and HTML previews use an isolated `html-preview://` origin.**

- **Electron's security fuses are locked in release builds.** The environment-variable and browser-cookie effects are listed under [Breaking Changes](#breaking-changes).

- **Browser downloads carry Mark-of-the-Web:** Windows SmartScreen and Office Protected View can apply their usual protections to downloaded files.

### New Features

- **Record the Persephone window, active page, or editor area:** choose a region from quick settings, then control capture in the header. Review the video in Video Player and use **Save as…** or **Discard**. Closing the player without saving deletes the recording; anything left over is cleaned up after seven days. Agents can also record through `window.screen.recording`; see the [Header Strip guide](./screens/header.md), [Video Player guide](./editors/video.md), and [window API reference](./scripting/api/window.md).

- **Agents can cancel native dialogs:** an agent working through MCP is told when a native file dialog is open and can close it with `windows[i].nativeDialog.dismiss()`. It can only cancel; it never picks a path or confirms. See the [MCP Server Setup guide](./mcp-setup.md).

### Improvements

- **MCP gives agents clearer hints, better search, and complete screenshots:** image results from `call` are returned as inline images without `maxLength` truncation, guide search and `helpSearch` rank the answers to plain questions such as "show a table to the user" first, and hints no longer repeat the same warning or the same pending-dialog notice on every call. See the [MCP Server Setup guide](./mcp-setup.md) and [AI Vision guide](./agents/ai-vision.md).

- **Browser downloads start while Save As is open:** the file downloads in the background while you pick a location, and the rest of Persephone keeps responding. A download that finishes first shows **Waiting for save location** in the downloads list until you choose where to save it; cancelling the dialog cancels the download.

---

## Version 5.0.6

### New Features

- **Windows single sign-on for Microsoft work and school accounts:** opt in under **Settings → Browser Profiles** on Windows to use the device's sign-in proof on supported Microsoft sign-in pages. It is off by default and does not apply to Incognito or Tor. See the [Browser editor guide](./editors/browser.md#windows-single-sign-on).

- **Browser site permissions:** pages can ask before using sensitive capabilities. Answer with
  **Allow** or **Block**, review or reset choices from the **Site permissions** button in the URL
  bar, and manage saved decisions under **Settings → Browser → Browser Profiles**. Incognito and
  Tor choices remain in memory for the private session. See the [Browser editor guide](./editors/browser.md#site-permissions-and-prompts).

- **F12 opens Persephone's DevTools** — Press `F12` when no browser page claims the shortcut to
  open DevTools for Persephone. An active browser page keeps `F12` for its own page DevTools.
  See [Keyboard Shortcuts](./shortcuts.md).

### Improvements

- **The browser remembers your search engine:** the engine picked in the URL bar is preselected
  in new browser pages, with one choice for profile pages and another for Incognito and Tor pages.
  See the [Browser editor guide](./editors/browser.md#url-bar).

### Bug Fixes

- **Cloudflare "Verify you are human" checks pass in browser pages:** the checkbox no longer
  reloads the page with the same check again. Every frame of a page, including the challenge
  frame, now reports the same Chrome identity.

- **Browser video fullscreen works as expected:** fullscreen video now fills the app window, and
  fullscreen ends when you press `Esc` (including when Persephone has keyboard focus), close the
  browser tab, or leave it hidden.

- **Browser pages recover from lost mouse releases:** opening a new tab or popup, or moving focus
  away, no longer leaves a page behaving as if a mouse button is still held.

---

## Version 5.0.5

### New Features

- **Segmented board toolbar control:** boards can put a row of joined choice buttons, like the
  editor switch, in the page toolbar with `type: "segmented"`. Options take a label, an icon, or
  both. Board bridge `1.28.0`. See the [boards guide](./boards.md#in-board-toolbar).

### Bug Fixes

- **Board toolbar selects and toggles show the picked value:** choosing an option in a board's
  toolbar select, or clicking its toggle, now updates the control itself. Before, the board received
  the new value but the control kept showing the old one.

---

## Version 5.0.4

### Breaking Changes

- **Removed legacy board intent inputs:** `app.boards.openBoard()` accepts only `boardRoot`, and
  `ILinkData.intent` has been removed. Scripts should call `app.capabilities.invoke()` for
  capability requests.

### New Features

- **Trusted page automation:** scripts and agents can drive browser pages, boards, and the app window
  with trusted mouse and keyboard input. Actions check that targets are visible and actionable,
  snapshots can be scoped or limited to interactive elements, and the shared surface adds waits,
  page events, drag, form filling, file upload, and response inspection. Browser response bodies are
  opt-in and may contain sensitive page data. See the [Page API](./scripting/api/page.md#browser-board-and-window-page-automation)
  and [Browser editor guide](./editors/browser.md).

- **Live content-pipe status and faster page opens:** a badge in the editor status bar shows source
  loading, progress, completion, or errors and opens provider/transformer details. The status bar is
  available under every content editor: it shows the source provider icon, keeps script and encoding
  controls in text editors, and lets boards without a content host show `persephone.setStatusText()`.
  Its details popover opens upward. Editors that defer restore show a loading tile capped at 60% of
  the page width, with wrapped, selectable source names, a close button, and **Retry**. Scripts can observe `pipe.stages`,
  `pipe.summary`, and `pipe.onStatusChange()`, inspect `page.pipe`, and await `page.ready`; MCP can
  inspect pipe stages and summary. Boards can report provider state, detail, byte progress, and
  transfer rate through bridge 1.26.0, and add transient text and buttons with update and action
  handling through `persephone.statusBar` in bridge 1.27.0. Items can be hidden or aligned to the
  end of the board's footer area. See the [Page API](./scripting/api/page.md#content-restore-and-pipe-status),
  [`io` API](./scripting/api/io.md#icontentpipe), [MCP pipe access](./agents/ai-vision.md#inspecting-a-pages-content-pipe),
  [page area guide](./screens/sidebar.md#while-page-content-is-restoring),
  [service-backed content providers](./agents/boards.md#service-backed-content-providers), and
  [Boards](./boards.md).

- **Scripts and trusted boards can route HTTP requests through Tor or a proxy:** `app.fetch(url, { tor: true })`
  uses Persephone's Tor daemon, while `{ proxy: "socks5://host:port" }` or a bare `host:port`
  selects a SOCKS5 proxy. Trusted boards can use `persephone.fetch(url, init)` for remote requests
  from their frame. Routed calls never fall back to direct connections; SOCKS5 resolves host names
  remotely, including `.onion` addresses through Tor. See the [`app.fetch` API](./scripting/api/app.md#fetchurl-options)
  and [Boards](./boards.md#offline-first-and-the-csp).

- **Scripts can inspect normalized board manifests:** `page.editor.getManifest()` returns the values
  Persephone applies, including `browserUrlMasks`, `contentMasks`, `singleInstance`, `settings`,
  `guides`, and capability `alwaysOpensNewPage`. Board Info's `page.editor.properties` exposes the
  same fields alongside install and trust state. Lists and nested declarations are copied, and
  optional fields remain absent when undeclared. See [Boards — Inspecting board metadata from scripts](./boards.md#inspecting-board-metadata-from-scripts).

- **Agents can read Image Viewer pixels inline:** after narrowing an image page's editor to
  `image-view`, call `read()` to receive a bounded PNG image block with applied and original
  dimensions. It works for inactive pages and does not write a temporary file.

- **Scripts can register custom content providers and URL schemes:** use `io.registerProvider()` and
  `io.registerScheme()` to make script-defined content readable through Persephone's normal
  link-opening flow. Scheme hooks can hand off to that flow with `context.handoff()`, and scheme
  matching is case-insensitive. Registrations remain available in the current window until it is
  reloaded or restarted. See the [`io` API reference](./scripting/api/io.md#registering-providers-and-url-schemes).

- **Scripts and agents can monitor toast alerts:** use `app.ui.alerts` or `ui.alerts` to check
  severity, message, and creation time, and dismiss alerts when useful. Error and warning toasts
  also reach the agent event feed. See the [`app.ui` API reference](./scripting/api/ui.md#alerts).

- **Browser profiles can route through a proxy:** named profiles, Default, and Incognito can use
  **Direct** or an unauthenticated SOCKS5/HTTP proxy in **Settings → Browser Profiles**. A proxied
  page shows a connection chip with egress IP and location. Pages fail to load if the proxy is down,
  and page loads, downloads, favicons, and Link editor preview images use the same route. Tor mode
  also routes tab favicons, **Open Image in New Tab**, board-claimed downloads, and WebRTC through
  Tor. See [Browser — Profile network (proxy)](./editors/browser.md#profile-network-proxy).

- **Boards can declare supervised module services:** a trusted board can name an ESM service entry
  that starts lazily under main-process supervision, answers requests without an open board page,
  and shares the board frame's `persephone.storage`. One service handles activity from multiple
  windows, so reloading one window does not interrupt the others. Live state, failures, restart
  counts, and process identity are visible through `boards.list()`. Board permissions are now
  enforced; see the [Boards guide](./boards.md#service-declarations-in-board-manifestjson). Bridge 1.22.0 adds
  `persephone.service.onRequest(handler)` and `onShutdown(fn)`; the host owns ready, probe, replies,
  and shutdown, while raw-protocol services remain supported during migration. See [Boards — declared
  services](./boards.md#declared-services-storage-and-lifecycle) and the [service authoring guidance](../board-template/CLAUDE.md#declared-module-services-manifestservice).

- **Boards can provide content and ranged pipe pages:** declare a namespaced `contentProviders` type
  and register its provider from the service. Optional `readRange` enables bounded pulls; providers
  without it retain the bounded whole-resource fallback. `editorKind: "stream-host"` exposes
  `persephone.host.streamUrl()` for `Range` reads without a materialized source file. Saved pages
  retain their provider descriptor and show a recoverable missing/unavailable state if the board is
  absent or its service cannot start. `persephone.content.open()` gives simple boards an origin-local
  ranged URL. Bridge 1.23.0 also unifies MIME detection through the shared extension table for
  `board://` files and `__pipe` responses, including documents, archives, and fonts; Markdown, CSV,
  XML, and YAML board files are served as UTF-8.

- **Torrent Viewer opens and restores torrent sources in one shared list:** the board uses bounded
  `readRange` pulls and self-contained `torrent/viewer` descriptors with the full URL and embedded
  magnet. Its `browserUrlMasks` claim cancels matching Browser downloads before saving them and
  opens their source in the board; claims from Tor or Incognito pages fetch through that page's
  session. Bridge 1.24.0 reports private source sessions through `source.onOpen` and
  `source.initialSourcePrivateSession`, so the board can show that tracker and peer connections are
  not anonymous. Later sources, including those targeted at another page, reach the existing Torrent
  Viewer page without replacing it and retain the session used to fetch them. Each window has one
  page and shares its torrent list across windows. `persephone.icons.forFiles(names)`
  returns Explorer file icons for board lists, and the Torrent Viewer uses it for its file list.
  See [Boards](./boards.md) and [Boards — Integration methods](./boards.md#integration-methods).

- **Browser links can open registered board schemes:** clicking a trusted board's registered custom
  scheme routes through Persephone's content pipeline; unregistered non-web schemes remain blocked.

- **Video Player plays archive-hosted media:** audio and video entries from supported archives can
  play and seek without loading the full source first. When VLC is available, **Open in VLC** uses
  the same streamed source.

- **Boards can provide named capability handlers and link routing:** declare capabilities in a
  trusted board's manifest, receive structured requests through `persephone.intent`, and let scripts
  or other boards discover and invoke handlers without knowing their owner. Built-in handoffs open
  and edit content; image data URLs can route with `openRawLink(imageDataUrl, { editor: "image.edit" })`;
  the old `{ editor: "draw-view" }` form no longer routes. When no handler is available, Persephone
  explains that no image or diagram editor is registered and points to Tools & Editors or a replacement board.
  Bridge 1.19.0 preserves handler results, supports discarding a page opened for a failed request,
  and allows a fresh handler page per invocation; 1.20.0 serializes up to 32 active and queued
  requests per handler page in FIFO order, rejecting expired deadlines and sending a best-effort
  cancel; 1.21.0 scopes `content.view` by representation for discovery. See [Boards — capability
  handlers and in-memory intents](./boards.md#capability-handlers-and-in-memory-intents) and the
  [`app.capabilities` API](./scripting/api/app.md#capabilities).

- **Excalidraw ships as a bundled board:** `.excalidraw` files and image/diagram handoffs use the
  offline-capable board by default. It appears under **Built-in** with a **Disable** action that
  removes its capabilities; if no replacement is installed, Persephone explains that no image or
  diagram editor is registered. The disabled entry stays available to **Enable** again. Excalidraw library browsing returns to the
  drawing, asks before adding a library, and merges accepted items with the existing library. The
  board uses its own brand icon and applies Persephone's theme before the drawing app loads, avoiding
  a white flash on dark themes. See [Excalidraw Board](./editors/draw.md#libraries).

- **Boards can put their own controls in the page toolbar:** trusted and bundled boards can declare
  buttons, toggles, menus, selects, and text inputs from a fixed catalog. Persephone renders them in
  its themed toolbar and sends interaction events to the board; boards can also set a text label, and
  the slot stays empty when unset. Recovery actions (**Reload board**, **Open board log**, and
  **Board properties**) share a **…** menu exposed as `board-toolbar-more`; individual recovery
  actions are not addressable controls. The bundled Excalidraw board uses five toolbar controls
  for theme, copy, save as SVG/PNG, open in a new tab, and screen snip. See [Boards](./boards.md).

- **Boards can declare user settings:** typed declarations in `board-manifest.json` appear in
  Settings, explicit values are stored in `board-settings.json`, and boards read effective values
  through bridge 1.13.0's `persephone.settings.get()` and `onChange()`. Users change or reset these
  settings in Persephone, not from the board; the Excalidraw board uses this for its library folder at **Settings →
  Editors → Excalidraw → Library folder**.

- **Excalidraw pages use the board facade:** `pages[i].editor` exposes the board facade instead of
  the removed `IDrawEditor`, `DrawEditorFacade`, and `draw-view` editor id. `app.pages.addDrawPage()`
  remains the supported way to create a drawing page.

- **Programmatic `call()` results are no longer silently truncated:** `app.call()` in scripts and
  `persephone.call()` in boards are unbounded by default. Pass `maxLength` explicitly to set a limit;
  the MCP `call` tool keeps its 20,000-character display limit.

- **Boards can write to the OS clipboard:** board authors can use `persephone.clipboard.writeText()`
  or `persephone.clipboard.writeImage()` for copy actions triggered from Persephone's toolbar, even
  when the board page is not focused. See [Boards — Integration methods](./boards.md#integration-methods).

### Improvements

- **Video Player source field stays on one line:** its URL field expands over the player only while
  you edit it.
- **Video Player recovers when a board content provider becomes available:** failed playback retries
  after the provider is registered, and reopening a failed source link retries in the existing page.
- **Board registration refusals are easier to spot:** provider, scheme, capability, settings, and
  browser URL mask refusals show a toast when they first appear and remain listed in Board Info.
- **Command-line launches accept multiple inputs:** open several files or folders at once, pass an
  `http(s)` URL to open in the built-in browser, or compare two files with
  `persephone.exe diff before.txt after.txt`. Inputs also open in the running Persephone instance.
  See [Getting Started — Installation](./getting-started.md#installation).
- **Settings has a navigable two-pane layout:** settings are arranged as per-group panels, with a
  fixed two-level **Content** tree on the left. Click a group or section to scroll to it; the tree
  follows the panel currently visible as you scroll. Board-declared settings appear in their own
  **Editors** or **Boards** panel.
- **Board path switching uses the Boards panels:** use the **Boards** panel or Explorer's **Boards**
  panel to switch boards instead of clicking the board path.
- **Board logs keep recent history across reloads:** opening or reloading a board adds a separator
  instead of clearing the log. Logs are capped at 256 KiB, trimming older entries as needed; bundled
  boards keep logs under `%APPDATA%\persephone\board-logs\<id>\ui.log`. See [Boards — Error log](./boards.md#error-log-uilog).
- **File Explorer context menus are grouped consistently:** **Cut**, **Copy**, and **Paste** stay
  together, followed by **Rename**, **Delete**, **New File**, and **New Folder**. Pasting or creating
  from a file row targets its parent folder.
- **Sidebar sizing is remembered for new pages:** resize the sidebar once and new pages start with
  that width; the sidebar is capped at 90% of the page area so the editor remains visible.
- **Git Tree remembers its layout for new pages:** column widths and order, plus the lower
  Commit/Diff panel height, carry forward when you open another Git Tree page.
- **Grids no longer flicker while scrolling:** dragging a grid's scrollbar or quickly scrolling a
  long list no longer causes blinking in grid editors, Explorer and Boards trees, Git Changes, or
  Git Tree.

### Bug Fixes

- **Board Info pages survive a restart:** Board properties pages opened from a board or the hub now
  restore after a restart or window reload. When opened from a board on a file, **Open board**
  returns to that board with its file loaded.
- **Files and web links supplied when starting Persephone now open as expected.**
- **A web link that starts Persephone opens inside it when Persephone is the default browser:** it
  no longer bounces back out to the default browser.

---
## Version 5.0.3

### New Features

- **Structured descriptors for board and web-app models:** append `.$describe` to a live model path
  to receive its members and children as data instead of parsing `$help` prose. This is useful for
  model browsers and generated clients; it follows the existing trust and privacy boundaries and
  does not invoke the described node.
- **MCP discovery recovers after lost context:** a `call` with no path returns the
  application overview and resets the session's remembered member-list hints. Use it again after a
  context compaction or whenever the earlier hints are no longer available.
- **Special folders open their editors directly:** clicking a recognized `.git` or `.mneme` row in
  File Explorer now opens Git Tree or Mneme instead of the folder contents. Use the page toolbar's
  Editor switch to move between that editor and **Folder View**; ordinary folders are unchanged.
- **Boards can edit folders directly:** a trusted board can declare `folderEditorMasks` and become
  the editor for matching folders. The Explorer row uses the board's icon, the page toolbar switches
  between the board and **Folder View**, and the same **+** install flow in **Board Info** is available
  when a published folder editor matches. If trust is removed, the open page keeps a recovery path
  back to Folder View. See [Boards — Direct-folder boards](./boards.md#direct-folder-boards).
- **Clipboard tool and history:** **Clipboard** is always available and pinnable in **Tools & Editors**;
  it opens a dedicated page with the history panel. Enable history in Settings to capture copied text,
  HTML, images, and file lists — including copies made inside Persephone, such as `Ctrl+C` or **Copy**
  in the Text Editor and copies made inside a Persephone Browser tab. Capture depends on the copy
  reaching the Windows clipboard, not on which editor or page supplied it. Each row shows a
  content-type icon, preview text, and a compact local capture-time badge; hovering or focusing a row
  swaps the badge for **Copy**, and while the list is focused **Arrow Up** and **Arrow Down** select and
  open adjacent history items. Rows keep a persistent selection, and copied content arrives at the top
  as a new row. File lists open as readable absolute paths rather than watcher metadata. When history
  is disabled, stored rows remain available for opening, copying, removing, and clearing, and the panel
  offers **Open Settings**. History is off by default because stored content may remain readable on
  disk; while it is enabled, stored history is also readable by agents through the `clipboard` call
  namespace.
- **Quick settings in the header:** Open the **…** button in the header to reach **Snip Screen**,
  **Snip Persephone**, and live switches for MCP, Mneme, and the clipboard listener. Service rows
  toggle in place, so the popover stays open while you change more than one setting; the snip actions
  still close it after activation.
- **Drag-and-drop pinning:** In **Tools & Editors**, hover a built-in editor row to reveal **Pin to
  menu**, or drag a built-in editor or registered board to the **Pinned** rail. Drop before a pinned
  row to place it there, or on the rail background to append it. Drag a pinned item onto the
  **Built-in Editors** or **Registered boards** tab body to unpin it.

### Improvements

- **The Explorer's root row shows where the folder is:** the File Explorer tree's root used to show
  only the folder's name, which never said where that folder lives. It now shows the full path beside
  the name, dimmed and slightly smaller. When the sidebar is narrow the path is shortened from the
  **left**, so the deepest part stays visible and the folder name is never cut; the row's tooltip
  still holds the full path.
- **The Boards panel highlights the board you clicked:** board rows now carry the same selection
  and hover highlight as files in the File Explorer, and they are the same height, so the two
  panels line up when you switch between them. The board list in a board's own toolbar and the
  one on the **Tools & Editors** tab match as well.

### Bug Fixes

- **Grid column names stay consistent:** pasting data wider than the current grid or inserting
  several columns at once no longer creates duplicate columns. Header-free CSV columns now use
  spreadsheet-style names (`a`, `b`, `c`, …), matching columns added later and preserving names
  when you switch between Grid and the Text Editor. CSV files with a header row still use their
  actual header names. See [Grid Editor](./editors/grid.md#data-and-editing).
- **Edit Columns headers no longer drag out of place:** the Grid editor's **Edit Columns** popover
  let its three headers be dragged around, which was never intended. They are fixed in place again;
  the popover's own layout was never saved, so a drag only lasted until it closed.
- **Grid headers stay clean when scrolling:** Grid, Git Tree, File Grid, Environment Variables,
  and Log View grid output no longer show a previous column header's tooltip, accessibility label,
  or text in a data cell after scrolling. Fixed in av-grid 2.11.1 and 2.11.2.
- **Closing the Git Tree no longer means expanding its panel first:** the Git panel's **Close**
  button now stays on the panel header even when the panel is collapsed to a strip, so you can
  close the Git Tree without opening the panel to reach it. **Refresh** still appears only while
  the panel is open, since it refreshes the list you are looking at.
- **Closing the Mneme Wiki no longer means expanding its panel first:** the Wiki panel's
  **Close** button now stays on the panel header even when the panel is collapsed to a strip, so
  you can close the Mneme editor without opening the panel to reach it.

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
- **Editor sidebar panels:** Links, Bookmarks, Notebook, Todo, and REST Client gain persistent sidebar views.

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

- **Mermaid and Notebook editors:** preview diagrams and organize structured notes.
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
