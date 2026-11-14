---
title: "Capabilities"
audience: "agent"
summary: "How are capability manifests declared, resolved, and versioned?"
---

# Capabilities

**Status:** The unified registry, client API and agent surface are implemented, and bundled boards use the `methods` form. External board migration remains in BT-087 (EPIC-140).

This is the normative contract for the unified capability registry. A capability has an id, a major version and named methods. A provider can be a trusted board or `persephone`. A consumer can be a board page, board service, Persephone or an agent. Method-specific contracts, including [audio capture and playback](../audio.md), [speech synthesis](../speech-synthesize.md), [transcription](../speech-transcribe.md), [wake](../speech-wake.md) and [translation](../text-translate.md), continue to define their data and behavior. The examples below illustrate new methods, not a replacement for those v1 streaming contracts.

## Manifest

Declare `capabilities` as an array of at most 32 declarations. A board providing `call` or `channel` declares a `service` entry and `permissions.service: true`; `open` is served by its page. Providers using `persephone.capabilities.handle` must set `minBridgeVersion` to `1.50.0`. Board pages and services using `getCapability` must set `minBridgeVersion` to `1.51.0`. A declaration is independently rejected and reported in Board Info when invalid; other valid declarations remain available. Unknown fields are ignored. Limits below apply to new declarations; legacy normalization is specified separately.

| Field | Contract |
|---|---|
| `id` | Required string, at most 160 characters. At least two dot-separated segments matching `[a-z][a-z0-9-]*`; no `@`, slash or whitespace. Platform ids `audio`, `text.open`, `content.view`, `image.edit`, `diagram.edit`, `http.request.open`, `certificate.view`, `theme.edit`, `agent.session`, `speech.transcribe`, `speech.synthesize`, `speech.wake` and `text.translate` are reserved contracts; boards may implement them only in accordance with their platform contract. The entire `system.` prefix is reserved for Persephone itself; boards must not provide a `system.*` id. A board-owned id must not equal a reserved id or extend it with another segment. Board-owned ids should start with a vendor segment; the manifest's free-text `author` does not determine that segment. Boards declaring the same board-owned id are competing providers, resolved by the normal rules. |
| `version` | Positive safe integer major version; default `1`. Versions match exactly. |
| `title` | Optional string, trimmed, at most 120 characters; empty becomes absent. Display falls back to id. |
| `priority` | Finite number; default `50`; higher wins. |
| `accepts` | Optional array of nonempty MIME strings; absent means unrestricted, an empty array matches no supplied MIME. Matching is exact and case-sensitive, with no wildcard expansion. |
| `representation` | Optional nonempty string; absent means unrestricted. Every board `content.view` declaration must supply it. |
| `alwaysOpensNewPage` | Optional boolean, default `false`; applies to `open`. |
| `methods` | Required nonempty object for new declarations; at most 32 entries. Names match `[A-Za-z][A-Za-z0-9_]*`, maximum 64 characters; `providers`, `$help`, `provider` and `then` are reserved in new declarations; synthesized legacy method names are unaffected. As with any JSON object, a repeated method name keeps the last definition. |

Each method is an object with these fields; unknown fields are ignored.

| Field | Contract |
|---|---|
| `kind` | Required: `call`, `channel`, or `open`. |
| `summary` | Required nonempty string, at most 512 characters. |
| `args` | Optional ordered array, default `[]`, at most 16 descriptors. Each is `{ name, type, optional?, description? }`: `name` matches `[A-Za-z][A-Za-z0-9_]*` and is unique; `type` is a nonempty human-readable TypeScript type expression, at most 512 characters; `optional` is boolean, default `false`; `description` is an optional string of at most 512 characters. Required arguments precede optional arguments. |
| `returns` | Optional human-readable string, at most 512 characters; absent means unspecified. For `open`, this describes the method's `result` value only; the agent surface wraps it with the optional `pageId`. |
| `timeoutMs` | Positive safe integer milliseconds, default 10,000, maximum 600,000. End-to-end deadline for `call` and `open`, and channel establishment only for `channel`. |
| `agent` | Boolean, default `true`; `false` hides the method from agent discovery and invocation. Channels are never callable by agents. |

Descriptors describe positional JSON arguments, generate signatures and typed discovery, and are not an executable schema. Providers validate argument values and results; platform-defined payload checks such as `certificate.view` and `theme.edit` remain in force. `call` and `open` arguments/results must be JSON values (no `undefined`, non-finite numbers, functions, cycles or binary values); use `null` for no result. A channel method takes one JSON object argument, default `{}`, whose `type` is supplied by the router; it must not contain `type`. Channel data remains structured-cloneable, including binary data.


## Resolution and discovery

Main owns the trusted, enabled registry and removes registrations immediately on disable or trust revocation. `getCapability` resolves once and returns a provider-bound proxy; it never silently switches provider in flight. `providers(id)` lists all currently visible candidates, including losing versions and filters, without starting services. The platform provider key is `persephone`; `handlerKey` distinguishes registrations within it. A board provider key is the board's existing storage identity, `boardRootKey(root)` (`src/main/board-root-key.ts`: lowercase SHA-256 hex of the normalized board root). It needs no new persistence: it is stable across app restarts, board updates in place, disablement and trust changes, and a board at a different root (for example a development copy next to the installed one) is a different provider. Discovery also returns each provider's manifest `name`; agent paths and `getCapability({ provider })` accept that name in place of the key when exactly one visible provider of the capability has it, otherwise they reject `no-handler` and the caller must use the key. The legacy `services.list()` `provider` value stays as it is for the legacy wrappers.

For `getCapability`, filter by id and exact major (default 1), and requested MIME and representation. For an unpinned `invoke`, any eligible major may match. A missing candidate filter is unrestricted; representation otherwise matches exactly, and MIME is an exact array membership test. `content.view.open` derives representation from its payload. Then choose, in order: an explicit `provider` option; the user's eligible choice in the persisted Persephone setting `capabilities.preferredProviders` (an object mapping capability id to provider key); highest priority; platform on a tie; board registration order. An explicit provider that has no eligible candidate returns no proxy, never falls back. An unavailable or ineligible preference is ignored, not deleted. If multiple eligible registrations belong to the selected provider, apply priority and registration order within it. For filtering before binding, `getCapability` accepts `filter`; callers of payload-dependent `open` must supply it when needed. An omitted version on `getCapability` means major 1, not latest.


## Read next

| What you need | Page (object-model path) |
|---|---|
| Migration, client API, wire and authorization | [client-and-wire](client-and-wire.md) - `guides.agents.capabilities["client-and-wire"]` |
| Errors, agent calls and examples | [errors-agent-calls-examples](errors-agent-calls-examples.md) - `guides.agents.capabilities["errors-agent-calls-examples"]` |
