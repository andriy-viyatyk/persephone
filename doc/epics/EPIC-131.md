# EPIC-131: Agent sessions in boards — provider boards and a multi-agent team chat

## Status

**Status:** Active
**Created:** 2026-10-18

## Overview

Let boards drive the user's installed coding agents — Claude Code (Opus, Sonnet) and Codex
(gpt-6-luna) — as long-lived, streaming, interruptible sessions. Phase 0 adds the two platform
primitives this needs and nothing agent-specific. Phase 1 ships one provider board with
two engines (Claude, Codex) and one single-agent chat, behind one shared `agent.session` contract. Phase 2 turns
any chat in that same board into a group chat: the user invites more agents, each with an editable
role, and they talk in one conversation alongside the chat's main agent.

## Goals

- A board service can stream to its pages, and a page can hold a long-lived two-way conversation
  with its service (Phase 0).
- A board can open the same kind of channel to *another* board's service through a declared,
  versioned interface, with trust and permissions that stay honest (Phase 0).
- The agent provider board (today `claude-agent`, with a Claude and a Codex engine) drives the installed CLIs using the user's existing
  logins, with streaming output, interrupt, resume, and tool approvals shown in the UI (Phase 1).
- Both implement one vendor-neutral `agent.session` contract, so consumers do not care which CLI
  is behind a session (Phase 1).
- Any Agent Chat conversation can invite more agents (Claude or Codex) with user-editable roles;
  every participant sees every visible message, and each one posts results to the shared chat
  through a board tool (Phase 2).

## Background (verified 2026-10-18)

What exists today:

- **Board services.** `board-manifest.json` `"service": "scripts/service.mjs"` plus the `service`
  permission runs a Node utility process (`src/main/module-service-supervisor.ts`, host
  `assets/module-service-host.mjs`). Node built-ins are available, so `child_process` can spawn the
  CLIs; imports resolve `node_modules` from the board root, so SDK packages work.
- **Service environment.** `buildServiceEnvironment()` keeps `PATH`, `USERPROFILE`, `APPDATA`,
  `LOCALAPPDATA`, `HOMEDRIVE`/`HOMEPATH` and friends — enough for installed CLIs to find their
  logins. API-key variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are *not* passed.
- **Page ↔ service is request/reply only.** `persephone.service.request(message)` → one reply via
  `persephone.service.onRequest(handler)`. There is no service → page push and no streaming.
- **MessagePort plumbing already exists.** The supervisor's lease path posts messages *with ports*
  to the utility process (`leaseCallbacks.postMessage(process, message, ports)`), used by
  service-backed content providers. Phase 0 should reuse it rather than invent a transport.
- **Cross-board work today is capabilities.** Capability handlers are page-based, one-shot,
  FIFO-queued (max 32) and deadline-bound (`src/renderer/api/board-capability-transport.ts`). They
  fit "do this and return a result", not "hold a session open for an hour and stream it".
- **Service shutdown.** `onShutdown` callbacks must finish within the main process's 2-second
  deadline — agent providers must kill whole CLI process trees on Windows within that window.

## Design

### Phase 0 — platform primitives

**P0-A. Service channels (same board).** A page opens a long-lived, two-way channel to its own
board's service:

```js
// page
const channel = await persephone.service.openChannel({ op: "session", id });
channel.onMessage((event) => render(event));
channel.send({ op: "user-message", text });
channel.close();

// service
persephone.service.onChannel((channel, openMessage) => {
    channel.onMessage((message) => { /* ... */ });
    channel.send({ type: "text-delta", text: "..." });
    channel.onClose(() => { /* release */ });
});
```

- Backed by a MessagePort pair handed to the utility process through the existing lease path.
- Structured-clone messages, ordered, no deadline; closes from either side; closes on page
  unload/navigation and on service exit (with a reason the other side can read).
- Channels from multiple windows coexist; a service restart closes all of them with
  `service-exited`.
- Backpressure: bounded queue with a clear error rather than unbounded memory.
- Open question for the task: also add a fire-and-forget `broadcast(event)` to all of a board's
  pages, or leave that to channels.

**P0-B. Cross-board service interfaces.** A board declares interfaces its service provides; other
boards connect to them and get the same channel object as P0-A:

```json
// provider manifest
{ "serviceInterfaces": [{ "id": "agent.session", "version": 1, "title": "Claude Code" }] }

// consumer manifest
{ "uses": [{ "id": "agent.session", "version": 1 }] }
```

```js
const providers = await persephone.services.list("agent.session");
const channel = await persephone.services.connect("agent.session", { provider: providers[0].id, version: 1 });
// provider service
persephone.service.onChannel((channel, openMessage, { interfaceId, caller }) => { /* ... */ });
```

- **Multi-provider by design.** Unlike content-provider schemes (first trusted board wins), many
  boards may provide the same interface; `list()` returns all of them and the consumer picks.
- **Trust is the hard part.** A consumer with no `execute` permission must not quietly gain shell
  access by connecting to an agent provider. So: the consumer must declare `uses`; the trust dialog
  and Board Info list the interfaces it uses and the provider boards behind them; the provider
  receives the caller's board identity and can refuse; providers own their own approval UI for
  dangerous actions. The task document must settle this before any implementation.
- Interfaces are namespaced like provider types (`author/name` or a reserved platform id); decide
  whether `agent.session` is a platform-reserved id or `persephone/agent.session`.

**P0-C. Private Persephone MCP for in-app agents.** Agents started by a board get Persephone's
MCP tools even when the user's CLI has no Persephone MCP configured and even when `mcp.enabled`
is off. The global switch keeps meaning "external clients may connect"; in-app agent sessions use a
separate, private endpoint.

- Today `src/main/mcp-http-server.ts` is one unauthenticated `127.0.0.1` listener gated by
  `mcp.enabled`. Each client already gets its own server from `createMcpServer()`, so the tool
  layer is listener-agnostic.
- Add a second listener (random port, `127.0.0.1` only, started on first use and independent of
  `mcp.enabled`) that requires `Authorization: Bearer <token>`. Tokens are per session, revocable,
  and die with the board service or when the session closes.
- Bridge API in the service, e.g. `persephone.mcp.issueSessionEndpoint()` →
  `{ url, headers, revoke() }`. Requires `appScripting` (a token is full app control, the same
  grant the trust dialog already describes as **Full access**).
- The provider injects it per session only (Claude SDK `mcpServers` / `--mcp-config`; Codex
  `-c mcp_servers.*`). It never writes the user's CLI config. Exact injection syntax comes from
  the research file.
- Optionally show these sessions in the MCP status indicator, labelled as in-app agents.

**P0-D. Multi-line board settings.** Board settings show `string` values as a one-line `InputView`
(`src/renderer/editors/settings/sections/BoardSettingsSection.ts`); the only string `format` today
is `folderPath`. Add `format: "multiline"`, rendered with the UIKit `TextareaView` (already used by
`FileSearchSection.ts`), so a board can declare long text such as agent instructions. Older
Persephone versions fall back to a one-line input, so a board using it should set the new
`minBridgeVersion`. Check whether the settings store or bridge caps string length.

All four P0 tasks change the board-facing bridge: each must bump `BOARD_BRIDGE_VERSION` and document
the new `minBridgeVersion` in the boards guide.

### Phase 1 — provider boards

Live in the `persephone-boards` repo (one folder each; boards never nest).

- **`agent.session` v1 contract** (written first, from the CLI research):
  - open: `{ model, effort?, cwd, instructions?, permissionMode, mcpServers?, resume? }`
    (`instructions` is the caller layer below; the provider composes the rest)
  - client → provider: `send`, `interrupt`, `approve` / `deny`, `close`
  - provider → client: `session-started` (with resumable id), `text-delta`, `thinking-delta`,
    `tool-call`, `tool-result`, `file-change`, `approval-request`, `turn-end` (with usage),
    `error`, `closed`
  - `list-sessions` / resume across restarts using the CLIs' own on-disk session stores.
- **One board, two engines** *(decided 2026-10-25, replaces the earlier `codex-agent` board)*.
  Boards cannot nest or import from each other, so a second board would copy the ~1,500-line chat
  UI and the service plumbing and every fix would land twice. Instead the `claude-agent` service
  gets a provider adapter interface (`providers/claude.mjs`, `providers/codex.mjs`; start, send,
  interrupt, approve, close, list sessions, history, models), and the shared service keeps
  channels, approvals, limits, instructions, the MCP endpoint and process-tree kill. The `describe`
  reply carries capability flags (for example subagents, transcript follow, MCP panel, cost
  reporting, SDK install); the UI shows or hides features by flag and never checks the vendor. The
  UI reads contract events only: native-message matching (model change, compacting) moves into
  the Claude adapter, which emits typed events. `open` gains a `provider` field. Order:
  BT-048 refactor with no behavior change → BT-049 Codex adapter → BT-050 rename the board (it is
  published as "Claude Agent" 1.0.0; migrate its `claude-agent:` localStorage keys and installs).
  In Phase 2 `services.list("agent.session")` then returns one provider and the consumer picks the
  engine with `open.provider`.
- **Each engine** maps its native CLI protocol onto the contract inside the shared service and
  chat page. Integration choice per CLI is
  decided from the research file, not from training data.

**Integration decisions from the research** ([EPIC-131-cli-research.md](EPIC-131-cli-research.md),
Claude Code 2.1.302 / Agent SDK 0.3.302 / Codex 0.163.0, checked 2026-10-18):

- **Claude: Agent SDK, launching the user's installed binary.** The SDK bundles its own `claude`
  binary as a per-platform optional dependency. Set `pathToClaudeCodeExecutable` to the installed,
  unmodified `claude`, so the user's own install and login are what run (this is also the reading
  of Anthropic's terms most clearly in bounds, see Concerns). Persephone never reads or handles
  credential files.
  - `systemPrompt: { type: "preset", preset: "claude_code", append }`. With no `systemPrompt`
    the SDK uses a minimal prompt, not Claude Code's. A changed `append` on resume is ignored
    (snapshotted at the first request), so instructions are fixed per session.
  - Always set `permissionMode` explicitly (unset may start in `auto` since SDK 0.3.286); route
    approvals through `canUseTool`.
  - Keep `settingSources` so `CLAUDE.md` loads. Never use `--bare` (it ignores subscription auth).
    Strip `ANTHROPIC_API_KEY` from the child environment unless the user chooses API-key auth,
    because it overrides the subscription login.
  - MCP: `mcpServers: { persephone: { type: "http", url, headers } }` plus
    `allowedTools: ["mcp__persephone__*"]`. User and project MCP servers still load unless
    `strictMcpConfig` is set; default is to leave them.
  - Budgets: `maxTurns` and `maxBudgetUsd` are available.
- **Codex: `codex app-server` (JSON-RPC over stdio), not `@openai/codex-sdk`.** The SDK only wraps
  `codex exec --json`: no text deltas and no approval round-trip. Generate the protocol types from
  the installed CLI (`codex app-server generate-ts` / `generate-json-schema`, offline) and check
  the version at start, because the protocol is marked experimental.
  - Instructions: `developerInstructions` on `thread/start` (or `-c developer_instructions`). It
    is additive and lands before `AGENTS.md`. No turn-level override.
  - MCP: `-c mcp_servers.persephone.url=…` and
    `-c mcp_servers.persephone.bearer_token_env_var=VAR`, with the token in the child
    environment so it never appears in argv. This is verified additive to the user's servers. If
    the thread-level `config` map turns out not to accept it, run one app-server child per session.
    Set `default_tools_approval_mode="approve"` for the Persephone server only if tool prompts get
    in the way.
  - Models from `model/list` at runtime (`gpt-6-luna` is in the local catalog, efforts low to max).
  - Codex reports tokens only (no cost) and has no max-turns or budget parameter, so the host
    enforces turn limits itself.
- **Built-in subagents.** Both CLIs have them. Phase 2 leaves them alone: invited agents are peers
  the user adds, not an orchestration layer, so nothing is doubled.
- **Windows.** Both can leave orphaned children. The provider owns a Job Object or uses
  `taskkill /T /F` on interrupt, close and shutdown. Claude's own sandbox is unsupported on native
  Windows; Codex has a native sandbox that needs setup, so default to approvals rather than
  sandbox-only safety.
- **Naming.** Anthropic does not permit "Claude Code" in the name of an SDK-built agent; "Claude
  Agent" is allowed. The board's display title follows that.
- **Approvals in the UI** are part of v1, not a later addition.
- **Configurable session instructions.** Every new session gets instructions composed in layers,
  most general first:
  1. **Environment preamble**, generated by the provider: you are running inside Persephone,
     in board X, the working folder, whether the private Persephone MCP (P0-C) is attached, and
     that the user reads your output in a chat page. It stays short, because the Persephone MCP
     server already sends its own usage guidance to clients (`SERVER_INSTRUCTIONS` in
     `src/main/mcp/manifest.ts`, passed in `server-factory.ts`).
  2. **User's main instructions** for that provider: a board setting declared in the provider's
     manifest (`"type": "string", "format": "multiline"`, see P0-D), edited in Settings under the
     board's node in **Editors**. The default value ships in the manifest; the chat page links
     to the setting.
  3. **Caller instructions** from the `open` message (`instructions` field), used for group-chat
     roles in Phase 2.
  - Delivered as an *addition* to the CLI's own system prompt, not a replacement, so built-in tool
    guidance and the repo's `CLAUDE.md` / `AGENTS.md` keep loading. Claude uses the append option;
    the Codex mechanism (developer instructions or equivalent) comes from the research file.
  - The chat page can show the composed instructions of a session, so the user can see exactly
    what the agent was told.
  - Layer 2 is per provider. A group-chat role's instructions are layer 3 (see Phase 2).

### Phase 2 — group chat inside Agent Chat *(redesigned 2026-10-25)*

No separate team-chat board. With Claude and Codex already behind one service, group chat is a
feature of the Agent Chat board (`claude-agent`): it reuses the chat UI, the session lifecycle,
approvals and the provider adapters, and needs no cross-board `uses` connection.

**Agent profiles** *(revised 2026-10-25, BT-052)*. Role and agent are one saved, fully
preconfigured **agent profile**:
- **Name** (e.g. Nova) and **role title** (e.g. Reviewer);
- **Agent instructions** — full text given to the joined agent as layer 3: how to behave in that
  role;
- **Summary for the chat** — a short description of what this agent does and what it can be asked
  for, so Master (and the other agents) know what each participant is for and Master can delegate
  work by asking that agent by name in the chat;
- **Engine and model** — stored as an alias (`opus`), not a pinned version, so defaults follow the
  latest model;
- **Effort** and **permission preset** (read-only by default; write presets carry a warning that
  Master works in the same folder).

The board ships four profiles, all Claude · Opus · medium · read-only: **Nova (Reviewer)**, **Rex
(Critic)**, **Atlas (Researcher)**, **Iris (Planner)**. The user adds, edits, duplicates and
deletes profiles in an in-board editor, with **Reset to defaults**. Profiles are board-level, owned
by the service, so every chat sees the same list. BT-051's unreleased roles file is replaced, not
migrated.

**Inviting an agent.** Every chat gets a **+ Invite agent** chip after the effort chip. It opens a
menu of profiles, `Nova (Reviewer)`, `Atlas (Researcher)`, …, with **Edit agents…** at the bottom;
one click invites. Names are unique in a chat, so a profile already in the chat is greyed out (to
have two reviewers, duplicate the profile). A profile that cannot run (engine not installed, model
no longer offered) is greyed out with the reason on hover. Inviting into an idle or new chat starts
Master first. Only the user invites agents in v1 (no agent-initiated invites). On add, the chat shows a notice
visible to everyone: *Agent Nova (Reviewer) joined*, followed by the role's summary for the chat.
The board collapses the summary under the notice (expandable), but the delivered message carries
it in full, so Master and every other participant read it. Removing an agent works the same way,
with a *left* notice.

**One session per participant.** Each invited agent gets its own native session (same `cwd` as the
chat), opened with the role instructions as layer 3. Its full working view — tool calls, file
reads, reasoning — stays in its own session. The sidebar does not list these sessions as separate
chats; they nest under their parent chat, and the user can open one read-only to watch it work.
Once a chat has at least one invited agent, its sidebar row shows a **group icon** instead of the
Claude or Codex icon. The icon keeps the main agent's engine color and the same idle/active
states, so the main engine is still readable at a glance.

**What is shared.** Only *visible* messages travel between sessions, never tool calls or tool
results:
- the user's messages;
- the main agent's final reply text of each turn;
- an invited agent's posts, made through a board MCP tool (`post_message(text)`). An invited
  agent's own reply text is not copied to the chat; only what it posts is.

Every visible message is delivered, in full, to every other participant. The volume is small (the
token weight of a chat is in tool traffic, which is never copied).

**Headers are stamped by the board, never written by agents.** Each delivered message starts with
one parsable header line, added by the board's tool or delivery code, for example
`[[from: Nova | role: Reviewer]]`, `[[from: user]]`, `[[from: Master | role: main]]`. The chat UI parses the
header and renders an author badge (name, role, engine icon in its color) instead of the raw line.
The exact format is fixed in the task document.

**Delivery.** A message reaches an agent as a new user turn. If the agent is mid-turn, messages
queue and arrive together as one turn when it goes idle. The main agent receives every post too,
so its transcript already holds the whole shared timeline with headers: reopening a chat rebuilds
it from the main transcript. A small per-chat participants file (name, role, engine, model,
effort, session id) is the only extra state, so invited agents resume with the chat.

**Joining mid-conversation.** A new participant's first turn carries the visible history so far
(headers included), not the main agent's tool traffic.

**Names and positions.** Every participant has a name and knows it. The main agent is named
**Master** by default; invited agents get their names at invite time. Anyone — the user or another
agent — can address a participant by name, Master included. Each agent also knows its position:
*main* or *joined*.

**Group-chat instructions are core, always injected.** The group rules live in the environment
preamble (layer 1), which the provider generates and the user cannot edit, so they are present in
every session whatever the user writes in their own instructions (layer 2). Every session gets
them from the start, solo chats included: the agent's own name and position, that other agents
may join, how to read the header, and that messages with the `user` header come from the user.
Kept short, so a chat that never becomes a group pays little for it. The behavior rules depend
on the position:
- **Main (Master):** answers the user's questions unless the user explicitly names another agent.
  Answers its own name when another agent addresses it. May delegate work to a joined agent by
  asking it by name in the chat, based on the role summaries it has received.
- **Joined:** helps according to its role (for example critique, review the plan, review the
  implementation) and publishes through `post_message`. Answers a question only when it is called
  by name. Otherwise it speaks only when the role calls for it; silence is an acceptable answer.

Because instructions are fixed per session (see Phase 1), the preamble carries only the rules,
not the participant list. The current participants (names and roles) come with the join/leave
notices delivered to every session, and a joining agent's first turn lists everyone already there.

**Ping-pong.** Master moderates; there is no hop limit (owner decision, 2026-10-25). The core
rules make Master watch for agents going back and forth without progress, repeating points or
prompting each other unasked; it then tells them by name to stop and summarizes for the user.
Joined agents follow Master's instructions, ranked right after the user's, and stay quiet on that
topic until the user or Master addresses them again. **Stop all** interrupts every participant.

**Approvals.** Each role has a permission preset; the default is read-only. If a role is allowed to
ask, its approval cards appear in the main chat under that agent's badge.

**MCP for `post_message`.** Claude: an in-process SDK MCP server per session. Codex: app-server
needs a server it can reach, so the board service hosts a small local endpoint (stdio shim or
token-gated HTTP like P0-C). The Codex path is unverified and is the first thing the task checks.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1703 | Phase 0: service channels — page ↔ own service, long-lived and streaming | Implemented |
| US-1704 | Phase 0: cross-board service interfaces (`serviceInterfaces` / `uses` / `services.connect`) with trust disclosure | Implemented |
| US-1709 | Phase 0: private token-gated Persephone MCP endpoint for in-app agent sessions | Implemented |
| US-1710 | Phase 0: `format: "multiline"` board settings (Textarea in Settings → Editors) | Implemented |
| [US-1711](../tasks/US-1711-service-board-settings/README.md) | Phase 0 follow-up: read board settings from a module service | Implemented |
| US-1705 | Phase 1: `agent.session` v1 contract document | Implemented |
| US-1706 | Phase 1: `claude-agent` provider board (persephone-boards BT-046) | Implemented |
| US-1707 | Phase 1: Codex engine in the agent board (persephone-boards BT-048 refactor, BT-049 Codex adapter, BT-050 rename) | Implemented |
| US-1708 | Phase 2: group chat in Agent Chat — roles, invited agents, `post_message`, shared delivery | Planned |

Phase 1 and 2 task documents are written after Phase 0 lands and after the CLI research below
has been reviewed.

## Concerns

- **Privilege laundering through providers** (P0-B): settled in US-1704's plan, before code.
- **CLI interfaces move fast.** Both CLIs change monthly (Codex removed `mcp-server` in 0.154.0).
  Phase 1 designs from [EPIC-131-cli-research.md](EPIC-131-cli-research.md), refreshed if stale.
- **Terms of use (open, owner decision).** Anthropic's legal page forbids third-party developers
  from offering Claude.ai login, routing requests through Free/Pro/Max credentials on behalf of
  their users, or handling credentials and session tokens; the Agent SDK page adds "unless
  previously approved". The same page allows an end user signing in to the unmodified Claude Code
  binary with their own subscription, including where a platform hosts Claude Code. Launching the
  user's own installed binary, and never touching credentials, is the design closest to the
  allowed case, but no page addresses it in so many words; Anthropic names sales as the contact.
  OpenAI has no statement either way on host apps reusing a local Codex login. Personal use first;
  decide before publishing the provider boards to the boards site. Quotes and links are in the
  research file, section 3.
- **Approval fatigue** with several agents: per-role permission presets, read-only by default.
- **Agent ping-pong and cost:** every delivered message starts a turn in each recipient. Handled by
  instructions, with Master as moderator; no board-enforced hop limit. Prompt caching keeps the
  re-read of each session cheap.
- **Codex MCP for `post_message`:** how app-server reaches a board-hosted tool is unverified.
- **Windows process trees:** kill the whole tree on interrupt/close/shutdown within 2 seconds.

## Notes

### 2026-10-18
- Epic created from discussion with the user. Phase 0 first; platform primitives are deliberately
  generic (any streaming board benefits), not agent-specific.
- CLI capability research delegated to a Sonnet web-research agent, because both CLIs change
  faster than training data; output goes to `EPIC-131-cli-research.md`.
- Research reviewed. Spot-checked locally: installed versions, the `codex app-server` subcommands
  including schema generation, and the SDK's bundled per-platform binaries on npm. Phase 1
  integration decisions recorded above.
- Added P0-C (private MCP endpoint, user request: in-app agents get Persephone MCP regardless of
  CLI config or the `mcp.enabled` switch) and P0-D (multi-line board settings, so per-provider
  instructions live in Settings → Editors).

### 2026-10-18 — Phase 0 implemented
- All four Phase 0 tasks implemented by Codex from reviewed plans, in the order US-1710 → US-1709 →
  US-1703 → US-1704, sharing one bridge bump to **1.42.0** (released in 5.0.13).
- Review fixes by Claude: blur-only save skips unchanged values; What's New wording; acks batched
  by a 10 ms tail timer instead of a per-message microtask; `openChannel()` open timeout (10 s);
  a deliberate `close()` reports `channel-closed`, not `service-exited`.
- Plan-review decisions worth keeping: MCP tokens outlive idle transports (only revoke, service
  exit/untrust/`appScripting` loss and quit end them), up to 4 transports per token; channel flow
  control is by message count (256 in flight) because board frames have no Node to measure bytes;
  consumers need only their trusted `uses` grant (no `service`), and any non-empty `uses` is shown
  as Full access; caller ids never expose filesystem paths (`local:<sha256>` fallback).
- **Verified live** with two throwaway boards (provider with `serviceInterfaces`, `appScripting`
  and a multiline setting; consumer with only `uses`): same-board channel echo + 1000 ordered
  messages with backpressure waits; cross-board list/connect + 2000 ordered messages, caller and
  interface `info`; undeclared interface and missing `service` refused; private MCP endpoint 401
  without/with a bad token, initialize/tools/list/`call` 200 with the token, 401 after revoke;
  multiline setting renders as a textarea and persists on blur only. Trust dialogs show provider
  interfaces and the consumer's Full-access `uses` grant.
- Not verified live: channel close on service crash/restart, untrust while channels are open,
  `appScripting` loss revoking tokens, MCP status indicator counts with an in-app session.

### 2026-10-25 — Codex as a second engine, not a second board
- User raised the double-maintenance cost of a separate `codex-agent` board. Decided: refactor
  `claude-agent` behind a provider adapter interface plus capability flags (BT-048, no behavior
  change, worth doing even if Codex slips because it removes the UI ↔ native-message leaks), add
  the Codex adapter over `codex app-server` (BT-049), then rename the board (BT-050).
- Open: the new board name (must not contain "Claude Code"), and whether the rename keeps the
  `claude-agent` id or ships a new id and retires the old one.

### 2026-10-25 — BT-048 / BT-049 done; rename decided
- BT-048 (adapter refactor) and BT-049 (Codex engine over `codex app-server` 0.163.0, board 1.1.0)
  implemented and tested by the user; committed on persephone-boards `develop`, not yet released.
- BT-050: the board is renamed **Agent Chat** and keeps the `claude-agent` id (user decision), so
  existing installs update in place and nothing needs migrating.

### 2026-10-25 — Phase 2 redesigned as group chat inside Agent Chat
- User proposal, refined in discussion: no separate team-chat board (it would duplicate the chat UI
  and session handling). Replaces the earlier chief-routing design (structured `{ next, task }`
  decisions, one writer, per-turn diffs).
- Decided with the user: editable board-level roles; **+ Invite agent** with a prefilled unique
  name; invited agents post through a board MCP tool; the board stamps a parsable author header on
  every delivered message; all visible messages go in full to all participants (tool traffic
  never); the main transcript is the shared timeline; ping-pong handled by instructions, tested
  before adding a hop limit; read-only role preset by default; user-only invites; a group chat's
  sidebar row shows a group icon in place of the engine icon.
- Every agent knows its name and position. The main agent is **Master** by default and answers
  the user unless the user names another agent; joined agents help per their role and answer only
  when called by name. Anyone can address Master by name.
- The naming and group rules are core instructions: always injected through the non-editable
  layer-1 preamble of every session, solo chats included, separate from the user's editable
  instructions.
- Each role has two texts: full agent instructions (layer 3 for the joined agent) and a short
  summary for the chat, delivered with the join notice (collapsed in the UI, full in the message)
  so Master knows each agent's role and can delegate to it by name.

### 2026-10-25 — BT-051 done; agent profiles for BT-052
- BT-051 (group chat core) implemented by Codex, user-tested, fixes by Claude: history bubbles take
  their kind from the author header; Master replies `[[pass]]` (dropped by the service) when it has
  nothing to add; acknowledgements forbidden. Committed on persephone-boards `develop` (board 1.2.0,
  unreleased).
- User decision: inviting must be one click. Roles become fully preconfigured agent profiles
  (name, role title, instructions, summary, engine/model alias, effort, permissions); the invite
  form and name pool are replaced by a menu. Four shipped profiles on Claude · Opus · medium ·
  read-only. Duplicates in one chat are greyed out. BT-052 also starts Master when inviting into an
  idle chat.
- Owner decision after a live three-agent discussion that recommended a hop limit: no hop limit.
  Master moderates loops and repetition and tells agents by name to stop; joined agents follow
  Master's instructions right after the user's (`GROUP_CORE` in service.mjs).
