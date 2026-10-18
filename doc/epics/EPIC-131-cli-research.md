# EPIC-131 research: programmatic control of Claude Code and Codex CLI

Researched 2026-10-18. Local versions observed: Claude Code `2.1.302`, Codex CLI `codex-cli 0.163.0`.
npm (checked 2026-10-18 via `npm view`): `@anthropic-ai/claude-agent-sdk` `0.3.302`, `@openai/codex-sdk` `0.163.0`, `@openai/codex` `0.163.0`.
Citations: `[local]` = output of the local `--help` / generated schema / local `%USERPROFILE%\.codex` cache; otherwise a URL. Anything not verified is marked UNVERIFIED.

Doc hosts: Claude docs are at `https://code.claude.com/docs/en/...`. OpenAI Codex docs have moved to `https://learn.chatgpt.com/docs/...` (the old `developers.openai.com/codex/...` URLs return a 308 redirect there). Index: https://learn.chatgpt.com/llms.txt and https://code.claude.com/docs/llms.txt.

---

## 1. Claude Code

### 1.1 Programmatic interfaces and what is recommended

| Interface | Notes |
|---|---|
| Agent SDK, TypeScript: `@anthropic-ai/claude-agent-sdk` (`npm install @anthropic-ai/claude-agent-sdk`) | Current npm version 0.3.302 [local npm]. Version tracks the bundled Claude Code version (docs example: SDK v0.3.191 bundles Claude Code v2.1.191) — https://code.claude.com/docs/en/agent-sdk/typescript. Docs call it "A library that runs the Claude Code binary" — https://code.claude.com/docs/en/agent-sdk/overview. |
| Agent SDK, Python: `claude-agent-sdk` | Same capabilities; not needed for a Node host. |
| CLI `claude -p` with `--input-format stream-json --output-format stream-json` | Documented as the route for "a language other than Python or TypeScript" — https://code.claude.com/docs/en/agent-sdk/overview, https://code.claude.com/docs/en/headless. The flags exist locally [local `claude --help`]. |
| Background sessions: `claude --bg`, `claude agents`, `claude attach/logs/stop/rm/respawn` | Present in local help [local]. These are for terminal use; no documented host protocol was found (UNVERIFIED whether a socket API exists). `--bg` is rejected with `-p` (headless doc). |
| Remote Control / cloud sessions (`--remote-control`, `--cloud`) | Anthropic-hosted; out of scope for a local host. |

**Recommended:** the Agent SDK (TypeScript) is Anthropic's documented path for embedding Claude Code in a Node process. The SDK exposes `query()` returning a `Query` (an `AsyncGenerator<SDKMessage>`) with `interrupt()`, `setModel()`, `setPermissionMode()`, `streamInput()`, `close()` — https://code.claude.com/docs/en/agent-sdk/typescript.

**Does the SDK bundle its own binary or spawn the installed `claude`?**
- It bundles one per platform. The npm package declares optional dependencies `@anthropic-ai/claude-agent-sdk-win32-x64`, `-win32-arm64`, `-darwin-*`, `-linux-*` (all `0.3.302`) [local `npm view @anthropic-ai/claude-agent-sdk optionalDependencies`]. The docs say `pathToClaudeCodeExecutable` is "Needed only if optional dependencies were skipped" — https://code.claude.com/docs/en/agent-sdk/typescript. So by default it spawns its own bundled binary, not the user's installed `claude.exe`. To use the installed one, pass `pathToClaudeCodeExecutable`. Behaviour of mixing an older/newer installed CLI with an SDK version is UNVERIFIED.
- The bundled binary reads the same `%USERPROFILE%\.claude` config (settings, sessions, credentials) as the installed CLI: the SDK "load[s] automatically from your project's `.claude/` and from `~/.claude/`, same as Claude Code" — https://code.claude.com/docs/en/agent-sdk/overview; `settingSources` defaults to all, `[]` disables filesystem settings — typescript reference.
- `startup()` / `prewarm()` (alpha, v0.3.282+) pre-spawn the process for faster first-token — typescript reference.
- The V2 session API (`createSession()`) was removed in SDK 0.3.142 — https://code.claude.com/docs/en/agent-sdk/sessions. Do not build on it.

**Auth with a subscription login:**
- Credentials on Windows live in `%USERPROFILE%\.claude\.credentials.json` (or under `CLAUDE_CONFIG_DIR`) — https://code.claude.com/docs/en/authentication.
- Precedence in the CLI: cloud-provider vars, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` (in `-p` mode "the key is always used when present"), `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, one-year token, "authenticates with your Claude subscription"), profiles, then subscription OAuth from `/login` — same page. Hence a host must strip `ANTHROPIC_API_KEY` from the child env if it wants subscription auth.
- `--bare` mode never reads OAuth/keychain: "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper" [local `--help`], https://code.claude.com/docs/en/headless. Do not use `--bare` if the goal is subscription login.
- Whether this use is permitted is a policy question, see section 3.

### 1.2 Session lifecycle

- **Start:** `query({ prompt, options })`. Single-shot (string prompt) or streaming-input mode (`AsyncIterable<SDKUserMessage>`) for a long-lived multi-turn process. `interrupt()`, `setModel()`, `setPermissionMode()` are "streaming input mode only" — typescript reference.
- **Multi-turn on one live process:** use streaming input (`prompt` as async iterable, or `Query.streamInput()`). CLI equivalent: `claude -p --input-format stream-json --output-format stream-json --verbose`; user messages are `{"type":"user","message":{"role":"user","content":"..."}}` (shape shown in https://code.claude.com/docs/en/agent-sdk/user-input). Docs recommend streaming input for chat UIs — user-input page, "Streaming input" section.
- **Resume per turn is also supported:** `options.resume = sessionId` or `continue: true` (most recent in cwd) — https://code.claude.com/docs/en/agent-sdk/sessions. TypeScript has no session-holding client object like Python's `ClaudeSDKClient`; for in-process multi-turn use streaming input.
- **Session id:** on every `result` message as `session_id`; in TS also on the init `system` message (`message.type === "system" && subtype === "init"`) — sessions page. CLI: `--session-id <uuid>` lets the host choose the id [local `--help`]; `--name` sets a display name.
- **Storage:** `%USERPROFILE%\.claude\projects\<encoded-cwd>\<session-id>.jsonl` (cwd encoded by replacing every non-alphanumeric char with `-`; names over 200 chars are truncated plus hash); `CLAUDE_CONFIG_DIR` relocates it — sessions page. Subagent transcripts are separate files. Resume works from any cwd on the same machine (lookup beyond current project dir since v2.1.223). Cross-host: `sessionStore` adapter (https://code.claude.com/docs/en/agent-sdk/session-storage, not read in detail).
- **Resume after process restart:** supported (`resume: id`). The restarted turn is not auto-continued unless `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` — headless page.
- **Fork:** `options.forkSession: true` with `resume`; `forkSession(sessionId, { upToMessageId?, title? })` function; CLI `--fork-session` — sessions page, typescript reference, [local `--help`]. Forking does not branch the filesystem.
- **Helper functions:** `listSessions`, `getSessionMessages`, `getSessionInfo`, `renameSession`, `tagSession`, `forkSession` — typescript reference.
- **Interrupt/cancel:** `Query.interrupt()` (streaming input mode); returns an interrupt receipt on newer CLIs; the init message `capabilities` array can contain `interrupt_receipt_v1`, `interrupt_cancel_queued_v1` for feature detection — typescript reference, headless page. For the raw CLI, SIGINT ends the turn; SIGTERM exits with code 143 and "records no result for" the turn — https://code.claude.com/docs/en/headless ("Stop a run with SIGTERM"). Windows signal semantics are UNVERIFIED; prefer the stream-json control protocol / `interrupt()` over signals on Windows.
- **Clean shutdown:** `Query.close()` "Terminates the process and cleans up resources". If the host ends the SDK input first, Claude Code cancels any pending permission prompt — headless page. On SIGTERM Claude Code kills the process tree of running Bash commands and runs `SessionEnd` hooks — headless page.
- **Persistence off:** TS `persistSession: false`; CLI `--no-session-persistence` (print mode only).

### 1.3 Streaming event model

Enable token streaming with `includePartialMessages: true` (CLI: `--output-format stream-json --verbose --include-partial-messages`) — https://code.claude.com/docs/en/agent-sdk/streaming-output.

`SDKMessage` union members (names exact, from https://code.claude.com/docs/en/agent-sdk/typescript): `SDKAssistantMessage`, `SDKUserMessage`, `SDKUserMessageReplay`, `SDKResultMessage`, `SDKSystemMessage`, `SDKPartialAssistantMessage`, `SDKCompactBoundaryMessage`, `SDKStatusMessage`, `SDKLocalCommandOutputMessage`, `SDKHookStartedMessage`, `SDKHookProgressMessage`, `SDKHookResponseMessage`, `SDKPluginInstallMessage`, `SDKToolProgressMessage`, `SDKAuthStatusMessage`, `SDKTaskNotificationMessage`, `SDKTaskStartedMessage`, `SDKTaskProgressMessage`, `SDKTaskUpdatedMessage`, `SDKBackgroundTasksChangedMessage`, `SDKThinkingTokensMessage`, `SDKSessionStateChangedMessage`, `SDKWorkerShuttingDownMessage`, `SDKCommandsChangedMessage`, `SDKNotificationMessage`, `SDKFilesPersistedEvent`, `SDKToolUseSummaryMessage`, `SDKMemoryRecallMessage`, `SDKRateLimitEvent`, `SDKElicitationCompleteMessage`, `SDKPermissionDeniedMessage`, `SDKPromptSuggestionMessage`, `SDKAPIRetryMessage`, `SDKMirrorErrorMessage`, `SDKInformationalMessage`, `SDKConversationResetMessage`.

Wire-level `type` values seen in docs: `system` (subtypes `init`, `api_retry`, `plugin_install`, `compact_boundary`, `status`, `hook_*`), `assistant`, `user`, `result`, `stream_event`.

| Need | Message / event |
|---|---|
| Text deltas | `{type:"stream_event", event:{type:"content_block_delta", delta:{type:"text_delta", text}}}` |
| Thinking deltas | same envelope; delta type for thinking is a raw Claude API event (the docs name "text or thinking blocks" and cut-off handling; the delta type string `thinking_delta` is from the Anthropic streaming API, not shown on the Agent SDK page — UNVERIFIED on this page). Also `SDKThinkingTokensMessage`. |
| Tool call start | `content_block_start` with `content_block.type === "tool_use"` (`name`), then `content_block_delta` with `delta.type === "input_json_delta"` (`partial_json`), then `content_block_stop` |
| Complete blocks | `SDKAssistantMessage` per completed content block (text block or `tool_use` block); `message.message.id` shared across blocks of one API message |
| Tool results | `SDKUserMessage` containing `tool_result` blocks; `SDKToolProgressMessage` for progress; `SDKToolUseSummaryMessage` |
| File edits | Edit/Write `tool_use` blocks (`input.file_path`, `old_string`, `new_string`, `content`), `SDKFilesPersistedEvent`; checkpoint/rewind via `enableFileCheckpointing` + `Query.rewindFiles()` |
| Usage / cost | `SDKResultMessage` carries `total_cost_usd` and usage (client-side estimate, "can differ from your actual bill") — https://code.claude.com/docs/en/headless; `message_delta` stream event carries per-message usage; `SDKRateLimitEvent` |
| Turn completion | `SDKResultMessage` (`type:"result"`, `subtype` e.g. `success`, `error_max_turns`, `error_max_budget_usd`; `session_id`, `result`, `structured_output`, `permission_denials`) |
| Errors/retries | `system/api_retry` (fields `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error` category) ; error result subtypes; single-shot `query()` throws after yielding an error result |
| Session state | `SDKSessionStateChangedMessage`, `SDKStatusMessage` (carries `permissionMode`) |
| Subagent attribution | `parent_tool_use_id` on assistant/user messages; TS also `agent_id` (v0.3.292+). Token-level `stream_event` is emitted for the main session only — streaming-output page. `--forward-subagent-text` forwards subagent text/thinking blocks (CLI v2.1.211+) |

Ordering: `message_start` -> `content_block_start` -> `content_block_delta`* -> `AssistantMessage` -> `content_block_stop` -> ... -> `message_delta` -> `message_stop` -> (tool runs) -> ... -> `ResultMessage` — streaming-output page. If a stream is cut (interrupt), `message_stop` still arrives; a cut tool call gets no `content_block_stop`.

### 1.4 Permissions and approvals

- **Permission modes** (TS `PermissionMode`): `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto` — typescript reference. CLI `--permission-mode` choices: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan` [local `--help`] (note CLI lists `manual`, the SDK doc lists `default`; mapping UNVERIFIED).
- **Default mode warning:** if `permissionMode` is unset, the starting mode is chosen by settings or may be `auto`; "Before TypeScript Agent SDK v0.3.286, omitting `permissionMode` was the same as passing `default`." Pass the mode explicitly — https://code.claude.com/docs/en/agent-sdk/permissions.
- **Evaluation order:** hooks -> deny rules -> ask rules -> permission mode -> allow rules -> `canUseTool` — permissions page.
- **Host interception:** `options.canUseTool(toolName, input, { signal, suggestions, ... })` returns `{behavior:"allow", updatedInput, updatedPermissions?}` or `{behavior:"deny", message}`. It also receives `AskUserQuestion` (input `questions[]`; answer by returning `updatedInput:{questions, answers}`). The callback "can stay pending indefinitely". Not available inside subagents for `AskUserQuestion` — https://code.claude.com/docs/en/agent-sdk/user-input.
- **Gotcha:** tools approved earlier (allow rules, `acceptEdits`, `bypassPermissions`) never reach `canUseTool`; the SDK emits process warning `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` for those configs. For checks on every call use a `PreToolUse` hook — permissions page.
- **CLI equivalent:** `--permission-prompt-tool <mcp tool>` and `--permission-prompts host|none` (v2.1.259+) [local `--help`], headless page. The wire format of the stdio control protocol (`control_request`/`control_response`) used by the SDK to call `canUseTool` is not documented on the pages read: UNVERIFIED. Using the SDK avoids needing it.
- **Unattended:** `--permission-prompts none` / TS `permissionPrompts: 'none'` denies anything that would prompt.
- **Deferral:** a `PreToolUse` hook may return a `defer` decision so the process can exit and resume later from the persisted session — user-input page.
- **Sandboxing:** Claude Code's own sandbox is "Not supported" on native Windows (supported in WSL 2) — https://code.claude.com/docs/en/setup (table "Set up on Windows"). So on native Windows, isolation relies on permissions/modes only.

### 1.5 Per-session configuration (SDK `Options`; CLI flag in brackets)

- **Model:** `model` (alias or full id) [`--model`]. Aliases: `default`, `best`, `fable`, `opus`, `sonnet`, `haiku`, `opus[1m]`, `sonnet[1m]`, `opusplan`. As of this research on the Anthropic API: `opus` = Opus 5.5, `sonnet` = Sonnet 5.5, `haiku` = Haiku 5.5, `fable` = Fable 5.1; pin with a full id such as `claude-opus-5-5` — https://code.claude.com/docs/en/model-config. The local `claude --help` text mentions `'fable'`, `'opus'`, `'sonnet'` [local]. `--fallback-model` available [local].
- **Reasoning effort:** `effort: 'low'|'medium'|'high'|'xhigh'|'max'` [`--effort`]; default `medium` on Opus 5.5/Sonnet 5.5/Haiku 5.5 — model-config page.
- **System prompt:** `systemPrompt`: string, or `{type:'custom', prompt}`, or `{type:'preset', preset:'claude_code', append?, excludeDynamicSections?}`. Default (no `systemPrompt`) is a minimal prompt in the SDK — typescript reference. CLI: `--system-prompt`, `--append-system-prompt`, `--exclude-dynamic-system-prompt-sections` [local]. `--system-prompt-snapshot on` (default) freezes the prompt at the conversation's first request and reuses it on every resume, "even when a later launch passes different text" [local `--help`] — important for a host that changes the prompt between turns.
- **cwd:** `cwd`; additional dirs `additionalDirectories` [`--add-dir`]; `--worktree`.
- **MCP injection:** `mcpServers: Record<string, McpServerConfig>` (stdio, SSE, HTTP, or in-process SDK server via custom tools) [`--mcp-config`, `--strict-mcp-config`]; runtime `setMcpServers`, `toggleMcpServer`, `mcpServerStatus` — typescript reference, https://code.claude.com/docs/en/agent-sdk/mcp (not read in detail).
- **Tools:** `allowedTools` (auto-approve, "Doesn't restrict Claude to these"), `disallowedTools` (a bare name removes the tool; scoped rules like `Bash(rm *)` deny matching calls), `tools` (restrict built-in set; `""` disables all) [`--allowedTools`, `--disallowedTools`, `--tools`].
- **Limits:** `maxTurns`, `maxBudgetUsd` (client-side estimate; ends the query with `error_max_budget_usd`) [`--max-budget-usd`, print only].
- **Env:** `env` replaces the child environment in the TS SDK ("spread `process.env`") — typescript reference.
- **Isolation of host config:** `settingSources: []` (skip user/project/local settings), CLI `--safe-mode`, `--restricted`, `--setting-sources`. Caveat: `claude -p` runs hooks from project `.claude/settings.json` and connects project `.mcp.json` servers "even in a folder you've never trusted" unless isolated — headless page.
- **Structured output:** `--json-schema` / `outputFormat`; result in `structured_output`.
- **Other useful flags** [local `--help`]: `--include-hook-events`, `--replay-user-messages` (echo stdin user messages back for ack), `--prompt-suggestions`, `--agents <json>`, `--plugin-dir`, `--betas` (API-key users only).

### 1.6 Subagents and multi-agent

- **Subagents (stable):** defined via `options.agents` (`AgentDefinition`: `description`, `prompt`, `tools`, `disallowedTools`, `model`, `skills`, `mcpServers`, `maxTurns`, `background`, `effort`, `permissionMode`, ...) or `.claude/agents/*.md`; invoked by the model through the `Agent` tool (appears as `Task` in the init tool list; match both names). Subagents can nest (default depth 3, concurrency 20; caps via `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `maxBudgetUsd`). Subagents run in the background by default. A built-in `general-purpose` subagent is always available unless `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1` — https://code.claude.com/docs/en/agent-sdk/subagents.
- **Overlap with a host-orchestrated team chat:** a host that wants strict control should disable the built-in delegation (`disallowedTools: ["Agent"]` removes the tool definition, per the "bare name removes the tool" rule) so the chief does not silently spawn its own workers. UNVERIFIED that the exact tool name to deny is `Agent` in all versions (docs say `Agent`; older `Task`).
- **Agent teams (experimental):** gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; one lead plus teammates, shared task list, mailboxes under `%USERPROFILE%\.claude\teams`. "In non-interactive mode with the `-p` flag, including Agent SDK sessions, Claude doesn't spawn teammates" — https://code.claude.com/docs/en/agent-teams. So agent teams are not usable from a Node host; no overlap risk in SDK sessions. Split panes are unsupported in Windows Terminal.
- **Dynamic workflows:** `Workflow` tool (TS SDK v0.3.149+) for large scripted fan-out — subagents page; not needed.
- Opus 5 "delegates to subagents more readily"; with the `claude_code` preset Claude Code adds a line telling it not to call Agent unless asked; with a custom prompt that line is absent — subagents page, section "Run Opus 5 with subagents".

### 1.7 Windows specifics

- Native Windows install supported (Windows 10 1809+). Git for Windows optional: with it the Bash tool uses Git Bash (path override `CLAUDE_CODE_GIT_BASH_PATH`), without it Claude Code uses the PowerShell tool; PowerShell tool also available alongside Bash — https://code.claude.com/docs/en/setup.
- Installed binary location (native installer): `%USERPROFILE%\.local\bin\claude.exe` [local `where claude`]; native installs auto-update in the background (setup page) so the installed CLI version can drift from the SDK's bundled one.
- Windows sandboxing not supported natively (setup page).
- Known issues (user-filed reports, not official; unverified fixes) — https://claudeissues.com/platform/windows-bash and issues such as https://claudeissues.com/issue/76353-bash-tool-leaks-orphaned-child-processes-on-windows-timeout-runaway-ind-scans-ac and https://claudeissues.com/issue/68799-windows-orphaned-worktree-agent-processes-hold-directory-lock-after-session-ends : Bash-tool grandchildren orphaned after timeouts or abnormal parent death, because Windows has no cascading kill. A host should own a Windows Job Object (kill-on-close) or run `taskkill /T /F` on the child tree at shutdown. UNVERIFIED which of these are fixed in 2.1.302.
- Docs: unreadable stdin on Windows crashed `claude -p` before v2.1.211 — https://code.claude.com/docs/en/headless.
- Binary is a native executable, not Node: "The installed `claude` binary does not itself invoke Node" — setup page.

---

## 2. OpenAI Codex CLI

### 2.1 Programmatic interfaces and what is recommended

| Interface | Notes |
|---|---|
| `codex app-server` (JSON-RPC 2.0 over stdio JSONL by default; also WebSocket, Unix socket) | Documented as the interface for custom clients that "handle authentication, conversation history, approvals, and streamed agent events" — https://learn.chatgpt.com/docs/codex-sdk.md, https://learn.chatgpt.com/docs/app-server. Marked `[experimental]` in local help [local `codex --help`]. **Recommended for a rich chat host.** |
| `codex exec --json` / `codex exec resume` / `codex exec fork` | JSONL events on stdout; one process per turn; non-interactive — https://learn.chatgpt.com/docs/non-interactive-mode.md, [local `codex exec --help`]. |
| Codex SDK, TypeScript: `@openai/codex-sdk` (0.163.0, Node 18+) | "wraps the `codex` CLI from `@openai/codex`. It spawns the CLI and exchanges JSONL events over stdin/stdout" (i.e. the `exec` JSONL path, not app-server) — https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/README.md. API: `new Codex(opts)`, `startThread()`, `resumeThread(id)`, `thread.run()`, `thread.runStreamed()`. Depends on `@openai/codex` [local npm]. Approval callbacks are not exposed on this path (UNVERIFIED; README does not document them). |
| Codex SDK, Python: `openai-codex` | "controls the local Codex app-server over JSON-RPC", ships a pinned CLI runtime — https://learn.chatgpt.com/docs/codex-sdk.md. |
| `codex mcp-server` | **Removed.** Release notes for rust-v0.154.0 (published 2026-09-09): "The deprecated `codex mcp-server` entry point is no longer available. (#42993)" — `gh api repos/openai/codex/releases/tags/rust-v0.154.0`. Docs: "The `codex mcp-server` command and standalone `codex-mcp-server` binary have been removed." — https://learn.chatgpt.com/docs/codex-sdk.md. Confirmed: absent from local `codex --help` [local]. |
| `codex exec-server`, `codex remote-control`, `codex agents`, `codex queue` | In local help [local]. `codex queue --thread <uuid|name> --message <text>` queues a message for an existing session [local]. Not documented for host use; UNVERIFIED. |

**Recommendation among them:** app-server for a multi-turn chat with live approvals, streaming deltas, interrupt and steer; `exec --json` only for fire-and-forget workers.

### 2.2 app-server protocol (verified from local generated schema and docs)

Schema generation (works offline, no tokens): `codex app-server generate-ts --out <dir>` and `codex app-server generate-json-schema --out <dir>` [local `codex app-server --help`], https://learn.chatgpt.com/docs/app-server ("Output matches the installed Codex version"). I ran `generate-json-schema` locally with 0.163.0; the lists below are read from that output (`ClientRequest.json`, `ServerNotification.json`, `ServerRequest.json`, `codex_app_server_protocol.v2.schemas.json`). A host should generate the schema at build time, pin to the installed CLI version, and tolerate unknown fields.

**Transports:** `--listen stdio://` (default; newline-delimited JSON), `ws://IP:PORT` (experimental, unsupported), `unix://[PATH]`, `off`; `--ws-auth capability-token|signed-bearer-token` [local help]; WebSocket serves `GET /readyz` and `/healthz`, rejects requests with an `Origin` header (403) — app-server doc. Overload error code `-32001`, retry with backoff.
**Daemon:** `codex app-server daemon {bootstrap,start,restart,update,enable-remote-control,disable-remote-control,stop,version}` [local help] — "Windows sessions can now share a background Codex server, with daemon lifecycle commands and managed updates" (0.154.0 notes). The daemon control socket and lock files exist locally under `%USERPROFILE%\.codex\app-server-control` and `app-server-daemon` [local]. A host spawning its own `codex app-server` over stdio does not need the daemon.

**Handshake:** send `initialize` once per connection with `clientInfo {name, title, version}` and optional `capabilities` (`experimentalApi`, `optOutNotificationMethods`, `requestAttestation`, `mcpServerOpenaiFormElicitation`), then notify `initialized`. Errors `Not initialized`, `Already initialized`. `clientInfo.name` is used for OpenAI's Compliance Logs Platform; enterprise integrations "should contact OpenAI to be added to the known clients list" — app-server doc.

**Client requests (selected, exact names from schema):**
`initialize`, `thread/start`, `thread/resume`, `thread/fork`, `thread/list`, `thread/loaded/list`, `thread/read`, `thread/turns/list`, `thread/items/list`, `thread/name/set`, `thread/archive`, `thread/unarchive`, `thread/delete`, `thread/unsubscribe`, `thread/compact/start`, `thread/revert`, `thread/inject_items`, `thread/shellCommand`, `thread/goal/{set,get,clear}`, `thread/metadata/update`, `turn/start`, `turn/steer`, `turn/interrupt`, `review/start`, `model/list`, `config/read`, `config/value/write`, `config/batchWrite`, `config/mcpServer/reload`, `mcpServerStatus/list`, `mcpServer/tool/call`, `account/read`, `account/login/start`, `account/login/cancel`, `account/logout`, `account/rateLimits/read`, `account/usage/read`, `command/exec`, `fs/*`, `skills/list`, `plugin/*`, `windowsSandbox/setupStart`, `windowsSandbox/readiness`.

**Per-thread parameters** (from `ThreadStartParams` schema): `approvalPolicy`, `approvalsReviewer`, `baseInstructions`, `config` (free-form config overrides, same keys as `config.toml`), `cwd`, `developerInstructions`, `ephemeral`, `model`, `modelProvider`, `personality`, `sandbox`, `serviceName`, `serviceTier`, `sessionStartSource`, `threadSource`. `ThreadResumeParams` adds `threadId`, `excludeTurns`; `ThreadForkParams` adds `threadId`, `lastTurnId`, `excludeTurns`.
**Per-turn overrides** (`TurnStartParams`): `threadId`, `input`, `model`, `effort`, `cwd`, `approvalPolicy`, `sandboxPolicy`, `summary`, `personality`, `outputSchema`, `serviceTier`, `approvalsReviewer`, `toolOutput`, `clientUserMessageId`, `parentTurnId`, `rootTurnId`, `turnTrigger`, `disabledPluginIds`. `turn/steer` takes `threadId`, `expectedTurnId`, `input` (no overrides). `turn/interrupt` takes `threadId`, `turnId`.
**Input items:** `text`, `image` (url), `localImage` (path), `skill` — app-server doc.
**Enums:** `AskForApproval` = `untrusted | on-request | never` or `{granular:{mcp_elicitations, request_permissions, rules, sandbox_approval, skill_approval}}`. `SandboxMode` = `read-only | workspace-write | danger-full-access`. `sandboxPolicy` types: `readOnly`, `workspaceWrite`, `dangerFullAccess`, `externalSandbox` — app-server doc. `TurnStatus` = `completed | interrupted | failed | inProgress`. `ReasoningEffort` is an open string "advertised by the model" (schema). `on-failure` is not in the 0.163.0 enum.

**Server notifications relevant to a chat UI (exact):**
- Lifecycle: `thread/started`, `thread/status/changed`, `thread/closed`, `thread/name/updated`, `turn/started`, `turn/completed` (params `threadId`, `turn` with `status`, `error`, `durationMs`, `items`), `item/started`, `item/completed`, `serverRequest/resolved`, `error`, `warning`.
- Text/reasoning: `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, `item/reasoning/textDelta`, `item/plan/delta`, `turn/plan/updated`.
- Commands/files: `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/outputDelta` (deprecated per doc), `item/fileChange/patchUpdated`, `turn/diff/updated`, `item/mcpToolCall/progress`.
- Usage/limits: `thread/tokenUsage/updated` (params `threadId`, `turnId`, `tokenUsage`; breakdown fields `inputTokens`, `cachedInputTokens`, `cacheWriteInputTokens`, `outputTokens`, `reasoningOutputTokens`, `totalTokens`), `account/rateLimits/updated`.
- Other: `model/rerouted`, `thread/compacted`, `mcpServer/startupStatus/updated`, `account/updated`, `windows/worldWritableWarning`, `windowsSandbox/setupCompleted`, `deprecationNotice`, `configWarning`.
- `ThreadItem` types (schema): `userMessage`, `hookPrompt`, `agentMessage`, `functionCallOutput`, `plan`, `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `subAgentActivity`, `webSearch`, `imageView`, `sleep`, `imageGeneration`, `enteredReviewMode`, `exitedReviewMode`, `contextCompaction`.
- Errors: `error` notification `{error:{message, codexErrorInfo?, additionalDetails?}}` and the turn then finishes `status:"failed"`; upstream HTTP status in `codexErrorInfo.httpStatusCode` — app-server doc. Server-side thread statuses: `notLoaded`, `idle`, `systemError`, `active` (with `activeFlags` e.g. `waitingOnApproval`). Unsubscribed threads unload after a 30-minute grace period (configurable per 0.154.0 notes, #42320).

### 2.3 Session lifecycle (Codex)

- **Start:** `thread/start` (returns a thread id; `ephemeral: true` for no persistence), then `turn/start` per user message. One app-server process can hold many threads concurrently; many turns per thread on the same live process.
- **Resume after restart:** `thread/resume {threadId}` on a new process; `codex exec resume <SESSION_ID|--last> "<prompt>"` for exec — [local `codex exec resume --help`]. `thread/read`, `thread/turns/list` read history without resuming. Resume by thread name also accepted by CLI [local].
- **Storage:** `%USERPROFILE%\.codex\sessions\<yyyy>\<mm>\...` rollout files [local directory listing; also "Threads are stored in `~/.codex/sessions`" — TS SDK README]; plus sqlite state (`goals_1.sqlite`, `queue_1.sqlite`, `logs_2.sqlite`, `memories_1.sqlite`) and `history.jsonl` [local]. `codex migrate-rollouts` exists for legacy sessions [local]. `--ephemeral` skips persistence on exec [local].
- **Fork:** `thread/fork {threadId, lastTurnId?, ephemeral?}`; `codex exec fork`, `codex fork` [local].
- **Interrupt:** `turn/interrupt` -> turn completes with `status:"interrupted"`. `turn/steer` injects input into the running turn (needs `expectedTurnId`).
- **Shutdown:** close stdin / kill the child; exact graceful-shutdown behaviour of app-server on stdin EOF is UNVERIFIED. `thread/unsubscribe` releases a thread.
- `exec --json` events: `thread.started`, `turn.started`, `turn.completed` (with usage), `turn.failed`, `item.started`, `item.updated`, `item.completed`, `error`; item types `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `collab_tool_call`, `web_search`, `todo_list`, `error`; usage fields `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens` — https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/exec_events.rs (main branch, read 2026-10-18); event list confirmed by https://learn.chatgpt.com/docs/non-interactive-mode.md. Exec has no text-delta events (items are whole), so streaming UX needs app-server.

### 2.4 Permissions and approvals (Codex)

- **Sandbox:** `read-only`, `workspace-write`, `danger-full-access` [local `codex exec --help`]; "By default, `codex exec` runs in a read-only sandbox" — non-interactive doc. `--full-auto` "is no longer supported"; `--approve-for-me` "route[s] approval requests through automatic review using the workspace-write sandbox" [local help]; `--dangerously-bypass-approvals-and-sandbox` exists.
- **Approval policy** (app-server `approvalPolicy`): `untrusted`, `on-request`, `never`, or granular object (schema, above).
- **Host interception (app-server):** the server sends JSON-RPC *requests* (with `id`) to the client; the client replies with a result. Exact `ServerRequest` methods (schema): `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`, `item/tool/call` (dynamic tools), `account/chatgptAuthTokens/refresh`, `attestation/generate`, legacy `applyPatchApproval`, `execCommandApproval`.
  - Command approval params: `threadId`, `turnId`, `itemId`, `command`, `cwd`, `commandActions`, `reason`, `approvalId`, `proposedExecpolicyAmendment`, `proposedNetworkPolicyAmendments`, `networkApprovalContext`, `kind` (schema). Response decision values: `accept`, `acceptForSession`, `decline`, `cancel`, `{acceptWithExecpolicyAmendment:{execpolicy_amendment:[...]}}`, `{applyNetworkPolicyAmendment:{...}}` (schema + app-server doc).
  - File change approval params: `threadId`, `turnId`, `itemId`, `reason`, `grantRoot`; decisions `accept`, `acceptForSession`, `decline`, `cancel`.
  - Permissions request: respond with a granted-subset `permissions` object with `scope` `session` or `turn`. MCP elicitation: `action` `accept` (with `content`) / `decline` / `cancel`.
  - Pending requests are cleared by the `serverRequest/resolved` notification.
- **Automatic review ("guardian"):** `approvalsReviewer` thread param and `item/autoApprovalReview/*` notifications exist [local schema]; docs https://learn.chatgpt.com/docs/sandboxing/auto-review.md (not read). Value set for `approvalsReviewer` UNVERIFIED.
- **SDK/exec:** non-interactive runs cannot answer approvals; "In non-interactive flows, actions needing new approval fail" — https://learn.chatgpt.com/docs/agent-configuration/subagents.md. With exec the host must pick a sandbox mode up front.

### 2.5 Per-session configuration (Codex)

- **Model:** `model` on `thread/start` / `turn/start`, `-m` on exec. Locally cached model catalog (`%USERPROFILE%\.codex\models_cache.json`, read 2026-10-18) lists slugs with `visibility: list`: `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`; hidden: `gpt-reserve`, `codex-auto-review`. **`gpt-6-luna` exists in this install's catalog**; supported efforts for `gpt-6-luna`: `low, medium, high, xhigh, max` (default `medium`); `gpt-6-sol`/`gpt-6.1-sol`/`gpt-6-astra` additionally support `ultra` [local cache]. No official doc page naming `gpt-6-luna` was found in the changelog text fetched (UNVERIFIED in docs; verified locally). Official docs mention `gpt-6.1-sol` ("GPT-6.1 Sol must be available to your signed-in account", https://learn.chatgpt.com/docs/codex-sdk.md; changelog 2026-10-14 advises `gpt-6.1-sol` when GPT-5.5 retires). Use `model/list` over app-server for the authoritative per-account list. Model availability depends on plan.
- **Reasoning effort:** `effort` on `turn/start` (per turn); exec/config `model_reasoning_effort` (key name appears in custom-agent docs). For the exec path use `-c model_reasoning_effort="high"` [config override syntax from local help].
- **Instructions:** `developerInstructions` (extra developer-role instructions) and `baseInstructions` (replace base prompt) on `thread/start`; AGENTS.md in the repo is loaded as usual; `personality` option. Whether `baseInstructions` replaces or appends: UNVERIFIED (schema has the field only).
- **cwd:** `cwd` (thread and per turn); exec `-C/--cd`; `--add-dir`; `--worktree` [local help].
- **MCP injection:** via `config` overrides on `thread/start` (`config` is a free-form map of `config.toml` keys, so `mcp_servers.<name>...` is the likely route — UNVERIFIED); exec: `-c 'mcp_servers.x.command="..."'` TOML override [local `-c` help]; persistent: `codex mcp add/remove/list` [local]; `config/mcpServer/reload` request. Subagents inherit the parent's MCP servers (subagents doc). `--ignore-user-config` skips `config.toml` but keeps auth (`CODEX_HOME`) [local exec help]. `--ignore-rules` skips execpolicy rules.
- **Tools:** no per-session allow/deny tool list found; control is via sandbox + approval policy + execpolicy rules + `dynamicTools` on `thread/start` (host-supplied tools returned via `item/tool/call`, experimental) — app-server doc.
- **Limits:** no `max_turns` or USD budget parameter found (UNVERIFIED). Usage is reported (`thread/tokenUsage/updated`), and rate limits via `account/rateLimits/read`. Cost in USD is not reported by Codex; subscription plans draw on plan limits.
- **Profiles:** `-p/--profile` layers `$CODEX_HOME/<name>.config.toml` [local exec help].
- **Structured output:** `outputSchema` per turn (app-server) / `--output-schema` (exec); `-o` writes the last message to a file.
- **Strictness:** `--strict-config` errors on unknown `config.toml` fields [local].

### 2.6 Subagents and multi-agent (Codex)

- Subagents are enabled by default in current CLI/app/IDE releases; `[agents]` keys: `agents.enabled` (default true), `agents.max_concurrent_threads_per_session` (legacy alias `agents.max_threads`), `agents.interrupt_message`, `agents.default_subagent_model`, `agents.default_subagent_reasoning_effort`. Built-in agents `default`, `worker`, `explorer`; custom agents are TOML files in `~/.codex/agents/` or `.codex/agents/`. Subagents inherit sandbox and approval settings; "In non-interactive flows, actions needing new approval fail" — https://learn.chatgpt.com/docs/agent-configuration/subagents.md. Whether subagents run under `exec` / `app-server` is not stated in that page (UNVERIFIED), but the protocol has `collabAgentToolCall` and `subAgentActivity` thread items and exec has `collab_tool_call` (schema, exec_events.rs), so the events surface to hosts.
- Overlap risk: a Codex worker may spawn its own subagents and consume extra tokens/threads. Mitigation to evaluate: `-c agents.enabled=false` (config key documented; effect via `-c` UNVERIFIED but `-c` is a generic override [local help]).
- `max_depth` default and the name of the depth key: third-party sources say `agents.max_depth` default 1 (https://codex.danielvaughan.com/2026/05/06/codex-subagents-official-docs-reference-patterns-csv-batch/, not official, UNVERIFIED).
- Other multi-session features in local help: `codex agents` ("Browse all agent sessions on the shared local app-server daemon"), `thread/goal/*`, `agent_message_board` feature flag "under development" [local `codex features list`]. Not needed.

### 2.7 Windows specifics (Codex)

- Binary: `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` [local `where codex`] (the desktop-app-bundled CLI). npm `@openai/codex` is the other distribution. 0.162.0: "Publish a signed PowerShell installer with Windows releases"; "Restore ordinary drive-letter file access on Windows 10" — https://learn.chatgpt.com/docs/changelog.
- Native Windows sandbox, three implementations: MXC (recommended, needs specific Windows 11 capabilities, no admin setup), Elevated (needs admin-approved setup; `codex sandbox setup --elevated`), Unelevated (restricted token, weaker network isolation). Config `[windows] sandbox = "elevated"|"unelevated"`, `[features] prefer_mxc = true`. MXC limitation: "Remaining child processes stop when the foreground command exits". Error 1385 = logon type denied — https://learn.chatgpt.com/docs/windows/windows-sandbox.md. Diagnostics at `CODEX_HOME/.sandbox/sandbox.log`. `codex sandbox uninstall` removes legacy machine-wide sandbox accounts and rules [local help].
- App-server over stdio is a plain child process; 0.154.0 notes "Harden Windows control socket rendezvous" (#42326) for the daemon path.
- Process tree/orphan behaviour of `codex.exe` on host termination: UNVERIFIED. Own it with a Job Object or `taskkill /T`.
- `codex doctor` diagnoses install, config, auth, runtime [local help]. `codex login status` printed `Logged in using ChatGPT` [local].

---

## 3. Terms and policy (quoted, no speculation)

### 3.1 Anthropic

Source: https://code.claude.com/docs/en/legal-and-compliance (fetched 2026-10-18; no revision date shown on the page).

Quotes:
- "**OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "**Developers** building products or services that interact with Claude's capabilities, including those using the [Agent SDK], should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above."
- Embedding conditions: "The Claude Code binary must not be modified... Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential."
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
- Agent SDK overview note: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead." — https://code.claude.com/docs/en/agent-sdk/overview
- Branding: "Claude Code" or "Claude Code Agent" is not permitted as the name of an SDK-built agent; "Claude Agent" is allowed — same overview page. The legal page also forbids using the Claude Code or Anthropic names or logos "as part of your own product, feature, or company name".
- SDK terms: governed by Commercial Terms of Service — overview page.

Factual reading, without a conclusion: the pages draw the line at a third party offering Claude.ai login / routing requests through plan credentials *on behalf of its users*, and at collecting or intermediating Claude.ai credentials or session tokens. They do not address in so many words a local app the user installs that launches the user's own already-logged-in binary. Whether the Persephone design (user's own machine, user's own login stored by Claude Code, Persephone never reading the credential file) falls inside or outside is not stated; the contact route named by Anthropic is sales ("For questions about permitted authentication methods for your use case, please contact sales"). The Agent SDK note says "Unless previously approved", which implies approval is possible. Treat as an open question for the product owner.

### 3.2 OpenAI

- Auth page (https://learn.chatgpt.com/docs/auth, fetched 2026-10-18): "Codex supports two ways for a person to sign in when using OpenAI models" — ChatGPT sign-in (subscription access) or API key (usage-based). Credentials cached "in a plaintext file at `~/.codex/auth.json` or in your OS credential store" (`cli_auth_credentials_store`: `file|keyring|auto|ephemeral`). For automation: API keys "still the recommended default for automation"; ChatGPT-managed auth in CI is an "advanced" option "for trusted runners", not for public or open-source repos (non-interactive doc, https://learn.chatgpt.com/docs/non-interactive-mode.md). The auth page does not address third-party apps driving the CLI with a subscription login.
- App-server page: auth methods exposed to clients: `account/login/start` types `apiKey`, `chatgpt`, `chatgptDeviceCode`, `chatgptAuthTokens` (experimental); `account/read`; `account/rateLimits/read` — https://learn.chatgpt.com/docs/app-server. Enterprise clients are asked to contact OpenAI to be added to the known-clients list (`clientInfo.name`).
- "Sign in with ChatGPT" product page (https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md): "In supported apps, eligible ChatGPT Plus and Pro subscribers can also choose to use their ChatGPT plan for AI requests." It "uses your Codex / ChatGPT work usage included in your plan." Listed apps with plan usage include Amp Code, Conductor, Devin, Kilo Code, Notion, Vercel, Warp and others; "Signing in and using your plan are separate permissions"; "App usage counts toward your existing plan limits." This is a separate OAuth-style product for apps; it is not documented as the mechanism by which a locally installed `codex.exe` login is reused by a host. No OpenAI page found that either permits or prohibits a host app from spawning the user's own `codex` binary with the user's stored ChatGPT login. No OpenAI Terms page text on this topic was found (the docs index has no "Terms" page). Marked UNVERIFIED; the OpenAI Services Agreement / Terms of Use were not fetched in this pass.

---

## 4. Side-by-side comparison

| Topic | Claude Code | Codex CLI |
|---|---|---|
| Recommended host interface | Agent SDK TS `@anthropic-ai/claude-agent-sdk` 0.3.302 (bundles per-platform binary) | `codex app-server` JSON-RPC (stdio JSONL) for chat; `exec --json` for one-shot |
| SDK spawns | Its own bundled `claude` (optional deps); `pathToClaudeCodeExecutable` to override | `@openai/codex-sdk` spawns `codex exec` JSONL via `@openai/codex` dependency; app-server needs hand-written client or Python SDK |
| Protocol docs / schema | TS types + docs; stdio control protocol undocumented | `generate-ts` / `generate-json-schema` ship exact schema for installed version |
| Multi-turn, one live process | Yes (streaming input, `Query.streamInput`) | Yes (`turn/start` repeatedly on a thread; many threads per process) |
| Resume after restart | `resume: sessionId` (jsonl under `%USERPROFILE%\.claude\projects`) | `thread/resume` (rollouts under `%USERPROFILE%\.codex\sessions`) |
| Fork | `forkSession` option / function, `--fork-session` | `thread/fork`, `codex exec fork` |
| Interrupt | `Query.interrupt()` | `turn/interrupt` -> `status:"interrupted"`; plus `turn/steer` |
| Text deltas | `stream_event` / `content_block_delta` / `text_delta` (needs `includePartialMessages`) | `item/agentMessage/delta` |
| Thinking | `thinking` content blocks / stream events, `SDKThinkingTokensMessage` | `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta` |
| Tool call / result | `tool_use` / `tool_result` blocks; `SDKToolProgressMessage` | `item/started`/`item/completed` with `commandExecution`, `fileChange`, `mcpToolCall`; `item/commandExecution/outputDelta` |
| File edits | Edit/Write tool inputs; `rewindFiles` checkpoints | `fileChange` items, `item/fileChange/patchUpdated`, `turn/diff/updated`, `thread/revert` |
| Usage | `result.total_cost_usd` (estimate) + per-message usage | `thread/tokenUsage/updated` (tokens only), `account/rateLimits/*`; no USD |
| Turn end | `result` message (`subtype`) | `turn/completed` (`completed`/`interrupted`/`failed`) |
| Approvals | `canUseTool` callback (allow/deny/updatedInput); `AskUserQuestion`; PreToolUse hooks | Server requests `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`; decisions `accept`/`acceptForSession`/`decline`/`cancel` |
| Modes | `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto` | `approvalPolicy` untrusted/on-request/never/granular + sandbox read-only/workspace-write/danger-full-access |
| OS sandbox on Windows | Not supported natively | MXC / elevated / unelevated sandbox |
| Models | `opus`, `sonnet`, `haiku`, `fable` aliases (Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.1 on API) | `gpt-6-luna`, `gpt-6-sol`, `gpt-6.1-sol`, `gpt-6-astra`, `gpt-5.6-*` (local catalog); `model/list` |
| Effort | `low..max` (`effort`) | `low..max` (+`ultra` on some); `effort` per turn |
| System prompt | `systemPrompt` string/preset+append; `--append-system-prompt`; snapshot-on-first-request caveat | `developerInstructions`, `baseInstructions`, AGENTS.md |
| MCP injection | `mcpServers` option / `--mcp-config` (+runtime control) | `config` overrides / `-c mcp_servers...` / `codex mcp add` (UNVERIFIED for per-thread) |
| Tool allow/deny | `allowedTools`, `disallowedTools`, `tools` | None found; sandbox + policy + execpolicy rules |
| Max turns / budget | `maxTurns`, `maxBudgetUsd` | None found |
| Built-in multi-agent | Subagents (Agent tool, stable); Agent teams experimental, disabled in SDK/-p | Subagents on by default (`[agents]`); `collabAgentToolCall` items |
| Auth for host | Subscription OAuth in `%USERPROFILE%\.claude\.credentials.json`; env `ANTHROPIC_API_KEY` overrides it | `%USERPROFILE%\.codex\auth.json` or OS store; `account/login/start` available; API key via `CODEX_API_KEY` |
| Third-party + subscription | Policy page restricts offering Claude.ai login / routing via plan credentials on behalf of users; API key recommended (see 3.1) | Docs recommend API keys for automation; no explicit statement on host apps using the user's CLI login found (see 3.2) |
| Windows | Native supported; Git Bash optional; orphaned child reports | Native; sandbox needs setup; daemon on Windows |

---

## 5. Recommendation for a Node host

1. **Process model:** one long-lived child per agent session, owned by a Node background process, all spawned with `windowsHide: true`, stdio piped. Wrap every child in a Windows Job Object (kill-on-close) or call `taskkill /PID <pid> /T /F` on shutdown; both vendors have Windows orphan-process exposure (Claude: user reports above; Codex: UNVERIFIED).
2. **Claude:** use `@anthropic-ai/claude-agent-sdk` `query()` in streaming-input mode (one `Query` per chat/agent), `includePartialMessages: true`, explicit `permissionMode`, `canUseTool` routed to the UI (it can stay pending), `interrupt()` for stop, `close()` for shutdown, persist `session_id` from the init message and `resume` it after a restart. Pass `settingSources` deliberately (an empty list isolates from user/project hooks; the default loads them). Set `env` explicitly (strip `ANTHROPIC_API_KEY` if subscription auth is intended; do not pass `--bare`). Set `systemPrompt` once per session because of the snapshot behaviour. For the "critic"/"chief" roles use `model: "opus"` / `"sonnet"` with `effort`.
3. **Codex:** spawn `codex app-server` (stdio) and implement a small JSON-RPC client (initialize/initialized, `thread/start`, `turn/start`, notifications, server-request replies). Generate the schema with `codex app-server generate-json-schema` / `generate-ts` at build time, pinned to the installed CLI version (the surface is `[experimental]` and moves fast: 0.163.0 has 664 v2 definitions). Use one app-server process for all Codex threads. Handle `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` by mapping to the same approval UI as Claude. Use `turn/interrupt` for stop. Choose `gpt-6-luna` via `model` after confirming with `model/list`.
4. **Do not use** `@openai/codex-sdk` for the chat path: it wraps `codex exec` (no text deltas, no approval round-trip documented). `exec --json` is acceptable for headless worker tasks.
5. **Team chat orchestration:** keep orchestration in the host. Disable vendor-side delegation to avoid double orchestration: Claude `disallowedTools: ["Agent"]` (verify the tool name per version); Codex `agents.enabled=false` via `-c`/thread `config` (verify). Agent teams are off in SDK sessions anyway. Route each agent's messages to the others as plain user turns; tag them as coming from another agent (Claude itself tells receivers that inter-agent messages are not user consent, a pattern worth copying).
6. **Safety defaults for workers:** Claude: `permissionMode: "default"` or `"dontAsk"` with explicit `allowedTools`, and a `PreToolUse` hook for must-check rules (not only `canUseTool`). Codex: `sandbox: "workspace-write"`, `approvalPolicy: "on-request"`. Warn about worktree isolation (`--worktree` on both) for parallel workers editing the same repo (Claude docs: forking and shared cwd do not branch the filesystem).
7. **Policy gate before shipping subscription-based driving:** see open uncertainty 1.

---

## 6. Open uncertainties

1. **Anthropic policy fit (decisive).** The legal page restricts third parties offering Claude.ai login or routing requests through plan credentials for their users, and forbids intermediating credentials or session tokens; it explicitly permits a user signing in to the unmodified Claude Code binary with their own subscription. It does not explicitly cover a local desktop app that launches that binary or the bundled SDK binary on the user's behalf. Needs a product-owner decision, possibly written confirmation from Anthropic sales ("Unless previously approved"). Consequences: whether to read `%USERPROFILE%\.claude\.credentials.json` (do not), whether the SDK-bundled binary counts as "unmodified Claude Code binary" (not stated), whether to fall back to API keys.
2. **OpenAI policy fit.** No page found stating whether a third-party app may spawn the user's `codex` with their ChatGPT login. The "Sign in with ChatGPT" program lists approved apps with plan usage; Persephone is not in it. OpenAI Terms of Use / Services Agreement not fetched.
3. SDK-bundled binary vs installed `claude.exe` version skew: the bundled binary and an auto-updating installed one share `%USERPROFILE%\.claude`; behaviour when versions differ (session file format, `--system-prompt-snapshot`, settings) UNVERIFIED.
4. Claude stdio control protocol (`control_request` / `control_response`) is not documented on the pages read; use the SDK rather than raw `claude -p` if `canUseTool` and `interrupt()` are needed. Raw `claude -p` interrupt semantics on Windows (no POSIX signals) UNVERIFIED.
5. Exact `thinking` delta type name on the Agent SDK page not shown (it is a standard Anthropic streaming event; confirm by capturing a real stream).
6. Codex app-server: stability (`[experimental]`), whether `thread/start.config` accepts `mcp_servers.*` and `agents.*` overrides per thread, whether `baseInstructions` replaces or appends, the value set of `approvalsReviewer`, clean-shutdown semantics on stdin close, and Windows orphan behaviour. All UNVERIFIED; verify by a single test run in a later task (this research ran nothing that starts an agent session).
7. Codex has no documented `max_turns` or USD budget; cost control is by token counts and plan limits. Claude's `maxBudgetUsd` is an estimate.
8. `gpt-6-luna` is present in the local model catalog but not named in the OpenAI docs pages fetched; availability is plan-dependent and may change; read `model/list` at runtime.
9. Codex subagents under `exec`/`app-server`: events exist in schema; whether sub-agent approvals surface as server requests to the host UNVERIFIED.
10. Claude Windows orphan-process bugs: reports are user-filed; status in 2.1.302 UNVERIFIED.
11. Codex `thread/start` `sandbox` vs `config`-level `windows.sandbox` interplay: which Windows sandbox implementation an app-server child uses by default (MXC vs legacy) not verified.
12. Per-session MCP and instruction uncertainties are listed inside sections 7 and 8 (notably: Codex `thread/start.config` key shape for `mcp_servers.*`, Codex MCP approval default and delivery mechanism, Claude SDK `strictMcpConfig` mapping onto `mcpServers`, Codex AGENTS.md loading under exec/app-server).

---

## 7. Per-session MCP injection

Goal: give ONE session a Streamable HTTP MCP server at `http://127.0.0.1:<port>/mcp` that requires `Authorization: Bearer <token>`, without touching the user's global CLI config. Researched 2026-10-18.

### 7.1 Claude Code

**Recommended: Agent SDK `mcpServers` option.** It is an in-memory option on `query()`; nothing is written to `%USERPROFILE%\.claude` or `.mcp.json` — https://code.claude.com/docs/en/agent-sdk/mcp ("Pass MCP servers directly in the `mcpServers` option").

```typescript
options: {
  mcpServers: {
    persephone_team: {
      type: "http",                                   // not "streamable-http" when passed in code
      url: "http://127.0.0.1:<port>/mcp",
      headers: { Authorization: `Bearer ${token}` }   // static header, built by the host
    }
  },
  allowedTools: ["mcp__persephone_team__*"]
}
```

Facts and sources (all https://code.claude.com/docs/en/agent-sdk/mcp unless noted):
- Transport: `"type": "http"` is the streamable HTTP transport; `"sse"` is the legacy one. "In `.mcp.json` and other JSON config files, `"streamable-http"` is accepted as an alias for `"http"`. The SDKs' `McpHttpServerConfig` type declares only `"http"`, so use `"http"` for servers you pass in code."
- Bearer header: documented pattern `headers: { Authorization: \`Bearer ${process.env.API_TOKEN}\` }` (section "HTTP headers for remote servers"). The SDK does not run OAuth itself; a server returning an auth challenge with no token reports status `needs-auth`; "complete the OAuth flow in your own application and pass the resulting access token in the server's `headers`."
- Tool names are `mcp__<server-name>__<tool-name>`; characters like `.` and spaces in the server key become `_`. Pick a key with letters, digits, underscore or hyphen.
- **Permission:** "MCP tools require explicit permission before Claude can use them." Auto-approve with `allowedTools: ["mcp__persephone_team__*"]` (wildcard allowed after a literal `mcp__<server>__` prefix; unanchored `mcp__*` in allow rules is ignored — https://code.claude.com/docs/en/agent-sdk/permissions). `permissionMode: "acceptEdits"` does not approve MCP tools; `bypassPermissions` does but is broader than needed. Without allow rules the call falls to `canUseTool`, where the host can approve it. MCP tools whose server sets `_meta["anthropic/requiresUserInteraction"]` always prompt.
- **Connection timing:** an http server without a cached tool list delays the first turn until it connects, up to `MCP_TIMEOUT` (30 s default; override via `env`; `CLAUDE_CODE_MCP_STARTUP_WAIT_MS` v2.1.274+). The server must therefore be listening before `query()` starts. A remote server with a cached tool list (saved by Claude Code from an earlier connection) "connects on its first tool call" and shows `pending` in init. Check the init `system` message `mcp_servers[].status` (`pending|connected|failed|needs-auth|disabled`) and `Query.mcpServerStatus()`; Claude can fall back to built-in tools when the server is unavailable, so a host must verify status rather than trust the result. `reconnectMcpServer(name)` and `setMcpServers()` exist for runtime control (typescript reference).
- Tool search is on by default: tool definitions are withheld and loaded on demand; `alwaysLoad: true` on the server config exposes full schemas on the first turn (connection-timing section).
- Output cap: results over 25,000 tokens are written to a file (`MAX_MCP_OUTPUT_TOKENS`); tool call timeout `MCP_TOOL_TIMEOUT`.
- Loopback: no restriction on `127.0.0.1` was found in these pages and none is stated either way (UNVERIFIED; the first live test should confirm).

**Does other MCP config still load alongside?** Yes unless suppressed:
- Project `.mcp.json` is read when the `project` setting source is enabled (the default). "`claude -p`, Agent SDK, and cloud sessions: Claude Code can't show the prompt, so it loads project-scoped servers without asking." — https://code.claude.com/docs/en/mcp (scope/approval section). Exclude with `settingSources` without `"project"`, `disabledMcpjsonServers`, or strict mode.
- Same-name definitions: precedence local > project > user > plugin > claude.ai connectors; "The whole entry comes from one source. Fields are not merged across scopes." — https://code.claude.com/docs/en/mcp. Use a unique server key so the host entry cannot be shadowed. How `--mcp-config` / `options.mcpServers` rank against `local` scope is not stated (UNVERIFIED); a unique name avoids the question.
- The global `~/.claude.json` config is "Always read" regardless of `settingSources`; the only opt-out listed is relocating it with `CLAUDE_CONFIG_DIR` in `env` — https://code.claude.com/docs/en/agent-sdk/claude-code-features ("What settingSources does not control"). Whether user-scope MCP servers live in that file is not stated on these pages (UNVERIFIED).
- claude.ai connectors load when the session uses a claude.ai login; "Passing `mcpServers: {}` does not suppress the connectors". Suppress with `strictMcpConfig: true`, `disableClaudeAiConnectors: true` in settings, or `ENABLE_CLAUDEAI_MCP_SERVERS=false` in `env` (same table).
- **`--strict-mcp-config` / SDK `strictMcpConfig: true`:** "Only use MCP servers from --mcp-config, ignoring all other MCP configurations" [local `claude --help`]; "In a strict session, Claude Code v2.1.246 or later skips the approval prompt for project-scoped servers it isn't loading" — https://code.claude.com/docs/en/mcp. The exact mapping of the SDK option onto programmatic `mcpServers` is UNVERIFIED (the SDK docs name `strictMcpConfig` only in the connectors row; check the TS `Options` reference).

**CLI route (if not using the SDK):**
- `claude -p ... --mcp-config '<inline JSON or path>' --strict-mcp-config` [local `claude --help`: `--mcp-config <configs...>` "Load MCP servers from JSON files or strings (space-separated)"]. File format is the `.mcp.json` shape: `{"mcpServers":{"persephone_team":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer ${PERSEPHONE_MCP_TOKEN}"}}}}` — https://code.claude.com/docs/en/mcp (env expansion section) and the SDK page.
- `${VAR}` expansion works in `url` and `headers`; `${VAR:-default}` supported; an unset variable sends the literal `${VAR}` with a warning. Credential-named variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `HTTPS_PROXY`, `NPM_TOKEN`) are read as empty in remote `url`/`headers`: "To pass a covered credential, copy it into a variable with your own name". Name the env var something like `PERSEPHONE_MCP_TOKEN`.
- Inline JSON puts the token on the command line, visible to other local processes (inference, not from docs); prefer a temp config file with `${VAR}` expansion, or the SDK.
- In `--bare` mode "only servers supplied on the command line connect, for example with `--mcp-config`" (headless doc), but bare mode ignores subscription auth, so it does not fit.
- `claude mcp add` writes persistent config (scopes local/project/user) and is the wrong tool for per-session use [local `claude mcp --help`].

### 7.2 Codex CLI

**Streamable HTTP support: yes, stable.** `mcp_servers.<id>.url` is "Endpoint for an MCP streamable HTTP server"; `bearer_token_env_var` is "Environment variable sourcing the bearer token for an MCP HTTP server"; `http_headers` "Static HTTP headers included with each MCP HTTP request"; `env_http_headers` "HTTP headers populated from environment variables" — https://learn.chatgpt.com/docs/config-file/config-reference.md; example in https://learn.chatgpt.com/docs/extend/mcp.md (uses `bearer_token_env_var = "MY_MCP_TOKEN"` and a `http://localhost:3000/mcp` entry). `codex mcp add <NAME> --url <URL> --bearer-token-env-var <ENV_VAR>` exists [local `codex mcp add --help`] but persists to `config.toml`; do not use it for per-session. Config-sample comment: `bearer_token_env_var = "GITHUB_TOKEN" # optional; Authorization: Bearer <token>` — https://learn.chatgpt.com/docs/config-file/config-sample.md.

**Exec / one process per session: `-c` overrides.** `-c key=value` takes a dotted path, value parsed as TOML, "Keys can use dot notation to set nested values (for example, `mcp_servers.context7.enabled=false`)" — https://learn.chatgpt.com/docs/config-file/config-advanced.md; [local `codex --help`]. Recommended command shape:

```
codex exec --json \
  -c 'mcp_servers.persephone_team.url="http://127.0.0.1:<port>/mcp"' \
  -c 'mcp_servers.persephone_team.bearer_token_env_var="PERSEPHONE_MCP_TOKEN"' \
  -c 'mcp_servers.persephone_team.default_tools_approval_mode="approve"' \
  ...        # child env: PERSEPHONE_MCP_TOKEN=<token>
```

**Verified locally (no agent session, no tokens):** I ran `codex mcp list --json` with the first two `-c` overrides above (port 9, env var `PROBE_TOKEN`). Output showed a new server with `"transport":{"type":"streamable_http","url":"http://127.0.0.1:9/mcp","bearer_token_env_var":"PROBE_TOKEN",...}` and `"auth_status":"bearer_token"`, and the user's already-configured servers were still listed alongside it. Conclusions: (a) `-c` creates a streamable HTTP server with no file written; (b) the override is additive to the user's `config.toml` servers (they still load); (c) the token is read from the child's environment by variable name, so it never appears in argv. I did not contact the server, so the actual `Authorization: Bearer` header on the wire is UNVERIFIED but is what the key is documented to do.
- Prefer `bearer_token_env_var` over `http_headers` for the token: static `http_headers` would put the secret in the command line. `env_http_headers = { "Authorization" = "VAR" }` would also work but the env var must then contain the whole `Bearer <token>` string (inference).
- Use a unique server id (`persephone_team`). Behaviour when the id collides with an existing user server (per-key merge versus replace) is UNVERIFIED.
- Useful extra keys (config-reference): `startup_timeout_sec` (default 10 s), `tool_timeout_sec` (default 60 s), `required = true` (fail startup/resume if the server cannot initialize), `enabled_tools` / `disabled_tools`, `enabled`. With `required=true` a host gets a hard failure instead of a silent fall-back.
- Loopback is fine per the docs example (`http://localhost:3000/mcp`).

**App-server (one process, many threads).** Options, in order of preference for per-session scoping:
1. `thread/start` / `thread/resume` / `thread/fork` `config` param: schema type is `{"additionalProperties": true, "type": ["object","null"]}` [local generated schema, 0.163.0], a free-form map of config overrides applied to that thread. The key shape for `mcp_servers.*` (nested object versus dotted keys) and whether MCP servers are (re)started for a thread from this map are not documented: UNVERIFIED. The TypeScript SDK flattens nested `config` objects into dotted `--config` arguments (https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/README.md), but that is the exec path. Needs one live test.
2. Start a dedicated `codex app-server -c 'mcp_servers.…' ...` child per session (`-c` is accepted by `app-server`: [local `codex app-server --help`]). Deterministic and per-session by construction, at the cost of one process per agent session; the token goes via the child's env. Recommended if option 1 fails verification, or if sessions need different tokens.
3. Avoid `config/value/write` and `config/batchWrite` (they persist to the user's `config.toml`) and `config/mcpServer/reload` (reloads from disk). Verify connection with `mcpServerStatus/list` (returns per-server `authStatus`, `httpOrigin`, `runtimeStatus`, tools) and the `mcpServer/startupStatus/updated` notification [local schema].
- MCP tool names exposed to the model are server-prefixed; feature flag `non_prefixed_mcp_tool_names` is "under development" and off [local `codex features list`].

**Tool approval for MCP tools.**
- Keys `default_tools_approval_mode` (per server) and `tools.<tool>.approval_mode` (per tool), values `auto | prompt | writes | approve`; "The `writes` mode prompts for tools that aren't marked read-only"; `approve` is the closest to auto-approve — https://learn.chatgpt.com/docs/extend/mcp.md. The page does not state the default when unset or define `auto`: UNVERIFIED. The same enum exists in the schema as `AppToolApproval` [local].
- To avoid prompts for the host's own trusted tools, set `default_tools_approval_mode="approve"` on that server only.
- When a prompt does occur in app-server, `ApprovalsReviewer` (`user` default | `auto_review`) is described as covering "sandbox escapes, blocked network access, MCP approval prompts, and ARC escalations" [local schema]. The delivery mechanism for an MCP tool-call approval to the host is most likely the `mcpServer/elicitation/request` server request (feature flag `tool_call_mcp_elicitation` is `stable` and `true` [local `codex features list`]; response `action: accept|decline|cancel`). This link is an inference, UNVERIFIED.
- In `codex exec` (non-interactive) "actions needing new approval fail" (https://learn.chatgpt.com/docs/agent-configuration/subagents.md, stated for non-interactive flows), so on exec set `approve` explicitly.

---

## 8. Per-session instructions

Goal: add custom instructions to ONE session while keeping the CLI's default system prompt and repo `CLAUDE.md` / `AGENTS.md` loading. Researched 2026-10-18.

### 8.1 Claude Code

**Trap in SDK mode (differs from `claude -p`):** "when you don't set `systemPrompt` ... the SDK uses a minimal prompt that covers tool calling but omits the rest of the `claude_code` preset's content, including its security and safety instructions. This differs from `claude -p`, which uses the Claude Code system prompt by default." — https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts. A host must opt into the preset.

**Recommended (keep default prompt and add yours):**
```typescript
systemPrompt: { type: "preset", preset: "claude_code", append: "<host instructions>", excludeDynamicSections: true /* optional, cache */ }
```
- "`claude_code` preset with `append`: Everything above, with your instructions added after the preset. Nothing is removed, so this is the lowest-risk customization." Same page.
- CLI equivalent: `--append-system-prompt <prompt>` "Append a system prompt to the default system prompt" [local `claude --help`]. File forms `--append-system-prompt-file` / `--system-prompt-file` are referenced in https://code.claude.com/docs/en/headless but were NOT present in the local `--help` output I captured (UNVERIFIED for 2.1.302). `--exclude-dynamic-system-prompt-sections` [local] is the CLI form of `excludeDynamicSections`.
- `--system-prompt <prompt>` / a custom string `systemPrompt` **replaces** the prompt: "Custom string: ... The SDK sends only what you provide." Replacing loses the preset's tool-usage guidance and built-in safety instructions ("Default tools: Lost (unless included); Built-in safety: Must be added" in the comparison table, same page). It does NOT drop CLAUDE.md, skills, hooks or permissions, which load via other paths. The page advises adding a sentence explaining that system reminders come from the application, because CLAUDE.md content and hook output arrive as `<system-reminder>` conversation text. With a replaced prompt the git status snapshot is absent, and `includeGitInstructions` (commit/PR text in the Bash tool description) still reaches Claude unless disabled. The Opus 5 delegation-limiting line is only added by the preset.
- **CLAUDE.md loading in SDK mode:** "Default `query()` options enable both sources, so CLAUDE.md loads automatically. If you set `settingSources` ... explicitly, include the sources you need. CLAUDE.md loading is controlled by setting sources, not by the `claude_code` preset." `'project'` loads `CLAUDE.md` or `.claude/CLAUDE.md` from cwd (and parents, plus rules); `'user'` loads `~/.claude/CLAUDE.md`; `'local'` loads `CLAUDE.local.md`; omitting `settingSources` equals `["user","project","local"]`; `settingSources: []` loads none — same page and https://code.claude.com/docs/en/agent-sdk/claude-code-features. CLAUDE.md is injected "into the conversation" as project context, not into the system prompt, so it works with append, replace or default. Auto memory (`~/.claude/projects/<project>/memory/`) is also loaded into the system prompt regardless of `settingSources`; disable with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `env`.
- Other layers if wanted: output styles (need `settingSources` user/project; a custom style omits software-engineering instructions unless `keep-coding-instructions: true`); `agents` for per-role subagent prompts.

**Changing instructions mid-session:**
- "Claude Code records the system prompt on a session's first request and reuses that record until the session is compacted. The new text takes effect after that compaction, or in a new session." A different `append` on `resume`/`continue` is ignored on the next turn (same page, "Change the prompt of an existing session"; CLI flag `--system-prompt-snapshot on|off` [local help]). Recording a custom/append prompt by default requires Claude Code v2.1.265+ (SDK 0.3.265+).
- Supported ways to change instructions during a live session: (a) put them in the next user message; (b) a `UserPromptSubmit`/`PostToolUse` hook returning `additionalContext` ("written as a factual statement such as 'The workspace is now read-only'"); (c) `snapshot: false` on the object form of `systemPrompt` (SDK 0.3.257+) rebuilds every request but loses prompt-cache reuse and, where enforced, preserved thinking.
- For a multi-agent team chat, set role prompts once at session creation and send per-turn changes as user-message context.

### 8.2 Codex CLI

**Keys (config.toml or `-c`):**
- `developer_instructions`: "Additional user instructions are injected before AGENTS.md. Default: unset." (https://learn.chatgpt.com/docs/config-file/config-sample.md); "Additional developer instructions injected into the session (optional)." (https://learn.chatgpt.com/docs/config-file/config-reference.md). Additive: built-in base instructions are kept and AGENTS.md is still built after it. Use via `-c 'developer_instructions="""..."""'` (value parsed as TOML; multi-line strings need TOML triple quotes; on Windows mind the command-line length limit and quoting: inference, not from docs).
- `model_instructions_file`: "Override built-in base instructions with a file path. Default: unset." (config-sample). This replaces Codex's built-in base prompt; config-reference words it as "Replacement for built-in instructions instead of `AGENTS.md`", which is ambiguous about AGENTS.md (UNVERIFIED whether AGENTS.md still loads when it is set; the sample comment and the AGENTS.md guide treat AGENTS.md as separate project docs). Relative paths in project config resolve against the `.codex/` folder containing the `config.toml` (config-advanced). Prefer `developer_instructions` for adding; avoid replacing the base prompt.
- `experimental_instructions_file` is the old name: config-reference says "Rename `experimental_instructions_file` to `model_instructions_file`", so it is no longer current.
- `project_doc_max_bytes` (default 32768) caps AGENTS.md embedded in first-turn instructions; `project_doc_fallback_filenames` for alternates. `compact_prompt` overrides only the history-compaction prompt.

**AGENTS.md loading** — https://learn.chatgpt.com/docs/agent-configuration/agents-md.md: global `AGENTS.override.md` else `AGENTS.md` in `CODEX_HOME` (first non-empty), then from the project root (typically Git root) down to cwd, one file per directory (`AGENTS.override.md`, `AGENTS.md`, fallback names), concatenated root-down with blank lines, nearer files later; stops at the byte cap. "Codex builds an instruction chain when it starts (once per run; ...)". The page does not say whether it loads under `codex exec` or app-server (UNVERIFIED; expected to match since the same core builds the chain, but not documented). Project-scoped `.codex/config.toml` loads only for trusted projects (config-advanced).

**App-server per-thread params** (local generated schema, 0.163.0): `thread/start`, `thread/resume`, `thread/fork` accept `developerInstructions` (string|null), `baseInstructions` (string|null), `config` (free-form map) and, on start/resume, `personality` (deprecated: "`friendly` and `pragmatic` no longer select a style"). `developerInstructions` is the per-thread equivalent of `developer_instructions`; `baseInstructions` is presumably the per-thread base-instructions override (semantics undocumented: UNVERIFIED; avoid). The app-server doc shows `developer_instructions` inside `collaborationMode` on `turn/start` (https://learn.chatgpt.com/docs/app-server), but `collaborationMode` is NOT among the `TurnStartParams` properties in the 0.163.0 schema I generated (properties: threadId, input, model, effort, cwd, approvalPolicy, sandboxPolicy, summary, personality, outputSchema, and others), so treat the doc as lagging or gated behind `experimentalApi` (UNVERIFIED).
For `codex exec`: `-c 'developer_instructions="..."'`; `--ignore-user-config` skips `config.toml` (so also user-set instructions) but keeps auth; `--ignore-rules` skips execpolicy `.rules` only [local `codex exec --help`].

**Changing instructions mid-session:**
- `turn/start` has no `developerInstructions` field in the schema; its overrides cover model, effort, cwd, approvalPolicy, sandboxPolicy, summary, outputSchema, approvalsReviewer. The deprecated `personality` note, "Changing this does not rewrite the thread's existing instructions", implies thread instructions are fixed at creation. `thread/resume` accepts `developerInstructions`; whether a resume with new text replaces the stored instructions is UNVERIFIED.
- Practical equivalents: send new guidance as the next user input (`turn/start` `input`), or `thread/inject_items` (inserts raw items into history; semantics UNVERIFIED), or start a new or forked thread with new `developerInstructions` (`thread/fork` accepts it).

### 8.3 Net guidance for the host

| Need | Claude | Codex |
|---|---|---|
| Add instructions, keep defaults and repo docs | `systemPrompt: {type:"preset", preset:"claude_code", append}` plus default `settingSources` (CLAUDE.md loads) | `developerInstructions` on `thread/start` (or `-c developer_instructions=` on exec); AGENTS.md still built after it |
| Replace default prompt | `systemPrompt: "<string>"` (drops tool guidance and safety text; CLAUDE.md still loads) | `model_instructions_file` / `baseInstructions` (semantics partly UNVERIFIED; not recommended) |
| Repo instruction file loading | CLAUDE.md via `settingSources` (default on in SDK; off with `[]`) | AGENTS.md root-to-cwd, 32 KiB cap, part of first-turn instructions |
| Change after session start | New user message or hook `additionalContext`; `snapshot:false` to re-render each request | New user input; fork or new thread with new `developerInstructions`; no turn-level override |
| Pitfall | SDK default prompt is the minimal one, not Claude Code's; snapshot ignores a changed `append` on resume | `thread/start` `config` and `baseInstructions` semantics undocumented |
