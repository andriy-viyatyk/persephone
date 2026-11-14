---
title: "Agent Session"
audience: "both"
summary: "How do providers and clients discover and open resumable agent.session v1 sessions?"
---

# Agent Session — the `agent.session` v1 contract

This is the normative contract for boards that provide or consume `agent.session` version 1.
It is written for board authors and agents building boards. The provider launches the user's
installed CLI; the consumer does not receive the provider's permissions or credentials. The
Agent Chat board uses this Persephone platform contract to connect its chat UI to coding-agent
sessions.

## Transport and lifecycle

Declare the exact interface version in `board-manifest.json`:

```json
// Provider
{"serviceInterfaces":[{"id":"agent.session","version":1,"title":"Agent Chat"}]}
// Consumer
{"uses":[{"id":"agent.session","version":1}]}
```

Use a board service channel; see [Capabilities](../capabilities/index.md) for unified declarations and clients. The v1 channel contract below remains valid. A channel represents exactly one live session. For a
consumer, `persephone.services.connect("agent.session", selector, openMessage)` sends
`openMessage` to the provider as the session's opening request. The provider uses the same
`persephone.service.onChannel((channel, openMessage, info) => ...)` handler used for local
channels. For a provider's own chat page, `persephone.service.openChannel(openMessage)` is the
same operation. See the [Boards guide](../boards/index.md)
for channel trust and lifecycle details.

Closing the channel ends the live session: the provider interrupts and kills the CLI process tree
and revokes any per-session MCP endpoint. It does **not** delete the CLI's stored session. A later
`open` may resume it by id. A channel closing because of `renderer-reloaded`, `untrusted`,
`service-exited`, `quit`, or another platform close code has the same cleanup effect. A provider
must not treat a closed channel as a request to delete conversation history.

All messages are plain structured-cloneable objects with a string `type` discriminator. Receivers
ignore unknown message types and unknown additive fields. Consumer requests may include an `id`;
the provider echoes it on the reply event when one exists. `contractVersion: 1` is mandatory on
`open` and `session-started`. It is the contract's version, and equals the manifest interface
version. Additive fields are allowed within v1; incompatible changes require a parallel
`agent.session` version 2 declaration and contract.

Channels are ordered and bounded by the platform. Respect `writable` and `whenWritable()` before
sending. Service-to-consumer messages must remain below the channel's 1 MiB limit: serialize each
event to at most **900 KiB**, leaving room for structured-clone framing. Cap individual text,
summary, detail, and title fields at **32 KiB UTF-8**; cap tool input summaries at **16 KiB**.
Truncate oversized content and set `truncated: true` on the event or affected content object.
Do not send file contents in `file-change` events.

## Discovery requests

These opening requests do not launch a CLI session. The provider replies once and closes the
channel afterward. Discovery replies use the request's optional `id` as described above.

- `{type:"describe"}` returns `type:"description"` with `contractVersion:1`, optionally a bounded
  provider id, models (`id`, user-facing `label`, supported `efforts`), supported
  `permissionModes`, the effective cross-board permission ceiling for this caller, and the
  permanent v1 `features` booleans: `resume`, `thinkingStream`, `usage`, `cost`,
  `maxAgentSteps`, and `maxBudgetUsd`. These fields remain part of v1. A description includes
  `capabilities`, a provider feature-flag object a chat UI may use to gate provider-specific
  controls: `providerSetup`, `sessionStore`, `transcriptFollow`, `permissionModes`,
  `modelSelection`, `effortSelection`, `slashCommands`, `mcpPanel`, `subagents`, `tokenUsage`,
  `costUsage`, `contextUsage`, and `rateLimits`. It also includes `setup: { required: boolean,
  ready: boolean }` to describe provider setup requirements, and may include `provider`, the bounded
  provider id. Models and efforts reflect what this installed CLI and account can currently use.
- `{type:"list-sessions", cwd?}` returns `type:"sessions"` with resumable entries containing
  `id`, `title` (or first prompt when no title is available), `updatedAt` (ISO 8601), and `cwd`;
  rows may include `provider`, the bounded provider id that owns that session. If `cwd` is supplied,
  it filters the list to that working directory when supported. Do not start a session as a side
  effect of listing.

## Open request and session start

The consumer opens a live session with:

```ts
{
  type: "open",
  contractVersion: 1,
  provider?: string,               // bounded provider id; defaults to "claude"
  model: string,
  effort?: string,
  cwd: string,
  instructions?: string,          // caller instruction layer
  permissionMode: "read-only" | "ask" | "auto-edit" | "full-auto",
  resume?: string,                // opaque, bounded provider session id
  limits?: { maxUserTurns?: number; maxAgentSteps?: number; maxBudgetUsd?: number },
  mcp?: { persephone?: boolean }, // defaults to true
  title?: string
}
```

Provider ids are bounded identifiers matching `[a-z][a-z0-9-]{0,63}`. If `provider` is omitted,
the provider selection defaults to `claude` for compatibility with existing v1 callers. An unknown
or unavailable provider fails with error code `provider-unavailable`. A `resume` value is an opaque
provider session id: the shared contract bounds it to 512 characters and rejects empty values and
control characters, while each provider validates its own id format and whether the session exists.

The provider validates model, effort, cwd, resume id, limits, and permissions against its own
capabilities. It emits `session-started` before any turn events. The event includes a resumable
`sessionId`, selected `model`, effective `permissionMode`, a `limits` object describing each
requested limit and whether/how it was applied, `instructions: { composed }`, optional `provider`
identifying the provider, and `contractVersion: 1`. A requested but unsupported budget must be
reported as unapplied; it must not be silently presented as enforced. The limits mean:

- `maxUserTurns`: completed `send` turns in this live session. Providers always enforce it
  themselves; a `send` past the limit is rejected with `limit-reached`.
- `maxAgentSteps`: model/tool iterations within one turn (Claude Agent SDK `maxTurns`). Codex has
  no equivalent, so a Codex provider reports it as unapplied.
- `maxBudgetUsd`: estimated cost ceiling (Claude Agent SDK `maxBudgetUsd`). Codex reports tokens
  only, so a Codex provider reports it as unapplied.

### Instruction composition

The provider composes exactly three additive layers, in this order:

1. **Environment preamble**, generated by the provider: running inside Persephone, provider board
   name, working directory, whether Persephone MCP is attached, and that output is shown in a chat
   UI.
2. **Provider instructions**, configured by the user in the provider board (a multiline board
   setting, or an editor the board provides) and never taken from the consumer.
3. **Caller instructions**, from `open.instructions`, if supplied.

The provider adds this composition to the CLI's built-in prompt; it does not replace the prompt.
Repository `CLAUDE.md` / `AGENTS.md` files continue to load through the CLI. Instructions are
fixed for the live session: Claude snapshots its system prompt and Codex has no turn-level
developer-instruction override. Resuming a stored CLI session does not promise that new
instructions take effect. Return the actual composition in `session-started.instructions.composed`
so a consumer UI can show what the agent was told. Keep secrets out of all instruction layers.

### Private Persephone MCP

`mcp.persephone` defaults to `true`. When true and the provider has `appScripting`, it issues a
private endpoint for this session using `persephone.mcp.issueSessionEndpoint()` and injects that
endpoint only into the child session. Claude Agent SDK uses an HTTP MCP server with the returned
URL and headers (`mcpServers`). Codex uses `-c mcp_servers.persephone.url=...` and
`-c mcp_servers.persephone.bearer_token_env_var=...`; put the token in the child environment,
never in argv. Revoke the endpoint on every session-ending path. Never write user CLI config.
If the provider lacks `appScripting` or the caller requests `false`, report MCP as unattached in
the preamble and session description. The endpoint grants full app control; the provider must
require `appScripting` and disclose that grant through board trust.


## Read next

| What you need | Page (object-model path) |
|---|---|
| Session events, permissions, examples and security | [session-events-and-security](session-events-and-security.md) - `guides.agents["agent-session"]["session-events-and-security"]` |
