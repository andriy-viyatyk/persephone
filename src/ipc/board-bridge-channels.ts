/**
 * Board bridge wire types — the `persephone` integration tier carried over the
 * per-board `MessagePort` (EPIC-034 / US-724; re-homed onto a `MessageChannelMain`
 * port in EPIC-037 / US-771).
 *
 * A board iframe has no `ipcRenderer` and no preload — its only channel to the
 * privileged side is a `MessagePort` minted per board in main and transferred into
 * the frame by the host renderer (the one-time handshake). The board↔main protocol
 * is the {@link BoardToMain} / {@link MainToBoard} envelope union below; `execute()`
 * rides the same port as `{ kind: "runner", … }` envelopes wrapping the existing
 * `runner-channels.ts` messages.
 *
 * Like `runner-channels.ts`, this module is intentionally dependency-free (no
 * imports from `src/main` or `src/renderer`) so the injected board **shim**
 * (`src/board-shim.ts`, a plain browser script) can import its types. Dialog param
 * types are pulled type-only from the already-dependency-free `api-param-types.ts`;
 * runner message shapes from `runner-channels.ts`.
 */
import type { IAiRemoteRequest, IAiRemoteResponse, IAiVisionShape } from "ai-vision";
import type {
    OpenFileDialogParams,
    OpenFolderDialogParams,
    SaveFileDialogParams,
} from "./api-param-types";
import type {
    RunnerChannel,
    RunnerChunkMsg,
    RunnerErrorMsg,
    RunnerExitMsg,
    RunnerJobMsg,
    RunnerKillMsg,
    RunnerStartMsg,
    RunnerStdinMsg,
} from "./runner-channels";
import type { CapabilityErrorCode, IntentEnvelope } from "./capability-bus-channels";

export type { BoardServiceStatus } from "./module-service-channels";

/** The host color palette pushed into a board: the frozen color `--p-*` contract
 *  resolved to concrete values, plus theme identity. The `vars` keys are `--p-*`
 *  names (e.g. `--p-bg`). Re-pushed on every theme switch (US-725). */
export interface BoardThemePalette {
    /** Active theme id, e.g. "default-dark". */
    id: string;
    /** True for dark themes (lets a board pick asset variants). */
    isDark: boolean;
    /** `--p-*` name → concrete CSS color value. */
    vars: Record<string, string>;
    /** The `--p-graph-*` family as concrete values, keyed by the camelCased CSS suffix
     *  (`--p-graph-node-default` → `nodeDefault`) — a `<canvas>` cannot consume `var(...)`
     *  (EPIC-100 / US-1404). Optional ON THE WIRE only: the renderer ships the family inside
     *  `vars` like every other color, and the board SHIM derives this field from it, so the
     *  palette a board actually observes always carries it. */
    graph?: Record<string, string>;
}

/** The board context baked into served HTML by the `board://` handler as
 *  `window.__persephoneBoot` (EPIC-037 / US-771) — read synchronously by the shim
 *  before the first author script, replacing the old synchronous `getContext` IPC.
 *  The board root is NOT included: main fills the default `execute()` cwd + relative
 *  file paths from its own `boardId → root` registry. */
export interface BoardBootContext {
    /** Initial color palette, applied by the shim at first paint (US-725). Live
     *  switches arrive later as a {@link MainToBoard} `theme` envelope over the port. */
    theme: BoardThemePalette;
    /** Static metric vars (`--p-space-*`, `--p-radius-*`, …) — theme-independent. */
    tokens: Record<string, string>;
    /** The host renderer's origin — the shim accepts the port-handshake message only
     *  when `event.origin === hostOrigin` AND `event.source === window.parent` (C2). */
    hostOrigin: string;
}

export type BoardNotifyType = "info" | "success" | "warning" | "error";

export interface BoardNotifyMsg {
    message: string;
    type?: BoardNotifyType;
}

export interface BoardOpenRawLinkMsg {
    href: string;
    /** Optional registered editor id to open the file with (e.g. "md-view").
     *  Falls back to the default editor when omitted or when the editor doesn't
     *  accept the file (US-756 C6). */
    editor?: string;
}

/** `persephone.openContent(...)` — the board equivalent of `pages.addEditorPage` (EPIC-100 /
 *  US-1404). CREATE-ONLY by design: it builds one new in-memory, untitled page in the board's own
 *  window and returns that page's id. It carries no handle to any pre-existing page, so it does not
 *  widen `persephone.call`'s deliberate page scoping. */
export interface BoardOpenContentRequest {
    /** Target editor id (e.g. "md-view", "grid-json"). Must be a registered content-host editor;
     *  a `board-editor:<root>` id is rejected. */
    editor?: string;
    /** Monaco language id for the new page. Defaults to "plaintext". */
    language?: string;
    /** Page title. Trimmed and length-capped; empty → "untitled". */
    title?: string;
    /** Initial page content. */
    content?: string;
}

/** Reply to a board `board:openContent` request, pushed renderer → board and matched by `reqId`. */
export interface BoardOpenContentResultMsg {
    __persephone: "openContent:result";
    reqId: number;
    /** Id of the newly created page. */
    pageId?: string;
    /** Set instead of `pageId` when the request was rejected. */
    error?: string;
}

/** Board frame -> host: open a link as an origin-local ranged resource. */
export interface BoardContentOpenRequestMsg {
    __persephone: "board:contentOpen";
    reqId: number;
    link: string;
    timeoutMs?: number;
}

/** Host -> board frame: metadata for a content resource URL. */
export interface BoardContentOpenResultMsg {
    __persephone: "contentOpen:result";
    reqId: number;
    url?: string;
    size?: number;
    contentType?: string;
    error?: string;
}

/** Encoding for the board file bridge (US-756 C4). "utf8" returns/accepts a plain
 *  string; "base64" returns/accepts base64; "binary" returns/accepts the bytes
 *  themselves as a `Uint8Array` (bridge API 1.1.0 / app 4.0.21 — US-933).
 *
 *  Prefer "binary" for binary files. "base64" costs an encode in main, a ~33% larger
 *  payload over the port, and an `atob` + per-byte decode in the board (measured: 65 ms
 *  of pure conversion on a 20 MB file, and ~3x the transient memory), and it cannot
 *  carry a file over ~400 MB at all, because base64 of one exceeds V8's max string
 *  length. It remains the right choice only when the board actually wants base64 text
 *  (a `data:` URI, say). */
export type BoardFileEncoding = "utf8" | "base64" | "binary";

export interface BoardReadFileMsg {
    /** Absolute, or relative to the board root. */
    path: string;
    encoding?: BoardFileEncoding;
}

export interface BoardWriteFileMsg {
    /** Absolute, or relative to the board root. */
    path: string;
    /** File contents — a plain string ("utf8"), base64 ("base64"), or bytes ("binary"). */
    data: string | Uint8Array;
    encoding?: BoardFileEncoding;
}

// ── Port RPC envelopes (EPIC-037 / US-771) ───────────────────────────────────
// board ↔ main over the per-board MessagePort. Request/reply uses an `id`; fire-
// and-forget effects carry no id; `execute()` wraps runner-channels messages in a
// `runner` envelope (board→main: start/stdin/end-stdin/kill; main→board: stdout/
// stderr/exit/error). Theme is pushed main→board for live retint.

/** Request/reply methods (board → main, awaited by the shim). */
export type BoardRpcMethod =
    | "openFileDialog"
    | "saveFileDialog"
    | "openFolderDialog"
    | "readFile"
    | "writeFile"
    | "getJobs"
    | "serviceRequest"
    | "serviceStatus"
    | "serviceStop"
    | "storageGet"
    | "storageSet"
    | "storageDelete"
    | "storageKeys"
    | "clipboardWriteImage"
    | "clipboardWriteText";

/** JSON values accepted by the board-owned storage API. Runtime validation also rejects
 * non-finite numbers, cyclic values, class instances, oversized documents, and deep values. */
export type BoardJsonValue = null | string | boolean | number
    | BoardJsonValue[] | { [key: string]: BoardJsonValue };

/** A live job owned by this board (US-799) — the `getJobs` RPC result element.
 *  Plain data over the port; the shim wraps each in a control handle
 *  (`kill`/`write`/`endStdin` posting the usual runner messages by `jobId`). */
export interface BoardJobInfo {
    jobId: string;
    command: string;
    /** The caller-chosen name from `execute(cmd, { name })`, if any. */
    name?: string;
}

/** Fire-and-forget methods (board → main, no reply). */
export type BoardFireMethod = "openRawLink" | "notify";

/** JSON-compatible request for the page-scoped AiVision call surface. */
export interface BoardCallRequest {
    path: string;
    args?: unknown[];
    value?: unknown;
    maxLength?: number;
    timeoutMs?: number;
}

/** Correlated result for `persephone.call()`. */
export interface BoardCallResultMsg {
    kind: "call-result";
    id: number;
    result?: unknown;
    error?: string;
}

/** A runner envelope sent board → main (the caller→runner half of `RunnerChannel`). */
export interface BoardRunnerOutMsg {
    kind: "runner";
    channel:
        | RunnerChannel.start
        | RunnerChannel.stdin
        | RunnerChannel.endStdin
        | RunnerChannel.kill;
    msg: RunnerStartMsg | RunnerStdinMsg | RunnerJobMsg | RunnerKillMsg;
}

/** A runner envelope sent main → board (the runner→caller half of `RunnerChannel`). */
export interface BoardRunnerInMsg {
    kind: "runner";
    channel:
        | RunnerChannel.stdout
        | RunnerChannel.stderr
        | RunnerChannel.exit
        | RunnerChannel.error;
    msg: RunnerChunkMsg | RunnerExitMsg | RunnerErrorMsg;
}

/** Everything the board posts to main over the port. */
export type BoardToMain =
    | { kind: "rpc"; id: number; method: BoardRpcMethod; args: unknown[] }
    | { kind: "call"; id: number; request: BoardCallRequest }
    | { kind: "fire"; method: BoardFireMethod; args: unknown[] }
    | { kind: "connected" } // shim → main: handshake liveness (mode D, EPIC-037 C11)
    | BoardRunnerOutMsg;

/** Everything main posts to the board over the port. */
export type MainToBoard =
    | { kind: "rpc-result"; id: number; result?: unknown; error?: string; code?: string }
    | BoardCallResultMsg
    | { kind: "theme"; palette: BoardThemePalette }
    | BoardRunnerInMsg;

/** The init message the host renderer posts into the board frame to transfer the
 *  port (the single `window.postMessage` survivor — C2). The transferred port is on
 *  `event.ports[0]`; the shim validates `event.origin`/`event.source` before use. */
export interface BoardPortInitMsg {
    __persephoneInit: true;
    /** Stable page identity used by the host-local pipe URL. */
    pageId?: string;
    /** One-shot capability request delivered to a newly opened handler board. */
    intent?: IntentEnvelope;
    /** True when this page's platform-owned pipe may be addressed by `host.streamUrl()`. */
    pipeUrlEnabled?: boolean;
    /** The board's current busy flag (US-799) — carried at handshake so a re-created
     *  board can read `persephone.getBoardBusy()` and reinitialize its running state. */
    busy?: boolean;
    /** The file a custom-editor board edits (EPIC-042) — carried at handshake so the board
     *  can read `persephone.getFilePath()`. Undefined for a board opened plainly. */
    filePath?: string;
    /** The raw persisted source identity — carried at handshake so the board can read
     *  `persephone.getSourceUrl()` without materializing the source. Undefined for a plain board. */
    sourceUrl?: string;
    /** True when the initial source was opened with a private browser session. */
    initialSourcePrivateSession?: boolean;
    /** The absolute directory claimed by a folder editor; distinct from the board root and
     *  from the file-only `filePath` axis. Read through `persephone.getFolderPath()`. */
    folderPath?: string;
    /** True when this board is a content-host editor (EPIC-043): Persephone owns the content
     *  host and pushes `host:content`. Gates `persephone.host.getContent/getLanguage` in the shim
     *  (a plain board rejects instead of hanging). */
    contentHost?: boolean;
    /** True when `filePath` is NOT directly readable — its real source is an archive entry
     *  (`archive.zip!doc.pdf`) or an `http(s)` URL, which Persephone must materialize into a local
     *  cache file first. `getFilePath()` then resolves through a `board:filePath` request instead of
     *  returning `filePath` verbatim, so the board always receives a readable LOCAL path. Absent
     *  (the common case) keeps the zero-round-trip handshake path. */
    materialize?: boolean;
}

export type BoardToolbarControlType = "button" | "toggle" | "menu" | "select" | "segmented" | "input";

export type BoardToolbarIcon =
    | { name: string }
    | { svg: string; preserveColors?: boolean }
    | { file: string; preserveColors?: boolean };

export type BoardToolbarControlDescriptor =
    | {
        id: string;
        type: "button";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "toggle";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        value: boolean;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "menu";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        items: readonly { id: string; label: string; disabled?: boolean }[];
        disabled?: boolean;
        /** `"board-menu"` adds the items to the top of Persephone's own … menu instead of drawing a
         *  menu button. Fixed at `set()`; `update()` cannot move a control. */
        placement?: "toolbar" | "board-menu";
    }
    | {
        id: string;
        type: "select";
        label?: string;
        title?: string;
        options: readonly { value: string; label: string }[];
        value: string;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "segmented";
        label?: string;
        title?: string;
        /** One button per option; each needs a `label`, an `icon`, or both. */
        options: readonly BoardToolbarSegment[];
        value: string;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "input";
        label?: string;
        title?: string;
        value: string;
        placeholder?: string;
        disabled?: boolean;
    };

/** One option of a `segmented` toolbar control. */
export interface BoardToolbarSegment {
    value: string;
    label?: string;
    title?: string;
    icon?: BoardToolbarIcon;
    disabled?: boolean;
}

export type BoardToolbarControlPatch = {
    id: string;
    type?: BoardToolbarControlType;
    label?: string;
    title?: string;
    icon?: BoardToolbarIcon;
    disabled?: boolean;
    value?: boolean | string;
    items?: readonly { id: string; label: string; disabled?: boolean }[];
    /** Select options (`label` required, no icons) or segmented options. */
    options?: readonly BoardToolbarSegment[];
    placeholder?: string;
};

export interface BoardToolbarSetMsg {
    __persephone: "board:setToolbarControls";
    controls: readonly BoardToolbarControlDescriptor[];
}

export interface BoardToolbarUpdateMsg {
    __persephone: "board:updateToolbarControls";
    controls: readonly BoardToolbarControlPatch[];
}

export interface BoardToolbarControlEventMsg {
    __persephone: "toolbar:control";
    id: string;
    type: BoardToolbarControlType;
    value?: boolean | string;
}

/** The complete board-to-host window message union. */
/** Text used by the board toolbar API on the board-to-host channel. */
export interface BoardToolbarTextMsg {
    __persephone: "board:setToolbarText";
    toolbarText: string;
}

export interface BoardInteractMsg { __persephone: "board:interact" }
export interface BoardErrorMsg { __persephone: "board:error"; message: string }
export interface BoardLogMsg { __persephone: "board:log"; message: string; level: "warn" | "error" }
export interface BoardBusyMsg { __persephone: "board:busy"; busy: boolean }
export interface BoardSetContentMsg { __persephone: "board:setContent"; content: string }
export interface BoardSaveMsg { __persephone: "board:save" }
export interface BoardSetModifiedMsg { __persephone: "board:setModified"; modified: boolean }
export interface BoardSaveHandlerMsg { __persephone: "board:saveHandler"; handlerId: number; registered: boolean }
/** `discard: true` tells the board the user chose Don't Save, so it can drop drafts kept for app restarts. */
export interface BoardSaveRequestMsg { __persephone: "board:saveRequest"; requestId: number; discard?: boolean }
/** Host asks a freshly loaded main frame to re-announce its active Save handler (registered before load). */
export interface BoardSaveHandlerSyncMsg { __persephone: "board:saveHandlerSync" }
export interface BoardSaveResultMsg { __persephone: "board:saveResult"; requestId: number; success: boolean; error?: string }
export interface BoardSetStateMsg { __persephone: "board:setState"; state: Record<string, unknown> }
export interface BoardMergeStateMsg { __persephone: "board:mergeState"; partial: Record<string, unknown> }
export interface BoardStateInitMsg {
    __persephone: "board:stateInit";
    defaults: Record<string, unknown>;
    restorableKeys?: string[];
}
export interface BoardSetSecondaryViewsMsg {
    __persephone: "board:setSecondaryViews";
    views: Array<{ id: string; html?: string; title?: string }>;
}
export interface BoardStatusTextMsg { __persephone: "board:setStatusText"; statusText: string }
export interface BoardCycleThemeMsg { __persephone: "board:cycleTheme"; direction: 1 | -1 }
export interface BoardVarRequestMsg {
    __persephone: "board:var";
    reqId: number;
    varMethod: "get" | "set" | "list" | "show";
    varArgs: unknown[];
}
export interface BoardSettingsRequestMsg {
    __persephone: "board:settings";
    reqId: number;
    settingsMethod: "get";
    settingsArgs: unknown[];
}

export type BoardStatusBarTone = "normal" | "muted" | "error" | "accent";
export interface BoardStatusBarTextItem {
    id: string; type: "text"; text: string; tone?: BoardStatusBarTone; title?: string;
    align?: "end"; hidden?: boolean;
}
export interface BoardStatusBarButtonItem {
    id: string; type: "button"; text: string; tone?: BoardStatusBarTone; title?: string;
    disabled?: boolean; icon?: BoardToolbarIcon; align?: "end"; hidden?: boolean;
}
export type BoardStatusBarItem = BoardStatusBarTextItem | BoardStatusBarButtonItem;
export type BoardStatusBarPatch = { id: string; type?: "text" | "button"; text?: string;
    tone?: BoardStatusBarTone; title?: string; disabled?: boolean; icon?: BoardToolbarIcon;
    align?: "end"; hidden?: boolean };
export interface BoardStatusBarSetMsg { __persephone: "board:setStatusBarItems"; items: readonly BoardStatusBarItem[] }
export interface BoardStatusBarUpdateMsg { __persephone: "board:updateStatusBarItems"; items: readonly BoardStatusBarPatch[] }
export interface BoardStatusBarActionMsg { __persephone: "statusBar:action"; id: string }
export interface BoardFetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    timeout?: number;
    maxRedirects?: number;
    rejectUnauthorized?: boolean;
    tor?: boolean;
    proxy?: string;
}
export interface BoardFetchRequestMsg { __persephone: "board:fetch"; reqId: number; url: string; init: BoardFetchInit }
export interface BoardFetchPullMsg { __persephone: "board:fetch:pull"; reqId: number }
export interface BoardFetchAbortMsg { __persephone: "board:fetch:abort"; reqId: number }
export interface BoardFilePathRequestMsg { __persephone: "board:filePath"; reqId: number }
export interface BoardFileIconsRequestMsg { __persephone: "board:fileIcons"; reqId: number; names: string[] }
export interface BoardOpenContentRequestMsg {
    __persephone: "board:openContent";
    reqId: number;
    openContent: BoardOpenContentRequest;
}

export interface BoardPageStateGetRequestMsg { __persephone: "board:pageState:get"; reqId: number; key: string }
export interface BoardPageStateSetRequestMsg { __persephone: "board:pageState:set"; reqId: number; key: string; value: string }
export interface BoardPageStateRemoveRequestMsg { __persephone: "board:pageState:remove"; reqId: number; key: string }
export interface BoardPageStateGetResultMsg { __persephone: "pageState:get:result"; reqId: number; value?: string; error?: string }
export interface BoardPageStateSetResultMsg { __persephone: "pageState:set:result"; reqId: number; error?: string }
export interface BoardPageStateRemoveResultMsg { __persephone: "pageState:remove:result"; reqId: number; error?: string }

/** Board-to-host window messages. Each discriminator has its own exact payload. */
export type BoardToHostMsg =
    | BoardInteractMsg
    | BoardErrorMsg
    | BoardLogMsg
    | BoardBusyMsg
    | BoardSetContentMsg
    | BoardSaveMsg
    | BoardSetModifiedMsg
    | BoardSaveHandlerMsg
    | BoardSaveResultMsg
    | BoardSetStateMsg
    | BoardMergeStateMsg
    | BoardStateInitMsg
    | BoardSetSecondaryViewsMsg
    | BoardStatusTextMsg
    | BoardToolbarTextMsg
    | BoardToolbarSetMsg
    | BoardToolbarUpdateMsg
    | BoardStatusBarSetMsg
    | BoardStatusBarUpdateMsg
    | BoardCycleThemeMsg
    | BoardVarRequestMsg
    | BoardSettingsRequestMsg
    | BoardFetchRequestMsg
    | BoardFetchPullMsg
    | BoardFetchAbortMsg
    | BoardFilePathRequestMsg
    | BoardFileIconsRequestMsg
    | BoardOpenContentRequestMsg
    | BoardPageStateGetRequestMsg
    | BoardPageStateSetRequestMsg
    | BoardPageStateRemoveRequestMsg
    | BoardContentOpenRequestMsg
    | BoardAiVisionRegistrationMsg
    | BoardAiVisionNotifyMsg
    | BoardAiVisionResultMsg
    | BoardCapabilityIntentResultMsg
    | BoardCapabilityListRequestMsg
    | BoardCapabilityInvokeRequestMsg
    | BoardNavigationCreateReturnUrlMsg;

/** Host content pushed renderer → board over `iframe.contentWindow.postMessage` (EPIC-043).
 *  Repeated: an initial snapshot after the frame loads, then on every host content/language
 *  change. Echo-guarded renderer-side (a push equal to the board's last `setContent` is skipped),
 *  so the board's `onContentChange` never re-fires for the board's own write. */
export interface BoardHostContentMsg {
    __persephone: "host:content";
    content: string;
    language?: string;
}

/** Source identity pushed renderer → the board's main frame for runtime opens.
 *  It never carries payload bytes or a provider pipe. */
export interface BoardSourceOpenedMsg {
    __persephone: "source:opened";
    sourceUrl: string;
    /** Present only when the source was opened with a private browser session. */
    privateSession?: boolean;
}

/** Shared state pushed renderer → board over `iframe.contentWindow.postMessage` (EPIC-044).
 *  A snapshot after the frame loads (seed), then on every change. `seq` is a monotonic
 *  per-model version: the shim applies a push only when `seq` exceeds the last applied,
 *  so seed-vs-init / set / merge deliveries are order-independent (no echo-guard needed). */
export interface BoardStateSyncMsg {
    __persephone: "state:sync";
    state: Record<string, unknown>;
    seq: number;
}

/** Reply to a board `board:filePath` request pushed renderer → board. Matched to the request by
 *  `reqId`. `path` is a readable LOCAL path holding the board's content (the source path itself for
 *  a plain local file, else a cache file materialized from the content pipe); `error` is set instead
 *  when the source could not be read (missing archive entry, HTTP failure). */
export interface BoardFilePathResultMsg {
    __persephone: "filePath:result";
    reqId: number;
    path?: string;
    error?: string;
}

/** Reply to a board `board:fileIcons` request (US-1533). `urls` holds each distinct icon once, as a
 *  `data:` URL; `icons` maps every requested name to an index into `urls`. */
export interface BoardFileIconsResultMsg {
    __persephone: "fileIcons:result";
    reqId: number;
    urls?: string[];
    icons?: Record<string, number>;
    error?: string;
}

/** Reply to a board `board:var` request pushed renderer → board (EPIC-046). Matched to the
 *  request by `reqId`. `result` carries the method's return (get: string|undefined; list:
 *  string[]; set: undefined); `error` is set instead when the request rejected (not configured
 *  + user declined, locked, or a store error). */
export interface BoardVarResultMsg {
    __persephone: "var:result";
    reqId: number;
    result?: unknown;
    error?: string;
}

/** Reply to a board `board:settings` request. Settings are effective typed scalar values. */
export interface BoardSettingsResultMsg {
    __persephone: "settings:result";
    reqId: number;
    result?: string | number | boolean;
    error?: string;
}
export interface BoardFetchHeadMsg {
    __persephone: "fetch:head";
    reqId: number;
    status: number;
    statusText: string;
    headers: [string, string][];
    hasBody: boolean;
}
export interface BoardFetchChunkMsg { __persephone: "fetch:chunk"; reqId: number; chunk?: ArrayBuffer; done: boolean }
export interface BoardFetchErrorMsg { __persephone: "fetch:error"; reqId: number; error: string }

/** Renderer-to-board push for one effective board setting value. */
export interface BoardSettingsChangedMsg {
    __persephone: "settings:changed";
    id: string;
    value: string | number | boolean;
}

export interface BoardAiVisionRegistrationMsg {
    __persephone: "board:aiVision";
    schemaVersion: number;
    shape: IAiVisionShape;
    /** Why the shape arrived. `"register"` (the default when absent, so an older shim still
     *  reads correctly) is a *new* remote — a fresh document, or a second `expose()` — and
     *  invalidates every proxy and in-flight request built against the previous one.
     *  `"refresh"` is the *same* remote re-publishing its structure after the board changed
     *  it (`remote.refresh()`); the frame and the handlers behind it are unchanged, so
     *  in-flight requests must survive and only the cached shape is stale. */
    reason?: "register" | "refresh";
}

/** Host renderer → board iframe; the new opposite direction on this channel. */
export interface BoardAiVisionNotifyMsg {
    __persephone: "board:aiNotify";
    text: string;
}

export interface BoardAiVisionRequestMsg {
    __persephone: "ai:request";
    reqId: number;
    request: IAiRemoteRequest;
}

export interface BoardAiVisionResultMsg {
    __persephone: "board:aiResult";
    reqId: number;
    response: IAiRemoteResponse;
}

/** Board -> host renderer: mint one opaque navigation-return URL for this live frame. */
export interface BoardNavigationCreateReturnUrlMsg {
    __persephone: "navigation:createReturnUrl";
    reqId: number;
}

/** Host renderer -> board: reply to a navigation-return URL request. */
export interface BoardNavigationReturnUrlResultMsg {
    __persephone: "navigation:returnUrl";
    reqId: number;
    url?: string;
    error?: string;
}

/** Host renderer -> board: deliver a claimed navigation return to the exact owning frame. */
export interface BoardNavigationReturnMsg {
    __persephone: "navigation:return";
    url: string;
    query: Readonly<Record<string, readonly string[]>>;
    hash: Readonly<Record<string, readonly string[]>>;
}

/** Renderer → board: deliver one capability request to the board frame. */
export interface BoardCapabilityIntentRequestMsg extends IntentEnvelope {
    __persephone: "capabilities:intent";
}

/** Board → renderer: settle a capability request delivered to this frame. */
export interface BoardCapabilityIntentResultMsg {
    __persephone: "capabilities:intent:result";
    requestId: string;
    result?: unknown;
    discardPage?: boolean;
    error?: { code: CapabilityErrorCode; message: string };
}

/** Renderer → board: best-effort cancellation of an active capability request. */
export interface BoardCapabilityIntentCancelMsg {
    __persephone: "capabilities:intent:cancel";
    requestId: string;
}

/** Board → renderer: request the capabilities visible in this renderer. */
export interface BoardCapabilityListRequestMsg {
    __persephone: "board:capabilities:list";
    reqId: number;
}

/** Renderer → board: reply to a capability-list request. */
export interface BoardCapabilityListResultMsg {
    __persephone: "capabilities:list:result";
    reqId: number;
    result?: unknown;
    error?: { code: CapabilityErrorCode; message: string };
}

/** Board → renderer: invoke a capability from this board frame. */
export interface BoardCapabilityInvokeRequestMsg {
    __persephone: "board:capabilities:invoke";
    reqId: number;
    id: string;
    version?: number;
    payload: unknown;
    deadlineMs?: number;
}

/** Renderer → board: reply to a board capability invocation. */
export interface BoardCapabilityInvokeResultMsg {
    __persephone: "capabilities:invoke:result";
    reqId: number;
    pageId?: string;
    result?: unknown;
    error?: { code: CapabilityErrorCode; message: string };
}

/** All `__persephone:` envelopes exchanged between a board frame and its host renderer. */
export type BoardHostFrameMsg =
    | BoardToHostMsg
    | BoardToolbarSetMsg
    | BoardToolbarUpdateMsg
    | BoardHostContentMsg
    | BoardSourceOpenedMsg
    | BoardStateSyncMsg
    | BoardFilePathResultMsg
    | BoardPageStateGetResultMsg
    | BoardPageStateSetResultMsg
    | BoardPageStateRemoveResultMsg
    | BoardFileIconsResultMsg
    | BoardContentOpenResultMsg
    | BoardOpenContentResultMsg
    | BoardVarResultMsg
    | BoardSettingsResultMsg
    | BoardFetchHeadMsg
    | BoardFetchChunkMsg
    | BoardFetchErrorMsg
    | BoardSettingsChangedMsg
    | BoardAiVisionRegistrationMsg
    | BoardAiVisionNotifyMsg
    | BoardAiVisionRequestMsg
    | BoardAiVisionResultMsg
    | BoardCapabilityIntentRequestMsg
    | BoardCapabilityIntentResultMsg
    | BoardCapabilityIntentCancelMsg
    | BoardCapabilityListRequestMsg
    | BoardCapabilityListResultMsg
    | BoardCapabilityInvokeRequestMsg
    | BoardCapabilityInvokeResultMsg
    | BoardNavigationCreateReturnUrlMsg
    | BoardNavigationReturnUrlResultMsg
    | BoardSaveRequestMsg
    | BoardSaveHandlerSyncMsg
    | BoardNavigationReturnMsg
    | BoardToolbarControlEventMsg
    | BoardStatusBarActionMsg;

// Re-export the dialog param shapes so the shim + bridge import one place.
export type {
    OpenFileDialogParams,
    OpenFolderDialogParams,
    SaveFileDialogParams,
};
