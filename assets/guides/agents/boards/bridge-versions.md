---
title: "Boards — bridge version history and compatibility"
audience: agent
summary: "Which bridge version added each persephone.* member and manifest field, the minBridgeVersion to declare, and cross-board service channel limits."
---

# Boards — bridge version history and compatibility

Bridge `1.66.0` adds optional transactional chunked writes to host-service providers
(`writeBegin`, `writeChunk`, `writeCommit`, `writeAbort`) and extends tree-provider `stat()` with
optional link kind, content href (including for a missing destination), and directory deletion mode.
Tree-provider `list()` may return `readOnly: true` to disable write actions for that connection's tree.
Chunks are limited to 1 MiB, each operation has a 10-second deadline, and at most 16 write sessions may be open service-wide.
Boards using the methods should declare `minBridgeVersion: "1.66.0"`; see the content-provider guide
for cancellation, cleanup, and persistent-target recovery requirements.

Bridge `1.65.0` adds `persephone.openTree()` for opening or focusing an accepted board tree and
allows `persephone.openRawLink()` to route links in schemes accepted for the calling board.

Bridge `1.64.0` adds the manifest `contentProviders[].tree` flag and the host-service
`persephone.treeProviders.register(type, implementation)` API for listing, statting, and optional
tree writes. Boards using tree providers should declare `minBridgeVersion: "1.64.0"`.

Bridge `1.63.0` lets `pages[i].editor.attachTestExtension()` accept `scriptPath` as an ordered
array of absolute files or a folder of direct `.js` / `.JS` files, in addition to one file. Board
`persephone.call()` forwards the option through its existing browser-editor route. Files in a folder
load in plain filename order and all selected files run in one scope.

Bridge `1.62.0` treats a trusted click as delivered when the target closes during the release command,
adds `hoverFirst` to click options (default true; automatic hover reveal runs only after a not-visible
actionability result), and applies CSS `:hover` to browser and board guests until the next pointer action.
Trusted browser and board left-clicks also check that the page dispatched a `click` event by default;
pass `{ checkClick: false }` for press-driven pages. A missing event is reported as the coded
`click-not-dispatched` error, with replaced press/release targets named when they differ.
Board calls also expose `mouseDown(target, options?)`, `mouseMove(target, options?)`,
`mouseUp(target?, options?)`, and `wheel(delta, target?, options?)`. Buttons stay held across calls;
move events retain the full CDP button mask so page state can be inspected before release. Locator
targets use actionability checks, coordinate targets use the selected board frame's viewport CSS
pixels, and wheel deltas pass through unchanged. The runner releases held buttons for adopted pages.
Browser page-model access through `pages[i].editor.app` also stays available across same-document
SPA navigation while the page runtime survives; reads wait briefly for an already-running probe.

Bridge `1.61.0` exposes browser-editor `addInitScript(source, options?)`, `waitForDownload(options?)`, and
`route(urlOrRegex, response, options?)`, `unroute(urlOrRegex?)`, and `unrouteAll()`;
`removeInitScript(id, options?)`, and `clearInitScripts(options?)` through
`window.persephone.call()`. Init scripts are scoped to one browser tab and run before scripts in
future documents; they do not run in the current document. Source is limited to 1,000,000
characters and each tab can hold 50 registrations. They cover the main frame and same-process child
frames, not OOPIFs. DevTools detaches CDP, pausing scripts until the next automation call restores
registrations. `waitForDownload()` is limited to agent-opened or test-adopted pages, waits up to
595 seconds, and reports the page-supplied filename plus the captured file path and size. Request routes
are declarative, page-scoped, and limited to test-power pages; the newest matching route wins. See
[Browser automation](../browser.md) for lifecycle details.
The browser editor also exposes `storageState()` and page-scoped `storage.clear()` / `storage.set()`.
Hidden `adoptForTestRun()`, `releaseFromTestRun()`, and `applyStorageStateForTestRun(state)` members
support the web-app test runner through the same call tree. Storage state contains sensitive cookie
and origin data; see the browser and web-app test guides for access and persistence behavior.
The browser editor also exposes `clipboard.arm()`, `clipboard.readText()`, and
`clipboard.writeText(text)` for page-scoped test clipboard observation and input. This is part of
Bridge `1.61.0`; it does not require a version bump. `readText()` reports only text observed from
the page's own writes and never reads the OS clipboard.
The browser editor also exposes `clock.install({ now? })`, `clock.fastForward(ms)`, and
`clock.uninstall()` through `window.persephone.call()`. Install before navigation when application
startup must use fake page time; fast-forward runs due page timers. This extends Bridge `1.61.0`
without another version bump.

Bridge `1.60.0` resolves selectors through one shared path. The existing `text=` selector now
works for synthetic typing and focus, file input selection, and snapshot roots through board calls.
Browser page-model refs are converted to ordinary automation refs before results reach board calls.
Selector strings also support `role=`, `label=`, `placeholder=`, `testid=`, `title=`, and `alt=`
alongside CSS and `text=`. For example, use `role=button[name="Save"]` or `label=Email`;
role and name come from Chromium's accessibility tree, and role name matching normalizes whitespace
and supports substring, case-sensitive exact (`"Save"s`), and `/pattern/flags` forms. Role state
filters support checked, disabled, expanded, level, pressed, and selected; role matches exclude
ignored accessibility nodes unless `[include-hidden]` is specified. `testid=` compares `data-testid`
exactly, and quoted `text=` retains exact matching. Selector strings run in the selected board
frame's main frame; snapshot refs may address joined frame content. Fullscreen remains CSS-only.
Selector strings support `>>` chaining, CSS `:has-text("...")` and `:visible` suffix filters,
and signed `nth=N` steps. Locator objects accept exactly one of `role`, `label`, `placeholder`,
`testId`, `title`, `alt`, `text`, or `selector`, with `name`, `exact`, `within`, `hasText`,
`visible`, and `nth` modifiers. Regex role names use JSON-safe `{ regex, flags? }` objects.
For example, `ref=e12 >> text=Save` scopes to a main-frame ref and `ref=` must be the first step;
frame refs remain available through the direct `{ ref }` form. Snapshot roots and wait selector
APIs remain selector/ref-only.

Bridge `1.60.0` also exposes `count`, `isVisible`, `isEnabled`, `isChecked`, `innerText`,
`allInnerTexts`, `boundingBox`, `query`, and `waitForFunction` through `window.persephone.call()`.
Locator reads resolve through the same selector engines. Single-element reads use strict matching;
pass `{ nth }` to choose a zero-based match. `query` defaults to role, name, trimmed text, visible,
enabled, checked, tag, and ref, and captures at most 200 matches in document order. `value` and
`attributes` are opt-in because they expose page data; raise the outer call `maxLength` for large
results. Role and name are Chromium accessibility facts and may be null when no exposed AX node
exists. Returned refs are ordinary snapshot refs and remain valid while their element stays in the DOM.
Snapshot pointer-generic names may include descendant text even when query's AX name is empty. Selector
engines retain their own query ordering and visibility rules. `boundingBox` uses main-viewport CSS
pixels; OOPIF refs are unsupported. `waitForFunction` accepts a function or source string, JSON-safe
args and results, rAF or numeric polling, and a timeout capped at 28 seconds. It runs caller-authored
JavaScript in the board page and can mutate page state; over `persephone.call()` provide a source
string because call arguments must be JSON. This wait does not extend the outer request timeout.

Bridge `1.59.0` extends trusted board input with `focus(locator)` and `focus: "focus"` on
keyboard actions, relative and timed drags, and `clickAt` / `dragTo` in the selected board-frame
viewport. It also scrolls targets within nested containers before hit testing and reports the
nearest clipping container when a target remains clipped. Browser page-model replies observed through
`persephone.call()` now report navigation during invocation as `page-navigated`, fail reported length
cuts with `result-truncated`, and preserve page-side object key order. These additions are available
through `persephone.call()` and `$help` / `$describe`; no manifest permission is required. Browser
editor calls also accept hidden Playwright aliases with browser-specific unknown-name suggestions,
and trusted automation right-clicks leave Persephone's browser menu closed by default unless
`nativeMenu: true` is passed.

Bridge `1.58.0` adds `persephone.setWorkingFolder(path)`, which sets or clears the transient folder
used as the board page's initial File Explorer root. It requires no manifest permission; only the
trusted main frame may call it. Boards using it should declare `minBridgeVersion: "1.58.0"`.

Bridge `1.57.0` adds `{ inPlace: true }` to `persephone.openRawLink(href, options)`, navigating
content in the page hosting the board without an `appScripting` grant. Boards that use it should
declare `minBridgeVersion: "1.57.0"`.

Bridge `1.49.0` adds toolbar breadcrumbs. Check `persephone.version` before using a bridge member
that may not exist in an older app. Bridge `1.42.0` adds multiline board settings;
boards that rely on them must set `minBridgeVersion: "1.42.0"`. Bridge `1.43.0` adds checkbox
multi-select controls for string settings; boards that rely on them must set
`minBridgeVersion: "1.43.0"`.
<!-- board-template:exclude -->
The host-service API `persephone.mcp.issueSessionEndpoint()` returns a handle with `url`, `headers`
containing the Bearer authorization header, `token`, and an idempotent `revoke()` method. Revoke
it when the agent session ends; the host also revokes active handles during service shutdown.
Because it exposes full app control, issuance requires the board's granted `appScripting`
permission. Service boards using this API must declare `minBridgeVersion: "1.42.0"`.
<!-- /board-template:exclude -->
The same bridge release adds
`persephone.service.openChannel(openMessage)` for ordered, two-way streaming to the board's own
service. Register one `persephone.service.onChannel((channel, openMessage, info) => ...)` handler in
the service entry; same-board opens include `info.page.boardId`, while cross-board opens add
`info.interface` and descriptive `info.caller` metadata. Both channel endpoints support `send`,
`onMessage`, `onClose`, `close`, `writable`, and `whenWritable()`. Each direction allows 256
unacknowledged messages; service-to-page payloads are capped at 1 MiB, while page-to-service has
only the count bound. Limits are 16 channels per frame and 128 per service. Bridge `1.44.0` added
`persephone.voiceTyping.autoStopSilenceMs` and
`persephone.voiceTyping.onAutoStopSilenceChange(callback)`: `0` means auto-stop is off and any
other value is a duration in milliseconds. The callback immediately receives the current value,
then receives changes; call its returned function to unsubscribe. Feature-detect
`persephone.voiceTyping` before use because older apps do not expose this API. Use
`if (!channel.writable) await channel.whenWritable(); channel.send(x)`; errors include
`channel-backpressure`, `payload-too-large`, and non-cloneable values throw `rejected`. Channels close with `renderer-reloaded`,
`service-exited`, `untrusted`, or `quit` on the matching lifecycle event. Boards using channels
must declare `minBridgeVersion: "1.42.0"`. Cross-board service interfaces use provider
`serviceInterfaces: [{ id: "agent.session", version: 1, title: "Agent Chat" }]` and consumer
`uses: [{ id: "agent.session", version: 1 }]` declarations. Every non-empty `uses` grant is Full
access and covers providers trusted now or later. This grants messaging only: providers need their
own trust and `service` permission, and must enforce their own approval policy for untrusted
messages. `audio`, `agent.session`, `speech.transcribe`, `speech.synthesize`, `speech.wake`, and `text.translate` are reserved platform ids; legacy interface ids otherwise use `author/name`. For new declarations and consumers, see <!-- board-template:exclude -->[Capabilities](../capabilities/client-and-wire.md)<!-- /board-template:exclude -->.
Consumers call `services.list(id)` to choose a provider and
`services.connect(id, { provider, version }, openMessage?)` to connect; versions match exactly.
Boards use these cross-board calls from board pages; use
`persephone.service.openChannel(openMessage)` for same-board communication. The app also consumes
some reserved interfaces (`audio`, `speech.transcribe`, `speech.synthesize`, `speech.wake`, `text.translate`).
The provider's existing `onChannel` callback receives `info.interface = { id, version }` and
`info.caller = { id, name }`. Refuse with the normal close reason `connection-refused`. Main
rechecks grants and declarations when connecting, and closes channels on trust or page lifecycle
changes. Local caller ids are hashed so the board path is not disclosed. Boards using this API
must declare `minBridgeVersion: "1.42.0"`. The reserved `speech.transcribe` interface has a
<!-- board-template:exclude -->[normative v1 contract](../speech-transcribe.md)<!-- /board-template:exclude -->: consumers stream record-then-transcribe PCM audio
and providers return one result or error per channel. The **Speech to Text** catalog board in
`persephone-boards` provides it; **Agent Chat** gains a voice button when a provider is installed.
Both boards require Persephone 5.0.15.
The <!-- board-template:exclude -->[speech synthesis](../speech-synthesize.md)<!-- /board-template:exclude --> and <!-- board-template:exclude -->[wake and stop phrase](../speech-wake.md)<!-- /board-template:exclude --> guides define their normative v1 contracts.

The reserved `text.translate` interface has a <!-- board-template:exclude -->[normative v1 contract](../text-translate.md)<!-- /board-template:exclude --> for
detection, keyed text/HTML translation, and explicit model downloads.
Bridge `1.41.0` adds
`persephone.trashFile(path)`, which moves a file to the OS Recycle Bin. Bridge `1.40.0` adds optional
`singleInstanceMasks` manifest masks to choose which claimed file names route to a singleton board page,
`persephone.source.navigate(href)` to navigate the hosting page to an item in its initial source context,
and `persephone.page.visible` / `persephone.page.onVisibilityChange(callback)` for page-level visibility
(active or grouped beside the active page; independent of window minimization).
Bridge `1.39.0` adds permission-scoped
`persephone.watch()` file and folder change batches. Bridge `1.38.0` adds paged folder listing,
confirmed persistent folder and exact-file grants, `getFileAccess()` for non-prompting access checks,
and session read access to delivered source files. Confirmation dialogs use the manifest name when
available. It also adds `placement: "start"` for toolbar buttons and menus, a clear button on
toolbar inputs, and the page tab mute button (`persephone.page.setMuted()` / `onMuteToggle()`).
Bridge `1.37.0` adds source-panel snapshots as
`persephone.source.initialSourceContext` and `context` on `source.onOpen()` events. The initial
snapshot is restored with the page; runtime snapshots are transient. Bridge `1.36.0` adds registration-time
`persephone.locale.code` and board-pack `persephone.i18n.t()` / `has()`; boards using them must set
`minBridgeVersion: "1.36.0"`. Bridge `1.20.0` delivers requests to each handler
page one at a time in FIFO order, allows up to 32 active and queued requests per handler, and uses
`timeout` as the canonical timeout message from main. Bridge `1.19.0` adds
`persephone.intent.resolve(value, { discardPage: true })` (also available on the request-bound
`request.resolve`) for discarding a page created for a failed request, preserves the handler's exact
value under `result` for board callers, and adds the optional manifest capability field
`alwaysOpensNewPage` to request a fresh handler page for each invocation.
Bridge `1.28.0` adds the `segmented` toolbar control; boards using it set
`minBridgeVersion: "1.28.0"`.
Bridge `1.32.0` lets `readFile()` read the exact currently hosted document path when
`fileSystem: false`; boards using this behavior should set `minBridgeVersion: "1.32.0"`.
Bridge `1.33.0` adds `persephone.notify(message, type, { persistent: true })`, which keeps the toast
on screen until the user closes it. Older apps ignore the option and auto-close the toast, so it is
safe to pass without raising `minBridgeVersion`.
Bridge `1.35.0` adds the `themes` permission and `persephone.themes.*` bridge; a board that uses it
must set `minBridgeVersion: "1.35.0"` and request `themes: true`. The same version renders a toolbar
`button` or `menu` that has a `label` as a text button and accepts `placement: "board-menu"` on a
`menu` to add its items to Persephone's … menu (see the toolbar section).
Bridge `1.21.0` adds optional `representation` to capability discovery and board declarations.
Boards declaring `content.view` must provide one non-empty `representation` per supported format
and set `minBridgeVersion: "1.21.0"`.
Bridge `1.22.0` adds host-managed module-service lifecycle callbacks and structured service error
codes; services using `persephone.service.onRequest()` or `onShutdown()` should set
`minBridgeVersion: "1.22.0"`.
Bridge `1.23.0` uses one extension-to-MIME table for `board://` files and `__pipe` responses;
markdown, CSV, XML, and YAML board text uses UTF-8.
Bridge `1.18.0` adds `persephone.icons.forFiles(names)` for getting Persephone's file icons as
image URLs. Bridge `1.13.0` adds
`persephone.settings.get(id)` and `persephone.settings.onChange(callback)` for read-only access
to settings declared by the board; bridge `1.12.0` added
`persephone.clipboard.writeImage(data)` and `persephone.clipboard.writeText(text)` for native OS
clipboard writes; the preceding `1.11.0` release added transient page-toolbar text. These additions
are backward-compatible with existing boards.
