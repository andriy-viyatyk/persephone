# US-1796: Capability agent surface

## Goal

Expose the unified capability registry through the `capabilities` branch of the `call` tree, with agent-filtered live discovery, provider pinning, routed calls and opens, and method-derived bridge deadlines. Publish the existing normative guide. This is part of [EPIC-140](../../epics/EPIC-140.md); decisions 1–8 are final and are not reopened here.

## Background

- The normative [capabilities contract](../../../assets/guides/agents/capabilities.md#agent-calls) specifies the rendered root and per-id `$help` examples, positional JSON arguments, `providers["key-or-name"]`, agent authorization, channels as discovery only, and a bridge deadline of method timeout plus 5,000 ms. `open` runs in the window selected by MCP `call` and returns `{ pageId?, result }`; the existing guide and router permit `pageId` to be absent when the handler settles without a page.
- [US-1794](../US-1794-capability-registry/README.md) supplies `src/main/capability-router.ts`; [US-1795](../US-1795-capability-client-api/README.md) supplies `src/renderer/api/capabilities.ts` and `src/shared/capability-client.ts`. The router's `providers`, `resolve`, `authorize`, and `invoke` are the sole discovery, selection and routing path. `list({ kind: "agent" })` filters out hidden methods and registrations with no visible methods; `authorize` checks `agent` and trust, and `invokeChannel` rejects agents. Do not add a second resolver.
- The current renderer client calls main handlers in `src/ipc/main/core-handlers.ts` as `{ kind: "platform" }`. `platform` has greater access than `agent`; passing `asAgent: true` only restricts discovery and invocation to agent-visible methods and disallows channels. It cannot escalate the renderer. `app.capabilities.get` remains the way script code requests platform access. Reuse `createCapabilityProxy` for agent calls. Keep `capabilities.list()` / `handlers(id)` delegating to their existing legacy implementations unchanged. Add the mode to capability list/providers requests used for live agent discovery as well as `CapabilityClientOptions` and `CapabilityClientInvoke` for get/invoke.
- `src/renderer/scripting/ai-vision/namespaces/capabilities.ts` currently describes those two methods and is registered in `namespaces/index.ts`. `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` demonstrates live descriptor `children` and `index`; `namespaces/tools.ts` demonstrates live indexed nodes; `src/main/mcp/ai-vision/guides.ts` demonstrates the guide tree. `call-tools.ts` uses `parsePath` and `routeCallPath` to forward `windows[i]` paths to the selected renderer.
- `src/main/mcp/tools/call-tools.ts` decides bridge timeouts before `sendToRenderer`; `automationWaitBridgeTimeout` and `remoteAppBridgeTimeout` are existing precedents. For capability paths, query `capabilityRouter.providers({ kind: "agent" }, id)` without starting a service, then take the largest declared timeout for the method among eligible candidates (or among candidates matching the pinned provider), plus the named 5,000 ms allowance in `src/shared/capability-limits.ts`. The renderer resolves again when invoking. Taking the largest timeout keeps the bridge safe if provider preference changes between lookup and invocation; no binding crosses processes.
- `guides.agents` is the live tree in `src/main/mcp/ai-vision/guides.ts`; `assets/guides/agents/index.md` is its overview, and `src/main/mcp/manifest.ts` separately publishes MCP resources and server instructions. `assets/guides/agents/boards.md` currently describes legacy capability and service APIs as the only APIs and says `appScripting` grants capability invocation; the task must correct those claims while retaining useful legacy documentation.
- Existing manual fixtures: trusted provider `claudetest.echo` has `echo`, `slow` (1,000 ms), `fail` (`agent:false`) and `late` (unregistered); trusted consumer `claudetest.consumer` has `relay`, `relaySlow`, `probe`. Do not create test boards, unit tests or harnesses.

## Implementation Plan

Run these phases as sequential single-deliverable Codex runs. Each run leaves the app working, performs its manual MCP checks, then ends with `npm run typecheck`, `npm run lint`, and `npm run build-prod`. No implementation belongs in this planning task.

### 1a. Agent transport and live capability nodes (7 files)

- [x] In `src/ipc/capability-bus-channels.ts`, add an optional `asAgent` flag to the existing provider lookup and invoke request shapes only if needed to carry the mode. Do not add a caller-kind field. In `src/ipc/api-types.ts` and `src/ipc/renderer/api.ts`, add/forward the flag through existing capability endpoints as required.
- [x] In `src/ipc/main/core-handlers.ts`, map `asAgent: true` to `{ kind: "agent" }` for capability list/providers/get/invoke; preserve `{ kind: "platform" }` by default. Use the existing router's agent-filtered list/providers, `resolve`, `bindKey`, `authorize`, and invoke checks. Ensure an explicit invoke cannot call an absent or channel method. This is a deliberate access downgrade: the renderer already reaches the platform caller, and agent mode only hides `agent:false` methods and forbids channels.
- [x] In `src/renderer/scripting/ai-vision/namespaces/capabilities.ts`, keep `list()` and `handlers(id)` delegation and replace the read-only descriptor with the always-agent-view node. Add live `children` and string `index` for bracket-addressed ids. Root `$help` follows the rendered contract example and lists agent-visible ids, version/title, selected provider name and callable methods, then pointers to `tools` and `pages[i].editor.app`.
- [x] Add per-id `$help` in the contract format with selected provider/version, eligible provider keys/titles/versions, visible signatures, summaries, returns and timeouts. Add method properties/callables accepting positional JSON arguments. Default invocation resolves by normal rules on each call. `providers["key-or-name"]` pins the exact provider for that invocation without writing preferences; follow router handling for missing and ambiguous matches. Use the existing client transport with `asAgent: true` and `createCapabilityProxy`; do not use a second resolution path.
- [ ] Omit `agent:false` methods from help, members and pinned nodes. Show channel methods with `channel (not callable by agents)` and return a clear error if called without opening a channel. Preserve ordinary call/open results and router errors. `open` runs in the renderer targeted by MCP `call` and returns the router shape `{ pageId?, result }`.

Before → after snippets (the code shown is schematic around existing validation):

```ts
// src/ipc/main/core-handlers.ts — before
const bound = capabilityRouter.resolve({ kind: "platform" }, id, options);
// after
const caller = options?.asAgent ? { kind: "agent" as const } : { kind: "platform" as const };
const bound = capabilityRouter.resolve(caller, id, options);
```

```ts
// src/ipc/capability-bus-channels.ts — before
export interface CapabilityClientOptions { version?: number; provider?: string; filter?: { mime?: string; representation?: string } }
// after: add asAgent?: boolean to options and CapabilityClientInvoke; add it as an
// optional argument to capabilityList/capabilityProviders request signatures.
```

```ts
// src/ipc/api-types.ts — before
[Endpoint.capabilityProviders]: (id: string) => Promise<CapabilityClientResult<CapabilityProvider[]>>;
// after: preserve endpoint names and add the optional asAgent request argument
// (and corresponding capabilityList argument) to their typed signatures.
```

```ts
// src/ipc/renderer/api.ts — before
capabilityProviders = (id: string) => executeOnce<CapabilityClientResult<CapabilityProvider[]>>(Endpoint.capabilityProviders, id);
// after: forward optional asAgent to the existing endpoint; do the same for list.
```

```ts
// src/renderer/api/capabilities.ts — existing transport reused by the node
const provider = unwrapClientResult(await api.capabilityGet(id, options));
// agent node supplies { ...options, asAgent: true } and resolves again inside each invocation;
// createCapabilityProxy continues to expose only methods from the resolved provider.
```

```ts
// src/renderer/scripting/ai-vision/namespaces/capabilities.ts — before
help: "Use list() to inspect all registered platform and trusted-board capability candidates, or handlers(id, filter) to inspect one id. Discovery does not activate a handler.",
// after
children: () => this.children(),
index: key => typeof key === "string" ? this.capability(key) : undefined,
// help and indexed children are generated from the live agent-visible registry.
```

Manual MCP checks:

1. Call `capabilities.$help`, `capabilities.list()` and `capabilities.handlers("claudetest.echo")`; confirm both existing discovery methods still work.
2. Call `capabilities["claudetest.echo"].$help`; confirm its rendered provider and method entries match the contract.
3. Call `capabilities["claudetest.echo"].echo` with `args: ["x"]`, then call the same method through `providers["<actual key or name>"]`; confirm equal results and unchanged provider preferences.
4. Confirm `fail` is absent in default and pinned help/members, an explicit hidden-method attempt is denied, and `late` reports no handler. Confirm a visible channel is listed but its invocation returns a clear error without opening a channel.
5. Call `capabilities["claudetest.consumer"].relay`, `relaySlow` and `probe` with fixture-appropriate JSON; confirm they route through the existing client/router.

### 1b. Capability bridge timeout (2 files)

- [x] Add a named `CAPABILITY_AGENT_BRIDGE_ALLOWANCE_MS = 5_000` (or equivalent clear name) to `src/shared/capability-limits.ts`.
- [x] In `src/main/mcp/tools/call-tools.ts`, inspect parsed `capabilities[<id>][.providers[<provider>]].<method>` paths with `parsePath`, including parenthesized method paths. For an actual method call, query `capabilityRouter.providers({ kind: "agent" }, id)`; this is discovery only and starts no provider. Find agent-visible declarations for that method and use the maximum `timeoutMs`, restricted to matching provider key or name when pinned, then add the named allowance. If no candidate/method matches, retain the existing timeout policy. Do not resolve or bind a provider here; the renderer resolves at invocation time. Keep existing timeout rules for all non-capability paths.
- [x] For a `slow` declaration with `timeoutMs: 1_000`, verify the bridge budget is 6,000 ms; inspect the calculation for a maximum 600,000 ms declaration yielding 605,000 ms. Do not cap this through `automationWaitBridgeTimeout`.

Before → after:

```ts
// src/main/mcp/tools/call-tools.ts — before
const bridgeTimeoutMs = isBlockingRendererCall(forward.path)
    ? 125_000
    : remoteAppBridgeTimeout(forward.path, params.timeoutMs)
        ?? automationWaitBridgeTimeout(forward.path, Array.isArray(params.args) ? params.args : []);
// after: capability paths inspect eligible declarations without binding one;
// use max(method.timeoutMs) + CAPABILITY_AGENT_BRIDGE_ALLOWANCE_MS, else this policy.
```

```ts
// src/shared/capability-limits.ts — before
export const CAPABILITY_MAX_TIMEOUT_MS = 600_000;
// after
export const CAPABILITY_MAX_TIMEOUT_MS = 600_000;
export const CAPABILITY_AGENT_BRIDGE_ALLOWANCE_MS = 5_000;
```

Manual MCP checks:

1. Call `capabilities["claudetest.echo"].slow` with its fixture-appropriate args; verify the declared 1,000 ms router deadline precedes the 6,000 ms MCP bridge deadline.
2. Run `pages.$help`, `events.wait` with its normal arguments, and `windows[1].pages.$help`; confirm existing timeout policy and target-window routing remain intact.
3. Inspect the router/provider timeout calculation for 600,000 ms → 605,000 ms and for a pinned provider with a shorter timeout than another eligible provider; ensure only the pinned candidate set is considered.

### 2. Publish and reconcile the guides (4 files)

- [x] Add a capabilities task/reference row to `assets/guides/agents/index.md`, covering agent calls and provider/consumer guidance. The live `guides.agents.capabilities` tree entry is automatic; no separate tree implementation is required.
- [x] In `assets/guides/agents/capabilities.md`, replace the blanket draft banner with wording that distinguishes the implemented registry/client/agent surface from remaining bundled board and documentation migrations. Retain the agreed examples and authorization rules; correct only statements contradicted by the implementation.
- [x] Update `assets/guides/agents/boards.md` to point providers and consumers to `capabilities.md`, clarify that `appScripting` gates `persephone.call()` while capability access has its own grant rules, describe `getCapability` and provider preferences, and retain applicable legacy wrapper behavior.
- [x] Add the `persephone://guides/capabilities` resource and a concise capabilities pointer to server instructions in `src/main/mcp/manifest.ts`.

Before → after snippets:

```md
<!-- assets/guides/agents/capabilities.md — before -->
**Draft — not yet implemented (EPIC-140)**
<!-- after: registry/client/agent surface status is accurate; US-1797 and BT-087 migrations remain. -->
```

```md
<!-- assets/guides/agents/boards.md — before -->
`appScripting: true` grants board-frame access to `persephone.call()` and capability invocation.
<!-- after -->
`appScripting` gates `persephone.call()`; see [Capabilities](capabilities.md) for the unified API, grants and legacy invocation gates.
```

```md
<!-- assets/guides/agents/index.md — before -->
| Build or consume a board-backed coding-agent session | `persephone.services.connect("agent.session", ...)` | [Agent Session contract](./agent-session.md) / `guides.agents["agent-session"]` / `persephone://guides/agent-session` |
<!-- after: add a capabilities row beside the provider/consumer service-contract rows. -->
```

```ts
// src/main/mcp/manifest.ts — before
"For boards, use `boards.*` and `guides.agents.boards`; the `persephone://guides/boards` resource is an alternative.",
// after: add a capabilities pointer in instructions and register its guide resource.
```

Manual MCP checks:

1. Read `guides.agents.capabilities`, the agent guide index and `guides.agents.boards`; confirm the links and described caller gates match behavior.
2. Read the published capabilities resource through MCP and confirm it resolves to `assets/guides/agents/capabilities.md`.
3. Confirm the server instructions point agents to the capability guide.

## Concerns

- The requested `{pageId, result}` wording conflicts with the existing guide and router: `pageId` is optional when a handler settles without a page. Preserve the established result shape; normal page-opening results include it.
- MCP client interruption does not cancel an in-flight capability call before its deadline. The router still cancels the provider at the method's declared `timeoutMs`, and the bridge waits that duration plus 5 seconds. Record client-disconnect cancellation as a candidate for a later backlog item.
- The 1,000 ms `slow` fixture verifies deadline ordering but cannot demonstrate a method that exceeds the ordinary 30-second bridge timeout. Verify a longer declared deadline by code inspection or use an existing trusted provider with a longer declaration; do not modify fixtures or add a harness.
- The normative guide describes the epic-wide contract. Bundled board and architecture migration remain US-1797; external board migration remains BT-087.

## Acceptance Criteria

- [ ] The capability node always presents the agent view, whoever reaches it; `list()` and `handlers(id)` retain their legacy behavior.
- [ ] Live bracket-addressed ids, generated root/per-id help, default and pinned calls match the normative contract. Defaults resolve on every invocation; pinned calls do not change preferences.
- [ ] `asAgent` only restricts existing platform access; main applies the router's agent filtering and authorization. Hidden methods are absent and denied; channels are listed but cannot be invoked.
- [ ] The MCP bridge selects the largest eligible method timeout (or the pinned candidate's timeout) plus 5 seconds without pre-dispatch binding, and falls back to existing policy when no declaration matches.
- [ ] `open` runs in the MCP-targeted renderer and returns the existing router result, including optional `pageId` where permitted.
- [ ] Agent capabilities guide is available from the guide tree, overview and MCP resource; board guidance is consistent. No bundled board migration, architecture migration, tests or harnesses are added.
- [ ] Each implementation run completes its manual checks and `npm run typecheck`, `npm run lint`, `npm run build-prod`.

## Files Changed

| File | Planned change |
|---|---|
| `src/ipc/capability-bus-channels.ts` | Carry optional downgrade-only `asAgent` mode if required by request types. |
| `src/ipc/api-types.ts` | Type the existing capability endpoints with the optional mode if needed. |
| `src/ipc/renderer/api.ts` | Forward the optional mode through existing capability requests if needed. |
| `src/ipc/main/core-handlers.ts` | Map the flag to the router's agent caller for list/providers/get/invoke. |
| `src/renderer/scripting/ai-vision/namespaces/capabilities.ts` | Live agent-filtered root/id/provider nodes and help; retain legacy methods. |
| `src/main/mcp/tools/call-tools.ts` | Inspect capability method paths and derive safe bridge timeout without binding. |
| `src/shared/capability-limits.ts` | Name the 5,000 ms bridge allowance. |
| `assets/guides/agents/index.md` | Link the capability guide. |
| `assets/guides/agents/capabilities.md` | Correct implementation status and verified contradictions. |
| `assets/guides/agents/boards.md` | Point providers/consumers to the unified guide and fix `appScripting` wording. |
| `src/main/mcp/manifest.ts` | Publish MCP guide resource and server-instructions pointer. |

**No changes expected:** `src/main/capability-router.ts` and `src/main/capability-registry.ts` already provide agent filtering, resolution, authorization and routing; `src/shared/capability-client.ts` already creates method proxies; `src/renderer/scripting/ai-vision/namespaces/index.ts` already registers the capabilities descriptor; `src/main/mcp/ai-vision/guides.ts` already indexes guide files. `src/renderer/scripting/ai-vision/root.ts`, `src/renderer/scripting/ai-vision/call.ts`, and `src/renderer/api/mcp/call-command.ts` need no request-specific changes: the node always exposes the agent view. `doc/architecture/capability-bus.md`, bundled boards and persephone-boards are out of scope.

## Notes (verification, 2026-11-07)

Checked through Persephone MCP `call`: root and per-id `$help`; `capabilities["claudetest.echo"].echo` (caller `agent`); `fail` (`agent:false`) absent and not callable; pinned `providers["cap-test"].slow` → `timeout`; channel call refused with a clear error; `claudetest.consumer.relay` (outer caller `agent`, nested `board-service`); `text.open.open` returns `{pageId, result}` in the calling window; `guides.agents.capabilities` readable. Not exercised: `windows[1]` targeting, a method timeout above 30 s (checked by reading `call-tools.ts`).

Fixed during verification (Claude, in `namespaces/capabilities.ts`): the root list showed `agent:false` methods (now one `agentMethodList` helper; channel-only capabilities read "channels only (not callable by agents)"); unknown capability ids and provider names now throw `no-handler` with the valid names instead of the generic "primitive value" error; method help puts `Returns` and `Timeout` on their own lines.
