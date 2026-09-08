# US-1400: Guides, What's New, and the EPIC-099 gate

## Goal

Document the agent event channel for the audiences that need it — agents, board authors, and
users — and run [EPIC-099](../../epics/EPIC-099.md)'s gate: a `qa/surfaces/` page for the surface
and a `qa/runs/` entry recording both the mechanical verification and the weak-agent walkthrough.

## Background

US-1397, US-1398 and US-1399 are implemented and committed on `upcoming-v5.0.1`. What exists:

- an `events` block on every forwarded `call` result — the newest three entries this MCP session
  has not seen, plus `+N earlier events; read events.recent()`;
- an `events` root node (`recent`, `since`, `count`, `wait`), the wait bounded at 50 s by default
  and 110 s explicitly, returning `{ pending: true, waitedMs }` at the bound;
- producers for a board `refresh()` / reload, a browser navigation in a tab that has registered a
  model, a dialog the user answered, a guide button the user pressed, and a `notify(text)` from a
  board or a page;
- a browser page's shape signal over a CDP `Runtime.addBinding` function, with lazy revalidation of
  `window.__aiVision.version` as the correctness floor;
- `ui.guide.step(elementName, message, { buttons?, timeoutMs? })` and `ui.guide.end()`.

## Implementation plan

### 1. Documentation (delegated)

- A new `assets/guides/agents/events.md`, discovered through `src/shared/guides/index.ts`, and a
  pointer from `assets/guides/agents/index.md`.
- `assets/guides/agents/browser.md`: the shape-change signal, and what to do on a `shape-changed`.
- `assets/guides/agents/boards.md` and `assets/board-template/CLAUDE.md`: `remote.notify(text)`,
  the extended `refresh()`, and the limits (one line, 512 characters, five per minute, trusted
  boards only, labelled board-written).
- `assets/guides/screens/*`: the one-line distinction — `ui.elements` names the controls,
  `ui.highlight` points at one, `ui.guide.step` points at one **and waits for the user**.
- `assets/guides/whats-new.md`, under `## Version 5.0.1 (Upcoming)`, written for a user.
- `doc/architecture/key-files.md` and `doc/architecture/scripting.md` rows for `event-log.ts`,
  `namespaces/events.ts`, `namespaces/ui-guide.ts`, and the new CDP event path in
  `src/main/cdp-service.ts`.

### 2. The gate (not delegated — QA runs are the reviewing agent's, per `doc/agents-common.md`)

- A new `qa/surfaces/events.md` and its row in `qa/surfaces/README.md`.
- A `qa/runs/2026-09-08-epic-099-events.md` recording the mechanical run and the weak-agent
  walkthrough, iteration by iteration.

## Acceptance criteria

- [ ] `guides.agents.events` resolves and reads correctly through `call`.
- [ ] The board template and the boards guide describe `notify` and its limits.
- [ ] What's New has a user-facing 5.0.1 entry.
- [ ] `qa/surfaces/events.md` exists and is listed in `qa/surfaces/README.md`.
- [ ] `qa/runs/2026-09-08-epic-099-events.md` records every gate item with a verdict.
- [ ] The weak-agent walkthrough is recorded with each iteration's failure and the text that fixed
      it, or with the note that it passed first time.
