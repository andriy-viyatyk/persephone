---
title: "Session Events and Security"
audience: "both"
summary: "How do session events, permissions, examples, and security rules work for agent.session?"
---

# Session Events and Security

## Consumer requests during a session

Each `send` is one user input. Only one turn may run at a time. A `send` during a running turn is
rejected with `error` code `busy`; it is not queued or interleaved. The provider accepts:

| Request | Fields | Meaning |
|---|---|---|
| `send` | `text`, optional reserved `attachments` | Start one turn. V1 providers may reject non-empty attachments as unsupported. |
| `interrupt` | — | Interrupt the active turn; no-op if idle. |
| `approval-response` | `requestId`, `decision: "allow" \| "allow-session" \| "deny"`, optional `message` | Resolve a pending approval, subject to the provider's permission ceiling. |
| `close` | — | End the live session and close the channel. |

## Provider events

Every provider event uses `{type, ...}` and includes the echoed `id` when replying to a request.

| Event | Required fields and meaning |
|---|---|
| `session-started` | `sessionId`, `model`, effective `permissionMode`, applied `limits`, `instructions:{composed}`, `contractVersion:1`; emitted once after open succeeds. |
| `turn-started` | Optional `turnId`; one emitted for each accepted `send`. |
| `text-delta` | `text`; incremental assistant text. |
| `text` | `text`; final assistant message for a step/turn. |
| `thinking-delta` | `text`; optional incremental reasoning summary. Do not assume every CLI exposes it. |
| `tool-call` | `callId`, `name`, `input` summary; bounded and marked if truncated. |
| `tool-result` | `callId`, `ok`, `summary`; bounded and marked if truncated. |
| `file-change` | `path`, `kind` (provider-normalized change kind); no file contents. |
| `approval-request` | `requestId`, `kind` (`command` \| `file-write` \| `mcp` \| `other`), `summary`, `detail`. |
| `session-status` | `model`, user-facing `modelLabel`, `effort`, and boolean `compacting`; optional provider-specific `mode`, `contextTokens`, `contextWindow`, `contextPercent`, and `limits`. `limits` may contain `fiveHour` and/or `sevenDay`, each `{ percent: number, resetsAt?: string }`; `percent` is utilization from 0 to 100 and `resetsAt` is an ISO 8601 timestamp. |
| `turn-ended` | `reason` (`completed` \| `interrupted` \| `limit` \| `error`), `usage` with `inputTokens`, `outputTokens`, optional `cachedTokens` and `costUsd`. Unavailable values are omitted, not fabricated. |
| `error` | `code`, `message`, `fatal`; fatal errors end the live session. |
| `notice` | `message`; provider information such as model rerouting or a non-fatal limitation. |

For v1 use these error codes where applicable: `cli-not-found`, `cli-version-unsupported`,
`not-logged-in`, `model-unavailable`, `resume-not-found`, `provider-unavailable`, `limit-reached`,
`busy`, and `protocol-error`. The platform can also close the channel with service-channel codes such as
`channel-backpressure`, `channel-closed`, `payload-too-large`, `rejected`, `service-busy`,
`service-exited`, `renderer-reloaded`, `untrusted`, `connection-refused`, `quit`, and
`service-error`. A provider should send a useful non-fatal `error` before closing when possible.

## Permission modes and the cross-board ceiling

Permission modes are contract-level intent, ordered from least to most permissive as
`read-only` < `ask` < `auto-edit` < `full-auto`. Providers map them to native controls and report
the effective mode in `session-started`. Mappings below are best-effort: the CLIs do not offer
identical controls, and Claude's native sandbox is unavailable on Windows.

| Contract mode | Meaning | Claude Agent SDK mapping | Codex app-server mapping |
|---|---|---|---|
| `read-only` | Read and inspect; deny all writes, commands, and other side effects. | `permissionMode: "default"`; use `canUseTool` to allow read-only tools and deny every mutating/command/MCP action. Approximate: default may expose tools requiring host classification. | `sandbox: "read-only"`, `approvalPolicy: "never"`. Approximate: read-only sandbox limits filesystem writes but provider should also deny approval requests and non-read side effects. |
| `ask` | Every write or command needs explicit user approval. | `permissionMode: "default"`; route every write/command through `canUseTool`; allow only after `approval-response`. | `sandbox: "workspace-write"`, `approvalPolicy: "on-request"`; forward command and file approval requests. Approximate: Codex's native prompts are policy-triggered, not guaranteed for every possible side effect. |
| `auto-edit` | Workspace file edits are automatic; commands require approval. | `permissionMode: "acceptEdits"`; `canUseTool` still gates commands and other effects. | `sandbox: "workspace-write"`, `approvalPolicy: "on-request"`; approve file changes automatically within `cwd`, forward commands. Approximate: app-server exposes separate file and command approval requests, but file scope must be checked by the provider. |
| `full-auto` | Allow the CLI's full native access without approval prompts. | `permissionMode: "bypassPermissions"`. | `sandbox: "danger-full-access"`, `approvalPolicy: "never"`. This is the highest-risk mode. |

Every provider MUST maintain a user-configured board setting for its **cross-board permission
ceiling**, an enum over these four modes, defaulting to `read-only`. It applies to every cross-board caller in v1; a later
version may allow per-caller ceilings. The provider's own chat page is same-board use and is not
bounded by this ceiling. For a cross-board open, clamp a request above the ceiling down to the
ceiling and report the effective mode in `session-started`. Never raise permissions above what
the consumer requested or the ceiling permits.

The provider owns this enforcement. A consumer's `uses` grant gives it messaging access to
providers, not authority to approve their CLI actions. Forward an `approval-request` to a
cross-board caller only if the requested action is within the effective ceiling. Deny any action
the ceiling forbids without asking the caller, even if the caller sends `allow` or `allow-session`.
This prevents a consumer holding only `uses` from laundering `execute` access by approving shell
commands through a provider. The ceiling is a safety boundary, not a substitute for each
provider's own trust grant and `service` permission.

## Native event mapping

Providers normalize native events into the contract above. The CLI protocols evolve; check the
installed versions and tolerate unknown native fields. Codex app-server is experimental and its
schema should be generated from the installed CLI.

| Contract event / operation | Claude Agent SDK | Codex app-server |
|---|---|---|
| Start/resume session | `query()` / streaming input; `resume: sessionId`; init message supplies session id. | `thread/start` / `thread/resume`; result supplies thread id. |
| Turn start/end | `SDKResultMessage` / result subtype; usage and estimated `total_cost_usd`. | `turn/started`, `turn/completed`; token usage via `thread/tokenUsage/updated`; no USD cost. |
| Text | `stream_event` content-block `text_delta` (enable partial messages); final assistant/result messages. | `item/agentMessage/delta`; final `agentMessage` item. |
| Thinking | Thinking content blocks / SDK thinking messages when enabled and exposed. | `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta`. |
| Tool call/result | Assistant `tool_use` / user `tool_result`; tool progress messages. | `item/started` / `item/completed` for command, file, MCP, and other thread items; command output deltas. |
| File change | Edit/Write tool input and result; normalize without sending file contents. | `fileChange` items, `item/fileChange/patchUpdated`, `turn/diff/updated`. |
| Approval | `canUseTool` callback; keep pending until response, map allow/allow-session/deny. | JSON-RPC server requests such as `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, and `mcpServer/elicitation/request`; map accept/acceptForSession/decline/cancel. |
| Interrupt | `Query.interrupt()`. | `turn/interrupt`; turn completes as interrupted. |
| Errors/notices | SDK error/result messages, rate-limit and status messages. | `error`, `warning`, `configWarning`, `model/rerouted`, and protocol errors. |
| Usage | Result usage and estimated cost; cached tokens where exposed. | `thread/tokenUsage/updated`; input/output/cached token counts, no USD cost. |

## Examples

### Sequence: discovery, open, turn, approval, close

```text
consumer -> provider  {type:"describe", id:"d1"}
provider -> consumer  {type:"description", id:"d1", contractVersion:1, ...}
provider closes discovery channel

consumer -> provider  {type:"open", contractVersion:1, model:"...", cwd:"...", permissionMode:"ask"}
provider -> consumer  {type:"session-started", contractVersion:1, sessionId:"...", ...}
consumer -> provider  {type:"send", id:"s1", text:"Inspect the failing test."}
provider -> consumer  {type:"turn-started"}
provider -> consumer  {type:"text-delta", text:"I will inspect..."}
provider -> consumer  {type:"approval-request", requestId:"a1", kind:"command", summary:"Run tests", detail:"..."}
consumer -> provider  {type:"approval-response", requestId:"a1", decision:"allow"}
provider -> consumer  {type:"tool-call", callId:"c1", name:"...", input:{summary:"..."}}
provider -> consumer  {type:"tool-result", callId:"c1", ok:true, summary:"..."}
provider -> consumer  {type:"text", text:"The test passes."}
provider -> consumer  {type:"turn-ended", reason:"completed", usage:{inputTokens:120, outputTokens:35}}
consumer -> provider  {type:"close"}
provider kills the process tree, revokes session MCP, preserves CLI session storage
```

### Minimal consumer

```js
const providers = await persephone.services.list("agent.session");
const channel = await persephone.services.connect("agent.session", {
  provider: providers[0].provider, version: 1,
}, {
  type: "open", contractVersion: 1, model: "gpt-6-luna", cwd,
  permissionMode: "ask", mcp: { persephone: true },
});
channel.onMessage(event => render(event));
channel.onClose(reason => showClosed(reason));
await channel.whenWritable();
channel.send({ type: "send", id: crypto.randomUUID(), text: "Review this change." });
// On user action: channel.send({type:"approval-response", requestId, decision:"allow"})
// On session end: channel.send({type:"close"});
```

### Provider skeleton (CLI operations are pseudocode)

```js
persephone.service.onChannel(async (channel, open, info) => {
  if (open?.type === "describe") return describeThenClose(channel, info);
  if (open?.type === "list-sessions") return listThenClose(channel, open.cwd);
  if (open?.type !== "open" || open.contractVersion !== 1) return protocolError(channel);

  const crossBoard = Boolean(info.interface && info.caller);
  const ceiling = crossBoard ? configuredCrossBoardCeiling() : "full-auto";
  const effectiveMode = clamp(open.permissionMode, ceiling);
  const mcp = open.mcp?.persephone !== false && hasAppScriptingPermission();
  const endpoint = mcp ? await persephone.mcp.issueSessionEndpoint() : undefined;
  const composed = composeInstructions(environmentPreamble(open.cwd, mcp), providerInstructions(), open.instructions);
  const session = await launchOrResumeInstalledCli({ open, effectiveMode, composed, endpoint });
  channel.send({ type: "session-started", contractVersion: 1, sessionId: session.id,
    model: session.model, permissionMode: effectiveMode, limits: session.appliedLimits,
    instructions: { composed } });

  let busy = false;
  channel.onMessage(async request => {
    if (request.type === "send" && busy) return replyError(channel, request, "busy");
    if (request.type === "send") { busy = true; try { await session.turn(request); } finally { busy = false; } }
    else if (request.type === "interrupt") await session.interrupt();
    else if (request.type === "approval-response") await session.resolveIfAllowed(request, ceiling);
    else if (request.type === "close") await stopAndClose(session, channel);
    // Ignore unknown message types for forward compatibility.
  });
  channel.onClose(async () => { await killProcessTree(session); endpoint?.revoke(); });
});
```

## Security and terms of use

Providers launch the user's own installed CLI and rely on its existing sign-in. They must never
read, copy, store, log, pass through, or otherwise handle CLI credential files, session tokens, or
authentication secrets. Do not offer a provider-controlled login or intermediate the user's
subscription. This matters especially for Claude: Anthropic's terms describe restrictions on
third-party products offering Claude.ai login or routing subscription credentials, while also
allowing a user to sign in to an unmodified Claude Code binary. The exact status of every host-app
scenario is not stated by either vendor, so a provider follows the cautious design above, and its
author should check the current Anthropic and OpenAI terms before publishing it. Persephone's
board that implements this contract is named **Agent Chat**; other integrations should follow
each vendor's current naming requirements.
