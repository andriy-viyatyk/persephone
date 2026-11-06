# US-1785: Agent session host channel and app-side client

Epic: [EPIC-139](../../epics/EPIC-139.md) · Phase 2 foundation · Planned

## Goal

Allow Persephone to consume `agent.session@1` and provide a reusable renderer client for discovery, resumable sessions, streamed turns, cancellation and safe approval denial. US-1787 will compose it into the assistant; this task does not wire the assistant.

## Background

- The normative protocol is [agent-session.md](../../../assets/guides/agents/agent-session.md): discovery opens are `describe` and `list-sessions`; live sessions open with `type: "open"`, `contractVersion: 1`, model, optional effort/instructions, absolute cwd, permissionMode, optional `resume`, and `mcp`. One channel holds one session, one turn at a time. `session-started` supplies the resumable ID and effective mode; `send`, `interrupt`, `approval-response` and `close` are subsequent messages. A closed channel preserves the provider's stored conversation. Unknown additive messages/fields must be tolerated.
- `src/main/module-service-supervisor.ts` `HOST_SERVICE_CHANNEL_POLICIES` currently allows transcription, synthesis, wake and translation; `connectHostServiceChannel()` checks opening type, provider declaration, trust, service permission, exact version, and limits, and sends `{ page: { boardId }, interface, caller: { id: "persephone", name: "Persephone" } }`. `listServiceProviders()` creates opaque random provider keys held in memory, removed with roots; these keys are not restart-stable identities.
- `src/renderer/ui/speech/SpeechTranscriptionProvider.ts` and `src/renderer/ui/translation/TextTranslationProvider.ts` discover with `api.getBoardServiceProviders`, connect via `api.connectHostServiceChannel`, and match `api.onBoardServiceChannel` ports by prefix and channel ID. The event may precede the connect result. `SpeechServiceChannel.ts` implements ordered sequence/ACK, close, `writable` and `whenWritable`; register handlers immediately and clean up pending ports, timeouts and subscriptions. Translation additionally rejects pending waiters on disposal. APIs live in `src/ipc/renderer/api.ts`.
- `src/ipc/module-service-channels.ts` sets 1 MiB serialized service-to-consumer messages and 256 unacknowledged messages per direction (ACK batch 32, tail delay 10 ms). The contract limits provider events to 900 KiB and fields to 32 KiB (tool input 16 KiB). These are per-message and in-flight limits, not turn totals: long turns work if both sides drain and respect backpressure. A slow or nonconforming provider can still close with `channel-backpressure` or `channel-message-too-large`; do not accumulate an unbounded event history in the client. Agent Chat's `scripts/service.mjs` `send()` waits for writability and `scripts/agent-session-protocol.mjs` `serializeEvent()` caps events at 900 KiB. Arbitrary event rates are not guaranteed safe.
- In `C:/projects/persephone-boards/boards/claude-agent/scripts/service.mjs`, `onChannel` routes `describe`, `list-sessions` and `open` without restricting them to a board page. `prepareOpen()` uses `Boolean(info?.interface && info?.caller)` for cross-board, reads the provider's own `cross-board-permission-ceiling` setting (manifest default `read-only`), and clamps the request. It does not look up the caller's board ID or root. Host caller is accepted as cross-board by the code; this remains to be verified live. `validateOpen()` in `scripts/agent-session-protocol.mjs` requires an absolute cwd, and Claude and Codex adapters check that it is an existing directory; neither needs a caller board root for cwd.
- Agent Chat's `issueOpenEndpoint()` calls `persephone.mcp.issueSessionEndpoint()` for requested MCP except at effective `read-only`; the endpoint is provider-service scoped, not keyed on caller board root. Both adapters send the effective mode and `mcp.persephone` in `session-started`, and session cleanup revokes the endpoint. At default `read-only` no endpoint is issued; `hookDecision()` denies MCP actions. Claude and Codex discovery can include Agent Chat's `catalog` of engine descriptions; the service defaults `open.provider` to `claude` when omitted. A board selector and an engine/provider ID are distinct.
- `src/renderer/api/fs.ts` `dataFileName()` resolves under `<userData>/data`, and `mkdir`, `read`, `write` provide renderer filesystem operations; `fpJoin` is in `src/renderer/core/utils/file-path.ts`. Epic decisions 4 and 5 require a dedicated cwd and a full-auto request, while respecting the provider ceiling and denying approvals. Decisions 6, 7 and 9 assign speaking, assistant instructions and interrupt triggers to later tasks; this client supplies only the underlying operations.

## Implementation Plan

- [x] **Allow contract opening types.** In `src/main/module-service-supervisor.ts`, add this policy; retain all existing validation and limits:

  ```ts
  // Before: no agent.session host policy
  // After:
  ["agent.session@1", { interfaceId: "agent.session", version: 1, openTypes: new Set(["describe", "list-sessions", "open"]), boardIdPrefix: "agent-session:" }],
  ```

  `list-sessions` is a contract discovery open even though the first client need is describe; subsequent `send`/`interrupt`/`approval-response`/`close` are messages, not opening types. Reject all other opens and versions.

- [x] **Build a generic client.** Add `src/renderer/ui/agent-session/AgentSessionProvider.ts` and `src/renderer/ui/agent-session/AgentSessionChannel.ts`, following the speech and translation consumers. Before: no app session client. After: `list()` returns v1 board providers; `describe(boardProvider, optionalEngine)` returns the contract description and preserves additive fields/catalog so future settings can show each engine's models and efforts. Use a bounded discovery timeout, surface provider errors and close reasons, close discovery channels, and do not assume descriptions or models are available. The selector is the fresh opaque board key; pass the distinct optional engine ID inside the open request. Connect/port races, early events, disposal during connect, timeouts, and late ports must be handled without lost messages, leaked ports or unresolved waiters. Do not expose a new public board bridge or script API.

  Model `AgentSessionChannel.ts` on `src/renderer/ui/speech/SpeechServiceChannel.ts`, with its own wire sequence/ACK semantics, immediate listeners, ordered delivery, `whenWritable()` before every outbound send, and deterministic close/dispose. Do not refactor the speech or translation transports. Expose typed events and close/error callbacks, preserve unknown events, and do not hold the entire transcript. `open()` accepts model, effort, caller instructions, `cwd`, optional resume and engine ID, and opens with `permissionMode: "full-auto"` and `mcp: { persephone: true }`. Resolve only on a valid `session-started`, expose its effective mode and `lowerThanFullAuto` (all three other known modes), plus optional MCP attachment metadata; fail safely on invalid start/mode. Forward `error` and transport closure to callers, distinguish nonfatal errors, and settle pending operations on fatal error or close.

  ```ts
  // Before: no session open
  // After: example request (boardProvider is the current discovery selector)
  { type: "open", contractVersion: 1, provider: engineId, model, effort, cwd,
    instructions, permissionMode: "full-auto", mcp: { persephone: true }, resume }
  ```

  Omit undefined optional fields. `send` starts one turn and streams all events to a registered consumer through `turn-ended`; reject a concurrent turn locally or surface provider `busy` without interleaving. `interrupt` cancels the active turn but does not close the session; retain it until `turn-ended` or closure. Automatically answer every `approval-request` with `{ type: "approval-response", requestId, decision: "deny", message: "Interactive approvals are unavailable for this session." }` after writability, and expose the request/denial reason for future UI. Never allow approval through this client. Close sends `close` when possible then closes the port, handles already-closed sessions idempotently, and disposes listeners and pending work. Make start/turn/close races and send failures explicit; no assistant state machine or voice-specific text.

- [x] **Persist a conversation binding.** Add `src/renderer/ui/agent-session/AgentSessionStore.ts`: use `fs.dataFileName("agent-session")`, `fpJoin`, and `fs.mkdir` to create `<userData>/data/agent-session/workspace` as absolute cwd; put metadata at `<userData>/data/agent-session/session.json`, outside the cwd. Before: no app-owned session record. After: store `{ boardName, engine, cwd, sessionId }` from the selected provider and latest `session-started`; use `fs.read`/`fs.write`, validate parsed fields, report malformed or I/O errors, and serialize writes so an older start cannot overwrite a newer one. Never persist the ephemeral discovery key. On load, rediscover current `agent.session@1` providers and resolve the saved `boardName` only if exactly one matches; return that provider's current selector with the stored engine, cwd and resume ID. With zero or several matches return no resume and a reason, so the caller can start fresh and explain why. Keep `resume-not-found` visible rather than silently discarding history. Provide clear/reset of metadata for a future new-conversation command without deleting the workspace or provider history. On successful start persist the returned ID before reporting persistence success. Coordinate concurrent owners rather than claiming cross-window atomicity: US-1787's single owner must serialize access; surface write errors.

- [x] **Document host access.** Update `doc/architecture/scripting.md` and the supervisor row in `doc/architecture/key-files.md` to include `agent.session@1` host consumption and link the normative guide. Document the app client's automatic approval denial in `doc/architecture/scripting.md`. In the provider contract `assets/guides/agents/agent-session.md`, add only that the app may call with `{ id: "persephone", name: "Persephone" }` and `info.interface` set, making it a cross-board caller subject to the provider ceiling, and list the host's allowed opens. Check `assets/guides/agents/boards.md` and `assets/guides/boards.md`: both already list/link `agent.session` as a reserved contract; update their host-interface descriptions if enumerated, without duplicating the contract. US-1784's guide index and MCP alias already include the existing agent-session guide; do not add a duplicate resource.

- [ ] **Manual verification, no test harness.** Run `npm run typecheck` and `npm run lint` for implementation. In a running development build with trusted Agent Chat, installed/authenticated CLI and a chosen model, use MCP `script.execute` to `await import()` the client by source-module path; the dev build serves source modules and a second module instance is harmless because the client holds no app-global state. List and describe providers, create the workspace, then open at the default ceiling and check `read-only`, the lowered-mode flag and no MCP. Raise Agent Chat's ceiling to `full-auto`, reopen and check `full-auto` and attached MCP. Stream one turn through `turn-ended`, interrupt a running turn, close, then reopen using the stored ID and confirm the conversation resumed. Log bounded event summaries and close reasons, not credentials. If convenient, also exercise more than 256 events, provoke an approval at `ask` and verify denial and reason, and try invalid opening types and versions. Record actual results, provider/CLI versions and limitations; do not fabricate them. No permanent verification UI, unit tests or harness.

### Verification results

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build-prod`: passed with Vite chunking warnings. Redirected repeat attempts hit Windows `spawn EPERM`; a normal repeat passed.
- Live Agent Chat verification (2026-11-07, dev build, Agent Chat 1.3.3, Claude engine, `haiku`/`low`), through `script.execute` importing the client by source path:
  - `list()` found Agent Chat; `describe()` returned the multi-engine catalog (claude: 3 models, codex: 9 models).
  - `open()` at the default ceiling: `permissionMode: "read-only"`, `lowerThanFullAuto: true`, `mcp.persephone: false`. Workspace created at `<userData>/data/agent-session/workspace`.
  - One turn streamed `session-started`, `session-status`, `turn-started`, `text-delta`, `text`, `turn-ended` (`completed`); `close()` ended with `channel-closed`.
  - `store.load()` matched the saved board name; reopening with `resume` returned the same session id and the agent recalled a code word from the previous session.
  - `interrupt()` during a long streamed turn ended it with `turn-ended` reason `interrupted`.
  - Not run: the `full-auto` ceiling and MCP attachment (needs the user to raise Agent Chat's ceiling, a security setting in another board), approval denial at `ask`, >256 events, invalid opens.

## Concerns / Open questions

- **Bridge version: no bump.** `src/shared/board-bridge-version.ts` is `1.49.0`. This adds an allow-listed host consumer using existing `onChannel` metadata and channel messages; it changes no board-facing method, field, or primitive. If implementation changes that surface, include the version bump and its documentation in the implementation.
- Agent Chat accepts the host in source and needs no host-identity, ceiling lookup, MCP scoping or cwd-default change. Live behavior remains unverified. Its read-only MCP omission is intentional in `scripts/service.mjs` `issueOpenEndpoint`; the client must expose lowered mode and not promise attachment. Separate contract discrepancy: `scripts/providers/codex.mjs` `startSession` reports `instructions: { composed: true }` rather than composed text. Correct there in a separately scoped boards change if consumers need contract-conforming instructions; it does not block this client, which does not consume that field.
- A provider's opaque selector changes after restart. The chosen `boardName` matching rule declines to resume when no provider or several providers match; a unique name can still refer to a replacement board, so `resume-not-found` must remain visible.
- The protocol limits bound each event and in-flight queue, not total data or memory consumed by a slow callback. Surface backpressure errors; sustained traffic verification is optional above. No new UI catalog messages are planned.

## Acceptance Criteria

- [ ] Host accepts exactly `describe`, `list-sessions`, `open` for `agent.session@1`; existing authorization and channel limits remain intact.
- [x] Discovery exposes v1 providers and model/effort descriptions, including multi-engine catalogs; early events and lifecycle failures are handled.
- [ ] Sessions open with the required options, stream ordered events, prevent overlapping turns, interrupt, deny approvals with a reason, report effective mode and close cleanly.
- [ ] Dedicated existing cwd and validated `{ boardName, engine, cwd, sessionId }` survive restart; exactly one matching provider permits resume, zero or multiple matches return no resume with a reason, and `resume-not-found` remains visible.
- [ ] Live checks cover discovery, both ceiling levels and MCP attachment, a streamed turn, interrupt, close and resume; typecheck and lint results recorded. No tests, test harness, assistant wiring or settings UI.
- [x] Host interface docs reflect the new capability; bridge-version verdict remains valid or a bump is included if the surface changes.

## Files that need NO changes

- `src/shared/board-bridge-version.ts`, `src/board-shim.ts`, `src/renderer/editors/board/board-api.d.ts`: existing generic board bridge, subject to the verdict above.
- `src/shared/board-manifest-utils.ts`: `agent.session` is already reserved. `src/main/mcp/manifest.ts`, `assets/guides/agents/index.md`: agent-session guide is already registered and indexed.
- `src/renderer/ui/voice-typing/VoiceTypingController.ts` and voice assistant state/UI, wake and speech providers: US-1787 and neighboring tasks compose the client later.
- `C:/projects/persephone-boards/boards/claude-agent/`: investigate only; no edits in this task.

## Files Changed

| File | Planned change |
|---|---|
| `src/main/module-service-supervisor.ts` | Add host policy for the three v1 opens. |
| `src/renderer/ui/agent-session/AgentSessionProvider.ts`, `AgentSessionChannel.ts`, `AgentSessionStore.ts` | Discovery, reusable session transport and persistent conversation binding. |
| `assets/guides/agents/agent-session.md`, `doc/architecture/scripting.md`, `doc/architecture/key-files.md` | Document host client and interface. |
| `assets/guides/agents/boards.md`, `assets/guides/boards.md` | Update only if a host-interface enumeration requires it. |
| `doc/tasks/US-1785-agent-session-host/README.md`, `doc/active-work.md`, `doc/epics/EPIC-139.md` | This plan, dashboard link and epic status. |
