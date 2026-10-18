# US-1705: `agent.session` v1 contract

## Goal

Publish the normative v1 contract for boards that provide or consume `agent.session`, including lifecycle, event and permission semantics, and the Claude Agent/Codex CLI mappings.

## Background

EPIC-131 Phase 0 shipped ordered `persephone.service.openChannel()` and `persephone.services.connect()` channels, exact-version `serviceInterfaces`/`uses` declarations, trust disclosure, and `persephone.mcp.issueSessionEndpoint()` for authorized services. A service-to-consumer message is limited to 1 MiB. The guide index is built by scanning `assets/guides/`; therefore a guide file resolves dynamically as `guides.agents["agent-session"]`. `src/main/mcp/manifest.ts` separately registers focused MCP resource URIs, so this task adds `persephone://guides/agent-session` there.

The contract settles the Phase 1 open questions: one channel is one live CLI session; close kills the process tree but preserves CLI session storage; sessions permit one active turn; cross-board access is clamped by a provider-owned ceiling; instructions are composed at session creation; and requests above the ceiling are denied by the provider without asking the consumer. These choices keep the channel simple to consume and prevent a board holding only `uses` from laundering command execution approval.

## Implementation Plan

1. Write `assets/guides/agents/agent-session.md` as a normative v1 reference. Specify discovery (`describe`, `list-sessions`), `open`, event and request envelopes, bounded output, errors, resume and close semantics, instruction composition, private MCP, permission ceilings, per-mode CLI mappings, lifecycle examples, and provider/consumer pseudocode.
2. Link the guide from `assets/guides/agents/index.md` and the cross-board service-interface passage in `assets/guides/boards.md`.
3. Register the focused resource in `src/main/mcp/manifest.ts` so the canonical guide also has the `persephone://guides/agent-session` URI. Add a single 5.0.13 What's New line because the new guide is visible to both users and agents.
4. Keep this task doc current with the final scope and changed-file list.

Before â†’ after contract shape:

```js
// Before: Phase 1 outline left lifecycle and permissions to each provider.
{ type: "open", model, cwd, permissionMode }

// After: versioned request with explicit limits and private MCP intent.
{ type: "open", contractVersion: 1, model, cwd, permissionMode,
  limits: { maxUserTurns: 8 }, mcp: { persephone: true } }
```

No changes are needed in `src/renderer/editors/board/board-api.d.ts`, bridge implementation, CLI providers, board manifests, `BOARD_BRIDGE_VERSION`, tests, or `doc/active-work.md`. The Phase 0 APIs already supply the channel and endpoint; this task documents their use.

## Concerns

- Claude terms distinguish third-party handling of subscription credentials from a user signing into an unmodified installed binary, but do not explicitly settle every local host-app scenario. The contract preserves the epic's cautious model: launch the user's own CLI and never handle credentials; resolve policy questions before publishing provider boards.
- Claude and Codex permission controls are not equivalent. The guide labels approximate mappings and makes the provider responsible for enforcing the effective mode and cross-board ceiling.
- Codex app-server is experimental. Providers should generate/check protocol types against the installed CLI version and report unsupported versions.

## Acceptance Criteria

- `assets/guides/agents/agent-session.md` defines all v1 requests, events, lifecycle, errors, versioning, bounded summaries, permissions, ceilings, and both CLI mappings.
- The guide contains a sequence example and minimal consumer and provider skeleton snippets.
- The guide is linked from the agents overview and Boards service-interface section; `guides.agents["agent-session"]` resolves through dynamic guide indexing and the focused MCP resource URI is registered.
- The 5.0.13 release notes add one line for this user-visible guide.
- No source behavior, bridge version, tests, dashboard, or epic is changed.

## Files Changed

| File | Change |
|---|---|
| `assets/guides/agents/agent-session.md` | New normative contract |
| `assets/guides/agents/index.md` | Add agent task-to-guide entry |
| `assets/guides/boards.md` | Link the contract from cross-board interfaces |
| `src/main/mcp/manifest.ts` | Register the focused MCP guide resource |
| `assets/guides/whats-new.md` | Add one 5.0.13 guide announcement |
| `doc/tasks/US-1705-agent-session-contract/README.md` | Task record |

The following remain unchanged: `src/renderer/editors/board/board-api.d.ts`, board bridge source, provider boards, `doc/active-work.md`, `doc/epics/EPIC-131.md`, and `BOARD_BRIDGE_VERSION`.

## Review notes (Claude)

- Split the single `maxTurns` limit into `maxUserTurns` (provider-enforced for both CLIs) and
  `maxAgentSteps` (Claude Agent SDK `maxTurns`, steps within one turn; unapplied on Codex), because
  the two CLIs and the team-chat runaway-loop guard mean different things by "turn".
- Removed links to `doc/` and internal task ids from the shipped guide; the guide ships in the app
  and `doc/` does not.
