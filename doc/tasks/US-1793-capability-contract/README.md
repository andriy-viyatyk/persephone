# US-1793: Capability contract

## Goal

Specify the unified capability contract for board authors and implementers of [EPIC-140](../../epics/EPIC-140.md), before implementation. The guide is a draft and is not yet published in the guide indexes or MCP manifest.

## Background

[US-1792](../US-1792-capabilities-inventory/README.md) inventories the existing surfaces. The new contract preserves the intent lifecycle, filters and legacy results described in [capability-bus.md](../../architecture/capability-bus.md) and the limits and codes in [capability-bus-channels.ts](../../../src/ipc/capability-bus-channels.ts). Existing renderer payloads and board APIs are in [capabilities.d.ts](../../../src/renderer/api/types/capabilities.d.ts) and [board-api.d.ts](../../../src/renderer/editors/board/board-api.d.ts). [board-manifest-utils.ts](../../../src/shared/board-manifest-utils.ts) normalizes service declarations and grants; [module-service-supervisor.ts](../../../src/main/module-service-supervisor.ts) authorizes channels and records host open types; [module-service-host.mjs](../../../assets/module-service-host.mjs) provides `onRequest` and `onChannel`. The [boards guide](../../../assets/guides/agents/boards.md), [synthesis](../../../assets/guides/agents/speech-synthesize.md), [transcription](../../../assets/guides/agents/speech-transcribe.md), [wake](../../../assets/guides/agents/speech-wake.md) and [translation](../../../assets/guides/agents/text-translate.md) specify existing board and streaming behavior.

## Implementation plan

- [x] Write [capabilities.md](../../../assets/guides/agents/capabilities.md) as the draft normative schema, migration, routing, API, authorization and examples.
- [x] Link this task in [active-work.md](../../active-work.md) and mark it Planned (documented) in [EPIC-140.md](../../epics/EPIC-140.md).
- [x] Leave `src/main/mcp/manifest.ts`, guide indexes, other guides and all code unchanged; US-1796 publishes the guide.

## Decisions beyond the epic

- Ordered positional descriptors use readable TypeScript type expressions; they generate signatures and discovery without imposing a second runtime validator on providers.
- New declarations have bounded metadata, a 10-second default and 10-minute maximum deadline. Major 1 is the default; `capabilities.preferredProviders` stores selections, and explicit provider selection never falls back.
- Legacy open types come from the existing host policy or optional `openTypes`. Unknown legacy types continue through `services.connect`, so undeclared types are not guessed or broken.
- The new `uses`-gated API does not require `appScripting`; legacy bus wrappers retain that gate. The agent bridge adds five seconds to the resolved deadline.
- Common errors extend the bus union for authorization and channel flow control. New `call`/`open` values are JSON; channel data retains structured clone.
- Board-owned ids should use a vendor prefix but do not derive it from free-text `author`; reserved ids cannot be extended, and `system.*` is platform-only. EPIC-139's audio capability is `system.audio`.
- Board provider keys are `boardRootKey(root)` (existing stable SHA-256 of the normalized root, `src/main/board-root-key.ts`), so no new persistence is needed; a different root is a different provider. Agents and `getCapability` may use the manifest `name` instead when it is unique among the capability's providers. Claude replaced Codex's persisted-UUID proposal on review: the root key already exists and is stable.
- New board-page `open` calls use the disclosed `uses` grant without `appScripting`; providers validate payloads. Legacy synthesized channel names are exempt from new method-name grammar.
- Agent opens target the MCP-selected window. Service handlers register synchronously at startup; an unregistered call after startup fails immediately. Rendered agent help examples specify the discovery format.

## Concerns / open questions

- EPIC-139 must specify the actual `system.audio` API and capture consent; this guide's service example deliberately treats those as provider-owned helpers.
- US-1794 through US-1796 must coordinate provider identity, legacy wrapper compatibility, cancellation propagation and the released bridge version. The guide specifies behavior, not current implementation.

## Acceptance criteria

- [x] Draft guide defines schema, legacy mapping, all three method kinds and messages, resolution, client and agent APIs, authorization, errors and provider/consumer examples.
- [x] Existing contracts are cited here and compatibility is explicit; no implementation or publication links are changed.
- [x] Dashboard links this document and the epic records Planned (documented).

## Files Changed

| File | Change |
|---|---|
| `assets/guides/agents/capabilities.md` | Draft normative capability contract. |
| `doc/tasks/US-1793-capability-contract/README.md` | Task record and decisions. |
| `doc/active-work.md` | Link the task. |
| `doc/epics/EPIC-140.md` | Record documented status. |
