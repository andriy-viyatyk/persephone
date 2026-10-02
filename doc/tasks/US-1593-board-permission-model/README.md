# US-1593: Permission model — bridge surface inventory, manifest schema, core enforcement

Epic: [EPIC-119: Board permissions](../../epics/EPIC-119.md)

> Implementation record: verified inventory and plan from review, with completion recorded below.

## Goal

Inventory every capability reachable by a trusted board, define normalized manifest permissions,
and enforce `execute`, `service`, `openExternal`, `appScripting`, and `network` at trusted
application-side handlers. Grants are frozen into the main-owned trust record when the user trusts
the board. File-system bridge scope belongs to US-1596, device/clipboard browser permission policy
belongs to US-1597, and permission UI/re-trust belongs to US-1598.

## Background

EPIC-119 decisions (2026-10-02), as amended by the US-1593 review: permissions are enforced and off
by default for the new object form; legacy forms retain their historical unrestricted grants except
that `service` remains enabled only when the old array contains `"service"`; permission changes
require re-trust; denied calls use the exact message `permission-denied: "<flag>" is not enabled in
board-manifest.json`; and any bridge behavior change requires a
`BOARD_BRIDGE_VERSION` bump. A new object-form manifest must set `minBridgeVersion` to that bumped
bridge version because old builds treat an object as an empty string list and would otherwise lose
the existing `service` grant. Bundled and registered-board migration is deferred to US-1599/1600/1601.

The starting bridge version was `1.28.0`; implementation bumps it to `1.29.0` in
`src/shared/board-bridge-version.ts`.

## Verified surface inventory

Each row is a capability family exposed to a trusted board. Main-process and renderer-host line
references below are the enforcement points to change, not merely the page-side wrapper. The current
`BoardWebview.handleMessage` accepts only the live board iframe's `board://<host>` origin and exact
`event.source === frame.contentWindow` (`src/renderer/editors/board/BoardWebview.ts:743-761`).

| # | API / surface | Trusted-side handler (`file:line`) | Reach | Classification | Finding |
|---|---|---|---|---|---|
| 1 | `persephone.execute()` | `src/main/board-bridge.ts:359-373` | Starts an OS child process with board-selected command, args, cwd, and environment; board controls stdin/kill (`:374-384`). | `execute` (dangerous; implies full access) | `startJobTo` is the main-process execution route. |
| 2 | `persephone.executeNode()` | `src/main/board-bridge.ts:359-373` | Starts Node code in an Electron utility process with board-selected script and args; default relative script resolves under board root. | `execute` (dangerous; implies full access) | Verify gate applies before either `startJobTo` or `startNodeJobTo`. |
| 3 | `persephone.service.request/status/stop()` and service provider registration | `src/main/board-bridge.ts:262-268`; `src/main/module-service-supervisor.ts:278-305, 379-383` | Calls/starts/stops a board-owned Node service in a utility process; provider implementation retains executable functions. | `service` (dangerous; implies full access) | Existing permission applies only to start eligibility (`board-service-permission.ts:8-14`; trust snapshot `board-trust-service.ts:199-205`), not a full per-request authorization contract. |
| 4 | `persephone.getJobs()` and process handles (`write`, `endStdin`, `kill`) | `src/main/board-bridge.ts:258-260, 374-384` | Enumerates this owner’s jobs and controls their processes. | `execute` | Currently process control is accepted on runner envelopes independent of permission. |
| 5 | `persephone.readFile()` / `writeFile()` | `src/main/board-bridge.ts:201-211, 239-256` | Main reads/writes paths; `resolveBoardFilePath` accepts absolute paths and relative paths rooted at board root. | `fileSystem` (`false` / `"board"` / `"full"`; US-1596) | Absolute paths are arbitrary filesystem access. Relative traversal needs the US-1596 boundary decision. |
| 6 | `openFileDialog`, `saveFileDialog`, `openFolderDialog` | `src/main/board-bridge.ts:236-238`; `src/ipc/main/dialog-handlers.ts` (dialog implementation) | Native picker returns user-selected file/folder paths to the board. | `fileSystem` (US-1596; selected-path semantics) | Paths selected this session are the user-picked-file exception in the epic. |
| 7 | `persephone.storage.get/set/delete/keys` | `src/main/board-bridge.ts:269-276`; `src/main/board-storage.ts` | Persistent JSON storage keyed to one board root. | Harmless | Board-scoped data storage; does not address arbitrary OS files. |
| 8 | `persephone.clipboard.writeText/writeImage` | `src/main/board-bridge.ts:282-290` | Writes caller-supplied text/image bytes to the OS clipboard. | Harmless-enough | Copy is a common user-facing action and write-only access cannot read user data. Pastejacking remains possible if a user later pastes the replaced clipboard contents. |
| 9 | `navigator.clipboard.read*` and iframe clipboard delegation | `src/renderer/editors/board/BoardWebview.ts:481-484`; `src/main/permission-policy-service.ts:29, 165-193, 215-240` | `iframe.allow` delegates read/write; the app-session `APP_ALLOW` currently allows `clipboard-read` and `clipboard-sanitized-write` without consulting the board. | `clipboardRead` for reads; writes remain allowed | US-1597 owns browser permission-policy integration for board origins and conditionally adding `clipboard-read` to the iframe allow list. |
| 10 | `persephone.call(path, options)` | Main relay `src/main/board-bridge.ts:307-330`; renderer handler `src/renderer/api/mcp/board-call-command.ts:11-68` | Resolves a renderer AiVision root from the board’s hosting page; includes `script.execute`, app fs/settings/ui/shell/proc, pages, tools, boards and other renderer nodes. It does not route `main.*` (`doc/architecture/overview.md`, Object Model / AiVision paragraphs). | `appScripting` (dangerous; implies full access) | `handleBoardCall` derives boardRoot from `ownerId`’s attached editor and uses the hosting page context, but currently only checks trust (`:41-59`). |
| 11 | `persephone.openRawLink()` and clicked board links | Main forwards board `openRawLink` with trusted entry (`src/main/board-bridge.ts:335-343`); renderer pipeline `src/renderer/api/internal/RendererEventsService.ts:56-63`; final URL launch `src/renderer/content/builtin-schemes.ts:110-132` | Links may open in an in-app browser tab/new Persephone page or finally launch via `shell.openExternal`; only the last action leaves Persephone. | `openExternal` only at the final outside-app launch | Internal browser tabs and new Persephone pages always stay allowed. Carry a trusted board source marker to the final launch handler. A denied fire-and-forget route is dropped and logged to that board’s board log. |
| 12 | `persephone.openContent()` | `src/renderer/editors/board/BoardWebview.ts:295-300`; `src/renderer/editors/board/board-open-content.ts:51-89` | Creates one new in-memory built-in editor page in the board’s window; cannot select/read/edit existing pages and rejects opening another board. | Harmless | Create-only; no read or mutation of an existing page. |
| 13 | `persephone.content.open()` | `src/renderer/editors/board/BoardWebview.ts:302-307, 1143-1215`; pipe read `src/main/board-protocol-service.ts:207-254` | Resolves links via the app content pipeline and exposes bytes to the board via `board://<host>/__pipe/resource/...`; may resolve local file-backed or network-backed content. | `network` for network-backed sources; `fileSystem` for other files (not the hosted document) | Check the board grant before resolving/opening; classify the resolved provider/source, including network-backed HttpProvider/session-src flows, and do not let a URL disguise a local/private network target. |
| 14 | `persephone.fetch()` | `src/renderer/editors/board/BoardWebview.ts:338-354`; `src/renderer/editors/board/board-fetch.ts:38-47`; underlying request/DNS seam `src/renderer/api/node-fetch.ts:139-173` | Host renderer calls `nodeFetch` with arbitrary URL, method, headers, body, proxy/Tor options and returns response bytes to board. | `network: false / "internet" / "full"` | `nodeFetch` constructs `http(s).request({ hostname })` and lets Node resolve implicitly; apply policy in its per-hop request path, after DNS and before connect, including redirects/proxies. Refuse the configured Persephone MCP endpoint unless `appScripting` is granted. |
| 15 | `persephone.getFilePath()` / `getFolderPath()` / `getSourceUrl()` | `src/renderer/editors/board/BoardWebview.ts:1106-1125` (file path); board model implementation reached by host | Discloses the identity/path of the document the user opened in this board. | Harmless | The hosted document’s path and source identity are part of the board’s user-authorized viewing/editing operation; `fileSystem` applies to other paths. |
| 16 | `persephone.file.streamUrl()` / `getContent()` and board content-host change/save/state | `src/renderer/editors/board/BoardWebview.ts:206-228, 1135-1215`; `src/renderer/editors/board/board-pipe-handler.ts:132-188` | Reads or changes and saves the document the user opened in this board editor. | Harmless | Reading and saving the hosted document is always allowed; `fileSystem` governs paths other than this hosted document. |
| 17 | `persephone.icons.forFiles()` | `src/renderer/editors/board/BoardWebview.ts:288-293, 1126-1141` | Returns icons/data URLs selected by supplied filenames. | Harmless | Filename-to-icon lookup only; does not open or read the named path. |
| 18 | `persephone.navigation.createReturnUrl()/onReturn` | `src/renderer/editors/board/BoardWebview.ts:309-315, 1219-1251` | Creates a nonce-scoped navigation return URL for this board frame. | Harmless | Claim is bound to the current page/model/frame/tab/generation. |
| 19 | `persephone.setSecondaryViews()` | `src/renderer/editors/board/BoardWebview.ts:228, 479-484` | Creates same-board sidebar views, each a `board://` iframe on the same host/root. | Harmless as a view operation; each frame inherits the board’s grants | Must resolve permissions by the owning board root for every secondary frame, not by tab ID or caller-supplied host. |
| 20 | `persephone.toolbar.*`, `statusBar.*`, `setStatusText()` | `src/renderer/editors/board/BoardWebview.ts:229-267`; controls are `mainTrusted` (`:122-142`) | Alters only the board’s host-rendered toolbar/status UI or receives its UI actions. | Harmless | Secondary frames cannot set the main-frame-only toolbar/status catalogs. |
| 21 | `persephone.notify()` and `persephone.aiVision` logs/registration | `src/main/board-bridge.ts:335-353`; `src/renderer/editors/board/BoardWebview.ts:269-277, 797-848` | Emits app toast/log entries or publishes board-provided read-only AiVision descriptions and notifications. | Harmless for notification/description only | `aiVision.expose` describes board-local UI; see separate callable `persephone.call` and capability invocation rows. The reverse `ai:request` direction (declared in `src/ipc/board-bridge-channels.ts:611-621`) carries a host/app request to the board and is not a board capability. |
| 22 | `persephone.capabilities.list()/invoke()` and `intent` | `src/renderer/editors/board/BoardWebview.ts:279-282, 1033-1104` | Invokes renderer-local capability handlers; handlers can open or edit app pages and execute board-contributed behavior. | `appScripting` | Current implementation rechecks trust, then invokes without permission check. |
| 23 | `persephone.vars.get/set/list/show` | `src/renderer/editors/board/BoardWebview.ts:316-326, 1268-1285`; `src/renderer/api/board-vars/board-vars-bridge.ts:25-29, 31-75` | Reads/writes the board’s own namespace; `show()` opens that namespace’s environment-variable page for the user. | Harmless | Namespace is derived from `this.props.boardRoot`, not board input; the board receives only its own configured values and the UI page is an explicit user-facing action. |
| 24 | `persephone.settings.get()/onChange()` | `src/renderer/editors/board/BoardWebview.ts:327-336, 1288-1308`; settings bridge `src/renderer/api/board-settings/board-settings-bridge.ts` | Reads declared board settings and subscribes to their changes. | Harmless | Board settings are manifest-declared and scoped by board root; no app-wide setting write method is exposed. |
| 25 | `persephone.setBusy()/getBusy()`, shared state, content callbacks, source events, theme/view | `src/renderer/editors/board/BoardWebview.ts:206-228, 277; src/board-shim.ts:1830-2078` | Board-local UI/lifecycle state, current hosted-document events, theme palette and view role. | Harmless | Reading/saving the hosted document is always allowed (rows 15-16); shared state is board-local. |
| 26 | Direct DOM, same-origin nested iframes, web APIs/local storage | `src/main/board-protocol-service.ts:71-88`; `src/main/open-window.ts:49-63`; iframe creation `src/renderer/editors/board/BoardWebview.ts:479-496` | Board JavaScript has no Node integration in subframes; CSP permits same-origin nested frames and `connect-src 'self'`; storage remains same-origin. `nodeIntegrationInSubFrames:false` and separate `board://` origin isolate the board frame. | Device flags for camera/mic/location/notifications; direct remote network blocked by CSP | No iframe sandbox attribute is set. Protocol and host bridge are the trust boundaries. |
| 27 | `board://<host>/<path>` protocol | `src/main/board-protocol-service.ts:256-325` | Serves board-root files via `path.resolve(root, rel)` and `net.fetch(file://...)`; `decodeURIComponent(pathname)` happens after URL parsing, so encoded traversal such as `%2e%2e%2f` survives normalization. It also serves pipe/resource streams (`:258-279`). | Harmless base access for the board’s own root; traversal confinement in US-1596 | Object-form manifests are always confined to their board root regardless of `fileSystem`; `fileSystem` governs bridge APIs, not `board://`. Legacy boards keep current traversal behavior until migration. |
| 28 | Board pipe/registered content providers and stream host | Host renderer `src/renderer/editors/board/board-pipe-handler.ts:202-268`; main protocol `src/main/board-protocol-service.ts:207-254`; HTTP fetch `src/renderer/content/providers/HttpProvider.ts:346-364`; session-source handler `src/main/session-src-protocol.ts:80-115` | Board frames consume the hosted document’s pipe, or registered provider streams, with byte-range reads. HttpProvider uses `nodeFetch` unless it has a main-issued `session-src` handle, which fetches through its bound Electron session. | Harmless for the hosted document; `service` for service-registered providers; `network` for remote providers; `fileSystem` for other local files | Bind the board identity and network grant through provider resolution and session-src issuance/handling; apply the same policy and MCP exception to both direct nodeFetch and session-backed remote content. |
| 29 | Browser device permissions | `src/main/permission-policy-service.ts:29, 175-240`; iframe `allow` `src/renderer/editors/board/BoardWebview.ts:483` | Chromium camera, microphone, geolocation, notifications and other requestable origin permissions; current policy only allows APP_ALLOW or blocks/prompts according to permission kind and does not inspect board manifest. | Corresponding device flag (`camera`, `microphone`, `geolocation`, `notifications`) | Device enforcement implementation belongs to US-1597; include all nested frames/origin checks there. |
| 30 | External navigation / links in nested board frames and `window.open()` | `src/main/open-window.ts:140-143, 199-224`; `src/board-shim.ts:1449-1471` | Popups are routed in-app; board-origin links leaving `board://` are routed through `openRawLink`; direct frame navigation is blocked. | Internal routes remain allowed; only final OS launch uses `openExternal` | For `setWindowOpenHandler`, attribute `details.referrer.url` when it is `board://<host>/…`. Empty/non-board referrer is unattributed: route in-app as today, but refuse final external launch unless the user confirms. A board can suppress, but cannot forge another board’s origin. |
| 31 | Drag and drop | No board-specific privileged handler found; board iframe uses ordinary DOM event handling, while board-list drag handlers are host UI (`src/renderer/editors/board/BoardsTreeView.ts:68-127`). | Board-page DOM drag/drop is local browser behavior; no board bridge message transports host file paths. | Harmless on verified paths | Recheck any new Electron `will-navigate`/drop handler if added; do not treat native shell drops as harmless without tracing. |
| 32 | Board frame mount/trust, handshake, icon cache, log append and repaint | `src/renderer/editors/board/BoardEditorView.ts:180-208`; `src/renderer/editors/board/BoardWebview.ts:515-697, 1314-1316` | Registers the frame/port for an already permitted board, records diagnostics, fetches filename icons, and paints host theme. | Harmless | Trust is the existing entry gate; it is not a substitute for per-capability checks. |
| 33 | `board:cycleTheme` | `src/renderer/editors/board/BoardWebview.ts:268`; `src/renderer/api/cycle-app-theme.ts:10-30` | Cycles the application-wide theme from a board-frame message. | Harmless | Cosmetic setting only. |
| 34 | Built-in board context menu | `src/board-context-menu.ts:11-21, 120-145, 207-257` | Offers Open Link/Open Image (new page), Copy/Paste, Save Image As (native save dialog then `writeFile`), and clipboard image writes. | Per action: `openExternal` only for OS launch, `fileSystem` for selected save path, `clipboardRead` for Paste, writes harmless | Uses the same fire/RPC bridge methods; central gates cover it. Internal page opens stay allowed. |

**Inventory count: 34 capability families.** Network and clipboard reads now have explicit flags.
The hosted document and the board’s own `board://` root remain available without `fileSystem`; that
flag governs other file paths. Device and clipboard browser permission policy is assigned to US-1597;
other file paths and object-manifest protocol confinement are assigned to US-1596.

### Transitive grants

- `execute` and `service` each run board-controlled Node/process code with the user’s OS privileges.
  Either can read/write arbitrary files, access the network, launch programs, and alter application
  state: treat each as **dangerous; implies full access**. This must be explicit in US-1598 trust
  wording, even when the board has no `fileSystem` grant.
- `appScripting` reaches the renderer AiVision root through `persephone.call()` and can call
  `script.execute`, whose own descriptor says it runs arbitrary renderer code with the user’s
  privileges and can read/write files, spawn processes, access the network, and affect the app
  (`src/renderer/scripting/ai-vision/root.ts:93-109`). It also reaches app `fs`, `shell`, `proc`,
  `pages`, `settings`, `tools`, and boards (`:60-83`). Treat it as **dangerous; implies full access**.
  Renderer `main.*` routing is not exposed through this board-rooted call path.
- `openExternal` can launch an external browser/application or open a file in its OS handler. It is
  an explicit external side effect, though unlike `execute` alone it does not grant arbitrary code.
- These flags do not relax fileSystem/device flag enforcement for direct APIs. The UI should state
  their full-access implication; US-1598 owns wording/display.

### Manifest normalization and consumers

Current verified contract: `normalizePermissions(raw): string[]` calls `normalizeStringList`, which
returns `[]` for non-arrays (`src/shared/board-manifest-utils.ts:5-27`).
`parseBoardManifest()` currently only stores permissions when the field is an array
(`src/renderer/editors/board/board-manifest.ts:815-835`); normalized/raw interfaces currently type
it as `string[]` (`:75-114, 270-282`).

Target shape (type names are proposed for implementation):

```ts
export interface BoardPermissionFlags {
  execute: boolean;
  service: boolean;
  fileSystem: false | "board" | "full";
  openExternal: boolean;
  appScripting: boolean;
  network: false | "internet" | "full";
  clipboardRead: boolean;
  camera: boolean;
  microphone: boolean;
  geolocation: boolean;
  notifications: boolean;
}
export type NormalizedBoardPermissions =
  | { kind: "flags"; flags: BoardPermissionFlags }
  | { kind: "legacy"; service: boolean };
```

Missing `permissions` and an old string array normalize to `{ kind: "legacy", service }`. Every
permission except `service` has its historical unrestricted grant; `service` is true only when the
legacy array includes `"service"` (and false when permissions are missing). New object input
normalizes every absent/invalid flag to off (`false`, with `fileSystem: false` and `network: false`).
Enforcement consumes the explicit discriminant, not an all-false heuristic. `fileSystem` accepts
only `false | "board" | "full"`; `network` accepts only `false | "internet" | "full"`.

`network: "internet"` denies loopback/private/link-local DNS results: `localhost`, `127.0.0.0/8`,
`::1`, `0.0.0.0`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `fc00::/7`, and `fe80::/10`.
Resolve DNS after each URL/redirect and deny the request if any returned address is in a blocked
range; pin a validated address for the request so a second lookup cannot select a local destination.
`"full"`
also allows local/LAN destinations. Always refuse Persephone’s own MCP endpoint (loopback and
configured port) unless `appScripting` is granted; `nodeFetch` has no browser `Origin` header, so
reaching MCP would otherwise provide full app control. US-1598 wording for `network: "full"` is:
“can reach services on this computer and your local network”.

Every currently found consumer to migrate:

| Consumer | Current use | Planned change |
|---|---|---|
| `src/renderer/editors/board/board-manifest.ts:75-114, 270-282, 815-835` | Manifest and normalized types; parse only string array | Define raw object schema and normalized discriminated type; normalize absent/array/object, including validation. |
| `src/renderer/editors/board/board-manifest.ts:876-885` | `boardTrustDisclosure()` projects a string list | Return normalized permission summary/legacy marker with the exact service bit for trust/info consumers (US-1598 presentation). |
| `src/renderer/editors/board/request-board-trust.ts:4-18`, `src/renderer/ui/dialogs/TrustBoardDialog.ts:11-12` | Forms trust-dialog `permissions: readonly string[]` state | Carry the normalized permission summary into the US-1598 view; keep disclosure generation in the manifest helper. |
| `src/renderer/editors/board/board-service-permission.ts:7-14` | Checks `.includes("service")` | Use `flags.service` for object manifests and the legacy marker’s exact `service` boolean. |
| `src/main/board-trust-service.ts:189-235` | Builds service snapshot from live manifest plus trusted path list | Persist granted permissions at trust time, then extend this main-owned snapshot with grants and manifest-change status. Bundled sources use their shipped manifest as their grant set. |
| `src/main/module-service-supervisor.ts:70-94, 278-305` | Snapshot has `canStartService`; request/start validates service state | Keep central supervisor check as defense in depth; exact `permission-denied` bridge rejection must originate for board calls. |
| `src/renderer/editors/board/custom-editor-registry.ts:496-497` | Reads minBridgeVersion only (no permissions) | Keep compatibility gate; ensure new object manifests’ minBridgeVersion compares against bumped `BOARD_BRIDGE_VERSION`. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts:392-394` | Reports app/bridge compatibility | Verify the compatibility reason displays the old-build rejection when object manifests require the bumped bridge. |
| `src/renderer/scripting/api-wrapper/board-manifest-projection.ts:21` | Copies permissions with array spread | Project object/legacy state without assuming iterable array. |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:145` | Copies permission array to AI facade | Update projected type/summary; display-only consumer. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts:407` | Supplies `manifest.permissions` to view | Supply normalized summary. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts:401-403` | Emits one chip per string | Present flags/legacy state (UI copy belongs US-1598; model type must change here). |
| `src/renderer/ui/dialogs/TrustBoardDialogView.ts:30-57`; `src/renderer/scripting/ai-vision/dialogs/trust-board.ts:42` | Trust dialog prints string list | Update input contract; readable effective grants, legacy Unrestricted label, and dangerous implications are US-1598. |
| `src/main/board-trust-service.ts:204` and `src/renderer/editors/board/board-service-permission.ts:13` | Only direct `normalizePermissions()` call sites | Migrate both; shared normalizer also changes the manifest parser call. |

`normalizePermissions` search found no other call sites under `src`. The permission string projection
also reaches `src/renderer/editors/board-info/BoardInfoEditorModel.ts:66, 407`,
`src/renderer/scripting/ai-vision/dialogs/trust-board.ts:9, 41-42`, and the view/facade entries in
the table. `normalizeStringList` has many unrelated manifest-array consumers and must keep its
current array-only behavior.

### Enforcement identity and process ownership

- **Main process:** the per-board MessagePort closes over `BoardPortEntry { root, host, ownerId,
  hostWebContents }` (`src/main/board-bridge.ts:79-98, 501-516`). RPC and `call` envelopes are routed
  through this immutable entry (`:388-430`). Enforcement looks up the grant set in the main-owned
  trust snapshot by canonical root; it never reads a live manifest to authorize a request and never
  accepts a board-supplied root or permission set. `execute` runner envelopes likewise reach main
  handlers with this entry (`:359-405`); gate start and job-control messages against that grant.
  Service executes in `utilityProcess.fork` under the supervisor (`src/main/module-service-supervisor.ts:379-383`).
- **Trust-time grant record:** replace the `trustedBoards.txt` path-only format with a main-owned
  record containing root + granted normalized permissions. On migration, each old trusted path gets
  the normalized permissions in its current manifest recorded as granted (the prior trust decision
  already allowed full access). Extend `BoardTrustService.createSnapshots()` to publish those grants.
  If the live manifest differs, gated calls continue using the stored grant set, never the union;
  US-1598 shows the change and requests re-trust before replacing the grant. This prevents a board
  from editing its own manifest with `writeFile` and granting itself `execute`.
- **Renderer host:** `BoardWebview` and `board-call-command` use the same main-owned snapshot, via an
  authoritative IPC query/cached projection in `src/renderer/api/board-trust.ts`, not parse the live
  manifest for enforcement. `BoardWebview` still matches each message to the exact iframe object,
  origin, model, host, and generation (`src/renderer/editors/board/BoardWebview.ts:743-761`); use the
  model root only as lookup identity, never as a new manifest grant.
- **`persephone.call`:** main relays with the board port’s `ownerId`; renderer finds the page, verifies
  that owner is an attached `BoardEditorModel`, derives its `boardRoot` from editor state, and
  builds a `ScriptContext` for that hosting page (`src/renderer/api/mcp/board-call-command.ts:41-59`).
  Add the `appScripting` check after resolving the owner/model root and before `resolveAiCall`.
- **Secondary views:** each view is its own iframe and BoardWebview, but shares the same model/root;
  `BoardEditorModel.frames` keys main and `board-secondary:<viewId>` frames. Resolve the owning
  `boardRoot` from model props on each request; all views inherit the same permission set. Keep
  current exact-frame message checks. Main-only UI messages remain gated by existing `mainTrusted`.
- **Nested iframes:** `board://` CSP allows same-origin frames (`src/main/board-protocol-service.ts:82-85`),
  but the host handler accepts only the top frame’s `contentWindow` as `event.source`. A nested
  same-origin frame can access its parent’s JS context and call the shared shim; it must inherit its
  board’s permissions. Cross-origin nested frames cannot use `persephone` directly and cannot pass
  the host’s event-source test. Chromium device permissions still need their own requesting-frame
  origin check in US-1597.
- **Node/renderer boundary:** the API’s privileged calls actually execute in main (`board-bridge`),
  renderer host (`BoardWebview` and board call), or utility process (`module-service-supervisor`);
  board JavaScript only posts requests. Never enforce solely in `src/board-shim.ts`.

Denied requests reject via the relevant Promise reply with exactly
`permission-denied: "<flag>" is not enabled in board-manifest.json`. Fire-and-forget routes such as
`openRawLink`, popups, and navigation are dropped and logged to the board’s board-log because their
event paths have no Promise to reject. Legacy `{ kind: "legacy" }` grants all permissions except
the separately recorded historical `service` bit.

### Bundled boards

Verified examples: `assets/demo-board/board-manifest.json:1-10` still uses the old
`["service", "contentProviders", "capabilities"]` array and currently requires bridge `1.28.0`;
it stays legacy/unrestricted through US-1600, with service allowed because its array includes
`"service"`. `assets/board-template/board-manifest.json` has no permissions field; it stays legacy/
unrestricted through US-1599, with service denied because the field is missing. `boards-assets/manifest.json` is a recommended component
catalog, not a board manifest, and defines no bridge permissions. Do not migrate bundled manifests
in US-1593. The epic defers the external `persephone-boards` catalog to US-1600 and registered
custom boards to US-1601.

## Implementation Plan

- [x] In `src/shared/board-manifest-utils.ts`, define all object flags and normalization. The shape
  includes `network: false | "internet" | "full"` and `clipboardRead: boolean`; object fields default
  off. Missing and old-array permissions normalize to `{ kind: "legacy", service }`, where only an
  old array containing `"service"` sets `service: true`.
- [x] In `src/renderer/editors/board/board-manifest.ts`, update raw/normalized types,
  `parseBoardManifest()`, and `boardTrustDisclosure()`. Migrate the current permission consumers
  listed above, keeping presentation work in US-1598 and device/clipboard browser policy work in
  US-1597.
- [x] Replace the path-only `trustedBoards.txt` store in `src/main/board-trust-service.ts` with an
  atomic main-owned `trustedBoards.json` record containing each trusted root and the normalized granted set captured
  when the user approves trust. Migrate old path-list entries by reading each entry’s current
  manifest once and storing those permissions as granted. When a live manifest later differs, expose
  a changed-since-grant state, but authorize only from the stored grants (never union with live
  values) until US-1598 re-trust replaces them. `readBundledSources()` uses each shipped bundled
  manifest directly as its grant set.
- [x] Extend `src/main/board-trust-service.ts:createSnapshots()` and the snapshot contract in
  `src/ipc/module-service-channels.ts` with the authoritative per-root granted set. Add a main IPC
  query/change projection through `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, and
  `src/ipc/renderer/api.ts`; cache it in `src/renderer/api/board-trust.ts`. Update
  `src/main/mcp/ai-vision/board-guide-mounts.ts` to read the new store format (or a compatibility
  projection), so trusted board guides keep working.
- [x] Gate main-process `execute` / `executeNode`, job stdin/end/kill, and service request/status/stop
  using the snapshot keyed by immutable `BoardPortEntry.root` in `src/main/board-bridge.ts` and
  `src/main/module-service-supervisor.ts`. Keep `service` eligibility in the supervisor as defense in
  depth. Preserve the exact denial text through RPC replies and runner errors.
- [x] Gate AiVision `persephone.call()` in `src/renderer/api/mcp/board-call-command.ts` using the same
  main-owned grant projection after resolving the board editor from `ownerId`. Keep
  `persephone.capabilities.invoke()` under `appScripting` in `src/renderer/editors/board/BoardWebview.ts`.
  `BoardWebview` must use its frame/model root only to look up the snapshot, never to parse a live
  manifest or accept board-provided identity. Secondary views share the model/root’s grant; same-origin
  nested frames inherit the parent board’s bridge. Preserve exact-frame checks.
- [ ] Implement `network` in `src/renderer/editors/board/board-fetch.ts` and the per-hop request seam
  in `src/renderer/api/node-fetch.ts` (and `src/renderer/api/proxy-tunnel.ts` as needed). Also gate
  board-originated `content.open()` before provider resolution and carry board identity/grants into
  `src/renderer/content/providers/HttpProvider.ts:346-364` and main-issued `session-src` handles in
  `src/main/session-src-protocol.ts:80-115`; both direct and session-backed remote content must share
  the policy. Resolve and
  check DNS results against the listed local/private ranges before connecting, pin the checked address,
  repeat for every redirect, and apply the rule to proxy/Tor routes. `"internet"` rejects local/LAN
  targets; `"full"` allows them. Always refuse the configured Persephone MCP host/port unless the same
  board has `appScripting`; use the MCP server endpoint from `src/main/mcp-http-server.ts` or its
  main-owned permission projection. Document DNS rebinding and proxy-side resolution as residual risks.
- [ ] Keep the hosted document separate from `fileSystem`: reading, saving, streaming, and disclosing
  the document the user opened in this board is always allowed, including `getFilePath()` and
  `getFolderPath()`. In US-1596, gate every other file path (`readFile`/`writeFile`, dialogs, unrelated
  folder paths, and other file-backed `content.open`) by `fileSystem` and selected-path grants.
- [ ] In US-1596, confine `board://` serving for every object-form manifest to its own root, regardless
  of `fileSystem`; the board’s own assets are its base capability. Preserve current traversal behavior
  only for legacy manifests until US-1600/US-1601 migration. Continue to classify unrelated file-backed
  content pipes through `fileSystem`.
- [ ] Gate `clipboard-read` for board origins in US-1597 by `clipboardRead`, including the
  `iframe.allow` permission list in `src/renderer/editors/board/BoardWebview.ts` and app-session
  `APP_ALLOW` handling in `src/main/permission-policy-service.ts`. Keep clipboard writes and
  `clipboard-sanitized-write` allowed; document the pastejacking trade-off.
- [ ] In `src/renderer/content/builtin-schemes.ts`, gate only the final `shell.openExternal()` call
  (`:110-132`) and file OS-handler launch (`src/renderer/content/open-with-default-app.ts:13-24` /
  `src/ipc/main/core-handlers.ts:130-135`). Carry a trusted board-source marker from
  `src/main/board-bridge.ts`’s `openRawLink` event and `src/main/open-window.ts` popup/navigation routes
  through `src/ipc/api-types.ts`, `src/ipc/renderer/renderer-events.ts`,
  `src/renderer/api/types/io.link-data.d.ts`, `RendererEventsService`, link data, and the final launcher.
  Extend the `api.openPath` request contract so the trusted renderer can pass provenance to main; the
  board cannot call that IPC endpoint itself. In-app browser tabs and new
  Persephone pages always remain allowed. For denied fire-and-forget routes, drop the launch and append
  a board-log entry.
- [x] `src/main/open-window.ts:setWindowOpenHandler` only has subframe popup call sites in the app;
  `rg 'window.open\\(' src/renderer` finds no application-renderer call site. Attribute a
  `details.referrer.url` beginning `board://<host>/` through the main board host registry. If referrer
  is empty/non-board, route in-app as today and mark the source unattributed; refuse final external
  launch unless the user confirms. Do not treat a missing referrer as a board grant.
- [x] Bump `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` (starting at `1.28.0`) as an
  explicit step. New object-form manifests set `minBridgeVersion` to the bumped value; old builds
  continue to show their existing newer-bridge incompatibility instead of interpreting an object as
  an empty permission list.
- [x] Keep bundled `assets/demo-board/board-manifest.json` on its legacy array and
  `assets/board-template/board-manifest.json` without a permissions object until US-1600/US-1599;
  do not alter `boards-assets/manifest.json` (catalog of recommended components, not a board).

### Before → after contract

Current: permissions are a disclosure string list, except `service` is allowed only when that exact
string is present. Planned contract:

```ts
// Before
permissions: string[]

// After, raw manifest
permissions: BoardPermissionFlags

// Normalized at trust time; legacy service preserves today's exact behavior
type NormalizedBoardPermissions =
  | { kind: "flags"; flags: BoardPermissionFlags }
  | { kind: "legacy"; service: boolean };
```

Enforcement example (main-owned identity and exact denial text):

```ts
// Before: the RPC dispatch runs the privileged handler directly.
return handler(entry, args);

// After: use the GRANTED snapshot for entry.root; never read the live manifest here.
if (!boardTrustSnapshot.allows(entry.root, "execute")) {
  throw new Error('permission-denied: "execute" is not enabled in board-manifest.json');
}
return handler(entry, args);
```

## Concerns

- `execute`, `service`, and `appScripting` each imply full access through OS processes or renderer
  script execution; US-1598 must use the documented “dangerous, implies full access” wording.
- `network: "internet"` DNS checks can race with rebinding or a proxy’s own DNS resolution. Resolve
  and pin every hop locally, and record proxy/Tor routing as residual risk to review during implementation.
- Direct `nodeFetch` board requests resolve and pin each redirect hop. Proxy/Tor destinations are
  checked against local DNS, but the proxy may resolve the destination independently. Session-backed
  `session-src` requests still need a main-owned board identity/grant binding before the same DNS
  policy can be enforced there; that portion of network enforcement remains incomplete.
- Trust records are changing from paths to root + grant. Keep `src/main/mcp/ai-vision/board-guide-mounts.ts`
  and renderer trust projections compatible with the format migration; legacy file grants must never
  be re-derived on each request.
- Legacy trusted boards remain unrestricted (except the existing `service` declaration rule) until
  the US-1600 catalog and US-1601 custom-board migrations are complete.
- Object-manifest `board://` traversal is confined in US-1596; legacy traversal remains until migration.
- Unit tests and test harnesses are intentionally omitted per the project workflow.

## Acceptance Criteria

- [ ] Complete verified inventory of every board-reachable capability, with API, trusted-side
  handler file/line, reach, and flag or explicit harmless rationale.
- [ ] Explicitly document transitive grants and the wording implication for US-1598.
- [ ] Specify normalized manifest type, legacy handling, and every current consumer migration.
- [ ] Specify trusted-side enforcement locations, per-request board/frame identity resolution,
  trust-time granted snapshot, exact rejection text, secondary frames, nested iframe treatment, and
  process ownership.
- [ ] Specify `network` ranges/MCP exception, `clipboardRead` ownership, external-launch-only
  `openExternal`, and the hosted-document/fileSystem boundary.
- [ ] Include the required bridge version bump and old-build `minBridgeVersion` behavior.
- [ ] Verify bundled board compatibility and list exact files planned to change and not change.

## Files Changed

| File | Change |
|---|---|
| `src/shared/board-manifest-utils.ts`, `src/renderer/editors/board/board-manifest.ts` | Normalize object flags and legacy permissions; migrate manifest projections. |
| `src/main/board-trust-service.ts`, `src/main/board-bridge.ts`, `src/ipc/*` | Persist trust-time grants, publish the authoritative snapshot, and gate main bridge operations. |
| `src/renderer/api/board-trust.ts`, `src/renderer/editors/board/*`, `src/renderer/api/mcp/board-call-command.ts` | Cache grants through IPC and enforce renderer board capabilities. |
| `src/renderer/api/node-fetch.ts`, `src/renderer/content/*`, `src/main/open-window.ts` | Enforce direct board network requests and carry board provenance to external URL launches. |
| `src/shared/board-bridge-version.ts`, `src/main/mcp/ai-vision/board-guide-mounts.ts`, bridge type files, `assets/guides/agents/boards.md`, `doc/architecture/key-files.md` | Bump/document bridge contract and update trust/type references. |
| `doc/tasks/US-1593-board-permission-model/README.md` | Record implementation progress and remaining scope. |

### Runtime files in the reviewed plan

| File | Planned implementation change |
|---|---|
| `src/shared/board-manifest-utils.ts`, `src/shared/board-bridge-version.ts` | Typed normalization and required bridge-version bump. |
| `src/renderer/editors/board/board-manifest.ts`, `board-service-permission.ts`, `BoardWebview.ts` | Manifest parser/projection and trusted renderer host enforcement. |
| `src/main/board-trust-service.ts`, `src/main/board-bridge.ts`, `src/main/module-service-supervisor.ts`, `src/ipc/module-service-channels.ts` | Persisted trust grants and main snapshot/process/service gates. |
| `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, `src/ipc/renderer/api.ts`, `src/renderer/api/board-trust.ts`, `src/main/mcp/ai-vision/board-guide-mounts.ts` | Main-owned grant snapshot IPC/cache and trust-store migration support. |
| `src/renderer/api/mcp/board-call-command.ts`, `src/renderer/api/internal/RendererEventsService.ts`, `src/ipc/renderer/renderer-events.ts`, `src/renderer/api/types/io.link-data.d.ts`, `src/main/open-window.ts`, `src/renderer/content/builtin-schemes.ts`, `src/renderer/content/open-with-default-app.ts`, `src/ipc/main/core-handlers.ts` | AiVision gating and source-marked final OS launch decisions. |
| `src/renderer/editors/board/board-fetch.ts`, `src/renderer/editors/board/board-open-content.ts`, `src/renderer/api/node-fetch.ts`, `src/renderer/api/proxy-tunnel.ts`, `src/renderer/content/providers/HttpProvider.ts`, `src/main/session-src-protocol.ts`, `src/main/mcp-http-server.ts` | Network range, DNS pinning, redirect/proxy, board content-provider provenance, session-src policy, and MCP endpoint checks. |
| `src/main/permission-policy-service.ts`, `src/renderer/editors/board/BoardWebview.ts` | US-1597 clipboardRead/device origin policy and iframe allow list. |
| `src/renderer/scripting/api-wrapper/board-manifest-projection.ts`, `BoardInfoEditorFacade.ts`, `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, `BoardInfoEditorView.ts`, `src/renderer/editors/board/request-board-trust.ts`, `src/renderer/ui/dialogs/TrustBoardDialog.ts`, `TrustBoardDialogView.ts`, `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` | Migrate typed permission disclosures; trust wording itself is US-1598. |

### Files requiring no changes in US-1593

`src/main/board-protocol-service.ts` and `src/renderer/editors/board/board-pipe-handler.ts` are
inventoried but their path/stream enforcement belongs to US-1596. Device and clipboard-read grants
in `src/main/permission-policy-service.ts` and iframe delegation belong to US-1597.
`src/renderer/editors/board-info/BoardInfoEditorView.ts`
and `src/renderer/ui/dialogs/TrustBoardDialogView.ts` permission presentation belongs to US-1598,
though their types must follow the normalized contract. `assets/demo-board/`, `boards-assets/`, and
`assets/board-template/` stay unmigrated in this task.
