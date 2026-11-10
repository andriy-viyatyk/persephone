> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# Application shell (ui/) and scripting runtime — refactoring review

## Summary

The core shell views (`PagesView`, `PageContentView`, `SecondaryViewsView`, `DialogsView`) are
well-built VanillaView hosts. The scripting runtime still has a small, clear core. Most editor
facades are thin adapters. The problems sit around the edges, and almost all of them were added
during the platform epics.

`ui/` is not the top layer the architecture describes. It holds models and services that
`api/`, `editors/`, `components/` and the audio window import: sidebar state, editor categories,
dialog plumbing, speech capture and translation transport. 96 files outside `ui/` import from it,
13 of them in `api/`. Several of those imports are dynamic only to dodge import cycles. Feature
rules leak into views and then get re-derived in other places: tab title, active state, sound and
which tab actions are allowed; board display names; "untrust a board, then unpin it".

Biggest problems:
1. **`ui/` works as a service layer** (SHL-1, SHL-5). Lower layers import it, so the
   documented dependency rules are not true.
2. **Voice typing and transcript code** (SHL-2, SHL-3). `VoiceTypingController` is a god object.
   It shares speech plumbing with `TranscriptController` by copying it, and the copying runs down
   to three or four implementations of port routing and of the channel protocol.
3. **Tab behaviour lives in `PageTabView`** (SHL-4). The view decides title, active state, sound
   and which actions are allowed. The page model and the ai-vision tab node re-implement the same
   checks.

Scripting: the "runner hierarchy" is a base class with one subclass. `AutoloadRunner` sits outside
it and repeats the library preparation (SHL-11). Facades use one consistent pattern, but it is
copy-pasted rather than encoded, and the editor-to-facade registry lives inside `PageWrapper`
behind casts (SHL-9). A handful of facades re-implement model rules (SHL-10).

## Findings

### SHL-1: `ui/` is used as a service and model layer by lower layers
- **Priority:** P1
- **Effort:** L (can be done one folder at a time)
- **Where:**
  - `src/renderer/api/pages/PageModel.ts:17,23,28-29`, `api/pages/PagesPersistenceModel.ts:22`,
    `api/pages/IPageHost.ts:4` import `ui/secondary-views/SecondaryViewsModel`, `panel-key` and
    `ui/dialogs/ConfirmationDialog`.
  - `api/settings.ts:15` imports `ui/speech/microphone-cleaning-types`.
  - `api/internal/GlobalEventService.ts:1` imports `ui/dialogs/poppers/showPopupMenu`.
  - `api/board-install.ts:18`, `api/board-updates.ts:22`, `api/site-extension-management.ts:6`,
    `content/builtin-schemes.ts:13` and five `components/tree-provider/*` files import
    `ui/dialogs/dialog-buttons` (46 importers in total).
  - `editors/monaco/index.ts:10-14` imports `ui/transcript/*` and `ui/translation/*`.
  - `editors/browser/BrowserTranslationController.ts:7-8`, `editors/settings/sections/BrowserProfilesSection.ts:25-26`
    import `ui/translation/*`.
  - `renderer/audio/audio-window.ts:3-10` imports `ui/speech/PcmAudioCapture`, `ComputerAudioGate`,
    `microphone-device`, `microphone-cleaning-types`, `LoopbackReference`.
  - 14 editors register panels through `ui/secondary-views/secondary-view-registry`.
- **Problem:** `doc/architecture/overview.md` ("Dependency Rules" 9–10) says `ui/` orchestrates
  everything and that lower layers must not import from higher ones. File counts that import
  `ui/`: api 13, components 7, editors 55, scripting 20, content 1, audio 1. Much of what lives in
  `ui/` is not shell:
  - `SecondaryViewsModel` and `panel-key`: page state owned by `PageModel`.
  - `secondary-view-registry`: an editor-registration registry, the sibling of `editorRegistry`.
  - `dialog-buttons`: constants plus a label map.
  - `ui/speech/*`: an audio DSP pipeline, a DTLN worker and PCM capture, shared with the separate
    audio window.
  - `ui/translation/TextTranslationProvider` and `TranslationServiceChannel`: a transport client
    for `text.translate@1`.
  - `ui/transcript` and `ui/translation/TranslateTextPage*`: Monaco toolbar contributions.

  There are also two ways to show a confirmation. `api/ui.ts:82-111` wraps the dialogs
  (`ui.confirm` has 12 callers). 14 files outside `ui/` import `showConfirmationDialog` directly
  instead.
- **Refactor:** move each piece to the layer that owns it and keep only views in `ui/`.
  1. `ui/secondary-views/SecondaryViewsModel.ts` and `panel-key.ts` move to
     `api/pages/secondary-views/`. `secondary-view-registry.ts` moves to
     `editors/base/secondary-view-registry.ts`, next to `editorRegistry`.
     `SecondaryViewsView`, `LazySecondaryViewView` and `SideBarPanelHeaderView` stay in `ui/`.
  2. Dialogs:
     - `dialog-buttons.ts` moves to `shared/` or `api/types/`, because it is pure data.
     - Split each `XDialog.ts` into a model plus `showXDialog()` (no view import) and register its
       view from one shell bootstrap file, `ui/dialogs/register-dialog-views.ts`. Today every
       `XDialog.ts` imports its own view to call `registerDialogView`, and that pins the model into
       `ui/`.
     - The models and `showDialog`/`dialogsState` (now defined in `DialogsView.ts:139-157`) can
       then live in `api/dialogs/`.
     - Lower layers call `ui.confirm/input/...`. Extend `IConfirmOptions` where a caller needs
       something `ui.confirm` lacks.
  3. Move `ui/speech/*` (minus the voice-typing overlay) and the transport half of
     `ui/translation` (`TextTranslationProvider`, `TranslationServiceChannel`,
     `TranslationWorkflow`'s language helpers) to a non-UI home, such as
     `src/renderer/services/speech/` and `services/translation/`. Update `overview.md` to define
     where such services sit.
  4. Move `ui/transcript/*` and `ui/translation/TranslateText*` to
     `editors/monaco/contributions/`, because only `editors/monaco/index.ts` uses them.
- **Risk / notes:** mostly mechanical import moves. Step 2 changes the order in which dialog views
  are registered: the bootstrap must register views before the first `showDialog`. Do SHL-5
  (editor categories) as part of this move. SHL-2 and SHL-3 assume the new speech home.

### SHL-2: `VoiceTypingController` is a god object; its session plumbing is copied in `TranscriptController`
- **Priority:** P1
- **Effort:** M
- **Where:**
  - `ui/voice-typing/VoiceTypingController.ts:24-65` (session and capture records, 25 fields),
    `85-108` (IPC and settings wiring), `161-233` (provider plus microphone open),
    `260-318` (protocol decoding), `320-373` (PCM capture and send queue), `423-509` (segment
    insertion, clipboard fallback, final-result reconciliation), `526-565` (silence and inactivity
    heuristics), `584-614` (overlay state, main-process state, error-to-i18n mapping).
  - `ui/transcript/TranscriptController.ts:137-176`, `178-232`, `234-241`.
  - `ui/app/MainPageView.ts:113-122`.
- **Problem:** one 615-line class does seven jobs:
  - IPC (shortcut events, `setVoiceTypingState/Config`, microphone arming, text insertion);
  - settings sync;
  - provider discovery;
  - `speech.transcribe` protocol parsing through `as { type?: unknown; ... }` casts;
  - Web Audio capture;
  - a text-reconciliation algorithm (`finishLiveResult`);
  - an acoustic auto-stop heuristic (median speech level).

  `key-files.md:215` describes it in the same terms. `TranscriptController` repeats the same
  pieces:
  - its own port router;
  - the same `connectHostServiceChannel({ interfaceId: "speech.transcribe", ... openMessage: { type: "transcribe", format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 } ... } })`
    call (`VoiceTypingController.ts:192-197`, `TranscriptController.ts:138-143`; an unused third
    copy is `SpeechTranscriptionProvider.open`, `SpeechTranscriptionProvider.ts:32-35`);
  - the same `getUserMedia` constraints with arm/clear IPC (`VoiceTypingController.ts:210-216`,
    `TranscriptController.ts:191-198`);
  - the same capture wiring (`microphoneOptions`, `reportMicrophoneStatus`, `openPrivateLoopback`,
    `watchMicrophoneSettings`).

  Smaller issues:
  - The overlay state type is defined in the view and imported by the controller (`:11`).
  - `"Alt+V"`/`"Alt+Shift+V"` defaults appear again (`:69-70`, `:129-130`, `MainPageView.ts:115`)
    although `api/settings.ts:410-411,473-474` already normalizes them.
  - `describeFeatures(provider, session.mode === "translate")` (`:186`) passes "is translate" as
    the `refresh` flag.
  - A view (`MainPageView`) constructs and owns this app-wide service.
- **Refactor:** split it into parts that each have one job.
  - `SpeechSessionClient` (in the new speech service home, built on SHL-3): `open({ live, translate })`
    returns a typed session with `onStatus`, `onDraft`, `onSegment`, `onResult`, `onError`,
    `sendAudio`, `end`, `cancel`. All protocol decoding sits here.
  - `MicrophoneCapture.open({ loopbackReference, onChunk, onLevel, onFailed })`: arm/clear IPC,
    constraints, `resolveMicrophoneDevice`, `PcmAudioCapture` with cleaning, loopback and settings
    watch. Used by both controllers. Replace `PcmAudioCapture.start`'s eight positional parameters
    (`PcmAudioCapture.ts:71`) with an options object at the same time.
  - `VoiceTypingSession`: one dictation's state machine (starting → recording → transcribing →
    idle), lease, timer.
  - `LiveTextInserter`: `queueSegment`, `finishLiveResult`, `insertFinalResult` and `copyBuffered`
    as a pure class with an injected `insert(text)` port.
  - `SpeechAutoStop`: `recordSpeechBaseline`, `checkAutoStop` and `checkInactivityStop`, with
    the thresholds (0.005, 0.2 of median, 30 000 samples, 150 ms tick) in one commented constants
    block.
  - `VoiceTypingService` (app-level, started from bootstrap rather than `MainPageView`): shortcut
    and settings sync, owns sessions, exposes `state: TOneState<VoiceTypingOverlayState>`.
    `VoiceTypingOverlayView` binds to that state.
  - `TranscriptController` becomes about 120 lines: two `MicrophoneCapture`/display sources, two
    `SpeechSessionClient` sessions, and `append()`.
- **Risk / notes:** timing-sensitive code: microphone and channel open in parallel, plus the
  stop-before-accept paths. Move code without changing behaviour, one extraction per change, and
  test the shortcut flows by hand after each step. Depends on SHL-3; best done after the SHL-1
  folder move.

### SHL-3: Service-channel transport and port routing are implemented three to five times
- **Priority:** P2
- **Effort:** M
- **Where:**
  - Channel protocol: `ui/speech/SpeechServiceChannel.ts:17-85`,
    `ui/translation/TranslationServiceChannel.ts:17-87`, `api/renderer-capability-channel.ts:5-55`.
    `board-shim.ts` has a fourth copy (cross-area).
  - Port routing on `api.onBoardServiceChannel` with pending/waiter maps: `VoiceTypingController.ts:87-93,245-258`,
    `TranscriptController.ts:72-77,234-241`, `SpeechTranscriptionProvider.ts:14-21,80-90`,
    `TextTranslationProvider.ts:68-75,241-254`, `api/capabilities.ts:194-212`.
  - Magic prefixes: `"voice-typing:"` in three renderer files plus `main/module-service-supervisor.ts:73`;
    `"text-translation:"` at `TextTranslationProvider.ts:70` and `module-service-supervisor.ts:76`.
- **Problem:**
  - **Near-copy channels.** `SpeechServiceChannel` and `TranslationServiceChannel` are line-for-line
    copies of the sequenced ack/backpressure client. They differ only in queueing messages until the
    first subscriber and in how size is checked; the capability channel is a third variant.
  - **Five port routers.** Each repeats the same `pendingPorts`/`portWaiters`/timeout code.
  - **Duplicate subscriptions.** `VoiceTypingController` and `TranscriptController` each subscribe
    and also own a `SpeechTranscriptionProvider` that subscribes too, so every `speech.transcribe`
    port reaches two routers.
  - **A port leak (found while reviewing).** The router that did not open a channel parks its
    port in `pendingPorts`. For example, every `describe` port opened by the provider stays in
    `VoiceTypingController.pendingPorts` until window dispose.
- **Refactor:**
  1. Add `ipc/renderer/service-channel-client.ts` with
     `createServiceChannel(port, { label, queueUntilSubscribed?, sizeCheck: "arraybuffer" | "json" | "v8" })`.
     The speech, translation and capability channels become calls to it.
  2. Add `ipc/renderer/host-service-ports.ts`: a single `onBoardServiceChannel` subscription that
     resolves ports by `channelId` and closes any port nobody claims after the timeout. API:
     `connectHostService({ interfaceId, provider, version, openMessage }) → Promise<ServiceChannel>`.
  3. Put the board-id prefixes in `ipc/module-service-channels.ts` as constants used by both main
     and renderer.
- **Risk / notes:** `TranslationServiceChannel` queues early messages and the speech channel does
  not; keep that as an option instead of unifying it. The prerequisite for SHL-2.

### SHL-4: Tab presentation and tab-action rules live in `PageTabView` and are re-derived elsewhere
- **Priority:** P1
- **Effort:** M
- **Where:**
  - `ui/tabs/PageTabView.ts:28-92` (local `EditorTabState` and projection), `289-303` (board-title
    detection through `instanceof BoardEditorModel` and `displayNameEnglish`), `206-216` (active
    rule), `404-444` (sound button through `toggleMuteAll` duck-typing), `559-638` (context-menu
    availability), `648-701` (drag rules).
  - `ui/tabs/page-title.ts:5-30`, `ui/sidebar/OpenTabsListView.ts:148-168`.
  - `scripting/ai-vision/page-tab.ts:52-68`.
  - `api/pages/PagesLayoutModel.ts:64`, `api/pages/PagesLifecycleModel.ts:1167-1170`.
  - `ui/app/PagesView.ts:78-81,90-94`.
- **Problem:** the rules for what a tab shows and what you may do with it are encoded in the view:
  - **Duplicated rules.**
    - `isLockedBoardPage`/`retainedDescriptor`/`pinSide` checks (`retainedDescriptor` is read six
      times) decide which menu items appear. The model repeats the same guards for pin
      (`PagesLayoutModel.ts:64`) and duplicate (`PagesLifecycleModel.ts:1167-1170`), so the two
      lists must be kept in sync by hand.
    - The "active including grouped partner" rule is copied into `ai-vision/page-tab.ts:56-60`.
      The sound-indicator rule, including the `as { toggleMuteAll?: ... }` and `_anyTabAudible`
      casts, is copied at `page-tab.ts:64-68`.
  - **Title rules.** "Is this a plain board title?" is decided two different ways:
    `PageTabView` uses the live `BoardEditorModel`, while `OpenTabsListView` re-reads the manifest
    and compares names. `displayPageTitle` is an if-chain keyed on editor id plus the stored
    English title string (`"Browser"`, `"Source: "`, `" — Resources"`, …). It is stringly typed and
    has to know about every editor.
  - **Popover rules in a view.** `PagesView` sends `pagesModel.onFocus` when the popover opens or
    closes (`:90-94`) and writes `page.popoverSize` (`:78-81`).
  - **Untranslated strings.** `"Ungroup"`/`"Close Page"`/`"Mute Page"`/`"Unmute Page"` at
    `PageTabView.ts:352,413,433` bypass `t()`.
- **Refactor:**
  1. Add a `PageTabState` projection on the page model, e.g. `PageModel.tab` returning
     `{ title, active, grouped, popoverOpen, sound: { visible, muted }, canClose, canPin, canUnpin, canDuplicate, canDetach, canDrag }`.
     `PagesLayoutModel`/`PagesLifecycleModel` guards call the same `can*` predicates.
     `PageTabView`, `OpenTabsListView` and the ai-vision `PageTabNode` only read it.
  2. Replace `displayPageTitle` with `EditorModel.displayTitle` (default `title`; overrides in the
     board, board-info, browser, about, monaco Source/DOM, link "Resources" and tools-hub editors).
     The board override uses one board-identity helper (SHL-6).
  3. Define an optional `IAudibleEditor { readonly audible: boolean; readonly muted: boolean; toggleMuteAll(): void }`
     on the editor contract, replacing the `_anyTabAudible` state field and duck-typed getters.
  4. Move the popover focus signal into `PagesModel.openPopover/closePopover`.
- **Risk / notes:** the editor-side pieces (`displayTitle`, `IAudibleEditor`) touch the editors
  reviewer's area; agree on the contract first. Order: steps 1 and 4 first (shell-only), then 2–3.

### SHL-5: The editor-categories model is a set of procedural helpers in `ui/sidebar`; "untrust a board, then unpin it" is copied six times
- **Priority:** P1
- **Effort:** M
- **Where:**
  - `ui/sidebar/pinned-items.ts:1-142`.
  - Call sites that untrust and then call `removePin`/`removeCategoryMembership`:
    `api/boards.ts:349-356`, `api/board-install.ts:161-164`,
    `editors/board/request-board-trust.ts:112-115`, `editors/board-info/BoardInfoEditorModel.ts:584-586`,
    `editors/explorer/BoardsSecondaryView.ts:473`, `ui/sidebar/EditorsTreeView.ts:252-259`.
  - `ui/sidebar/tools-editors-registry.ts:60-67,79-91`.
- **Problem:**
  - **Wrong layer.** `pinned-items.ts` is the domain model for the `editor-categories` setting:
    create, rename, delete, move, assign. It is a set of free functions in a `ui/sidebar` file. The
    `api/` and `editors/` modules that need it reach it with `await import("../ui/sidebar/pinned-items")`,
    which is a layering inversion hidden behind a dynamic import.
  - **A rule kept by convention.** Removing a board from trusted boards must also drop its
    category membership, and each of six call sites repeats that step by hand. Only
    `api/boards.ts` also skips bundled boards.
  - **Dead pin API.** The old API is still there with zero callers: `addPin`, `insertPin`,
    `movePin`, `isPinned` and `PinnedDragData`. `getPinnedStrings` is labelled a "compatibility
    projection" (`:36`), and `PageTabsView.ts:341-342` still mentions the removed "sidebar rail".
  - **Shared DOM icons.** `tools-editors-registry`'s static items build DOM icon nodes once at
    module load (`createFolderIconElement()` at `:66`), so every consumer must remember to
    `cloneNode` (`PageTabsView.ts:343`, `EditorsTreeView.ts:147`).
- **Refactor:**
  1. Create `api/editor-categories.ts` with a class `EditorCategoriesModel` (singleton
     `editorCategories`). It has `state`, `categories`, `categoryOf(ref)`, `create`, `rename`,
     `remove`, `move`, `assign(ref, categoryId, index?)` and `unassign(ref)`, plus `encodeRef`/
     `decodeRef`.
  2. In its constructor, subscribe to `boardTrust.subscribePaths` and prune board refs whose root
     is no longer trusted. Delete the six manual `removePin` calls.
  3. Move `tools-editors-registry.ts` (creatable items) beside it as `api/creatable-items.ts`, with
     `icon` as a factory (`() => Node` or an icon name) instead of a shared node.
  4. Delete the dead pin helpers.
- **Risk / notes:** pruning on the trust event changes timing slightly (asynchronous instead of
  inline after `untrust`). The setting key stays the same, so no persistence migration is needed.
  Part of SHL-1.

### SHL-6: Board name and glyph resolution is repeated in six shell views, each with its own manifest cache
- **Priority:** P2
- **Effort:** S
- **Where:** `ui/tabs/PageTabsView.ts:52-53,330-363,404-412`; `ui/sidebar/OpenTabsListView.ts:148-178`;
  `ui/app/MainPageView.ts:264-287`; `ui/tabs/EditorCategoriesPopoverView.ts:151-152`;
  `ui/sidebar/EditorCategoriesView.ts:77-78`; `ui/sidebar/EditorsTreeView.ts:125-126`.
- **Problem:**
  - **Same expression in six places.**
    `boardDisplayText(root, manifest?, boardMetadataKeys.name, manifest?.name?.trim() || fpBasename(root))`
    is written six times.
  - **Two private caches.** `PageTabsView` and `OpenTabsListView` each keep their own
    `warmedBoardRoots` set and `boardManifests` map, with an identical `warmBoard()`
    (`readNormalizedBoardManifest` plus `ensureBoardDisplayText`).
  - **Two change events to merge.** Each view subscribes separately to `onBoardDisplayTextChanged`
    and `subscribeBoardIconChanges`.
- **Refactor:** add one `boardIdentity` service in `editors/board/` (or `api/boards`):
  - `displayName(root)` warms lazily and returns a fallback until the manifest is loaded;
  - `glyph(root, size?)`;
  - `onChanged(listener)` merges the text and icon events.

  Delete the per-view caches. `MainPageView.refreshBoardIdentity` becomes a `BoardWindowIdentity`
  service (`api/window` or `editors/board`) that bootstrap starts in board mode. It owns
  `document.title`, `setBoardWindowIdentity` IPC and the revision guard.
- **Risk / notes:** low. The editors reviewer owns `board-display-text`; the consumer side is all
  here.

### SHL-7: `MainPageView` mixes layout with snip, board-window identity, voice-typing ownership and five header widgets
- **Priority:** P2
- **Effort:** M
- **Where:** `ui/app/MainPageView.ts:36-46` (`runSnip`), `113-122` (voice typing), `151-161` (audio
  capture count IPC plus revision guard), `162-172` (global mute), `186-262` (header assembly with
  six `isBoardMode` branches), `264-287` (board identity), `331-375` (MCP and Mneme indicators),
  `405-477` (recording controls and `hiddenChromeState`).
- **Problem:** the root layout view does feature work:
  - it fetches a snip and opens an image page;
  - it calls `api.getAudioCaptureCount` and subscribes to `rendererEvents.eAudioCaptureCount` with
    its own revision ordering, which is model state kept in a view;
  - it starts the voice-typing service;
  - it computes the board window's identity and sends it to main.

  `hiddenChromeState` lets the recording widget save and restore the MCP indicator's
  `hidden`/`display`, so two widgets mutate each other's DOM.
- **Refactor:**
  1. Move `runSnip` to `app.shell.snipToNewPage(hideWindows)`.
  2. Add an `audioCaptureState` TOneState in `api/` next to `globalMuteClient`.
  3. Extract `HeaderStatusIndicatorsView` (MCP, Mneme, audio capture, global mute; it reads a
     `hideStatusChrome` flag from `windowRecording` state rather than being poked by the recording
     view) and `RecordingControlsView`.
  4. Build `AppHeaderView` and `BoardWindowHeaderView` as two compositions instead of `if`
     branches.
  5. Move voice typing (SHL-2) and board identity (SHL-6) to bootstrap services.

  `MainPageView` should end up around 150 lines of layout.
- **Risk / notes:** `data-name` contracts (`ui-element-contract.md`) must be preserved exactly;
  ai-vision element declarations target them.

### SHL-8: `MenuBarView` builds the same configuration twice and owns folder actions
- **Priority:** P2
- **Effort:** S
- **Where:** `ui/sidebar/MenuBarView.ts:148-169` vs `251-269`; `300-407`; `331-343,409-415`;
  `496-526` vs `528-557`.
- **Problem:**
  - **ListBox props twice.** The ListBox props are written in the constructor, behind a `holder`
    hack to reach `this` before `super`, and again in `folderListProps()`.
  - **Right-hand view config twice.** `createRightView` and `rightViewProps` are parallel switches
    over the same folder ids with copied prop objects.
  - **Four switches.** Label, icon, tooltip and context menu are four more switches keyed on the
    built-in ids from `api/menu-bar.ts`. Tooltips `"Currently opened tabs"`, `"Recently opened files"`
    and `"Script library folder"` (`:325-327`) bypass `t()`.
  - **Domain actions in the view.** It sets `script-library.path`, unlinks it, clears recent
    files and adds folders.
  - **Instance sniffing.** It tells right-hand views apart with `instanceof` (`:489-493`).
- **Refactor:**
  - Add one `BUILTIN_FOLDER_UI: Record<BuiltinFolderId, { label(); icon(); tooltip(); contextMenu(view); create(ctx); props(ctx) }>`
    table plus one generic user-folder entry.
  - Build the ListBox in `onMount` from `folderListProps()` only.
  - Move the library-folder actions to `api/library-service.ts` (`scriptLibrary.choose()`,
    `.unlink()`) and folder add to `menuFolders.addWithDialog()`.
  - Expose a `searchable` interface (`showSearch()`) on right-hand views instead of tracking
    `recentFileListView`/`treeViewModel`.
- **Risk / notes:** low.

### SHL-9: The facade pattern is consistent but copy-pasted; the editor-to-facade registry lives inside `PageWrapper` behind casts
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `scripting/api-wrapper/PageWrapper.ts:11-64` (26 editor and facade imports), `67-113`
    (`EditorFacade` union and `FACADE_FOR_EDITOR` with `as` and `as unknown as` casts), `258-270`.
  - 22 facades repeat the identical `aiVision` block (`createElements(..., { scopeSelector: pageScopeSelector(pageId), beforeHighlight: () => activatePageAndWaitForLayout(pageId) })`
    plus `withEditorGuideHelp`), e.g. `TextEditorFacade.ts:88-103`, `GridEditorFacade.ts`,
    `McpInspectorFacade.ts:216-232`.
  - 13 facades re-declare the same `id` and `name` member rows.
  - `isAttached`/`requireAttached` copies in `EnvVarsEditorFacade`, `GitTreeEditorFacade`,
    `LogViewEditorFacade` and `AboutEditorFacade`.
  - `board-editor:*` family special-casing in `PageWrapper.ts:261-268`, `editor-guide-help.ts:6`,
    `ui/app/RenderEditorView.ts:51`.
- **Problem:**
  - **Edits in three places.** Adding an editor facade means editing `PageWrapper`'s imports, its
    union type and its map.
  - **Unchecked casts.** The map takes `EditorModel` and casts to the concrete model, so a wrong
    entry compiles.
  - **Copy-pasted skeleton.** Every facade copies the same `aiVision` skeleton, roughly 15 lines
    each; a change to scoping or highlight policy is a 22-file edit.
  - **Prefix rule outside the registry.** Three files know that `board-editor:<id>` means
    "board-view's definition"; that resolution belongs to the editor registry.
- **Refactor:**
  1. Add an `EditorFacadeBase<TEditor extends EditorModel>` with
     `constructor(protected editor: TEditor, readonly id, readonly name)`, a shared `pageId`,
     `requireAttached(action)`, and an `aiVision` built from a single abstract method:
     `protected describe(): { kind; summary; members; help; elements?; highlightAll?; summarize() }`.
     The base adds the `id`/`name` rows, element scoping and the guide help.
  2. Add `scripting/api-wrapper/editor-facade-registry.ts`:
     `registerEditorFacade(idOrPrefix, (editor) => facade, guard?: (e) => e is TEditor)`, called
     from each facade module (or a single `register-facades.ts`). `PageWrapper.editor` becomes a
     lookup. The union type becomes `ReturnType` of the registry, or an `IEditorFacade` interface.
  3. Have `editorRegistry.getById` resolve family ids (`board-editor:*` to the `board-view`
     definition), then delete the three local special cases.
- **Risk / notes:** facades stay thin, and the agent-facing text does not change. The
  BrowserEditorFacade and BoardEditorFacade owners must adopt the base too. Coordinate with them.

### SHL-10: Several facades re-implement model rules or reach past the model
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `api-wrapper/McpInspectorFacade.ts:287-296` vs `editors/mcp-inspector/McpInspectorView.ts:237`;
    `McpInspectorFacade.ts:249,255,265`; `McpInspectorFacade.ts:467` (an import at the end of the
    file).
  - `api-wrapper/BoardInfoEditorFacade.ts:279-326` vs `editors/board-info/BoardInfoEditorView.ts:700-712`;
    `BoardInfoEditorFacade.ts:146-233` vs `api-wrapper/board-manifest-projection.ts:12-56`.
  - `api-wrapper/VideoEditorFacade.ts:140-153`.
- **Problem:**
  - **MCP panel list.** The "available panels" rule (info, plus tools/resources/prompts by
    capability, plus history) exists in both the Inspector view and the facade. The facade writes
    `transportType`, `url` and `connectionName` straight into `model.state`, with a cast on
    `transportType`, instead of through model setters.
  - **Board install state.** The catalog "install state" (downloading, registered, downloaded or
    error, from install progress, the install registry and trust) is derived separately by
    `BoardInfoEditorView.tileStatus` and `BoardInfoEditorFacade.copyMatch`.
  - **Board properties projection.**
    - `BoardInfoEditorFacade.properties` is an 85-line hand-written spread (37 instances of
      `...(x !== undefined ? { x } : {})`). It re-lists the manifest fields that
      `projectBoardManifest` already projects for `BoardEditorFacade`.
    - Even the legacy-or-flags permission copy appears in both places.
  - **Video controls.** `VideoEditorFacade` plays, pauses and seeks by mutating the editor's
    exposed `HTMLMediaElement`, so the model leaks DOM and the facade acts as the controller.
- **Refactor:**
  - `McpInspectorEditorModel`: add `availablePanels` (used by the view and the facade) and
    `setTransportType`/`setUrl`/`setConnectionName`.
  - `BoardInfoEditorModel`: add `installStateOf(entry)` (used by `tileStatus` and `copyMatch`).
  - `BoardInfoEditorFacade.properties`: return `{ ...projectBoardManifest(props), ...infoExtras }`,
    with a small `copyDefined(source, keys)` helper for the remaining extras.
  - `VideoEditor`: add `play()`, `pause()` and `seek(t)`; the facade calls those.
- **Risk / notes:** the model additions are in the editors reviewer's area; the facade side is
  mechanical once they exist.

### SHL-11: The runner "hierarchy" is a one-subclass base; `AutoloadRunner` repeats its preparation; script globals are defined in three places
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `scripting/ScriptRunnerBase.ts:11-15,19-31,47-63`; `scripting/ScriptRunner.ts:23,28-30,52-76,90-127`;
    `scripting/AutoloadRunner.ts:50-71,79-99`.
  - `scripting/library-require.ts:6,15-20,37-41`.
  - `scripting/ScriptContext.ts:69-73,194-224`.
  - `api/internal/GlobalEventService.ts:253`.
- **Problem:**
  - **A base with one subclass.** `ScriptRunnerBase` has exactly one subclass. Its doc comment says
    "Stateless singleton" but it holds `libraryDirty` (`:28`).
  - **Two preparation paths.** `AutoloadRunner` does not use the base. It repeats the library
    preparation (`ensureSucraseLoaded` plus `registerLibraryExtensions`, without the dirty-cache
    clear) and scans the `autoload/` folder twice (`markNeedsReload` and `loadScripts`).
  - **Globals in three places.** The script globals are listed in `ScriptContext` fields,
    `SCRIPT_PREFIX` (`ScriptRunnerBase.ts:11-15`) and `MODULE_CONTEXT_PREFIX`
    (`library-require.ts:15-20`); adding one means three edits.
  - **A flag inferred from an unrelated argument.** MCP provenance is inferred from "a console log
    array was passed" (`ScriptContext.ts:69-73`).
  - **Hidden global counter.** `handlePromiseException` is a counter that is decremented 1 s after
    each run and read by `GlobalEventService.ts:253` (an `api` to `scripting` import).
  - **Dead entry point.** `scriptRunner.run` has no callers (`ScriptRunner.ts:28-30`), though
    `scripting.md`'s architecture diagram still shows it as the entry point.
  - **Redundant parameter.** `runWithResult(pageId, script, page, ...)` takes `pageId` although
    every caller passes `page.id`.
  - **Wrong-way import.** `ScriptRunner` dynamically imports `ui/dialogs/TextDialog` (`:63`)
    instead of using `ui.showTextDialog`.
  - **Pointless dynamic import.** `ScriptContext` is dynamically imported in `ScriptRunner`
    (`:110`) but statically in `AutoloadRunner`.
  - **Library-path bug (found while reviewing).** `registerLibraryExtensions` registers once and
    keeps the first `libraryPath` in its `.js` handler (`library-require.ts:37-41`). After the user
    changes the Script Library folder in the same session, `.js` files in the new folder are no
    longer transpiled or given the context prefix.
- **Refactor:**
  1. `scripting/script-engine.ts` holds the pure functions: `compile(script)` (implicit return,
     expression detection, `hasTopLevelReturn`) and `execute(compiled, context)`.
  2. `scripting/ScriptLibrary.ts` is a class that owns sucrase loading, extension registration
     (re-registered when `script-library.path` changes), the dirty flag and the cache clear. It
     subscribes to the settings change and to `library-service` invalidation and exposes
     `prepare()`.
  3. `ScriptRunner` (run modes only) and `AutoloadRunner` both call `scriptLibrary.prepare()` and
     the engine. Delete `ScriptRunnerBase`.
  4. Export a single `SCRIPT_GLOBALS` list from `ScriptContext`; generate both prefixes from it.
  5. `new ScriptContext({ page, origin: "user" | "agent" | "autoload", consoleLogs?, tipCollector? })`.
  6. Replace `handlePromiseException` with `scriptRunner.isActive` (a run counter without the timer)
     or attribute rejections through the context. Delete `run()`.
- **Risk / notes:** the implicit-return heuristics are user-visible. Move them verbatim and do not
  change behaviour.

### SHL-12: Two script APIs over Log View with separate input normalization; copy-pasted entry handles
- **Priority:** P3
- **Effort:** S
- **Where:** `api-wrapper/UiFacade.ts:27-35,131-162`; `api-wrapper/LogViewEditorFacade.ts:123-153`;
  `api-wrapper/Markdown.ts`, `Mermaid.ts`, `Text.ts`, `Grid.ts`, `Progress.ts`.
- **Problem:**
  - **Two normalizers.** The `ui` global (`UiFacade`) and `pages.logView` (`LogViewEditorFacade`)
    both write entries into the same `LogViewEditor`. Their input normalizers differ:
    `UiFacade.addDialogEntry` normalizes buttons itself, while `push` runs `normalizeUiPushEntry`
    with `strictTypes`. The same entry type can be accepted on one path and rejected on the other.
  - **Copied handle classes.** `Markdown` and `Mermaid` are identical apart from three strings;
    `Text`, `Grid` and `Progress` follow the same field-mirror and `updateEntryById` pattern.
- **Refactor:**
  - `UiFacade.show.*` and `dialog.*` build the entry object and run it through the same
    `normalizeUiPushEntry` (lenient mode) before adding it.
  - Replace the five handle classes with a generic `LogEntryHandle<TEntry>` that is given the
    field list (and, for markdown and mermaid, `openInEditor` representation data).
- **Risk / notes:** keep the public property names the scripts use (`text`, `title`, `data`, …).

### SHL-13: Dead code and stale leftovers
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `ScriptRunner.ts:28-30` (`run`, unused).
  - `ui/sidebar/pinned-items.ts` (`addPin`, `insertPin`, `movePin`, `isPinned`, `PinnedDragData`,
    all unused).
  - `ui/speech/SpeechTranscriptionProvider.ts:32-35` (`open`, unused).
  - `ui/speech/LiveSpeechSessionCoordinator.ts:18-20` (`isBusy`, unused).
  - `ScriptContext.ts:196,208-209` (unused `_releaseList` parameter and a stale "SF2 + LV9"
    migration comment).
  - `renderer-script-target.ts:6-8` ("legacy EditorModel; unwrap adapter" comment plus an `as any`
    left from the adapter era).
  - `ui/translation/TranslateTextPageController.ts:36-42` (`displayName`/`routeFor` pure aliases).
  - `ui/sidebar/MenuBarView.ts:55-56` (`isStaticFolder` alias of `isBuiltinFolder`).
  - `ui/dialogs/Dialogs.ts` (a one-line re-export of `DialogsView`), `ui/dialogs/poppers/Poppers.ts`
    (re-export) and the `ui/dialogs/index.ts` barrel: post-React shims. Dialog state
    (`dialogsState`, `showDialog`) is defined inside `DialogsView.ts:11,139-157`.
  - `DialogsView` and `PoppersView` are near-identical slot reconcilers.
  - `DialogsView.ts:9` calls `scripting/ai-vision/event-log`.
  - `ui/tabs/PageTabsView.ts:162-174` vs `176-188` (`updateTabs` and `refreshTabLayout` differ only
    by `scrollToActive`); `:231` hardcodes a 208 px locked-tab width that mirrors CSS.
  - `ui/dialogs/TorInfoDialog.ts:9`, `board-dialog-controller.ts:7`, `ui/speech/microphone-settings.ts:17,26`
    use raw `require("electron").ipcRenderer` rather than `api`.
- **Problem:** dead branches and shims make readers check whether code paths are still alive. The
  shims also hide where state lives.
- **Refactor:**
  - Delete the unused members and the alias functions.
  - Update dialog imports to the real module and delete `Dialogs.ts`, `Poppers.ts` and the barrel.
    Move `dialogsState`, `showDialog` and `popperState` into `dialogs-state.ts` (see SHL-1 step 2).
  - Extract one `ModelViewSlotHost` used by both the dialog and popper hosts. Have `showDialog`
    raise an `onDialogClosed` event that ai-vision subscribes to.
  - Merge the two `PageTabsView` methods.
  - Route the raw IPC calls through `ipc/renderer/api` methods.
- **Risk / notes:** none beyond import churn.

## Cross-area notes

- **api to ui and api to scripting imports** (api reviewer): `PageModel`,
  `PagesPersistenceModel`, `IPageHost`, `settings.ts`, `GlobalEventService` (imports both
  `ui/dialogs/poppers` and `scripting/ScriptRunner`), `boards.ts`, `board-install.ts`,
  `board-updates.ts` and `site-extension-management.ts`. See SHL-1 and SHL-5.
- **Model rules duplicated in editor views** (editors reviewer):
  - `BoardInfoEditorView.tileStatus:700-712` and `McpInspectorView.panelSegments:237` hold rules
    the facades duplicate.
  - `VideoEditor` exposes `activeMediaElement` (DOM) from the model.
  - `BrowserEditor`, `BoardEditorModel` and `VideoEditor` expose audibility through
    `_anyTabAudible` state plus duck-typed `toggleMuteAll` getters (SHL-4).
- **Board-editor id family** (editors reviewer): `board-editor:*` is special-cased outside the
  registry in `content/builtin-schemes.ts:359,373`, `content/folder-editor-link.ts:56`,
  `editors/base/editor-switch.ts:151,189`, `editor-switch-options.ts:92`, plus the three in my
  area. `editorRegistry` should resolve family ids.
- **Two audio capture hosts** (main and audio reviewers): in-window capture for voice typing and
  transcript (`ui/speech`) and the audio window that serves the `audio` capability
  (`renderer/audio/audio-window.ts`). Both build on `PcmAudioCapture` and DTLN cleaning. The
  audio window imports `ui/speech/*` (wrong direction). Open question for the owner: should voice
  typing and transcript use the audio service instead of a second capture stack?
- **Service-channel client copies** (main and boards reviewers): `api/renderer-capability-channel.ts`
  and `board-shim.ts` are further copies of the same protocol client (SHL-3). The
  `"voice-typing:"` and `"text-translation:"` board-id prefixes are hardcoded in
  `main/module-service-supervisor.ts:73,76` and in the renderer separately.
- **ai-vision tab rules** (ai-vision reviewer): `scripting/ai-vision/page-tab.ts:52-68`
  re-implements `PageTabView`'s active and sound rules (SHL-4). `ai-vision/dialogs/*` imports 14
  `ui/dialogs` modules.
- **BrowserEditorFacade raw IPC** (browser reviewer): `BrowserEditorFacade.ts:58` also uses raw
  `require("electron").ipcRenderer`. It should adopt the facade base in SHL-9.
- **Doc drift:**
  - `doc/architecture/folder-structure.md` lists `ui/dialogs/progress/ProgressModel.ts` and
    `ProgressOverlay.ts`, which do not exist (progress lives in `uikit/Progress/`), and lists
    `DialogsView.ts` twice.
  - `doc/architecture/scripting.md`'s architecture diagram starts from the dead
    `ScriptRunner.run`.
  - `overview.md`'s dependency rules contradict the actual import graph (SHL-1).

## Keep

- **View lifecycle.** `VanillaView` composition with `bind`/`own`/`listen`/`child` is used
  consistently. `PageContentView`, `SecondaryViewsView` and `PagesView` are good examples of hosts
  that only compose, and their long comments explain non-obvious DOM-order and change-detection
  decisions (US-1365).
- **Dialog split.** Each dialog has a `TDialogModel` subclass, a `show*()` function and a view
  registered by symbol id (`dialog-view-registry`). This is the right shape; only the place where
  the view gets registered needs to move (SHL-1).
- **AppWrapper.** It derives service properties from `appServiceDescriptors` and has a
  compile-time exhaustiveness check against `IApp` (`AppWrapper.ts:188-202`). Copy this approach
  for other mirrored surfaces.
- **Facades as copies with explicit contracts.** `GridEditorFacade.rows` returns a copy, with the
  reason documented. `TextEditorFacade.requireTextHost` uses one error contract. Script-facing
  types are projected copies, not live models.
- **Small speech modules.** `LiveSpeechSessionCoordinator` (lease object), `ComputerAudioGate` and
  `microphone-device.ts` are small, single-purpose and documented. `TextTranslationProvider` has a
  clean operation and queue API once its transport copy is removed (SHL-3).
