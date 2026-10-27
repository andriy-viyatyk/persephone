---
title: "What's New"
audience: both
summary: "Release notes, newest first — the last 10 releases in full, older ones condensed to features and breaking changes; call guides.whatsNew instead for just the running version's section."
---

# What's New

Release notes and changelog for Persephone (formerly js-notepad).

---

## Version 5.0.15 (Upcoming)

### Improvements

- **Speech to text:** Install the Speech to Text catalog board from `persephone-boards` to provide
  transcription. Agent Chat shows a voice button when a provider is installed and can stop dictation
  after silence using the shared Voice Typing setting. Both boards require Persephone 5.0.15 or later;
  board authors can also use the reserved `speech.transcribe` v1 service contract.
- **Voice typing:** Dictate into a focused input with `Alt+V`; configure the shortcut in Settings, including a tap of the right `Ctrl` key alone. Install and trust the Speech to Text board to use it.
- **Transcript in the Text Editor:** Capture microphone audio, computer audio, or both into a text
  page. Computer audio capture is available on Windows; committed speech is added to the page as you
  speak.

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
