---
title: "Boards — services, capabilities and intents"
audience: both
summary: "Declare module services, capability methods and intents in the manifest, and the reserved platform interfaces."
---

# Boards — services, capabilities and intents

## Service and capability declarations

Bridge `1.8.0` adds the capability and intent methods documented below to the additive provider,
service, and stream-host surface; boards that do not use them continue to work unchanged.
Bridge `1.48.0` adds `persephone.openBoard(folder)` for opening a folder this board can list; the target follows its normal trust flow. Boards using it should set `minBridgeVersion: "1.48.0"`. Folder listing authorization and target-board trust are independent decisions. Bridge `1.42.0` adds `format: "multiline"` for string board
settings, rendered as a multi-line Textarea in Persephone's Settings page; boards that rely on it
must set `minBridgeVersion: "1.42.0"`. It also adds the host-service API
`persephone.mcp.issueSessionEndpoint()` for explicitly authorized board services. The returned
handle contains `url`, `headers` (including `Authorization: Bearer …`), `token`, and an idempotent
`revoke()` method. The service host revokes outstanding handles during shutdown; providers should
revoke them when an agent session ends. This grants full app control through MCP, so the board's
trusted permission snapshot must include `appScripting`. Service boards using the endpoint must set
`minBridgeVersion: "1.42.0"`. The same bridge release adds
`persephone.service.openChannel(openMessage)` for a permission-granted board to open a long-lived,
ordered channel to its own module service. The service registers one
`persephone.service.onChannel((channel, openMessage, info) => ...)` handler; same-board channels
provide `info.page.boardId`. Both endpoints support `send`, `onMessage`, `onClose`, `close`,
`writable`, and `whenWritable()`. Messages are structured-cloneable, with at most 256
unacknowledged messages per direction; service-to-page messages are additionally limited to 1 MiB.
Page-to-service messages have no byte limit because board frames cannot measure V8 serialization.
There are at most 16 channels per frame and 128 per service. Use
`if (!channel.writable) await channel.whenWritable(); channel.send(x)` to respect backpressure;
`send()` throws `channel-backpressure` at the limit. Oversized service messages throw
`payload-too-large`; non-cloneable values throw `rejected`. `close()` without a reason reports `channel-closed` to the other side. Channels close on page reload, service exit or stop, trust loss, and
app quit (`renderer-reloaded`, `service-exited`, `untrusted`, and `quit`). Boards using this API
must declare `minBridgeVersion: "1.42.0"`.
Boards that rely on the newer `payload-too-large` and `rejected` send errors, reasonless-close
reporting, or queued delivery before an `onMessage` listener is registered must declare
`minBridgeVersion: "1.56.0"`.
The same release also supports cross-board service interfaces. The following legacy compatibility
example uses `serviceInterfaces` and `services.connect`; for new `methods`, `getCapability` and
`uses` declarations, see [Capabilities](../agents/capabilities/client-and-wire.md). A provider declares
`serviceInterfaces: [{ id: "agent.session", version: 1, title: "Agent Chat" }]`; a consumer
declares `uses: [{ id: "agent.session", version: 1 }]`. The trust dialog treats every non-empty
`uses` list as Full access because it grants messaging access to providers trusted now or later.
The consumer receives no provider permissions; each provider independently needs trust and its
Full-access `service` grant, and must treat messages as untrusted. Use
`persephone.services.list(id)` to choose among current providers, then
`persephone.services.connect(id, { provider, version }, openMessage?)`. Version selection is an
exact positive integer match, and main rechecks both boards when connecting. Provider
cross-board calls from boards are page-only; use `persephone.service.openChannel(openMessage)` when the
consumer and provider are the same board. The app also consumes reserved interfaces. Provider
`onChannel(channel, openMessage, info)` receives `info.interface` and a descriptive `info.caller`;
local caller ids use a hash instead of exposing the board path. Refuse with
`channel.close({ code: "connection-refused", message: "..." })`. Cross-board channels keep the
same bounds and lifecycle as `service.openChannel()` and close when either board loses the needed
trust or grant. Boards using this API declare `minBridgeVersion: "1.42.0"`.
When the board has no trusted `uses` grant for an interface, `services.list()` and `services.connect()`
reject with code `permission-denied`; the explanatory grant message is preserved.
For a streaming coding-agent provider and consumer protocol over this channel, see the normative
[`agent.session` v1 contract](../agents/agent-session/index.md) (`guides.agents["agent-session"].index`). The
Agent Chat board uses this platform contract for its coding-agent sessions.

`audio`, `agent.session`, `speech.transcribe`, `speech.synthesize`, `speech.wake`, and `text.translate` are reserved platform ids; other ids use exactly `author/name`.
For shared microphone and computer audio capture or PCM playback, see the normative
[`audio@1` contract](../agents/audio.md) (`guides.agents["audio"]`). A consumer declares `audio@1`
in `uses` and requests the matching `microphone` or `computerAudio` permission for capture. Voice
boards can use `audio.muteApp()` to mute Persephone playback while listening; the header indicator
identifies holders and releases all active mutes across app windows.
For recording audio and getting text back from an installed speech-to-text board, see the normative
[`speech.transcribe` v1 contract](../agents/speech-transcribe.md) (`guides.agents["speech-transcribe"]`).
The **Speech to Text** catalog board in `persephone-boards` provides this service. When a provider is
installed, **Agent Chat** shows a voice button for dictating a message. Both boards require
Persephone 5.0.15 or later. Agent Chat dictation can stop after silence using the shared setting in
[Settings > General > Voice Typing](../screens/settings.md#voice-typing).
The [`speech.synthesize` v1 contract](../agents/speech-synthesize.md) and [`speech.wake` v1 contract](../agents/speech-wake.md) define synthesis and enrolled phrase detection.
For detection, keyed text/HTML translation, and explicit model downloads, see the normative
[`text.translate` v1 contract](../agents/text-translate.md) (`guides.agents["text-translate"]`).
Bridge `1.41.0` adds `persephone.trashFile(path)`, which
moves a file the board may write to the Recycle Bin. Bridge `1.40.0` adds the optional
`singleInstanceMasks` manifest field, which selects claimed file names routed to a singleton board page,
and `persephone.source.navigate(href)`, which navigates the hosting page to an item in its initial
Explorer or Link Editor source context, and `persephone.page.visible` / `onVisibilityChange()` for
whether the hosting page is active or grouped beside the active page. This visibility is page-level
and ignores window minimization. When `singleInstanceMasks` is omitted, existing route-everything
behavior remains. Bridge `1.39.0` adds `persephone.watch()` for permission-scoped
file and folder change batches. Bridge `1.38.0` adds `persephone.listFolder()`, user-confirmed
`rememberFolder()` / `rememberFile()` grants, `getFileAccess()` for checking current path access
without prompting, and session read access to local source files delivered to a board. Persistent
access confirmations use the manifest name when available. Bridge `1.37.0` adds source-panel snapshots as
`persephone.source.initialSourceContext` and `context` on `source.onOpen()` events. The initial
snapshot is stored with the page's `sourceLink` and restored with the page; runtime snapshots are
transient. Bridge `1.36.0` adds registration-time
`persephone.locale.code` and board-pack `persephone.i18n.t()` / `has()`; a board using them
requires `minBridgeVersion: "1.36.0"`. Bridge `1.35.0` adds the permission-gated
`persephone.themes.*` API described below. Bridge `1.33.0` adds
`persephone.notify(message, type, { persistent: true })`, a toast that stays until you close it.
Bridge `1.32.0` allows a simple board with `fileSystem: false`
to read only its currently hosted document through `readFile(getFilePath())`. Bridge `1.23.0` uses one extension-to-MIME table for
`board://` files and `__pipe` responses; markdown, CSV, XML, and YAML board text uses UTF-8.
Bridge `1.22.0` adds host-managed module-service lifecycle
and structured service errors. Bridge `1.21.0` adds optional `representation` to capability
discovery and manifest declarations. A board declaring `content.view` must provide one non-empty
representation per supported format and set `minBridgeVersion: "1.21.0"`. Capability requests to the same handler page are delivered
one at a time in FIFO order; up to 32 active and queued requests can be outstanding for a handler.
A timeout rejects with code `timeout` and sends a best-effort cancel. Bridge `1.19.0` added
`persephone.intent.resolve(value, { discardPage: true })` (also
available on the request-bound `request.resolve`) for discarding a page created for a failed
request, preserved the handler's exact value under `result` for board callers, and added the
optional manifest capability field `alwaysOpensNewPage` to request a fresh handler page for every
invocation. See [What's New](../whats-new.md) for the release notes.
