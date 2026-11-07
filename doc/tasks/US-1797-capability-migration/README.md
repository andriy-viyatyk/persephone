# US-1797: Migrate bundled boards and documentation to unified capabilities

**Epic:** [EPIC-140](../../epics/EPIC-140.md)  
**Status:** Planned; implementation awaits review.

## Goal

Make the bundled capability providers self-describing to agents and update architecture and author guidance to describe the implemented unified capability system. Preserve existing board behavior and legacy clients.

## Background

The normative [capability contract](../../../assets/guides/agents/capabilities.md) defines manifests, migration and client APIs. [US-1794](../US-1794-capability-registry/README.md), [US-1795](../US-1795-capability-client-api/README.md), and [US-1796](../US-1796-capability-agent-surface/README.md) implemented the main registry/router, clients and agent surface. Legacy declarations synthesize `open(payload)` with a 10-second deadline; explicit methods must have a summary and exactly one payload argument. The descriptions are documentation, not runtime schemas.

Verified inventory and decisions:

- `assets/boards/excalidraw/board-manifest.json` provides `image.edit` and `diagram.edit`; `assets/boards/rest-client/board-manifest.json` provides `http.request.open`. `assets/demo-board/board-manifest.json` also provides `demo.greet`; migrate this shipped example as well. Searches of `assets/board-template/` and `boards-assets/` found no additional provider manifests; the template's `CLAUDE.md` contains legacy examples. Localized manifest title keys are unaffected.
- `assets/boards/excalidraw/index.html` `handleImageIntent` requires nonempty `dataUrl` and `title`, accepts nonempty `mimeType`, and requires positive `naturalWidth` and `naturalHeight` together when supplied. `handleDiagramIntent` requires nonempty Mermaid `source` and `title`, returns `opened`/`imageOnly` or `conversion-failed`/`message`, discarding the page on conversion failure. `editorReady` and conversion are asynchronous; retain the existing 10-second default, and check actual startup during manual validation rather than inventing a longer deadline.
- `assets/boards/rest-client/src/rest-client-model.js` `openRequestIntent` requires a nonempty `url`, accepts string `method`, `body`, `title`, and string-valued `headers`; it creates a request in a content-host page, not an HTTP transaction. `assets/demo-board/app.js` `handleGreeting` accepts an optional string `name`, defaults to `board friend`, and resolves a greeting. Its legacy handler also tolerates non-object payloads; the descriptor describes the useful object form without adding validation.
- Leave Excalidraw's `persephone.capabilities.invoke("content.view", …)` at `assets/boards/excalidraw/index.html` unchanged. Switching to `getCapability("content.view", { filter: { representation: "svg" } })` would also require `uses: [{ "id": "content.view", "version": 1 }]` and `minBridgeVersion: "1.51.0"`, and would change selection and authorization semantics. `src/main/board-trust-service.ts` builds enabled bundled snapshots with `uses: source.bundledId ? manifestUses : storedGrant?.uses ?? []`: bundled grants come from the manifest, not a user trust approval, so adding one does not trigger a user trust re-prompt. Keeping the existing path is the lower-risk choice nonetheless. New-client access is checked by `src/main/capability-router.ts`; the legacy invoke is trust-gated as documented in the contract.
- Rename `doc/architecture/capability-bus.md` to `doc/architecture/capabilities.md` with `git mv`, then rewrite it to describe all capability kinds. The bus no longer exists. Preserve the `well-known-capability-certificateview` and `well-known-capability-themeedit` anchors. Update the only three live links in `doc/architecture/browser-editor.md`, `doc/architecture/scripting.md`, and `doc/architecture/overview.md`; historical references under `doc/tasks/` and `doc/epics/` may stay stale. Add the new page to `doc/agents-common.md`'s Documentation Map as “Work with capabilities (board/platform/agent)” and add it to `doc/architecture/key-files.md`.

## Implementation Plan

All checklists are future work. After each code phase run `npm run typecheck`, `npm run lint`, and `npm run build-prod`; documentation-only phases need no such commands. Manual checks below use Persephone MCP `call`; use `script.execute` through `call` where an app script is specified. Use a running build containing the phase changes and enabled bundled boards. No unit tests or test harnesses.

### Phase 1 — provider declarations (3 files)

- [x] Add explicit `methods.open` to all four declarations below, retaining every existing id, version, priority, title, filters and `alwaysOpensNewPage`. Do not alter the page handlers, minimum bridge version, permissions or legacy consumer. Do not set `timeoutMs`: 10,000 ms matches the prior synthesized default. Descriptions must remain within the contract's 512-character field limits.
- [x] `assets/boards/excalidraw/board-manifest.json`, before → after (the shown array is complete):

```json
"capabilities": [
  { "id": "image.edit", "version": 1, "priority": 50, "title": "Edit image", "alwaysOpensNewPage": true },
  { "id": "diagram.edit", "version": 1, "priority": 50, "title": "Edit diagram", "alwaysOpensNewPage": true }
]
```

```json
"capabilities": [
  { "id": "image.edit", "version": 1, "priority": 50, "title": "Edit image", "alwaysOpensNewPage": true,
    "methods": { "open": { "kind": "open", "summary": "Open an image for editing in Excalidraw.",
      "args": [{ "name": "payload", "type": "{ dataUrl: string; title: string; mimeType?: string; naturalWidth?: number; naturalHeight?: number }", "description": "dataUrl and title must be nonempty; mimeType, if supplied, must be nonempty. Supply both dimensions together as positive numbers, or omit both." }] } } },
  { "id": "diagram.edit", "version": 1, "priority": 50, "title": "Edit diagram", "alwaysOpensNewPage": true,
    "methods": { "open": { "kind": "open", "summary": "Convert a Mermaid diagram and open it for editing in Excalidraw.",
      "args": [{ "name": "payload", "type": "{ source: string; title: string }", "description": "Nonempty Mermaid source and title." }],
      "returns": "{ status: 'opened', imageOnly: boolean } | { status: 'conversion-failed', message: string }" } } }
]
```

- [x] `assets/boards/rest-client/board-manifest.json`, before → after (complete declaration):

```json
{ "id": "http.request.open", "version": 1, "priority": 50, "title": "Open HTTP request", "alwaysOpensNewPage": true }
```

```json
{ "id": "http.request.open", "version": 1, "priority": 50, "title": "Open HTTP request", "alwaysOpensNewPage": true,
  "methods": { "open": { "kind": "open", "summary": "Create a REST Client page containing a request; does not send it.",
    "args": [{ "name": "payload", "type": "{ url: string; method?: string; headers?: Record<string, string>; body?: string; title?: string }", "description": "url must be nonempty; headers map names to string values." }] } } }
```

- [x] `assets/demo-board/board-manifest.json`, before → after (complete declaration):

```json
{ "id": "demo.greet", "version": 1, "priority": 60, "title": "Demo greeting" }
```

```json
{ "id": "demo.greet", "version": 1, "priority": 60, "title": "Demo greeting",
  "methods": { "open": { "kind": "open", "summary": "Open the demo board and return a greeting.",
    "args": [{ "name": "payload", "type": "{ name?: string }", "description": "A missing or blank name defaults to board friend." }],
    "returns": "{ greeting: string; requestId: string; received: { name: string } }" } } }
```

- [x] Run the three code-phase commands above.
- [ ] Manual MCP `call`: (1) inspect `capabilities["image.edit"].$help`, `capabilities["diagram.edit"].$help`, and `capabilities["http.request.open"].$help`; confirm the signatures, summaries and providers. (2) Call `capabilities["image.edit"].open` with `{ "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX8AAAAASUVORK5CYII=", "title": "Pixel", "naturalWidth": 1, "naturalHeight": 1 }`; confirm a fresh Excalidraw page contains the image. (3) Call `capabilities["diagram.edit"].open` with `{ "source": "flowchart LR\nA-->B", "title": "Diagram" }`; confirm the diagram and result. (4) Run `app.capabilities.invoke("http.request.open", { url: "https://example.com", method: "GET" })` via `script.execute`; confirm a fresh REST Client page with the request, without sending it. (5) Open Excalidraw's SVG export in a new tab and confirm the legacy `content.view` path still displays it. Create a Demo Board in a scratch folder with `boards.createDemoBoard(name, dir)` (which auto-trusts it), inspect `capabilities["demo.greet"].$help`, and call `capabilities["demo.greet"].open({ "name": "Ada" })`; confirm the greeting. Then call `boards.unregisterBoard(root)` and delete the scratch folder.

### Phase 2 — architecture (6 files; documentation only, including one `git mv`)

- [x] Run `git mv doc/architecture/capability-bus.md doc/architecture/capabilities.md`, then rewrite `doc/architecture/capabilities.md`. Before: “The capability bus is Persephone's renderer-local request surface”. After: “Capabilities use a main-process registry and router shared by board pages, board services, Persephone and agents.” Replace obsolete renderer-local index, platform-registration and no-service-routing claims throughout. Explain snapshot eligibility/trust and enabled bundled boards, resolution and bound-provider reauthorization; route `call`/`channel` to services, `open` through the renderer and board intent lifecycle; show the board-page, board-service, and renderer clients plus the agent `call` tree. Document legacy wrappers and distinguish their gates and result shapes, deadlines, cancellation, limits and streaming. Link the normative contract instead of copying it. Preserve useful `certificate.view` and `theme.edit` payload, caller and error details and their existing `well-known-capability-certificateview` and `well-known-capability-themeedit` anchors; verify them against `src/renderer/api/certificate-view.ts` and `src/renderer/api/theme-edit.ts` while rewriting. Retain relevant board intent FIFO, fresh-page, cancellation and caller-window details, with source links.
- [x] `doc/architecture/browser-editor.md`: before link target `capability-bus.md#well-known-capability-certificateview` → after `capabilities.md#well-known-capability-certificateview`.
- [x] Update `doc/architecture/key-files.md` stale capability rows and add the architecture page. Before: “Capability-bus registry and invoke paths (manifest registration/release, D4 ordering …)” → after: “Renderer capability clients, legacy projection and open dispatch”. Add rows for `doc/architecture/capabilities.md` (unified architecture), `src/main/capability-registry.ts` (main index), `src/main/capability-router.ts` (authorization, resolution and routing), `src/main/capability-channel.ts` (main channel adapter), `src/shared/capability-contract.ts` (declarations and normalization), `src/shared/capability-limits.ts` (limits), `src/shared/capability-client.ts` (proxy builder), `src/shared/platform-capabilities.ts` (platform metadata), and `src/renderer/scripting/ai-vision/namespaces/capabilities.ts` (agent nodes). Correct the bridge-version row to include 1.50.0 and 1.51.0. Keep accurate legacy transport rows.
- [x] `doc/agents-common.md` Documentation Map: add “Work with capabilities (board/platform/agent)” linking to `architecture/capabilities.md`.
- [x] `doc/architecture/overview.md`, before → after: “renderer-local request counterpart … A derived index combines” → “main registry and router unify board and platform providers; renderer open dispatch retains caller-window intent routing”. Update the link path and label to `capabilities.md` / “Capabilities”.
- [x] `doc/architecture/scripting.md`, before → after: “Platform handlers remain direct in-process calls. Board requests use the renderer-local capability bus” → “Main resolves unified providers; open methods dispatch through the renderer, while service calls and channels route through main.” Update the surrounding stale index/selection description and both link paths/labels, retaining the theme anchor and page lifecycle details.
- [ ] Manual MCP `call`: (1) inspect `capabilities.$help`; confirm agent discovery. (2) Inspect `capabilities["content.view"].$help` and its providers. (3) Run `app.capabilities.handlers("content.view", { representation: "svg" })` via `script.execute`; confirm matching legacy discovery. (4) Open the renamed architecture page and follow its certificate and theme anchors and normative-guide link; verify the diagram and routes against the live results.

### Phase 3 — guide pointers (9 files; documentation only)

- [x] `assets/guides/boards.md`: before “Scripts should use `app.capabilities.invoke()` for capability calls.” → after “For new declarations and clients, see [Capabilities](./agents/capabilities.md); `app.capabilities.invoke()` remains a legacy wrapper.” At the capability and service sections, label old manifest/list examples as legacy, correct the old board `capabilities.list()` description (now unified and grant-filtered), and point readers to the normative guide for `methods`, `getCapability` and `uses`. Preserve intent/stream lifecycle details.
- [x] `assets/guides/scripting/api/app.md`: before “Discover and invoke named handlers supplied by Persephone or trusted Boards.” → after “Discover and invoke capabilities supplied by Persephone or eligible Boards; see [Capabilities](../../agents/capabilities.md) for `app.capabilities.get`, providers and method kinds.” Label existing `invoke`, `handlers` and `list` examples as legacy where applicable; retain examples and errors.
- [x] `assets/guides/agents/capabilities.md`: in the `returns` row of the method table, before “Optional human-readable string, at most 512 characters; absent means unspecified.” → after “Optional human-readable string, at most 512 characters; absent means unspecified. For `open`, this describes the method's `result` value only; the agent surface wraps it with the optional `pageId`.”
- [x] `assets/board-template/CLAUDE.md`: before “A board that can answer named requests declares handlers in the `capabilities` array.” → after “Declare methods in `capabilities`; see the [unified capability contract](../guides/agents/capabilities.md) for new providers and consumers.” Label legacy `serviceInterfaces`, `services.connect`, old manifest and invoke examples as compatibility examples, and correct its obsolete renderer-local `capabilities.list()` description. Verify the relative guide link from the template location.
- [x] `assets/guides/agents/agent-session.md`: before “Use a board service channel.” → after “Use a board service channel; see [Capabilities](capabilities.md) for unified declarations and clients. The v1 channel contract below remains valid.” Keep the v1 protocol and examples intact.
- [x] Add only an introductory pointer in each method-specific guide, leaving v1 streaming declarations, wire formats and examples intact:
  - `assets/guides/agents/speech-synthesize.md`: before “Discover with `persephone.services.list`” → after “For unified declarations and clients see [Capabilities](capabilities.md). Discover with `persephone.services.list` …”.
  - `assets/guides/agents/speech-transcribe.md`: before “Use `persephone.services.list`” → after “For unified declarations and clients see [Capabilities](capabilities.md). Use `persephone.services.list` …”.
  - `assets/guides/agents/speech-wake.md`: before “Discover with `persephone.services.list`” → after “For unified declarations and clients see [Capabilities](capabilities.md). Discover with `persephone.services.list` …”.
  - `assets/guides/agents/text-translate.md`: before its `persephone.services.connect` transport explanation → after a preceding sentence “For unified declarations and clients see [Capabilities](capabilities.md).”
- [ ] Manual MCP `call`: (1) open the in-app Boards guide and follow its new capability link. (2) Open the scripting API guide and follow its link. (3) Open agent-session and a speech/translate guide and follow their pointers; confirm v1 examples remain. (4) Inspect `capabilities.$help`, then use `script.execute` to run `app.capabilities.list()` and confirm legacy discovery remains available.

## Concerns

- Metadata does not validate payloads; handler validation remains authoritative. The image and diagram operations depend on editor startup and conversion completing inside the existing deadline; record any observed timeout as a separate behavior decision rather than silently changing the deadline.
- Demo Board is available as a template rather than a registered board. Create it with `boards.createDemoBoard(name, dir)` in a scratch folder for the manual check; this auto-trusts it. Afterward unregister it with `boards.unregisterBoard(root)` and delete that folder.
- Rename the architecture page and update all three live inbound links plus the Documentation Map and key-files index. Preserve the two named anchors; historical task/epic references may stay stale.
- External `persephone-boards` migration and new agent-shaped methods belong to BT-087; EPIC-139 is out of scope. No runtime implementation or new tests are part of this planning task.

## Acceptance Criteria

- [ ] Each of the four shipped declarations has an explicit agent-visible `open`, useful payload signature and summary matching its handler; all existing registration fields and behavior remain intact.
- [ ] Agent opens and legacy invokes work, including fresh-page behavior, the REST Client request and Excalidraw SVG export; Demo Board remains usable when installed.
- [ ] Architecture describes the main registry, router, three clients and agent surface accurately; old links and certificate/theme anchors resolve and key-file rows identify the actual owners.
- [ ] Guides point to the normative contract without changing v1 speech/translate streaming contracts; obsolete legacy-only claims are corrected.
- [ ] Phase 1 commands pass and each phase's manual checks are recorded. No unit tests or harnesses are added.

## Files needing no changes

`assets/boards/excalidraw/index.html`, `assets/boards/rest-client/src/rest-client-model.js`, and `assets/demo-board/app.js` already handle the described payloads. `assets/boards/*/lang/*.json` title keys stay stable. `boards-assets/` has no relevant declaration. `assets/guides/agents/boards.md` and `assets/guides/agents/index.md` already point to the unified guide; `assets/guides/agents/capabilities.md` is normative and already published. `assets/guides/whats-new.md` is historical release text. `doc/agents-common.md` does not list the old architecture page. Runtime registry/router/client files and external boards are unchanged.

Planning bookkeeping already applied: in `doc/active-work.md`, the unlinked `US-1796` and `US-1797` entries became links to their task documents. In `doc/epics/EPIC-140.md`, `US-1796` changed from `Planned (documented)` to `Implemented (pending epic review)` and `US-1797` changed from an unlinked `Planned` row to a task-document link with `Planned (documented)`. This README is new (before: absent; after: this plan).

## Files Changed

| File | Planned change |
|---|---|
| `assets/boards/excalidraw/board-manifest.json` | Explicit image and diagram open methods. |
| `assets/boards/rest-client/board-manifest.json` | Explicit HTTP request open method. |
| `assets/demo-board/board-manifest.json` | Explicit greeting open method. |
| `doc/architecture/capability-bus.md` → `doc/architecture/capabilities.md` | Rename and rewrite for unified architecture, preserve anchors. |
| `doc/agents-common.md` | Add Documentation Map link. |
| `doc/architecture/key-files.md` | Correct existing entries; add architecture page and nine ownership rows. |
| `doc/architecture/overview.md`, `doc/architecture/scripting.md`, `doc/architecture/browser-editor.md` | Correct architecture prose and renamed link targets. |
| `assets/guides/boards.md`, `assets/guides/scripting/api/app.md`, `assets/board-template/CLAUDE.md`, `assets/guides/agents/capabilities.md` | Unified contract pointers and legacy guidance corrections; clarify `open` returns. |
| `assets/guides/agents/agent-session.md`, `assets/guides/agents/speech-synthesize.md`, `assets/guides/agents/speech-transcribe.md`, `assets/guides/agents/speech-wake.md`, `assets/guides/agents/text-translate.md` | Pointers while retaining v1 contracts. |
| `doc/tasks/US-1797-capability-migration/README.md` | Task plan and verified phase steps. |
| `doc/active-work.md`, `doc/epics/EPIC-140.md` | Link the planned task and reflect US-1796/US-1797 statuses. |
| `doc/tasks/US-1797-capability-migration/README.md`, `doc/active-work.md`, `doc/epics/EPIC-140.md` | This plan and its dashboard/epic links and status. |

## Notes (phase 1 verification, 2026-11-07)

Verified through MCP: `$help` for `image.edit`, `diagram.edit`, `http.request.open` shows the new signatures; agent `open` on all three and legacy `app.capabilities.invoke("http.request.open")` open their pages (`diagram.edit` returns `{ status: "opened", imageOnly: false }`).

Two bugs found and fixed (Claude) while verifying — neither caused by this task:
- **Every board `open` through the new router was cancelled at once** ("This operation was aborted"): `src/main/capability-router.ts` and `src/ipc/main/core-handlers.ts` aborted on the caller/target window's `did-start-navigation`, which also fires for subframe navigations — including the board frame the `open` itself creates. Now `did-navigate` (main-frame commits only), as `src/ipc/main/path-watch-handlers.ts` already does. US-1794–1796 checks had only exercised the platform `text.open`.
- **Legacy `invoke` without an explicit version sent intents with no `version`** (`src/renderer/api/capability-bus.ts`, since EPIC-108), so boards checking `intent.version === 1` (REST Client) rejected them. The intent now carries the resolved registration's version.

**Demo board (phase 1 check 5):** `$help` for `demo.greet` is correct and `open({ name })` returns the greeting, cold and warm, on both the agent and legacy paths. **Fixed (Claude, after the US-1797 commit):** a cold `open` on a board with secondary views timed out, because `BoardWebview` handshakes of secondary frames (which share the page id) could consume the initial intent via `takeInitialIntent(pageId)` before the main frame did; only the main frame takes it now (`src/renderer/editors/board/BoardWebview.ts`). Pre-existing since EPIC-108; unrelated to EPIC-140. Separately, `boards.createDemoBoard` writes `"author": ""`, which triggers a "Board settings require a stable board identity" notification.
