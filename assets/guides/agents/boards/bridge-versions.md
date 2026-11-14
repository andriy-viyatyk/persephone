---
title: "Boards — bridge version history and compatibility"
audience: agent
summary: "Which bridge version added each persephone.* member and manifest field, the minBridgeVersion to declare, and cross-board service channel limits."
---

# Boards — bridge version history and compatibility

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
