# US-1443: Agent access to clipboard history

Epic: [EPIC-104: Clipboard tracker](../../epics/EPIC-104.md)

## Goal

Expose the stored clipboard history to Persephone's MCP agents through a discoverable,
setting-gated ai-vision namespace. An agent should be able to discover recent clipboard entries,
read an item's stored content, and use explicit destructive actions when the user asks for them,
without being given a filesystem path first.

This task is planning only. It must not implement the namespace, change the MCP manifest, or
modify the parallel clipboard tasks.

## Background

### Contracts from EPIC-104 and US-1439

[D13](../../epics/EPIC-104.md) makes the ai-vision namespace the authoritative discovery path.
The namespace is present exactly while `clipboard.enabled` is true and absent while it is false;
it must not be a permanently advertised node that merely reports "disabled". D13 also requires a
secondary line in `SERVER_INSTRUCTIONS`, while explicitly accepting that the static initialize-time
instructions can become stale.

[D6](../../epics/EPIC-104.md) is the privacy boundary: excluded clipboard changes produce no
payload, preview, or history entry. Therefore this namespace exposes only data that
US-1439 has already stored. Content excluded by the source application never entered the store and
cannot be read back here. This is the reason the additional agent read surface is acceptable,
although captured non-excluded content remains readable on disk under D10's deliberate
unencrypted-storage decision.

US-1439 defines the renderer-facing data contract in `src/ipc/clipboard-ipc.ts`:

```ts
export interface ClipboardHistoryItem {
    id: string;
    capturedAt: number;
    primary: ClipboardFlavor;
    preview: string;
    payloads: Partial<Record<ClipboardFlavor, string>>;
}

export interface ClipboardHistorySnapshot {
    revision: number;
    items: ClipboardHistoryItem[];
}
```

The parallel US-1439 changes currently add these typed renderer calls in
`src/ipc/renderer/api.ts`: `getClipboardHistory`, `removeClipboardItem`,
`clearClipboardHistory`, `getClipboardStatus`, `copyClipboardItem`, and the lifecycle methods.
The namespace consumes `getClipboardHistory`, `removeClipboardItem`, and
`clearClipboardHistory`; it does not need to change that IPC boundary. The snapshot is a query
plus revision signal, not a payload-body broadcast, so listing remains metadata-only.

The current worktree has no `doc/tasks/US-1441-clipboard-sidebar-panel/README.md` (nor any other
US-1441 task document). The epic lists US-1441 as planned, and US-1439 documents the panel-facing
history shape and calls. This task therefore treats the US-1439 document as the available parallel
contract and leaves the absent US-1441 document and future panel implementation untouched.

### Existing ai-vision shape and resolver behavior

`src/renderer/scripting/ai-vision/namespaces/recent.ts` is the closest completed namespace. It
keeps a static `IAiMember[]` allow-list with `files`, `load`, `add`, `remove`, and `clear`; its
mutating members carry `caution` strings; and `describeRecentFiles()` returns `kind`, `summary`,
`members`, `help`, and a `summarize()` count. `src/renderer/scripting/ai-vision/namespaces/index.ts`
registers descriptors for long-lived singleton API objects with `registerAiVisionFor(...)`.

Clipboard history has no renderer singleton or script-facing `IApp` member in the current source.
The new node should therefore be a root-owned `ClipboardHistoryNode` with its own `aiVision`
descriptor, rather than adding an `app.clipboard` API or registering a global object. This keeps
the setting gate and the node lifetime aligned: `AiRoot` is constructed for each MCP call in
`src/renderer/scripting/ai-vision/call.ts`, and `AppWrapper.call()` also constructs a fresh
`AiRoot` in `src/renderer/scripting/api-wrapper/AppWrapper.ts`.

The shared `ai-vision` descriptor contract in `node_modules/ai-vision/dist/core/types.d.ts` has
these relevant fields:

- `IAiMember` statically allow-lists a `property` or `method` and supports `signature`,
  `caution`, and `node` metadata.
- `IAiVisionDescriptor` supplies `kind`, `summary`, `members`, optional `help`, dynamic
  `children()`, optional `index()`/`provide()`, and `summarize()`.
- `children()` is live and must be cheap and side-effect-free; `summarize()` may be async.
- `restricted()` leaves a node discoverable but blocks its descendants. That is not the right
  behavior for D13 because the disabled node must be absent, not discoverable-but-blocked.

The resolver in `node_modules/ai-vision/dist/core/resolver.js` checks a descriptor's static
members or live child segments before reading a property. It always re-evaluates `children()` for
discovery, while MCP member hints are deduplicated by `kind` in the session's `seenKinds` set.
`shapeResult()` also applies the external package's private `MAX_ARRAY_ITEMS = 500` cap in
`node_modules/ai-vision/dist/core/result-shaper.js`, in `shapeValue()` and `arrayInfoFor()`, and
bounds structured results by `maxLength`. These facts require both a dynamic root child and an
explicit page method: changing only a static root member list could leave an agent without fresh
discovery after the root's `Persephone` kind had already been seen, and returning all 1000 entries
is needlessly large.

The existing filesystem route is safe for this purpose. `src/renderer/api/types/fs.d.ts` exposes
`app.fs.read(filePath, encoding?)` and `app.fs.readBinary(filePath)`, and
`src/renderer/api/fs.ts` implements them for an explicitly supplied file path. The new namespace
will select a path from the matching stored item returned by `getClipboardHistory()` and pass it
internally; the agent will call `clipboard.read(...)`, not `fs.read(...)` with a path it had to
discover. No live `electron.clipboard`, `navigator.clipboard`, `clipboardReadFilePaths`, or other
OS clipboard read is part of this design.

### MCP initialize instructions

`SERVER_INSTRUCTIONS` in `src/main/mcp/manifest.ts` is a `const` array joined at module load.
`src/main/mcp/server-factory.ts` passes that one string to each new `McpServer`, and
`src/main/mcp-http-server.ts` creates one server per client session before the initialize response.
The instructions are sent once per session.

The setting is renderer-owned: US-1439 explicitly requires the main process not to read
`appSettings.json` or import `src/renderer/api/settings.ts`; the renderer forwards the current
setting to the main clipboard service over IPC. Consequently, making the instruction string
conditional at module load would have no reliable setting value. Rebuilding it in
`createMcpServer()` would only describe the last main-process state at connection time and would
still be stale after the one-time initialize response, especially across renderer windows.

The least invasive and honest solution is to retain the static instruction contract and add
conditional wording: when `clipboard.enabled` is true, the agent should discover `clipboard`
through `call`; when it is false, the node is absent. This line advertises a discovery rule, not a
currently-on capability. The live namespace remains the contract; no change to
`server-factory.ts` or `mcp-http-server.ts` is needed.

## Implementation Plan

### 1. Add the renderer clipboard ai-vision node

Create `src/renderer/scripting/ai-vision/namespaces/clipboard.ts` with a
`ClipboardHistoryNode implements IAiVisible`. It should import the already-typed `api` from
`src/ipc/renderer/api.ts`, `ClipboardFlavor`/`ClipboardHistoryItem`/`ClipboardHistorySnapshot`
from `src/ipc/clipboard-ipc.ts`, and use an `AppWrapper` (or its filesystem-compatible type) for
the existing `app.fs` read route. Do not add an `IApp` or `AppWrapper` clipboard property: this is
an MCP ai-vision capability, not a new script API surface.

Describe the node with `IAiMember` entries kept next to the implementation, following
`recent.ts`'s static descriptor style:

```ts
const CLIPBOARD_MEMBERS: readonly IAiMember[] = [
    { name: "items", kind: "property", summary: "Newest-first preview metadata for the first page of stored clipboard history." },
    { name: "list", kind: "method", signature: "list(offset = 0, limit = 100)", summary: "Read one page of newest-first clipboard previews, with total count and revision." },
    { name: "read", kind: "method", signature: "read(id: string, flavor?: ClipboardFlavor)", summary: "Read the stored primary content, or one stored flavour, for a history item." },
    { name: "remove", kind: "method", signature: "remove(id: string)", summary: "Remove one stored clipboard item.", caution: "deletes the stored clipboard item and its payload files" },
    { name: "clear", kind: "method", signature: "clear()", summary: "Remove all stored clipboard history.", caution: "deletes all stored clipboard history and payload files" },
];
```

The `items` property is a convenient first page of at most 100 `ClipboardHistoryItem` values. The
`list(offset = 0, limit = 100)` method is the complete listing route for larger histories: validate
non-negative integer offsets and a positive integer limit no greater than 100 with
`validateCallArguments()`/the existing `numberRule()` conventions, query
`api.getClipboardHistory()`, and return a small page envelope:

```ts
{
    revision: number;
    offset: number;
    limit: number;
    total: number;
    items: ClipboardHistoryItem[];
}
```

This is explicit paging over the service's newest-first list. It preserves the US-1439 configured
history cap of 1–1000, avoids depending on the resolver's 500-item shaping ceiling, and gives the
agent `total` and `revision` so it can request older pages or recognize a changed history. Listing
returns only `ClipboardHistoryItem` metadata and payload paths already supplied by US-1439; it
never reads a payload body just to list previews.

Implement `summarize()` as an async snapshot query returning only bounded metadata, for example
`{ kind: "ClipboardHistory", count, revision, newestId }`, where `count` is the full current
snapshot count and `newestId` is `null` for an empty history. Do not include preview bodies in the
summary. `help` must explain newest-first paging, `read()`'s flavour behavior, the D6 exclusion
boundary, plain readable on-disk retention under D10, and that this node never reads the live OS
clipboard.

### 2. Read stored content without requiring a path

Implement `read(id, flavor?)` as a validated method that queries the current snapshot, finds the
exact item id, chooses `flavor ?? item.primary`, and rejects a missing item or unavailable flavour.
It must use only the matching path in that item's `payloads` map; it must not accept an arbitrary
filesystem path or call an OS clipboard API.

Use the existing `AppWrapper.fs` route with the stored format semantics:

- `text` and `html`: call `app.fs.read(payloadPath, "utf8")` and return the actual stored string.
- `files`: call `app.fs.read(payloadPath, "utf8")`, parse and validate the stored JSON shape, and
  return its `{ paths, dropEffect }` path-list content. Do not turn it into a text clipboard or
  infer a live file list.
- `image`: call `app.fs.readBinary(payloadPath)`, convert the stored PNG bytes to a base64-encoded
  string, and return the plain renderer record
  `{ type: "image", data: <base64-string>, mimeType: "image/png", id, flavor: "image" }`.
  `callImageResult()` in `src/main/mcp/tools/call-tools.ts:284-291` recognizes the `type`, string
  `data`, and string `mimeType` fields and converts that record into the MCP image content block
  represented by `McpContentBlock` in `src/main/mcp/types.ts:16-18`. The renderer node must not
  import either main-process MCP type; the returned-record shape is the cross-process contract.
  The agent therefore receives an image block plus the remaining metadata rather than an opaque
  Buffer.

The resolver still applies its normal `maxLength` shaping. `help` should tell agents to raise
`call.maxLength` for unusually long text or PNG base64 data when the bounded result reports
truncation. A missing payload or malformed stored file is an error for that read; it must not fall
back to the live clipboard or to an unrelated path.

`copyClipboardItem` is intentionally not exposed in this namespace. US-1439 keeps it for the
Clipboard panel, but copying changes the live OS clipboard, causes a D4-tracked clipboard event,
and is outside the user's read request. The agent can read the returned text/image/path-list
content and act only on an explicit subsequent user instruction through other app capabilities.

### 3. Add explicit remove and clear actions with caution

Expose `remove(id)` and `clear()` as thin calls to the US-1439 renderer IPC methods. Validate the
id as a string, propagate the service result/error, and do not duplicate deletion in the renderer.
The `caution` strings are mandatory because these actions delete plain on-disk history and are
displayed in ai-vision hints. `help` must say that agents should use them only after the user
explicitly asks to remove an item or clear history; the presence of a method is not permission to
perform it unprompted.

Do not expose `getClipboardStatus`, `setClipboardHealthMonitoring`, or `restartClipboard` here.
D12's health state is meaningful for the open panel's monitoring owner and is already represented
by US-1439's status IPC for US-1441. It is not needed to read the stored dataset and exposing a
panel-scoped `monitoring`/`healthy` state would couple agent data access to whether a UI panel is
open. Leave listener health entirely to the panel.

### 4. Gate the node at the renderer root per call

Update `src/renderer/scripting/ai-vision/root.ts`. Keep the existing unconditional root members in
`ROOT_MEMBERS`, add a separate `CLIPBOARD_ROOT_MEMBER`, construct one
`ClipboardHistoryNode` per `AiRoot`, and add a `clipboard` getter for the resolver to reach when
the node is advertised.

The current code has a static member list and a `children()` method that returns `.pages` and,
when available, `.page`:

```ts
get aiVision(): IAiVisionDescriptor {
    return {
        kind: "Persephone",
        members: ROOT_MEMBERS,
        children: () => this.children(),
        // ...
    };
}

private children(): IAiChild[] {
    const children: IAiChild[] = [
        { segment: ".pages", kind: "Pages", summary: "..." },
    ];
    // active .page is added here
    return children;
}
```

Change it to evaluate `!!this.app.settings.get("clipboard.enabled")` whenever the descriptor or
live children are assembled:

```ts
private readonly clipboardNode = new ClipboardHistoryNode(this.app);

get clipboard(): ClipboardHistoryNode {
    return this.clipboardNode;
}

get aiVision(): IAiVisionDescriptor {
    const members = this.clipboardEnabled()
        ? [...ROOT_MEMBERS, CLIPBOARD_ROOT_MEMBER]
        : ROOT_MEMBERS;
    return { /* existing descriptor fields */, members, children: () => this.children() };
}

private children(): IAiChild[] {
    const children: IAiChild[] = [/* existing .pages and optional .page */];
    if (this.clipboardEnabled()) {
        children.push({ segment: ".clipboard", kind: "ClipboardHistory", summary: "stored clipboard history" });
    }
    return children;
}
```

The final patch must preserve the existing root summary, help, restricted gate, page behavior, and
all existing root members. The `clipboard` member must be absent from `members` and `.children`
when disabled. Including the live child is essential for the server-side per-call truth: `seenKinds`
suppresses repeated static member lists, but the resolver rechecks live children. Do not use
`restricted()` to represent the off state; an absent node produces the better agent behavior of
not attempting a disabled capability, at the cost that the agent must consult
`settings.get("clipboard.enabled")` or the conditional MCP guidance to learn why it is absent.
The client-side discovery view can still lag: an agent that saw the `Persephone` root while
clipboard was off may retain a root member list without `clipboard`, and an agent that saw it on
may retain that old member list after it is turned off. A no-path `call` resets the session's
`seenKinds` memory and returns a fresh overview; the capability check itself remains live and
rejects the path whenever the setting is off.

Do not add the node to `src/renderer/scripting/ai-vision/namespaces/index.ts`: that file registers
stable singleton objects, whereas this node must be constructed per root call to avoid a stale
setting gate. Do not add it to `src/renderer/api/app.ts`, `src/renderer/api/types/app.d.ts`, or
`src/renderer/scripting/api-wrapper/AppWrapper.ts`; those are the script API surface and are not
required by D13.

### 5. Add the secondary static MCP instruction

Update only `src/main/mcp/manifest.ts` by adding one conditional, non-claiming line to the existing
`SERVER_INSTRUCTIONS` array:

```ts
// Before
"For Agent Tools, find registered tools with `tools.search()` and run one with `tools.execute(id, args)`.",
].join("\n");

// After
"For Agent Tools, find registered tools with `tools.search()` and run one with `tools.execute(id, args)`.",
"Clipboard history is opt-in: when `clipboard.enabled` is true, discover stored history under `clipboard` with `call`; when it is false, that node is absent. This reads stored history only and never the live OS clipboard.",
].join("\n");
```

Do not attempt to make this line reflect a live per-window setting at module load or promise that
the line will disappear from an already initialized client. The line is secondary discovery help;
the per-call renderer root is the authoritative capability check.

### 6. Verify the implementation without tests or parallel-task edits

After implementation, run the normal TypeScript/lint validation appropriate to the changed
renderer files, but do not add unit tests, test harnesses, or fixtures. Manually inspect or exercise
the MCP call path for:

- root discovery with `clipboard.enabled` false, then true, then false again in one session;
- `clipboard.$help`, `clipboard.items`, `clipboard.list()` paging, `revision` changes, empty
  history, and a history at the 1000-item service cap;
- text, HTML, image, and file-list reads, including an explicit sibling flavour and missing or
  malformed payloads;
- D6-excluded content never appearing in the list and no live OS clipboard read occurring;
- `remove` and `clear` showing caution metadata and changing only the stored history; and
- initialize instructions remaining honest when the setting changes after a client connects.

Do not modify `doc/active-work.md`, `doc/epics/EPIC-104.md`, the US-1438/US-1439/US-1440 task
documents, the absent US-1441 task document, or any parallel implementation while verifying.

## Concerns / Open questions (resolved)

- **Read-only versus mutations — resolved recommendation:** expose `remove` and `clear` in
  addition to reads because D10 explicitly gives the user delete controls and US-1439 already
  provides the authoritative deletion IPC. Mark both with `caution`, explain that they are only for
  an explicit user request, and do not expose copy-back because copying mutates the live OS
  clipboard and is outside this task's read need. An agent should not invoke either delete method
  merely because it discovered it.
- **Large-history listing — resolved recommendation:** use a first-page `items` property and an
  explicit `list(offset, limit)` method capped at 100 entries per call. Return `total` and
  `revision` with each page. This honors the 1–1000 persisted item cap and keeps previews and
  paths bounded per response; the external resolver's private `MAX_ARRAY_ITEMS = 500` in
  `node_modules/ai-vision/dist/core/result-shaper.js` is an additional shaping safeguard, not the
  application's pagination contract.
- **Summary shape — resolved recommendation:** `summarize()` returns only
  `{ kind: "ClipboardHistory", count, revision, newestId }`; it never includes payload bodies or
  a list of previews. A caller descends to `items`/`list` when it needs entries.
- **Listener health — resolved recommendation:** leave health entirely to US-1441's panel. The
  service's `ClipboardStatus` is panel-scoped because `monitoring` depends on active renderer
  owners; it is not a stable property of the stored history and is not needed for reads.
- **Disabled calls — resolved recommendation:** omit the node entirely. A present-but-disabled
  node would invite agents to keep retrying an unavailable feature and would conflict with D9/D13's
  fully absent feature behavior. The trade-off is reduced direct discoverability while disabled;
  `settings.get("clipboard.enabled")` and the conditional static instruction explain the state.
  Discovery is also cached at the client level: MCP sends a given kind's member list once per
  session, so a client that connected while the setting was off will not see the newly enabled
  member in an old root hint. The accepted remedy is a no-path `call`, which resets `seenKinds` and
  refreshes the overview. This does not weaken the capability gate: each new call builds the root
  again and omits/rejects `clipboard` according to the current setting.
- **Static MCP instructions — resolved limitation:** they cannot be made reliably current for the
  renderer-owned setting. `SERVER_INSTRUCTIONS` is joined at module load and sent once per session;
  `createMcpServer()` has no authoritative per-window setting source, and later setting changes
  cannot revise an initialize response. Together with the `seenKinds` limitation above, this is
  the accepted discovery-cache behavior; the client can use a no-path `call` to refresh object-model
  hints, but not an already-sent initialize instruction. Add conditional wording only; never state
  that clipboard history is currently available.
- **Privacy surface — resolved boundary:** D6 remains authoritative. The namespace cannot recover
  excluded content because US-1439 never stores it. It reads only payload paths returned by the
  history snapshot and never reads the live OS clipboard. D10's readable files and the explicit
  delete actions remain visible risks accepted by EPIC-104.
- **Payload formats — resolved:** text and HTML are returned as stored UTF-8 strings, files as the
  validated stored path list, and images as the exact plain record
  `{ type: "image", data: <base64-string>, mimeType: "image/png", ...metadata }`. The main
  `callImageResult()` recognizer is at `src/main/mcp/tools/call-tools.ts:284-291`; the renderer
  imports no main MCP type. A missing or malformed stored payload is an error, not a fallback to
  current clipboard data.

## Acceptance Criteria

- [ ] `src/renderer/scripting/ai-vision/namespaces/clipboard.ts` describes a
      `ClipboardHistory` node with `IAiMember`, `help`, and async `summarize()` metadata.
- [ ] Each newly built root exposes `clipboard` only when `clipboard.enabled` is true; both the
      root member list and live root children omit it when false, including after an on/off toggle
      in the same MCP session. Because member lists are cached per kind, the client may need a
      no-path `call` to refresh its overview after a toggle.
- [ ] Listing returns only the US-1439 `ClipboardHistoryItem` metadata and payload paths, with a
      first-page `items` view and bounded `list(offset, limit)` paging that reports `total` and
      `revision`; no payload body is read during listing.
- [ ] `clipboard.read(id, flavor?)` reads only the selected stored payload: UTF-8 text/HTML,
      validated file-list JSON as `{ paths, dropEffect }`, or a plain renderer record
      `{ type: "image", data: <base64-string>, mimeType: "image/png", ...metadata }` for PNG
      bytes. `src/main/mcp/tools/call-tools.ts:284-291` converts that record to the MCP image
      block; the renderer imports no main MCP type. It never reads the live OS clipboard or accepts
      an arbitrary path.
- [ ] Missing items, unavailable flavours, missing payload files, and malformed file-list data
      produce explicit errors without fallback reads.
- [ ] `remove` and `clear` call the US-1439 authoritative IPC methods and carry non-empty
      `caution` metadata; agents are told in `$help` to use them only after explicit user intent.
- [ ] The namespace does not expose copy-back or listener-health operations; D12 health remains
      panel-owned.
- [ ] `SERVER_INSTRUCTIONS` gains a conditional clipboard-discovery line that remains honest when
      the setting is off and clearly says the namespace reads stored history only.
- [ ] D6-excluded content is not newly exposed: the implementation reads only content already
      present in US-1439's store, and no direct live-clipboard capability is added.
- [ ] No unit tests or test harnesses are added, and no US-1438/US-1439/US-1440/US-1441 files,
      `doc/epics/EPIC-104.md`, or `doc/active-work.md` are modified by this task.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/scripting/ai-vision/namespaces/clipboard.ts` | New root-owned clipboard history node with paged metadata listing, stored-content reads, cautioned remove/clear methods, help, and summary. |
| `src/renderer/scripting/ai-vision/root.ts` | Construct the node per `AiRoot` call and conditionally advertise both its root member and live child from `clipboard.enabled`. |
| `src/main/mcp/manifest.ts` | Add the static, conditional clipboard-history discovery instruction. |

Files that need **no changes** for US-1443: `src/renderer/scripting/ai-vision/namespaces/index.ts`
(the node is root-owned, not a registered singleton), `src/renderer/api/app.ts`,
`src/renderer/api/types/app.d.ts`, `src/renderer/scripting/api-wrapper/AppWrapper.ts`,
`src/ipc/clipboard-ipc.ts`, `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`,
`src/ipc/renderer/renderer-events.ts`, `src/ipc/main/core-handlers.ts`,
`src/main/clipboard-service.ts`, `src/main/sidecar-process.ts`, `src/main/main-setup.ts`,
`src/main/mcp/server-factory.ts`, `src/main/mcp-http-server.ts`, `src/main/clip-service.ts`,
`src/renderer/api/fs.ts`, `doc/active-work.md`, `doc/epics/EPIC-104.md`,
`doc/tasks/US-1438-clipboard-watch-subcommand/README.md`,
`doc/tasks/US-1439-clipboard-capture-service/README.md`,
`doc/tasks/US-1440-clipboard-settings/README.md`, and the absent US-1441 task document and
panel files. The listed IPC/service files are dependencies delivered by US-1439, not additional
US-1443 edits.
