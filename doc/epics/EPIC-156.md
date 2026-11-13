# EPIC-156: Refactoring Phase 5.6 — main conventions: one service shape, IPC only in `ipc/main`, IPC contracts by domain

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-13

## Overview

This is the sixteenth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the sixth part of Phase 5 (pages,
settings, startup and app conventions). It covers roadmap item 5.6 and findings **MAIN-6**
(`doc/reviews/refactoring-2026-11/01-main.md`), **BND-7** and **BND-8** (`02-boundary.md`).

The code was checked on 2026-11-13, after EPIC-155. Phases 0, 1 and 4 already fixed part of what the findings describe
(`registry-handler.ts` is deleted; `audio-service` and `board-dialog-service` no longer call `ipcMain` directly;
`capability-client.ts` owns `capabilityResult`; the typed main→renderer RPC exists), so the current state is restated
here.

**The problems.**

- **`core-handlers.ts` is a service, not a registrar (BND-8).** 845 lines. The `Controller` class holds the board
  shortcut write and read-back check (`createBoardShortcut`, about 60 lines), the multi-display move and DPI logic
  (`getDisplays`, `setFullScreen`, `moveToDisplay`, about 110 lines), voice-typing arming, MCP/Mneme start-stop
  orchestration and more. `src/main/main-setup.ts:8` imports startup-input state from `ipc/main/window-handlers.ts`, so
  `src/main` still depends on `ipc/main` beyond the composition root.
- **Sender policy is ad hoc (MAIN-6, BND-8).** `bindEndpoint` already applies `guardIpcSender`
  (`ipc/main/endpoint-registry.ts`), yet 21 `senderFrame !==` re-checks remain across `src/`, plus
  `checkCapabilitySender` and inline "normal, non-board app window" lambdas. The real policies have no names.
- **One endpoint, five hand edits (BND-7).** `ipc/api-types.ts` (627 lines) holds the `Endpoint` enum, the `Api`
  signatures, `EventEndpoint`/`EventApi`; `ipc/renderer/api.ts` (757 lines) hand-writes an `executeOnce` wrapper per
  endpoint with no timeout; each domain registrar has an `XEndpoint` exclusion union and only the core `Controller` is
  checked for completeness (`implements Omit<MainApi, BoardEndpoint | GitEndpoint | …>`). Event payloads are sent as
  `unknown` and re-declared in `ipc/renderer/renderer-events.ts`; the preload channel union is declared twice
  (`preload.ts:16`, `renderer/types/window.d.ts:16`).
- **IPC is registered from services (MAIN-6).** `guardedIpcOn`/`guardedIpcHandle` are called inside 13 `src/main`
  modules (browser, browser-network, cdp, tor, audio, board-dialog, global-mute, network-logger, search, worker-host,
  command-runner, renderer-rpc, module-service board-settings adapter) instead of `ipc/main`.
- **Dynamic imports with no benefit (MAIN-6).** `board-handlers.ts` (31), `git-handlers.ts` (20) and
  `core-handlers.ts` (22) `import()` modules per call, many of which `main-setup.ts` already imports statically.
- **Four service shapes and a hand-kept shutdown list (MAIN-6).** Class singletons, object-literal facades and bare
  module functions over module state; `init()`/`initialize()`/`initXxx()` start styles; import-time side effects;
  setter injection (`setPermissionPromptHandler`, `setAudioWindowTargetResolver`, `setWebContentsResolver`,
  `setNetworkResponseBodyResolver`, `setPrivateMcpStatusChanged`); a 12-call `will-quit` list in `main-setup.ts`
  while `audio-service` hooks `before-quit` itself; the `app-asset` handler's DTLN/onnxruntime CORS allowlist is inline
  in `main-setup.ts`.

## Goals

- **Registrars are thin.** Every `ipc/main/*-handlers.ts` method is a one-line delegation (argument shaping and the
  sender policy only). The logic moves to `src/main` services: a window display service, `createBoardShortcut` in
  `board-window-identity.ts`, the launch/startup inputs in `main/launch-inputs.ts`, and whatever else the plan finds.
  `src/main` imports nothing from `ipc/main` except `main-setup.ts` importing the composition root.
- **Named sender policies.** `ipc-sender-guard.ts` exports the policies by name (at least `requireAppWindow`,
  `requireNormalWindow` and `requireWindowOf(webContents)`); the binder takes a policy option; every redundant re-check
  of what the guard already enforces is deleted.
- **IPC contracts by domain.** `src/ipc/contracts/<domain>.ts` each export `XApi` (and `XEvents` where the domain sends
  events). `Api` and `EventApi` are their intersections. A `bindDomain<XApi>(handlers)` call per registrar makes the
  compiler enforce per-domain completeness; the `XEndpoint` unions and the `Omit<>` go away. The `Controller` class is
  split into domain registrars.
- **A generated renderer client.** `ipc/renderer/api.ts` becomes a typed client built from the contract map (a `Proxy`
  over the existing request/reply transport), with a default timeout and named exemptions. Main sends events through a
  typed `send<K>(key, payload)`; the renderer's event declarations come from the same map. The preload channel union
  is declared once.
- **IPC registration lives only in `ipc/main`.** The `guardedIpc*` calls leave the services; each service exposes the
  methods and `ipc/main/<domain>-handlers.ts` binds them. The per-call dynamic imports in the handlers become static
  unless the plan shows a module is genuinely not loaded at startup and is heavy.
- **One main service shape.** A service with lifecycle is a class (or an object) implementing `start()` and
  `dispose()`, receiving collaborators through its constructor. `main-setup.ts` builds services in dependency order
  from one table and disposes them in reverse order on quit (the module-service quit gate stays a special async step).
  No import-time side effects. The `app-asset` protocol and its CORS allowlist move to `main/app-asset-protocol.ts`.
  The convention is written in `doc/standards/coding-style.md`.

## Decisions this epic acts on

- **Wire names do not change.** Endpoint channel strings already equal the method names; the contract key stays the
  channel name, so main and renderer keep talking on the same strings. These are private wire protocols that ship
  together (roadmap §8), but keeping them stable makes the diff mechanical and keeps the MCP and board paths untouched.
- **Script and board surfaces do not change.** `api.x` member names, `window.persephone`, the script API, AiVision and
  MCP `call` behaviour stay as they are. No `window.persephone` change, so no `BOARD_BRIDGE_VERSION` bump.
- **No new protocol code** (guardrail 1). `bindDomain` replaces `bindEndpoint` on the same transport and the same wire
  error (`shared/wire-error.ts`); the client reuses the existing reply channel and correlation. No new envelope, no
  second correlator.
- **The default timeout.** A call that would hang forever is the bug BND-7 names; a timeout that fires on a legitimate
  long call is worse. So: one default (a named constant in a grouped tuning block, the plan proposes the value), and
  each contract module lists its exempt methods — native dialogs, prompts and anything user-interactive, capability
  invocations (they have their own deadline), git operations, downloads and other long-running work. The plan lists
  every exemption with its reason. A timeout rejects with the existing wire error shape.
- **Event payloads have one declaration.** `EventApi` is the single source; port-carrying and request/reply events
  that are not in `EventApi` today (`eBoardPort`, `eModuleServicePort`, `eBoardServiceChannel`, `eCapabilityOpen*`)
  are typed in their own contract module rather than left out. The drifted `eBoardNotify` copy (missing `persistent`)
  disappears with the copy.
- **Sender policies are named once.** The binder default stays today's guard (app partition, main frame, owned by a
  `BrowserWindow`); tighter rules ("normal, non-board window", "the hidden audio window", "the window that owns this
  `WebContents`") are named policies passed at bind time. Behaviour for each endpoint stays exactly as today — the plan
  maps every removed inline check to the policy that now enforces it, or shows the guard already did.
- **Static over dynamic imports, with a reason per exception.** The roadmap's two findings disagree (BND-8 says keep
  the lazy `import()`s that keep startup light; MAIN-6 says the laziness is fictional). Decision: static by default;
  a dynamic import stays only when the plan shows the module is not otherwise loaded before the first window and is
  heavy, with a one-line comment saying so. No `await import()` to dodge a cycle (guardrail 5).
- **The service shape is applied to services with lifecycle.** A module that holds state, timers, listeners, child
  processes or servers becomes a service with `start()`/`dispose()` in the main service table. Stateless helper modules
  stay plain functions. The setter-injection hooks become constructor parameters where the collaborator exists at
  construction time; the plan records any that cannot (with the reason) rather than forcing it.
- **Shutdown order.** Reverse construction order replaces the hand list; the plan shows the current `will-quit` order
  and that reverse order is compatible with it (or names the explicit exceptions). `audio-service` joins the table
  instead of hooking `before-quit`.
- **God files only shrink** (guardrail 3). `ipc/main/core-handlers.ts` (845), `ipc/api-types.ts` (627),
  `ipc/renderer/api.ts` (757), `ipc/renderer/renderer-events.ts` (196) and `main/main-setup.ts` (286) each end smaller
  (the first three should disappear or become small composition files). New collaborators get one job each.
- **Out of scope here (deferred):** converting the remaining `as const` channel families (`BrowserChannel`,
  `TorChannel`, `SearchChannel`, …) to contract maps — BND-7 step 6 is marked "later" in the finding; their
  `guardedIpc*` transport is fine and this epic only moves where they are registered.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1891 | Thin `core-handlers`: logic into `src/main` services, launch inputs, named sender policies (BND-8 steps 1, 3–4; MAIN-6 sender policies) | Done |
| US-1892 | IPC contracts by domain, `bindDomain` and the registrar split (BND-7 steps 1–2; BND-8 step 2) | Done |
| US-1893 | Generated renderer client, default timeout, typed events and one preload channel union (BND-7 steps 3–5) | Done |
| US-1894 | IPC registration only in `ipc/main`; static handler imports (MAIN-6) | Done |
| US-1895 | One main service shape: the service table, constructor injection, reverse-order shutdown, `app-asset` protocol (MAIN-6) | Done |

**Order.** Strictly sequential. US-1891 empties the controller methods so the registrar split in US-1892 moves
one-liners. US-1893 builds the client on the contract map from US-1892. US-1894 moves the remaining service-side
registrations into registrars that now have a shape. US-1895 goes last: once services no longer register IPC, their
construction and disposal can be ordered in one table.

### Task notes for the planners

- **US-1891.**
  - List every `Controller` method with more than delegation, and its new owner. Reuse existing owners first
    (`board-window-identity.ts`, `capability-client.ts`, `native-dialogs.ts`, `open-windows.ts`); a new file only
    when no owner exists, named after its one job.
  - `window-handlers.ts` parses `process.argv` at module load and `main-setup.ts:8` imports it: move that state to
    `main/launch-inputs.ts` (or an existing launch-arguments owner if one exists).
  - `connectHostServiceChannel` (if it still returns either a channel id or a JSON string): split it into two
    endpoints and drop the renderer's `JSON.parse`. Check `renderer/api/capabilities.ts`.
  - Grep every `senderFrame !==`, `checkCapabilitySender` and inline window-kind check. For each, say whether the
    guard already enforces it (delete) or a named policy replaces it.
- **US-1892.**
  - Propose the domain list from the real endpoints (window, files/dialogs, downloads, capabilities, boards,
    module-services, voice-typing, clipboard, git, site-extensions, path-watch, mcp/mneme, recording, …) and assign
    every endpoint and event exactly once.
  - Whether the `Endpoint` enum survives: callers that use `Endpoint.x` today (`preload.ts`, `window.d.ts`, tests of
    channel names in main) — list them and what replaces them.
  - `bindDomain` signature, where it lives (`ipc/main/endpoint-registry.ts`), and how a registrar passes a sender
    policy per method.
- **US-1893.**
  - The client: a `Proxy` or a generated object over the existing `executeOnce` transport; how TypeScript types it;
    how existing `api.x(...)` call sites stay unchanged.
  - The timeout constant and the exemption list (see the decision above).
  - Typed `send` in `open-window.ts`/`open-windows.ts` and every main-side event send; `renderer-events.ts` derived
    from `EventApi`; `RendererEventsService` handlers typed from the same map.
  - The preload union: export one type from `preload.ts` (or `ipc/`) and use it in `window.d.ts`.
- **US-1894.**
  - Map all 13 service modules that call `guardedIpc*`: channel, owner method, new registrar file.
  - `renderer-rpc.ts` and the module-service board-settings adapter may be transport plumbing rather than endpoint
    registration; say which and why if any stay.
  - Every dynamic import in `board-handlers.ts`, `git-handlers.ts`, `core-handlers.ts` (or their successors): static
    or kept, with the reason.
- **US-1895.**
  - Inventory every `src/main` module with lifecycle: shape today, start style, import-time side effects, disposal.
  - The table's home (`main/main-services.ts` or similar) and how `main-setup.ts` uses it; the current `will-quit` and
    `app.whenReady` order written as a list, then the table, and show they match.
  - Each setter-injection hook: constructor parameter, or why not.
  - If the inventory is too large for one task, the plan may split it into US-1895 and US-1896 and say so.
  - Write the convention into `doc/standards/coding-style.md` and fix `doc/architecture/overview.md`'s main-process
    section if it states the old rule.

## Out of scope

- Converting the `as const` channel families to contract maps (BND-7 step 6), see above.
- Content Layer 2 typed `action` (roadmap 5.7) and the Phase 6 feature splits (`McpSessionHost`, browser main side,
  voice-typing controller).
- Any change to `window.persephone`, the script API, MCP `call` behaviour, persisted files.
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-13
- Epic created after EPIC-155. Current state re-checked against the code: `registry-handler.ts` already deleted; raw
  `ipcMain` remains only in `ipc-sender-guard.ts` and `endpoint-registry.ts`; 21 `senderFrame !==` re-checks; 13
  service modules register IPC through `guardedIpc*`; 73 dynamic imports across the three big registrars.

### 2026-11-13 — implementation and close
- All five tasks implemented and staged in one unattended run; typecheck, lint and build-prod pass after each, and a cold
  `npm start` reaches the settings effects (MCP server, Mneme and clipboard ready) after each. The Persephone MCP
  connection of the session was down, so the window checks went straight to the app's MCP HTTP endpoint: one
  accessibility snapshot after US-1895 (shell, Explorer and Git panel render), and a tray-equivalent quit
  (`openWindows.doQuit = true; app.quit()`) that stops Clipboard, Mneme and the MCP server and exits in 2 s.
- **Sizes (wc -l).** `ipc/main/core-handlers.ts` 845 -> deleted (29 domain registrars, the largest
  `board-handlers.ts` 212 -> 217 after it gained static imports and lost the module-service, capability and voice
  endpoints); `ipc/api-types.ts` 627 -> 60 (20 contract modules in `src/ipc/contracts/`); `ipc/renderer/api.ts`
  757 -> 123; `ipc/renderer/renderer-events.ts` 196 -> 56; `main/main-setup.ts` 286 -> 77 (`main/main-services.ts`
  387 new).
- **Decision refinements.**
  - US-1891: the registry-dependent policies live in `main/ipc-sender-policies.ts` (`requireAppWindow`,
    `requireNormalWindow`, `requireWindowOf`, `anyPolicy`) so `ipc-sender-guard.ts` stays a leaf; each binding passes
    an explicit `deny` so every endpoint keeps its old denial message. `window.d.ts` (script-facing, copied to
    `assets/editor-types/`) keeps its own display types; the IPC copies live in `api-param-types.ts`.
    `connectHostServiceChannel` was split; `connectCapabilityChannel` returns a typed result and the renderer no
    longer parses JSON.
  - US-1892: the enums stayed one more task, held equal to the contract keys by a type-level assertion. A follow-up
    run reformatted code the implementer had compressed onto long lines to meet line estimates.
  - US-1893: the client is a `Proxy` over the existing `executeOnce`/`PendingRequests` transport; `then`, `toJSON`,
    `constructor` and symbol keys return `undefined`, and methods and event objects are cached per key. The default
    timeout is 30 s; each contract module declares its exempt methods with a reason (dialogs, snipping, capability
    invocations and channels, git, update checks, board catalog/download, recording, module services, Mneme,
    clipboard sidecar start and others found in the audit). `Endpoint` and `EventEndpoint` are gone.
  - US-1894: every registrar is bound from `controller.init()`, before any window; service setup stayed where it was
    in `main-setup.ts`. The renderer-RPC reply hook stays with its `PendingRequests` owner. All dynamic imports in
    `src/ipc/main/` and `main-setup.ts` became static; the dev build has no ineffective-dynamic-import warning left.
  - US-1895: rescoped at review. The table reproduces exactly today's startup calls and quit disposals (no new
    quit-time behaviour); `MainService` has optional `start`/`dispose`. Phases match the old boundaries
    (`setup-before-certificate`, `setup-after-certificate-before-ipc`, `setup-after-ipc`, `ready`); app listeners and
    `controller.init()` stay in `main-setup.ts`. Disposal is reverse table order, with path-watch and private-MCP as the
    named pre-gate steps and the module-service gate unchanged; the board-pipe row precedes the video row so video
    stops first. Module-function services get collaborators through their row's `start(deps)` instead of setters; no
    god file was rewritten as a class. `app-asset` lives in `main/app-asset-protocol.ts` with
    `APP_ASSET_CORS_ALLOWLIST`.
- **Review.** `/review` replaced five new non-null assertions with runtime guards (voice typing, audio capture, CDP
  AI-vision binding) on paths the sender policies already protect; `/document` updated `overview.md`, `key-files.md`,
  `folder-structure.md` and `pages-architecture.md` (the convention itself went into `coding-style.md` with US-1895);
  `/userdoc` needed no changes. No English catalog messages changed.
- **Deliberate behaviour changes.** A renderer IPC request that gets no reply rejects after 30 s unless its method is
  exempt; a sender-policy denial now runs before argument validation, so an unregistered window sending a malformed
  voice-typing request gets "permission-denied" instead of a type error; shutdown runs the same disposals in reverse
  table order (video before board pipes) instead of the old hand order.
- **Deferred.** Converting the `as const` channel families (`BrowserChannel`, `TorChannel`, `SearchChannel`, …) to
  contract maps (BND-7 step 6).
