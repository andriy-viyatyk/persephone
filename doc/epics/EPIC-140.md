# EPIC-140: Capabilities — one registry for boards, Persephone and agents

## Status

**Status:** Draft — design for user review
**Created:** 2026-11-07
**Completed:** —

## Overview

Persephone has two separate ways for one module to ask another to do work, and agents can use
neither directly:

- the **capability bus**: page intents such as `image.edit`, `certificate.view`, `theme.edit`;
- **board service interfaces**: streaming channels to headless board services, such as
  `speech.transcribe`, `speech.synthesize`, `speech.wake`, `text.translate` and `agent.session`.

This epic merges them into one concept, the **capability**. A board, or Persephone itself,
registers a capability. Any board page, board service, Persephone code or agent checks whether it
exists and uses it the same way:

```js
const speech = await persephone.getCapability("speech.synthesize");
if (speech) await speech.speak("Hello");
```

Agents get a `capabilities` branch at the root of the `call` tree, next to `pages`, and call
capability methods like any other path. Providers can add **agent-shaped methods**, so an agent
uses an existing capability instead of building its own tool. An example is one call that
records a minute of speech and writes the text to a file.

## User requirements (2026-11-07)

- **One concept**, usable by boards, Persephone and agents alike. The code shape above.
- **Agents see capabilities in the object model.** The new branch at the `call` root lists every
  registered capability with `$help`, callable like any other path. No new MCP tools.
- **Rework, don't bolt on.** Redesign the capability bus and the service interfaces into this one
  concept.
- **Shape capabilities for agents.** Persephone is a platform for agents too, so some capabilities
  get simple agent-friendly methods on top of their streaming contracts.
- **First consumer: EPIC-139** (voice assistant, paused). It needs:
  - `speak()` and `stop()` from `speech.synthesize`, callable by agents;
  - an `audio` capability (capture and playback) that Persephone itself provides.

## Background

See [US-1792](../tasks/US-1792-capabilities-inventory/README.md) for the verified inventory. The
facts the design rests on:

- **Capability bus** ([capability-bus.md](../architecture/capability-bus.md)). Each renderer
  builds its own index from:
  - the built-in editor table (`text.open`, `content.view`);
  - the `capabilities` array of each trusted board manifest.

  `invoke(id, payload)` resolves one handler by version, filters, priority and platform
  tie-break, then opens a page and returns `{ pageId, result }`. A `headless` declaration exists
  but resolves to `no-handler`.
- **Service interfaces.** The manifest fields are `service` (the utility-process entry),
  `serviceInterfaces` (what the board provides) and `uses` (what it may consume).
  - Board pages use `persephone.services.list/connect` to open an ordered, bidirectional channel
    with backpressure. Versions match exactly.
  - Main authorizes every channel: trust, the `uses` grant, and the provider declaration.
  - The app reaches only allowlisted interfaces (`HOST_SERVICE_CHANNEL_POLICIES`).
- **Board services can't consume anything.** Their host API offers `onRequest` and `onChannel`
  only: no capability client, no cross-board service client, and no audio.
- **Agents:**
  - The `call` root already has a `capabilities` node, but it only offers `list()` and
    `handlers()`.
  - To invoke anything, an agent needs the full-privilege `script.execute`.
  - Agents can't discover or reach service interfaces at all.
- **Separate, and staying separate:**
  - Agent Tools (user-registered OS-process scripts, user-mediated trust);
  - board object models (`pages[i].editor.app`, scoped to an open page);
  - site-extension actions (scoped to a browser document).

## Design decisions (proposed by Claude, 2026-11-07 — reasons recorded)

1. **A capability is an id, a major version and a set of methods.**
   - The id is dot-separated (`speech.synthesize`, `image.edit`).
     - Platform-reserved ids stay reserved: the bus's well-known ids and today's
       `PLATFORM_SERVICE_INTERFACE_IDS`.
     - Board-owned ids use the author as a prefix (`acme.chart.render`).
     - The service-interface `author/name` form is retired. No board declares one today.
   - Every method has one of three **kinds**:

     | Kind | Shape | Provided by | Today's equivalent |
     |---|---|---|---|
     | `call` | JSON arguments in, one JSON result out, with a declared timeout | a board service, or Persephone | the service `onRequest`, without the routing |
     | `channel` | opens an ordered, bidirectional stream; returns a handle with `send`, events, `close()` and backpressure | a board service, or Persephone | a service-interface open type (`listen`, `transcribe`, `speak`) |
     | `open` | payload in; opens or reuses a page and returns `{ pageId, result }` | a board page, or a Persephone editor | a capability-bus intent |

   - **Why one concept with three kinds:** bus intents and service interfaces differ in *how*
     they run, not in what they are. Both are named work that a provider offers to consumers.
     Keeping the kinds explicit keeps today's lifetimes intact: pages stay pages, and streams
     keep their backpressure.
2. **One manifest declaration.** `capabilities` becomes the single field.
   ```json
   "capabilities": [{
     "id": "speech.synthesize", "version": 1, "title": "Text to speech",
     "methods": {
       "speak": { "kind": "call", "summary": "Speak text aloud; resolves when finished or interrupted.",
                  "args": [{ "name": "text", "type": "string" },
                           { "name": "options", "type": "{ lang?, voice?, speed? }", "optional": true }],
                  "timeoutMs": 600000 },
       "stop":  { "kind": "call", "summary": "Stop all current speech." },
       "stream": { "kind": "channel", "summary": "Streamed synthesis: PCM chunks per sentence." }
     }
   }]
   ```
   - `call` and `channel` methods are served by the board's `service`. `open` methods are served
     by the board page, as bus intents are today.
   - Each method's `summary` and `args` generate the agent `$help` and the typed discovery result.
   - **Migration.**
     - Old `capabilities` entries without `methods` read as one `open` method named `open`.
     - Old `serviceInterfaces` entries read as a capability whose channel methods are named after
       the interface's open types.
     - Both forms keep working: boards installed on users' machines must not break. Our own
       boards migrate within this epic.
3. **Main owns the registry and the routing.**
   - Today the bus index is rebuilt in every renderer, and service routing already lives in main.
     A capability must reach board services and agents without any page open, so main becomes the
     single authority: one index of platform and board capabilities, with trust, enabled state
     and versions.
   - `call` and `channel` go to the provider's utility process, started lazily as services are
     today. `open` goes to a renderer, using today's page-intent path.
   - Persephone's own capabilities (`text.open`, `content.view`, and EPIC-139's `audio`) register
     as provider `persephone`. Each one runs where it has to: a renderer for page intents, the
     hidden audio window for `audio`.
4. **One resolution rule.**
   - The steps, in order:
     1. filter by exact major version, and by `accepts` / `representation` where declared;
     2. take the user's chosen provider, if one is set;
     3. take the highest `priority`;
     4. on a tie, the platform wins;
     5. after that, the board registration order.
   - `getCapability(id, { version?, provider? })` resolves once, then returns a proxy bound to
     that provider. `providers(id)` lists all candidates for choosing.
   - **Why:** this is the bus rule plus the services' exact-version rule. The "user's chosen
     provider" step is new, because two boards can both provide `speech.transcribe`.
5. **The same client API everywhere.**

   | Caller | Access | Gate |
   |---|---|---|
   | Board page | `persephone.getCapability(id)` | the capability listed in the board's `uses` (existing grant model, shown in the trust dialog) |
   | Board service | the same `persephone.getCapability(id)`, **new**: injected into the service host and routed by main | same `uses` grant |
   | Persephone renderer | `app.capabilities.get(id)` | none (platform) |
   | Agent (MCP `call`) | `capabilities["speech.synthesize"].speak("Hi")` | a provider can hide a method from agents (`"agent": false`) |

   - The old surfaces become thin wrappers over the new registry:
     `persephone.capabilities.invoke` and `.list`, `persephone.services.connect` and `.list`, and
     `app.capabilities.invoke`. The bridge version is bumped.
   - **Why board services get a client:** a provider must be able to build an agent-shaped method
     from other capabilities. For example, `speech.transcribe` `record` uses Persephone's `audio`
     capability.
6. **Agent surface.**
   - The `capabilities` root node gets one child per capability id. Each child has:
     - `$help` generated from the declaration, listing its providers;
     - its `call` and `open` methods as callable members;
     - its `channel` methods listed with a note that agents can't call them.

     Today's `list()` and `handlers()` stay.
   - `call` methods run with their declared timeout, and the MCP bridge timeout is derived from it
     (today's per-path timeout pattern).
   - **Why channels aren't callable:** an MCP call is one request and one result. Streaming stays
     for code: boards, services, and `script.execute`.
7. **Agent-shaped methods live in the providing board** *(user requirement, Claude's placement)*.
   - The board knows its engine, its limits and its errors, so it declares simple `call` methods
     next to its streaming ones. Examples:
     - `speech.transcribe`: `record({ seconds, file?, source? })` returns the text and, with
       `file`, also writes it there;
     - `speech.transcribe`: `transcribeFile(path)`;
     - `speech.synthesize`: `speak` and `stop`;
     - `text.translate`: `translate(text, to)`.
   - Persephone provides only platform capabilities. It doesn't build adapters over other boards'
     contracts.
8. **What stays out of the registry.**
   - Agent Tools, board object models and site actions keep their own trust and scoping.
   - The `capabilities` `$help` points to `tools` and `pages[i].editor.app` as the other places to
     look.
   - **Why:** tools are user-registered OS processes behind a user-only trust step, and models and
     actions exist only while their page or document is open. Folding them in would blur those
     boundaries.

## Phases and tasks

| Task | Repo | Title | Status |
|------|------|-------|--------|
| US-1792 | persephone | Research: inventory of capability-like mechanisms | Done (pending epic review) |
| US-1793 | persephone | Capability contract: manifest schema, method kinds, resolution, authorization, wire messages — the normative guide `assets/guides/agents/capabilities.md` | Planned |
| US-1794 | persephone | Main-process registry and routing: one index (platform + boards), `call` / `channel` to services, `open` to renderers, legacy declarations mapped | Planned |
| US-1795 | persephone | Client API: `persephone.getCapability` for board pages and board services, `app.capabilities.get`; legacy APIs as wrappers; bridge version bump | Planned |
| US-1796 | persephone | Agent surface: per-capability nodes in the `call` tree, generated `$help`, callable `call` / `open` methods, derived timeouts; guides | Planned |
| US-1797 | persephone | Migrate bundled boards (Excalidraw, REST Client) and the docs (`capability-bus.md` → `capabilities.md`) | Planned |
| BT-087 | persephone-boards | Migrate the boards' declarations (Certificate Viewer, Theme Editor, Speech to Text, Text to Speech, Wake Word, Translate, Agent Chat) and add agent-shaped methods (`record`, `transcribeFile`, `speak`, `stop`, `translate`) | Planned |

**Order:** US-1793 → US-1794 → US-1795 and US-1796 in parallel → US-1797 and BT-087. EPIC-139
then resumes: its `audio` capability (US-1790) becomes a platform capability, and its US-1791 is
replaced by this epic.

## Concerns

- **Released surfaces.** Board authors and installed boards use `persephone.capabilities` and
  `persephone.services` today. Decision 2's mapping and decision 5's wrappers keep them working.
  Removing them is a later, separate decision.
- **Agents gain direct calls into board services.** A provider's methods become callable without
  `script.execute`. The protections:
  - only declared methods are reachable;
  - a provider can hide a method from agents;
  - trust and `uses` stay as they are.

  The agent already has full Persephone access through `script.execute`, so this adds
  convenience, not power.
- **Moving the index to main** changes when registrations become visible to renderers. Today
  each renderer rebuilds its own index. US-1794 must keep "untrust or disable removes the
  registration at once".
- **Long `call` methods** such as speech or recording must have declared timeouts and must be
  cancellable when the caller goes away (agent turn interrupted, page closed).

## Notes

### 2026-11-07
- Started from the EPIC-139 redesign. The voice assistant moved into the Agent Chat board, and
  the agent should speak by calling the Text to Speech board through Persephone's object model.
  The user generalized this: capabilities should be one well-designed concept that boards,
  Persephone and agents all use, and the existing ones (for example Excalidraw's) should be
  redesigned into it.
- The user added that capabilities may be shaped for agents. Example: record a time interval
  with speech to text and write the text to a file, instead of the agent building its own tool.
