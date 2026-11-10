> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 06-browser — built-in browser, automation and AiVision — refactoring review

## Summary

The automation core is in good shape: `automation/ref.ts`, `snapshot.ts`, `CdpSession.ts`, and the
AiVision descriptor registrations in `scripting/ai-vision/namespaces/` all have clear responsibilities.
The browser editor is where the structure has worn down. The sub-models exist, but recent features
(site extensions, page-authored `.app`, translation, site permissions, certificates) were mostly
added to `BrowserWebviewModel` and `BrowserView.ts`. The sub-models also reach into each other
through the editor, and one flat ~45-field state holds every concern.

Answers to the brief:
- **The split between the four classes is not clean.** Navigation, zoom, translation, site
  extensions and certificates each span two to four of BrowserEditor, BrowserWebviewModel,
  BrowserView and the facade.
- **Automation is layered correctly** (facade → `operations.ts` → CDP), but the automation surface
  is implemented three times.
- **AiVision is coherent at its core.** The incoherent part is the browser page's remote `.app`,
  which is spread across five classes and does not live in `ai-vision/` at all.
- **The facade contains model logic.** It holds the whole page-remote transport.

The three biggest problems:
1. `BrowserWebviewModel` is a 1,450-line god class. About 600 of its lines are a site-extension
   runtime (BRW-1).
2. The page-authored AiVision feature is spread across BrowserEditor, BrowserWebviewModel,
   BrowserEditorFacade, BrowserTabsModel and BrowserView (BRW-2).
3. The automation methods, their `waitFor` parsing and their help text are copied across three
   facades (BRW-3).

The flat state with hand-mirrored active-tab fields (BRW-4) is close behind. It has already caused
a stale-URL bug that the facade works around and `PageWrapper` still has.

## Findings

### BRW-1: `BrowserWebviewModel` is a god class (webview registry + event router + site-extension runtime + find + menus + translation registry + AiVision probing)
- **Priority:** P1
- **Effort:** L
- **Where:**
  - Site extensions: `src/renderer/editors/browser/BrowserWebviewModel.ts:127-139`, `:172-212`, `:597-896`, `:1098-1262`
  - Find: `:277-334`
  - Keyboard: `:263-275`
  - Translation registry: `:140-170`, `:380-383`
  - Page menu and resources: `:1287-1376`
  - Event router: `:456-587`
  - AiVision: `:39-52`, `:115-126`, `:898-1096`, `:1379-1454`
  - Also `src/renderer/editors/browser/BrowserEditor.ts:281-336` (a second keyboard handler) and `src/renderer/editors/browser/BrowserView.ts:105-130`
- **Problem:** The class comment ("Manages webview references, IPC event handling, context menu,
  and keyboard shortcuts", `:75-78`) no longer describes it. Its responsibilities now include:
  - a complete site-extension runtime:
    - per-document identity (`siteDocuments`)
    - injection and teardown script building (`:725-730`, `:822-844`)
    - trust-prompt handling, reload, and the action publication protocol
    - a page→main fetch proxy with concurrency limits (`:1117-1148`)
    - action running with timeouts, cancellation and choice tokens (`:1177-1262`)
  - AiVision shape probing, signal parsing, rate-limited notify, and late-probe scheduling (BRW-2)
  - a per-tab registry of `BrowserPageTranslationController` (BRW-7)
  - find-in-page state commands
  - toolbar page-menu construction and "Show Resources" link collection
  - a second keyboard handler for Ctrl+F. `BrowserEditor.handleGlobalKeyDown` also handles Ctrl+F
    (`BrowserEditor.ts:305-308`).

  The action-document record is an anonymous 11-field object type (`:133-138`), referenced through
  `NonNullable<ReturnType<typeof this.actionDocuments.get>>` (`:853`, `:1098`, `:1228`, `:1247`).
  It is mutated from six methods. The same `Runtime.evaluate("…resolveFetch(…)")` call is written
  out three times (`:189-192`, `:1132-1135`, `:1138-1141`).

  The webview registry (`webviewRefs` and `webviewReady`) is a public mutable `Map`/`Set` that
  `BrowserView` (`:106-128`, `:223`), `BrowserTargetModel` (`:44`, `:52`), the facade (`:220`) and
  `BrowserTranslationController` (`:206`) all read and write directly.
- **Refactor:**
  1. **Extract the site-extension runtime.** Create `editors/browser/BrowserSiteExtensionController.ts`
     and expose it as `editor.siteExtensions`.
     - It owns `siteDocuments`, `injectedSiteExtensions`, `actionDocuments`, `actionChoices` and
       `dismissedExtensionPrompts`.
     - It also owns the trust-prompt state writers that are now on BrowserEditor
       (`BrowserEditor.ts:114-122`, `:754-765`).
     - Public API: `onDocumentReady(tabId)` (today `injectSiteExtension`), `onNavigation(tabId)`,
       `onTabReleased(tabId)`, `onActiveTabChanged(prev)`, `refreshTrust()`,
       `trustPrompt(tabId, docId)`, `dismissPrompt(...)`, `reload()`, `actions(tabId)`,
       `runAction(id)`, `chooseResult(token, i)`, `activePrompt()` and `dispose()`.
     - Replace the anonymous record with a `SiteActionDocument` class that has `isCurrent(active)`,
       `resolveFetch(id, result)` (one evaluate) and `cancel()`.
     - `site-extensions-agent.ts:156` and the facade call the controller.
  2. **Extract `BrowserFindModel`** (state plus open/close/next/prev/foundInPage). Also move the
     find reset into it from `BrowserTabsModel.ts:289-294`.
  3. **Move `getPageMenuItems`/`showResources`** into `browser-page-menu.ts`, next to
     `webview-context-menu.ts`, which already receives `showResources` as a callback.
  4. **Merge the two keyboard handlers** into one shortcut table on BrowserEditor.
  5. **Make the webview registry private.** Add `attach(tabId, webview)`, `detach(tabId, webview)`
     (with the identity check the view does today), `get(tabId)` and `isReady(tabId)`.

  What remains is a `BrowserWebviewModel` that owns guests (registry, readiness, load, back,
  forward, reload, zoom, devtools) plus one event router. The router fans out to
  `siteExtensions`, `pageRemote` (BRW-2), `translation` and `find`.
- **Risk / notes:** The order of operations on `did-navigate`, `did-start-loading` and tab close is
  load-bearing. For example, the `siteDocuments` bump must happen before re-injection, and the
  registration must be cleared before the probe. Keep all of that in the one router method so the
  order stays visible. Do this together with BRW-2, because both carve code out of the same file.

### BRW-2: Page-authored AiVision (`pages[i].editor.app`) is spread over five classes, including the facade's transport
- **Priority:** P1
- **Effort:** M
- **Where:**
  - Registration store: `src/renderer/editors/browser/BrowserEditor.ts:46-58`, `:89-94`, `:163-256`
  - Probe, signals and notify: `BrowserWebviewModel.ts:39-52`, `:115-126`, `:589-595`, `:898-1096`, `:1379-1454`
  - Transport, revalidation, refusals and labelling: `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:246-448`, `:952-994`
  - Invalidation on tab close: `BrowserTabsModel.ts:165-167`, `:220-221`, `:244-245`
  - Indicator: `BrowserView.ts:866-872`
  - `aiVisionIndicatorRevision`: `BrowserEditorModel.ts:153-154`
- **Problem:**
  - **One feature, five classes.** The store (generation, token and binding version) is on the
    editor. Probing and signal handling are on the webview model. The request/revalidate transport,
    WebMCP namespace routing (`isWebMcpRequest`) and stale-document refusals are in the script
    facade. The tabs model must remember to invalidate the store on close.
  - **The in-page globals are written out in two classes.** `window.__aiVision` and
    `window.__persephoneWebMcpRemote` appear in the probe (`BrowserWebviewModel.ts:39-46`) and twice
    more in the facade (`:340-341`, `:384-391`). The preload defines the same global as
    `hostKey` (`preload-webview.ts:101`).
  - **The board works the other way round.** `BoardEditorModel.requestAiVision` owns the
    transport and `BoardEditorFacade` only builds the proxy. The browser puts CDP evaluate logic in
    the facade.
  - **State is kept outside the model's state.** The registration and site-action data live
    outside state, so a revision counter (`aiVisionIndicatorRevision`) is bumped in state only to
    make the view re-sync.
- **Refactor:** Create `editors/browser/BrowserPageRemote.ts` (`editor.pageRemote`) and give it all
  of the following:
  - the registration store
  - probe, signal, notify and late-probe handling, with the bounds constants from
    `BrowserWebviewModel.ts:47-52`
  - `request(registration, request, timeoutMs)`
  - `revalidate(registration)`
  - the WebMCP routing
  - tab hooks: `onLoadStart`, `onLoadStop`, `onNavigation`, `onInPageNavigation`, `onTabReleased`
    and `onActiveTabChanged`
  - a `changed` subscription that replaces `aiVisionIndicatorRevision`

  Put the page-global names in one shared constants module, imported by the preload, the probe and
  the transport.

  The facade then keeps only agent presentation: proxy caching, `createRemoteProxy`,
  `labelPageShape` and the refusal message wording. The resulting call is
  `createRemoteProxy(shape, (req) => this.model.pageRemote.request(reg, req, timeout), …)`.
- **Risk / notes:** The privacy gate (`agentMayAccessBrowserPage`) is currently checked in
  BrowserWebviewModel (`:515`, `:593`, `:936`, `:1036`) and in the facade (`:311`, `:376`). Move all
  of those checks into `BrowserPageRemote`, and have the facade's checks call the same predicate.

### BRW-3: The automation surface is implemented three times (browser facade, board facade, `window.screen`)
- **Priority:** P1
- **Effort:** M
- **Where:**
  - `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:497-942`, `:945-950`
  - `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:239-386`, `:676-679`
  - `src/renderer/api/window-screen.ts:77-221`
  - Help text: `BrowserEditorFacade.ts:158-170`, `BoardEditorFacade.ts:150-160`, `scripting/ai-vision/namespaces/window-screen.ts:25-37`
  - `src/renderer/automation/operations.ts:363-407`
- **Problem:**
  - **Repeated method bodies.** About 20 methods (snapshot, click, hover, type, select, check,
    uncheck, clear, pressKey, keyDown, keyUp, evaluate, waitFor, screenshot, drag, fillForm,
    setInputFiles, …) have the same body in each facade: `ensureTargetReady(target, tabId)` +
    `resolveElementLocator` + one `operations.*` call.
  - **`waitFor` parsing is copied verbatim** three times (`BrowserEditorFacade.ts:874-897`,
    `BoardEditorFacade.ts:314-333`, `window-screen.ts:154-172`).
  - **The help paragraphs are copied** three times ("click() and hover() use trusted CDP mouse
    input…", "Keyboard, fill, check…").
  - **`ensureTargetReady` runs twice.** Every explicit `ensureTargetReady` in these methods is
    redundant: `installAutomationActivity` already calls it before each listed method
    (`operations.ts:389-395`).
  - **`installAutomationActivity` is stringly typed.** It patches prototypes by method-name lists
    that are repeated per facade. It guesses `tabId` by scanning the arguments for any object with
    a `tabId` key (`:383-388`), and special-cases `fillForm` and `dialogs` by name.
  - **The browser facade adds its own boilerplate.** It wraps 15 methods in the same tip-collector
    IIFE (`let tipUrl; const result = await (async () => {...})(); record(...)`, e.g. `:635-644`,
    `:653-670`). The placement is inconsistent: query methods compute `tipUrl` before readiness and
    the others after it (`:580-628` vs `:634-644`).
  - **The result:** a new automation operation means edits to three classes, three method lists,
    three help texts and `BROWSER_AUTOMATION_MEMBERS`.
- **Refactor:**
  1. **Add one `AutomationSurface` class** (`scripting/api-wrapper/AutomationSurface.ts`),
     constructed with `(target: IAutomationTarget, host: "browser" | "board" | "app",
     hooks?: { tipUrl?(tabId): string | undefined; record?(op, url) })`.
     - It implements every `BROWSER_AUTOMATION_MEMBERS` method once, including the `waitFor`
       option→mode parser.
     - It runs each operation through a private `run(op, tabId, fn, { passive })`, which
       replaces `installAutomationActivity`'s argument sniffing. It does readiness, the activity
       lease and tip recording in one place.
  2. **Facades compose it.** Either use explicit one-line forwards, or generate them once from the
     `BROWSER_AUTOMATION_MEMBERS` names, so `IBrowserEditor` and the descriptor stay in step.
  3. **Write one `AUTOMATION_HELP` constant** next to `BROWSER_AUTOMATION_MEMBERS`. Facades append
     their host-specific paragraphs.
  4. **Delete the redundant `ensureTargetReady` calls** and the three method-name lists.
- **Risk / notes:** Keep the passive-read exemptions (`operations.ts:364`, `:396-401`) and the
  `dialogs({ policy })` special case exactly as they are. This touches the board facade and
  `api/window-screen.ts` (other reviewers' areas) — coordinate. BRW-8's interface split makes the
  constructor type exact.

### BRW-4: Flat `BrowserEditorState` with hand-mirrored active-tab fields and three notions of "current URL"
- **Priority:** P1
- **Effort:** M
- **Where:**
  - `src/renderer/editors/browser/BrowserEditorModel.ts:152-244`, `:259-275`
  - `BrowserEditor.ts:387-511`, `:561-595`, `:653-688`
  - `BrowserTabsModel.ts:40`, `:137-143`, `:336-350`
  - `BrowserWebviewModel.ts:340-354`, `:395-407`
  - `browser-pages.ts:66-74`
  - `BrowserView.ts:1201`, `:1222-1224`
  - `BrowserEditorFacade.ts:450-468`
  - `src/renderer/scripting/api-wrapper/PageWrapper.ts:366`
- **Problem:**
  - **Mirrored fields go stale.** Six active-tab fields are copied to the top level (`url`,
    `pageTitle`, `loading`, `canGoBack`, `canGoForward`, `favicon`). They are kept in step by hand
    in five places. `updateTab` mirrors everything except `url` (`BrowserEditor.ts:674-686`), so
    after a link click `state.url` still names the previous document:
    - The facade documents this and works around it (`BrowserEditorFacade.ts:450-462`, "found by
      EPIC-090's gate run").
    - `PageWrapper.ts:366` still reports `state.url` in page summaries. That is a live instance of
      the same bug.
  - **"URL" means three things**, besides `webview.getURL()`:
    - `tab.url` doubles as the requested URL. The view diffs it and calls `loadURL`
      (`BrowserView.ts:1222-1223` → `navigateWebview`), so navigation needs a mounted view.
    - `tabs.currentUrls` is a side map holding the committed URL.
    - `state.url` is the stale mirror described above.

    Code picks between them with `currentUrls.get(id) || tab.url` fallbacks (`BrowserEditor.ts:173`,
    `:392`, `:563`; `BrowserTabsModel.ts:343`; `BrowserView.ts:246`, `:773`).
  - **The new-tab literal is written four times** (`BrowserEditorModel.ts:259-275`,
    `BrowserTabsModel.ts:137-143` and `:336-340`, `BrowserEditor.ts:484-498`).
  - **The "set url + tab.url + tab.homeUrl" update is written three times** (`BrowserEditor.ts:587-594`,
    `:571-578`, `browser-pages.ts:66-74`).
  - **The active-tab lookup is hand-written 19 times** (`tabs.find(t => t.id === state.activeTabId)`).
  - **Unrelated concerns share one state.** It mixes persisted fields, per-keystroke URL-bar fields
    (`urlInput`, `hoveredIndex`, `suggestionsOpen`, …), find, Tor, network, prompts and bookmarks.
    `BrowserEditorView` binds the whole state (`BrowserView.ts:1201`), so every URL-bar keystroke
    re-syncs the toolbar, tabs panel, page manager and every overlay. Data held outside state
    needs revision counters (`aiVisionIndicatorRevision`, `materializationRevision`).
- **Refactor:**
  1. Export one `createBrowserTab(url?, groupId?)` from the state module and delete the three
     other copies. Add `BrowserEditor.activeTab` and `findTab(id)`, and replace the lookups.
  2. Make navigation an explicit command: `navigate()` → `webview.load(tabId, url)`. Make `tab.url`
     the committed URL, set only from `did-navigate`/`did-navigate-in-page`. Delete `currentUrls`;
     the restore code reads `tab.url`.
  3. Remove the top-level mirrors. Readers use `activeTab`. `getRestoreData` already derives `url`
     from the active tab, and the legacy no-tabs restore path (`BrowserEditor.ts:457-460`) can map
     into tab 0. If full removal is too broad for one task, centralize the mirroring in one
     `syncActiveTabMirror(s)` that includes `url`, and call it from every writer.
  4. Give URL-bar, find and prompt state their own `TComponentState` slices, owned by
     `BrowserUrlBarModel`, `BrowserFindModel` and the prompt owners. Views bind the slice they
     render.
- **Risk / notes:** Restore format: keep emitting `url`/`pageTitle` in `getRestoreData`.
  Navigation-claim rollback (`BrowserWebviewModel.ts:419-447`) and `navigateWebview`'s "already at
  this URL" check depend on the two-URL scheme, so retest link interception. Fix `PageWrapper.ts:366`
  right away; it only needs `activeTab.url`.

### BRW-5: `BrowserView.ts` holds 12 view classes and the business logic of several of them
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/browser/BrowserView.ts:79-270` (webview item)
  - `:367-510` (site permissions)
  - `:574-996` (toolbar, ~420 lines)
  - `:1062-1099`, `:1101-1130` (prompt bars)
  - `:1134-1290` (editor view)
  - `BrowserEditor.ts:148-153`, `:167-188`
- **Problem:** Logic that the model-view standard (`doc/standards/model-view-pattern.md:10-11`)
  assigns to models lives in views:
  - **Site permissions and certificates in the toolbar view.** `BrowserToolbarView` keeps
    site-permission data, load generations, registration keys and an origin cache (`:605-615`,
    `:745-760`, `:820-848`). It also runs the whole certificate workflow: the CDP fetch via the
    model, an origin re-check, a capability probe, the `certificate.view` vs `text.open` fallback,
    and notifications (`:780-818`). BrowserEditor only carries raw IPC passthroughs for permissions
    (`:148-153`) and the CDP certificate read (`:167-188`).
  - **Model work in `BrowserWebviewItemView`.** It registers the guest with main, sends mute state
    on `dom-ready`, and unregisters (`:140-168`, `:221-228`). It dispatches guest messages
    (`:171-191`). Its favicon handling writes the favicon cache, decides persistence by scanning
    bookmark links, and routes through the profile proxy (`:242-264`).
  - **The view drives model lifecycle.** The view mounts the model's IPC listener (`:1188`), so
    the model hears no browser events while unmounted.
  - **Two permission-label maps with different keys** (`:367-378` vs `:1085-1090`, typed
    `Record<string, …>` instead of `BrowserPermissionKey`).
  - **Toolbar controls are set up twice.** Their props are built in the constructor and rebuilt
    by position in `sync()` through `controls[0..8]` (`:631-651` vs `:701-712`). The doc warns
    about this coupling (`browser-editor.md` "Browser toolbar order").
  - `setUrlInputRef` is called from two views (`:673`, `:1190`).
- **Refactor:**
  1. **Split the file:**
     - `BrowserWebviewItemView.ts`, together with `BrowserTabPageView` and `BlankPageLinksView`
     - `BrowserToolbarView.ts`
     - `SitePermissionsPopover.ts`
     - `PageZoomPopover.ts`
     - `TranslationPopover.ts`
     - `BrowserPromptBars.ts` (popup-blocked, permission, site-extension trust)
     - `BrowserEditorView.ts`, which only composes the others
  2. **Add `BrowserSitePermissionsModel`** (`editor.sitePermissions`) with its own state (`open`,
     `origin`, `entries`, `changed`, `certificateAvailable`) and methods `load`, `set`, `reset`,
     `viewCertificate`. Move the IPC passthroughs and `getCertificate` there; the facade's
     `getCertificate` delegates to it.
  3. **Move favicon handling and guest registration out of the view.**
     - Favicon handling becomes `BrowserTabsModel.onFavicon(tabId, pageUrl, faviconUrl)`.
     - Guest registration, mute and unregister become `BrowserWebviewModel.attach`/`detach`
       (BRW-1, step 5).
     - Guest message dispatch becomes a typed model method (BRW-6).
  4. **One `browser-permission-labels.ts`** with a `Record<BrowserPermissionKey, {setting; prompt}>`.
  5. **Give toolbar controls named fields** plus one `props(state)` builder per control.
- **Risk / notes:** This is the most visible UI. Keep `data-name` values unchanged; they are the
  agent element contract (`BrowserEditorFacade.ts:116-135`).

### BRW-6: The guest↔host boundary is stringly typed, with dead event types and a monolithic preload
- **Priority:** P2
- **Effort:** M
- **Where:**
  - Preload: `src/preload-webview.ts:18-441`, `:75-268`, `:116-123` vs `:185-192`, `:295`, `:303`, `:344`, `:381`, `:392`, `:421`
  - `src/preload-webview/page-translation-agent.ts:190`, `:360`, `:406`
  - `BrowserView.ts:171-191`
  - `src/ipc/browser-ipc.ts:175-191`
  - `src/main/browser-service.ts:564-575`
  - `BrowserWebviewModel.ts:464-586`, `:569-576`, `:1271-1272`
  - Registration key composed at `BrowserTabsModel.ts:304`, `:312`; `BrowserView.ts:159`, `:202`, `:212`, `:225`, `:745`; `BrowserWebviewModel.ts:255`, `:453`, `:871`, `:1037`, `:1299`; `webview-context-menu.ts:260`; `BrowserEditorFacade.ts:224`; `BrowserTargetModel.ts:28`
- **Problem:**
  - **Bare guest channel names.** Guest→host channels (`"page-title"`, `"page-favicon"`,
    `"clicked-images"`, `"guest-pointerdown"`, `"show-find-bar"`, `"hide-find-bar"`,
    `"translation-*"`) are bare strings on both sides. Their payloads are cast (`args[0] as string`).
  - **Two delivery paths, half of each dead:**
    - Main sends `page-title-updated` and `page-favicon-updated` browser events
      (`browser-service.ts:564-575`). No renderer case handles them; title and favicon come from
      the preload instead.
    - `BrowserEventType` declares `show-find-bar`/`hide-find-bar` (`browser-ipc.ts:188-189`), and
      `BrowserWebviewModel` handles them (`:569-576`), but main never sends them. Only the preload
      does, and `BrowserView` handles that copy (`:185-188`).
  - **The registration key is rebuilt everywhere.** The `${editorId}/${tabId}` key is written out
    in about 15 places. Raw `ipcRenderer` calls on `BrowserChannel` come from seven renderer
    files.
  - **The context-menu payload is `any`** (`BrowserWebviewModel.ts:1272`,
    `webview-context-menu.ts:20-21`), although `BrowserEventData` declares those fields.
  - **The preload is one block.** The whole file sits in one unindented
    `if (process.isMainFrame) {` block. It mixes the `window.chrome` shim, a ~190-line WebMCP
    polyfill/bridge, reporters, overlay dismissal, keys and image tracking. Inside the WebMCP bridge
    the tool-name mangling algorithm is written twice (`:116-123`, `:185-192`), and `makeShape`
    is recomputed on every call (`:184`).
- **Refactor:**
  1. Add `src/ipc/browser-guest-messages.ts` with a `GuestMessage` discriminated union and channel
     constants. The preload sends through a typed `sendToHost(msg)`. The renderer dispatch becomes
     `BrowserWebviewModel.handleGuestMessage(tabId, msg, frameId)` with an exhaustive `switch`.
  2. Pick one source for title and favicon, and delete the other path. Remove `show-find-bar` and
     `hide-find-bar` from `BrowserEventType` along with their dead cases. Type the context-menu data
     as `BrowserEventData`.
  3. Add a per-editor `BrowserGuestChannel` (`key(tabId)`, `register`, `unregister`, `setMuted`,
     `setZoom`, `hardReload`, `exitHtmlFullscreen`, `collectDom`, `networkLog`, `sitePermissions.*`,
     `fullscreen`, `cdp(tabId)`). All renderer browser IPC goes through it.
  4. Split the preload into `preload-webview/chrome-shim.ts`, `webmcp-bridge.ts` (one
     `toMemberName()` and one name→tool map built per update) and `page-reporters.ts`.
     `preload-webview.ts` becomes three `install*()` calls, like the existing cinema and
     translation installers.
- **Risk / notes:** Functions passed to `contextBridge.executeInMainWorld` are serialized, so the
  WebMCP function body must stay self-contained. The split is per file, not per closure. Removing
  main's unused title/favicon events touches `src/main` (cross-area).

### BRW-7: Translation is spread over three classes, wired with a callback, and has a dead detection-sample pipeline
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/browser/BrowserTranslationController.ts:27-214`, `:205-213`
  - `BrowserPageTranslationController.ts:53-56`
  - `BrowserWebviewModel.ts:140-170`, `:380-383`, `:473-474`
  - `BrowserEditor.ts:112-113`
  - `BrowserView.ts:683-687`, `:716-719`, `:948-952`
  - `preload-webview/page-translation-agent.ts:360`
- **Problem:**
  - **The pieces call each other in a cycle.** The toolbar workflow (`BrowserTranslationController`)
    calls `editor.webview.startPageTranslation` and `stopPageTranslation`. The per-tab page pumps
    (`BrowserPageTranslationController`) live in a map inside `BrowserWebviewModel`, behind seven
    forwarding members. `BrowserWebviewModel` then calls back into the toolbar controller through a
    callback that BrowserEditor installs (`setTranslationLifecycle`). That is a cycle hidden behind
    a setter.
  - **The view merges two states.** It subscribes to two state sources and combines toolbar state
    with `getPageTranslationState(...).lastError` itself.
  - **The page agent's detection sample is never used.** The agent sends
    `translation-detection-sample`. It is stored per frame and exposed via
    `getLatestTranslationDetectionSample`, which has no callers. Meanwhile the controller reads its
    own sample with `webview.executeJavaScript` (`:205-213`).
- **Refactor:**
  1. Move the per-tab page-controller map into `BrowserTranslationController`, which becomes the
     single translation owner, with `onNavigation(tabId)`, `onTabReleased(tabId)` and
     `handleFrame(...)`.
  2. Have the BRW-1 router call it directly and delete `setTranslationLifecycle`.
  3. Expose one `tabView(tabId)` (toolbar state plus page error/progress) and one subscription.
  4. Keep exactly one detection-sample path. Either use the agent's sample or delete it from
     `page-translation-agent.ts` and `BrowserPageTranslationController`.
- **Risk / notes:** Small and self-contained; a good first task.

### BRW-8: `automation/operations.ts` is a 1,300-line flat module with duplicated in-page snippets, dead helpers, and a too-wide target interface
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/automation/operations.ts:27-36`, `:113-227`, `:486`, `:497-509`, `:513-519`, `:532`, `:543-561`, `:767`, `:773-775`, `:807-809`, `:1027-1154`, `:1160-1187`, `:1226-1228`, `:1234-1247`, `:1287-1290`
  - `src/renderer/automation/input.ts:111`, `:267-465`
  - `src/renderer/automation/types.ts:44-78`
  - `src/renderer/automation/AppTargetModel.ts:42-100`
  - `src/renderer/editors/board/BoardTargetModel.ts:57`, `:77-127`
  - `src/renderer/editors/browser/BrowserTargetModel.ts:31-39`
- **Problem:**
  - **The same in-page JS is pasted in many places:**
    - The "visible" predicate (rect size + visibility + display) appears at `:125-129`, `:486`,
      `:532`, `:551-554`, `:1133-1134` and `:1234-1236`.
    - The ancestor-frame-offset loop appears at `:221-224`, `:767`, `:1226-1228` and `:1245-1247`.
    - Selector-to-element resolution exists in four variants with different strictness.
  - **Query methods break the documented locator contract.** `getText`, `getValue`,
    `getAttribute`, `getHtml`, `exists` and `waitFor` use first-match `document.querySelector`
    (`:1033-1095`, `:1129`). This contradicts the documented shared locator ("Selector actions
    filter to visible matches, fail immediately on multiple matches", `browser-editor.md:1281-1283`).
    It also means a `text=` locator, which `resolveElementLocator` accepts, throws a DOM syntax
    error there.
  - **Mouse dispatch is written three times** (`:497-509`, `:773-775`, `:807-809`). Modifier bits
    are defined twice (`operations.ts:543-545`, `input.ts:111`).
  - **Dead or misplaced code:**
    - `listTabs`, `openTab`, `closeTab`, `selectTab` and `closeActiveTab` (`:1160-1187`,
      `:1287-1290`) have no callers (leftovers from the removed `browser_*` MCP tools).
    - `focusElementByClick` is a pure alias (`:513-519`).
    - The board-only `boardDialogs`/`answerBoardDialog` (`:27-36`) live in the "target-neutral"
      module.
  - **Two input stacks.** The legacy `{ synthetic: true }` path keeps a whole second typing stack
    (`input.ts:267-465`). Two `IBrowserTarget` members (`focusWebview`, `insertText`) exist only
    for that path.
  - **The target interface is too wide.** `IBrowserTarget` forces every target to implement
    navigation and tabs. `AppTargetModel` throws for 7 members and `BoardTargetModel` throws for 6.
    The identical `mapPoint` reducer is copied into all three targets.
- **Refactor:**
  1. **Split the module:**
     - `page-scripts.ts`: string builders `VISIBLE_FN`, `FRAME_OFFSETS_FN`,
       `selectorResolverFn({ strict, nth, allowHidden, text })`
     - `locator.ts`: locator types, `resolveElementLocator`, `resolveActionablePoint`, `runOnLocator`
     - `mouse.ts`: one `dispatchClick`, drag
     - `forms.ts`: type, select, check, fillForm, setInputFiles
     - `queries.ts`
     - `page-events.ts`: dialogs, console, errors, activity lease
     - `synthetic.ts`: every legacy path, including `input.ts:typeText`
  2. **Make query methods use the shared resolver**, or document that they are first-match and
     reject `text=`.
  3. **Delete the dead helpers.** Move the board dialog functions into `editors/board/`.
  4. **Split the interface:**
     - `IAutomationTarget { id; cdp; inputCdp; ensureReady? }`
     - `ISyntheticInputHost { focusWebview; insertText }`
     - `INavigableTarget { navigate; back; forward; reload; activeTab }`
     - `ITabbedTarget { tabs; addTab; closeTab; switchTab }`

     Each operation takes the narrowest of these. Add a shared `createInputSession(cdp, sessionId)`.
- **Risk / notes:** Unifying selector semantics changes behavior for query methods, so mention it
  in the agent guide. The interface split touches `BoardTargetModel` (board area).

### BRW-9: Bookmark ownership is split between the tabs model and the bookmarks-UI model; the profile lookup is copied three times
- **Priority:** P2
- **Effort:** S
- **Where:**
  - `src/renderer/editors/browser/BrowserTabsModel.ts:43-118`, `:352-369`, `:59-73`
  - `BrowserBookmarksUIModel.ts:65-135`, `:108-128`
  - `BrowserEditor.ts:521-534`
- **Problem:**
  - **Two owners for one resource.** The bookmarks resource (preload timer, `init`, configure,
    dispose, file-path resolution) lives in `BrowserTabsModel`, which has nothing to do with tabs.
    `BrowserBookmarksUIModel` owns `ensureBookmarks`, persisting the chosen file, the star button
    and image tracking. Each reaches into the other (`model.tabs.bookmarks`,
    `model.tabs.initBookmarks`).
  - **The profile lookup is copied three times**, with small differences ("profile name, else
    default profile, else default setting"): `resolvedColor`, `getBookmarksFilePath` and the
    persistence branch.
  - **Read and write disagree for Tor (a bug I tripped over).** A Tor page reads
    `tor.bookmarks-file` (`BrowserTabsModel.ts:61`). But `ensureBookmarks` writes a chosen file for
    a Tor page into the default profile or `browser-default-bookmarks-file`
    (`BrowserBookmarksUIModel.ts:108-128`).
- **Refactor:**
  1. Rename `BrowserBookmarksUIModel` to `BrowserBookmarksModel` (`editor.bookmarks`) and move the
     resource lifecycle into it. `BrowserTabsModel` loses all bookmark code.
  2. Add `editors/browser/browser-profile.ts` with `resolveBrowserProfile(state)` returning
     `{ profile?, color, bookmarksFile, setBookmarksFile(path) }`. Its read and write cover the
     same modes symmetrically.
- **Risk / notes:** The blank-page overlay and drawer read `model.tabs.bookmarks`
  (`BrowserView.ts:314`, `:324`, `:1274`); update those reads.

### BRW-10: Browser page creation configures `BrowserEditor` from outside, and the refusal paths leak the editor
- **Priority:** P2
- **Effort:** S
- **Where:**
  - `src/renderer/editors/browser/browser-pages.ts:30-117`, `:51-61`, `:66-74`, `:81-96`, `:101-106`
  - `BrowserEditor.ts:342-385`
  - `BrowserTabsModel.ts:50-56`
- **Problem:**
  - **The editor is configured by direct state writes from outside.** `showBrowserPage` writes
    mode flags and the title into `editor.state`, and repeats `navigate()`'s tab-URL write.
  - **Tor arming is split across two places.** `restore()` already arms Tor
    (`BrowserEditor.ts:355-366`), and `showBrowserPage` re-arms it with its own error policy.
  - **Refusals leak.** On refusal the half-built editor is not disposed: the Tor path just returns
    (`:94`), and the proxy path disposes only `editor.network` (`:104`). The following stay alive:
    - the `globalKeyDown` subscription
    - the site-extension trust subscription
    - the bookmark preload timer (`BrowserTabsModel.ts:52-56`)
    - Tor's `windowClosing` subscription
    - the translation availability probe
- **Refactor:** Add `static async BrowserEditor.createNew(options): Promise<{ editor } | { refused: string }>`.
  - It applies flags with one `configureMode(options)`, picks the remembered engine, sets the
    first URL through `navigate()`, restores, arms, and calls `editor.dispose()` on any refusal.
  - `browser-pages.ts` keeps only page selection (`openUrlInBrowserTab`). Its `matchesBrowser`
    becomes `editor.matches({ incognito, profileName, openedByAgent })`.
- **Risk / notes:** Keep "arm before `addPage`" exactly as it is; it is the fail-closed guarantee.

### BRW-11: Small rules re-implemented at call sites (zoom bounds, private-session test, trust-grant match, tab teardown, privacy guard)
- **Priority:** P2
- **Effort:** S
- **Where:**
  - Zoom: `BrowserEditor.ts:431`; `BrowserWebviewModel.ts:450`, `:468`; `BrowserView.ts:518-523`; `src/main/browser-service.ts:174`
  - `isIncognito || isTor`: `BrowserEditor.ts:545`; `BrowserEditorModel.ts:349`; `BrowserView.ts:250`, `:867`; `BrowserWebviewModel.ts:601`, `:673`, `:683-684`, `:802`, `:808`, `:1101`
  - Grant match: `BrowserEditor.ts:119`; `BrowserWebviewModel.ts:617`, `:641`, `:698`, `:720`, `:809`, `:1103`
  - Prompt construction: `BrowserWebviewModel.ts:625`, `:642`, `:783-792`
  - Active-prompt selection: `BrowserView.ts:1248-1249`, `BrowserEditorFacade.ts:795-799`
  - Tab teardown: `BrowserTabsModel.ts:163-167`, `:217-224`, `:242-247`; `BrowserView.ts:123-130`
  - Facade privacy guard: `BrowserEditorFacade.ts:217`, `:767`, `:773`, `:779`, `:785`, `:803`, `:812`
  - `src/renderer/editors/browser/agent-access.ts:23-27`
- **Problem:** Each of these is one rule with N hand copies. The copies already differ in detail:
  zoom validity is `>=50 && <=200` in one place and a clamp in another, and the step is 5 in the
  model and `PAGE_ZOOM_STEP` in the view. Tab release is written three times in the tabs model and
  once in the view, with different subsets of cleanup (the view also ends translation; the model
  copies don't). `privateBrowserRefusal`'s `"browser tools"` branch is dead; every caller passes
  `"call"`.
- **Refactor:**
  - Add `src/shared/browser-zoom.ts` (`MIN`, `MAX`, `STEP`, `DEFAULT`, `clamp`, `isValid`), used by
    the renderer and main.
  - Add `isPrivateBrowserSession(state)` to `agent-access.ts`.
  - Add `siteExtensionTrust.isGranted(extension)` in `site-extension-trust.ts`.
  - Add a `SiteExtensionTrustPrompt.from(extension, tabId, docId, host)` factory.
  - Add `editor.siteExtensions.activePrompt()`.
  - Add one `BrowserEditor.releaseTab(tabId)` that fans out to the sub-models' `onTabReleased`.
  - Add one `requireAgentAccess()` in the facade.
  - Drop the unused `via` parameter.
- **Risk / notes:** Mechanical. Do it before or alongside BRW-1 so the extracted controller starts
  with the shared helpers.

### BRW-12: Naming and module shape — `BrowserEditorModel` is an alias that creates an import cycle; compatibility delegates and re-exports
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `src/renderer/editors/browser/BrowserEditorModel.ts:1-370`, `:370`
  - `BrowserEditor.ts:98-101`, `:130-147`, `:722-734`
  - `BrowserView.ts:1292`
  - `BrowserTorModel.ts:12-31`
  - `BrowserEditorFacade.ts:205`
  - `doc/architecture/browser-editor.md:33-35`
- **Problem:**
  - **`BrowserEditorModel.ts` is not a model.** It holds the state interface, the search-engine
    table, id generators, the title policy and partition naming. It ends with
    `export { BrowserEditor as BrowserEditorModel } from "./BrowserEditor"`, so 13 files call the
    class `BrowserEditorModel` and others call it `BrowserEditor`. That re-export also creates a
    value-level import cycle: `BrowserEditor.ts` → `BrowserWebviewModel.ts` (imports `DEFAULT_URL`)
    → `BrowserEditorModel.ts` → `BrowserEditor.ts`.
  - **Compatibility delegates.** BrowserEditor keeps "thin tab and Tor delegates for existing
    callers" (doc `:33-35`; code `:140-147`, `:722-734`). `BrowserView.ts` re-exports `BrowserEditor`.
  - **Misplaced responsibility.** `BrowserTorModel` computes partitions for incognito and default
    profiles too.
  - **No interface check on the facade.** The facade says it implements `IBrowserEditor`
    (`:198-199`) but declares only `IAiVisible`. `BoardEditorFacade` declares its public interface.
  - **Leftovers.** `typedQueue` is a double cast, and `_anyTabAudible` uses an underscore name in
    the persisted state type.
- **Refactor:**
  - Rename `BrowserEditorModel.ts` to `browser-state.ts` and move the engines into
    `search-engines.ts`. Drop the alias and import `type BrowserEditor` everywhere.
  - Remove the delegates: callers use `editor.tabs.*` and `editor.tor.*`. Keep only members that
    form the documented editor API.
  - Move `partition` to BrowserEditor or a small `BrowserSession`.
  - Declare `implements IAiVisible, IBrowserEditor` on the facade.
  - Delete the re-export from `BrowserView.ts`.
- **Risk / notes:** Purely mechanical. Run it first or last to avoid merge churn with BRW-1 and
  BRW-4.

### BRW-13: AiVision folder — parallel dialog-adapter registry with copied UI strings, root module doing two jobs, member tables not tied to implementations
- **Priority:** P3
- **Effort:** M
- **Where:**
  - `src/renderer/scripting/ai-vision/dialogs/index.ts:37-52`
  - `dialogs/tor-info.ts:23-28`, `dialogs/namespace-collision.ts:23`, `dialogs/register-toolset.ts:24`
  - `src/renderer/ui/dialogs/dialog-view-registry.ts:31-42`
  - `src/renderer/scripting/ai-vision/root.ts:59-90`, `:262-284`, `:322-400`
  - `src/renderer/scripting/ai-vision/namespaces/clipboard.ts:79-97`
- **Problem:** Overall the AiVision layer is coherent. The `ai-vision` package does resolution,
  proxies and events; `namespaces/index.ts` registers one descriptor per service; standalone
  nodes cover agent-only surfaces. There are four weak spots:
  1. **Dialog adapters live in a second registry** keyed by the same view symbols as
     `dialog-view-registry`, with `as unknown as symbol` casts. Three adapters hard-code English
     copies of UI text, "mirroring" view line numbers. Those references are stale:
     `TorInfoDialogView.ts:104-106` are now the location row. The view uses
     `t("dialogs.torReconnectExplanation")` and also serves proxied profiles, but the adapter always
     reports "Tor connection".
  2. **`root.ts` holds the root node and a module-level script-run registry**
     (`pendingScriptRuns`, TTL, pruning).
  3. **Member tables are separate string lists** (`ROOT_MEMBERS` vs the getters,
     `BROWSER_EDITOR_MEMBERS` vs the facade). Nothing links a declared name to a real member, so
     renames drift silently.
  4. **`ClipboardHistoryNode` knows the clipboard service's storage format**, including a legacy
     JSON form.
- **Refactor:**
  1. Let `registerDialogView(id, ctor, { aiVision?: (entry) => DialogAdapter })` carry the adapter.
     Adapters read titles and messages from the dialog model's state (set by the `show*` function)
     instead of copying them.
  2. Move `ScriptNode` and its run registry to `namespaces/script.ts`.
  3. Add a typed helper `aiMembers<T>()(...)` whose `name` is `Extract<keyof T, string>`, and use
     it for facade and root tables.
  4. Move file-list payload parsing into the clipboard-history API module.
- **Risk / notes:** Item 1 touches `ui/dialogs` (other reviewer). Item 3 is compile-time only.

### BRW-14: `browser-editor.md` describes React-era internals and overstates locator uniformity
- **Priority:** P3
- **Effort:** S
- **Where:** `doc/architecture/browser-editor.md:160`, `:162`, `:166`, `:172`, `:180`, `:33-35`, `:1281-1283`
- **Problem:**
  - **React-era text.** The doc still describes a "memo comparator", the "mount effect", the
    "navigation effect" and the rule that "the IPC registration effect must NOT include `tab.url`
    in its dependency array". The editor is now `VanillaView` classes.
  - **Delegates described as intended design.** It presents the compatibility delegates (BRW-12)
    as the design.
  - **Locator claim is too broad.** It says every selector action is strict, which query methods
    are not (BRW-8).
- **Refactor:** Rewrite "Webview View Identity", "dom-ready Gating", "IPC Registration" and
  "Data Flow §1" in terms of `BrowserWebviewItemView.onMount`/disposers and the explicit navigation
  command (after BRW-4). Update "Model Composition" after BRW-1, BRW-2, BRW-7 and BRW-9.
- **Risk / notes:** None; do it as part of the refactor tasks' `/document` step.

## Cross-area notes

- **`src/renderer/scripting/api-wrapper/PageWrapper.ts:366`** reports `state.url`, which goes stale
  after in-page or link navigation (BRW-4). Switch it to the active tab's URL now.
- **`src/main/browser-service.ts:564-575`** sends `page-title-updated` and `page-favicon-updated`
  events that no renderer code handles. **`src/ipc/browser-ipc.ts:188-189`** declares
  `show-find-bar`/`hide-find-bar` browser events that main never sends (BRW-6).
- **Zoom bounds are duplicated in main** (`browser-service.ts:174`) and in the renderer (BRW-11).
- **`BoardEditorFacade` and `api/window-screen.ts`** carry the same automation boilerplate and help
  text as the browser facade (BRW-3). **`BoardTargetModel`** implements throwing stubs for an
  over-wide interface (BRW-8).
- **The board-only dialog helpers** `boardDialogs`/`answerBoardDialog` live in
  `automation/operations.ts:27-36`; they belong in `editors/board/`.
- **`src/renderer/api/site-extensions-agent.ts:150-156`** reaches into
  `editor.webview.reloadSiteExtension()`. After BRW-1 it should call `editor.siteExtensions.reload()`.
- **`ai-vision/dialogs/*` duplicates `ui/dialogs/dialog-view-registry.ts` and copies dialog text**
  (BRW-13). Coordinate with the UI/dialogs reviewer.
- **`ClipboardHistoryNode`** parses the main-process clipboard storage format (BRW-13); it belongs
  in the clipboard area.
- **Bugs found in passing** (not reviewed in depth):
  - Tor bookmark-file read/write asymmetry (BRW-9).
  - `showBrowserPage` refusal paths do not dispose the editor (BRW-10).
  - Query methods break on `text=` locators (BRW-8).

## Keep

- **`automation/ref.ts`:** one owner for ref parsing, frame sessions and CDP error translation,
  with the injection contract written down at the call seam.
- **`CdpSession.invokeUnwrapped`/`cdpExceptionMessage`:** error framing is stripped in one place,
  not at each caller.
- **`editors/browser/agent-access.ts`:** one dependency-free privacy rule, shared by the call tree
  and the facade. It should be the only place that test lives (BRW-11).
- **`scripting/ai-vision/namespaces/index.ts` + `registerAiVisionFor`:** agent metadata sits next
  to the service but outside it, so service objects stay free of agent concerns. A good model for
  other areas.
- **`BrowserTorModel` and `BrowserProfileNetworkModel`:** focused sub-models with `DisposableStore`
  and lifecycle-generation guards.
- **`BrowserPageTranslationController`:** a self-contained per-tab pump, with its tuning bounds as
  named constants at the top.
- **`preload-webview/cinema-mode.ts`:** large but single-purpose per-frame runtime, with a
  namespaced message protocol.
- **`PageManagerView` placeholder stability for `<webview>`:** a well-explained pattern that solves
  a real reload problem.
