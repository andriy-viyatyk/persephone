# EPIC-101: Structured descriptor access and the AiVision Explorer board

## Status

**Status:** Complete
**Created:** 2026-09-14
**Completed:** 2026-09-15

## Overview

Persephone's AiVision object model is only legible through an agent today. `$help` renders a
node's descriptor as prose for an LLM; there is no way for a *program* to read the same
descriptor as data. This epic adds one thing to the `ai-vision` library — a `$describe` path
segment, the structured sibling of `$help` — and then spends it on the artifact that proves it
works: an **AiVision Explorer** board in `persephone-boards` that browses the live model as a
tree, resolves paths, reads properties, calls methods, and follows the event stream.

The board is deliberately not Persephone code and not built on the MCP Inspector. It ships in
the public board catalog because the same viewer serves anyone building an app on `ai-vision`,
and because Persephone already routes a board's and a web page's own published model through
the same tree — so one board inspects all three.

## Goals

- Give any programmatic consumer of `ai-vision` structured access to a node's descriptor,
  without re-implementing the resolver's path walk.
- Ship an AiVision Explorer board that a board or web-app author can install and point at their
  own model, with no Persephone changes needed to host it.
- Keep the library addition host-agnostic: nothing in it should know about Persephone.
- Do not widen what a board can reach. `$describe` describes; it must not resolve anything a
  trusted board could not already resolve.

## Background — what already works, verified

The investigation that produced this epic established the following against the source. None of
it needs to be rediscovered.

**Boards already reach the same tree as the agent.** `persephone.call(path, options?)`
(`src/board-shim.ts:424`) crosses the board MessagePort to
`src/renderer/api/mcp/board-call-command.ts`, which calls `resolveAiCall` → `resolveCall(new
AiRoot(...))` — the *same* resolver and the *same* root the MCP `call` tool uses
(`src/renderer/api/mcp/call-command.ts`). Same descriptors, same `$help`.

**Board `aiVision` is the opposite direction and is not involved.**
`persephone.aiVision.expose(root)` (`board-api.d.ts:220-225`, `board-shim.ts:873`) *publishes* a
board's own model. It is what makes the Explorer able to inspect other boards; it is not how the
Explorer reads Persephone.

**Three differences from the agent's envelope**, all in `board-call-command.ts`:

1. `hints: "never"` is hardcoded (line 30), and the handler returns `{ result: result.result }`
   (line 57) — dropping `hint`, `warning`, `truncated`, `shown`/`total`, `events`, `pending` and
   `attention`. A board never sees the auto-hint block.
2. Scope is narrower than the guide implies: `AiRootOptions.page` (`ai-vision/root.ts:28`) only
   rebinds the `page` member to the hosting page. The rest of the root — `fs`, `proc`, `shell`,
   `script`, `boards`, `tools`, `settings` — is fully reachable from a *trusted* board.
3. `windows[i].*` and `main.*` are unreachable; the main process peels those off before
   forwarding. The Explorer is single-window by construction.

**What the board can already get, with no change at all:**

- `"<path>.$help"` → `buildHelp()`: long-form help + member list + live children, as **text**.
  The resolver answers the help segment before shaping (`resolver.js:33-38`), so it survives the
  board handler's `result.result` unwrap.
- `helpSearch(query, limit)` → structured `{ path, kind, matchedLine }[]`
  (`ai-vision/dist/core/help-search.d.ts`). A working search box today.
- An unknown member → a rejection whose message carries the member list (`forceMembers: true`).
- `events.recent()` / `events.wait()` → the Events panel.
- Reads, `value` assignment, and `args` invocation — "assign properties and call methods" is
  already fully supported.

**The one real gap.** A tree view needs `members` and `children()` as *data*. Today they exist
only as prose inside `$help`, or scraped out of an error string. `$help` is formatted for an LLM,
not a parser, and parsing it would couple the board to that formatting forever.

**Why this cannot be solved in Persephone.** The hard part is not producing the descriptor, it is
walking the path to the node that owns it: awaiting each hop, `index()`, live-child checks,
`restricted()` gates, method-vs-property handling. `resolveCall` returns a *shaped JSON value*,
not the live object, so a Persephone-side `describe()` cannot call `resolveCall` and then
`getAiVision()` on what comes back — the object is gone by then. It would have to duplicate the
resolver's walk. The walk belongs to the library.

## Design

### D1 — `$describe` is a path segment, not a root member

`$help` is already exactly the walk we need, ending in `buildHelp(path, descriptor)`. `$describe`
is the same walk ending in a projection of the descriptor to data. Making it a *segment* rather
than a method on a host root has three consequences worth stating:

- Every `ai-vision` host gets it for free, with no host-side wiring.
- **Persephone needs no code change for the board path.** `$describe` returns via `result`, and
  `board-call-command.ts:57` returns `result.result` — so it flows through the bridge untouched.
  No `AiRoot` member, no change to the hardcoded `hints: "never"`, no new bridge verb.
- It inherits `$help`'s "must be the last segment" rule and its gate semantics for free.

`IAiVisionDescriptor` (`ai-vision/dist/core/types.d.ts:59-80`) is already the shape we want to
return, so this is projection, not design: `members` is plain data; `children()` is awaited;
`help` is resolved when it is a function; `identity()` and `restricted()` are called.

### D2 — `$describe` matches `$help`'s restricted semantics exactly

In `resolver.js` the help branch answers *before* the landing node's `restricted()` gate, so a
restricted node still explains itself while nothing under it resolves. `$describe` must behave
identically, and must carry the `restricted` text in its payload rather than omitting the node.
Anything else would make `$describe` a way to see slightly more than `$help` — which is the one
thing this epic must not do.

### D3 — The agent keeps `$help`; `$describe` stays out of the tool description

`$describe` will be reachable by the agent, because the agent shares the resolver. That is fine.
It should **not** be advertised in the MCP `call` tool description or the root `$help` text:
prose is the better artifact for an LLM, and advertising two discovery verbs invites the agent to
pick the worse one. Documented for board and library authors, silent for the agent.

### D4 — The Explorer is a board, and a *trusted* board is a full-privilege console

This is the epic's main safety concern and it is a property of the viewer, not of `$describe`.
A trusted board reaches `proc`, `fs`, `shell`, `script` and `tools`. A viewer that renders a
"call this method" button next to every member is, by construction, a general-purpose remote for
all of it. The board must therefore:

- surface a member's `caution` text prominently wherever that member can be invoked or assigned,
- require an explicit per-invocation confirmation for any member carrying `caution`, never a
  remembered "don't ask again",
- never auto-invoke anything during tree expansion — expansion reads `children()` and `members`
  via `$describe` only, which the descriptor contract already guarantees is side-effect free.

Reads of ordinary properties during navigation are acceptable; reads of `caution` getters are not.

### D5 — One board, three kinds of model

The user's observation is correct and already supported by the code. Both `BoardEditorFacade`
(line 76) and `BrowserEditorFacade` (line 37) expose an `app` member holding the page's published
remote tree, and the boards guide already documents `$help`/`helpSearch` working on it
(`assets/guides/agents/boards.md`, "A board's own model: `.app`"). Because a board's
`persephone.call` sees the whole `pages` collection — only `page` is rebound — the Explorer can
root itself at:

1. `""` — Persephone's own object model;
2. `pages["<id>"].editor.app` — another **board's** published model;
3. `pages["<id>"].editor.app` — a **web page's** `window.__aiVision` model, auto-probed by
   `BrowserWebviewModel.probeAiVision` and origin-labelled (`page:` kind prefixes, the
   `[Page-authored data]` root stamp).

Same tree walker, three roots. A root picker is the whole feature. Note for the web-page case:
those summaries are third-party text by design and the labelling is the agreed mitigation — the
Explorer must render the `page:` prefix and origin stamp rather than normalising them away.

## Linked Tasks

| Task | Repo | Title | Status |
|------|------|-------|--------|
| US-1421 | persephone / ai-vision | `$describe`: structured descriptor access in the ai-vision resolver | Done — `ai-vision@1.2.0` published |
| US-1422 | persephone | Document `$describe` for board and library authors | Done |
| US-1423 | persephone | Root hint: prose overview, and a per-session hint reset on a root call | Done |
| BT-022 | persephone-boards | AiVision Explorer board — tree, path resolution, help and events | Done — published `aivision-explorer` v1.0.0 |
| BT-023 | persephone-boards | AiVision Explorer — one unified tree over every member (root picker dropped) | Done — published v1.0.3 |

### US-1421 — `$describe` in ai-vision

Work lands in the `C:\projects\ai-vision` checkout (currently `1.1.0`, matching Persephone's
`^1.1.0` registry dependency at `package.json:57`).

- `src/core/path-parser.ts` — add `{ type: "describe" }` to `PathSegment`; recognise the
  `$describe` literal beside the `$help` branch (dist line 106) with the same last-segment rule;
  add the `formatPath` case (dist line 71); update the grammar comment at the top of the file.
- `src/core/resolver.ts` — a branch beside `if (segment.type === "help")` (dist line 33)
  returning the projected descriptor as `result`, honouring D2.
- `src/core/hint.ts` — `buildDescription()` next to `buildHelp()`, plus its exported return type.
- Publish `1.2.0`; bump Persephone's dependency.

Because the dependency is a registry range and not a `file:` link, implementation needs either a
temporary link or a prerelease to test against Persephone before publishing. Decide which at the
task-document stage.

### US-1422 — Documentation

- `assets/guides/agents/boards.md` — a paragraph near the `persephone.call` section (line 301)
  covering `$describe`, its payload, and the caution/confirmation expectation from D4.
- Whether the board `call` envelope should also stop swallowing `warning` and `truncated` is an
  open question, deliberately **not** in scope here — see Concerns.

### BT-022 / BT-023 — The board

Standard `persephone-boards` workflow: work on `develop`, `board-manifest.json` version is the
publish trigger, `WHATS-NEW.md` per version, never hand-edit `boards-manifest.json` or any
`versions-manifest.json`. A `how-to/` recipe for reading the object model from a board is a
likely by-product worth capturing.

## Concerns / Open questions

1. **Should the board `call` envelope surface `warning` / `truncated` / `shown` / `total`?**
   Today the board cannot tell a truncated result from a complete one — it gets the value and
   nothing else. That is a genuine gap for a viewer that displays large results, and it is a
   Persephone-side change (`board-call-command.ts`), not a library one. Left out of scope so the
   epic can land; revisit once the board exists and we know whether it actually hurts.
2. ~~**`$describe` on remote proxies.**~~ **Resolved 2026-09-14.** Verified against the live Todo
   board at `pages[0].editor.app.$describe`: the synthesized proxy descriptor carries `kind`,
   `summary`, `members` (including `caution` and `writable` flags), `overview`, `help` and
   `children`, so the projection is complete. `expose()`'s own path walk answers `$describe` too,
   so a remote host resolving directly behaves the same. BT-023 is de-risked.
3. **Trust is a hard prerequisite.** Every path except a bare root `$help` is blocked for an
   untrusted board. The Explorer's first-run experience must explain that clearly rather than
   showing an empty tree with a resolver error.
4. **Single window.** No `windows[i].*`. If multi-window inspection is ever wanted, it needs a
   different transport, not a bigger board.

## Notes

### 2026-09-15 — Epic closed

**`$describe` shipped as a path segment and cost Persephone nothing on the board path**, exactly as
D1 predicted: `board-call-command.ts` returns `result.result`, so the projection flowed through the
bridge with no host wiring. One gap turned up at review — `routeCallPath` peeled `windows[i].` off
for every terminal segment *except* `describe`, so `windows[i].$describe` was forwarded to the
renderer instead of being answered by the main-process `WindowNode` the way `windows[i].$help` is.
One line in `call-tools.ts`; verified live against `windows[0].$describe`.

**D3 held.** `$describe` is documented for board and library authors (`assets/guides/boards.md`,
`assets/guides/agents/ai-vision.md`, `assets/board-template/CLAUDE.md`, and a demo-board button) and
stays out of the MCP `call` tool description and the root `$help`, so an agent is still pointed at
prose. A `windows[i].$describe` paragraph added to the agent-facing `agents/pages.md` during
`/document` was removed for the same reason.

**US-1423 was not in the original plan** and came out of using the board: the root hint rendered
`ROOT_OVERVIEW` and `ROOT_MEMBERS` back to back — the same 24 entries, twice, ~4.5 KB. The overview
is now prose about what Persephone is and what an agent can do with it; the members block keeps the
cautions and signatures. The second half was a real recovery defect: `seenKinds` lives in the
`callTools` closure, one set per MCP transport session, and a session outlives any client-side
context compaction — so an agent that lost its hints could never be sent a member list again. A
`call` with an empty path now clears the set, and the tool description says so, and says that
`<path>.$help` is safe on any path.

**The board is the artifact.** `aivision-explorer` is published (v1.0.3) and is the thing that
proves `$describe` is sufficient: it browses Persephone's own model, another board's, and a web
page's through the same tree walker. Its per-board notes live with it in `persephone-boards`.

**Concern 1 is still open, deliberately.** The board `call` envelope still swallows `warning`,
`truncated`, `shown` and `total`. Having built the viewer, it never hurt enough to fix — the
Explorer shows what it was given and does not claim completeness. It stays recorded here rather
than migrating to a task.

### 2026-09-14 — US-1421 landed (unpublished)

Implemented in `C:\projectsi-vision`, built clean, bumped to `1.2.0`:

- `src/core/path-parser.ts` — `$help` and `$describe` now share a `TERMINAL_SEGMENTS` table; both
  are terminal, both reject anything after them.
- `src/core/hint.ts` — `buildDescription()`, `IAiDescription`, `IAiDescriptionChild`. Each child
  carries the absolute `path` it resolves at alongside its raw `segment`.
- `src/core/resolver.ts` — the `describe` branch, placed beside `help` and ahead of the
  `restricted()` gate (D2).
- `src/remote/expose.ts` — the same branch in the remote host's `resolvePath`, so a board or web
  page that resolves paths itself answers `$describe` as well.
- `src/core/remote-proxy.ts` — `$describe` joins `$help` as a member name a remote model may not
  shadow (`TERMINAL_MEMBER_NAMES`).
- `README.md` + `CHANGELOG.md` updated; `AI_VISION_VERSION` bumped.

Verified: six-case synthetic run (root, node, restricted node, descriptor-less leaf, trailing
segment, `$help` unchanged), then against the running app — `pages.$describe` and
`pages[0].editor.app.$describe`. Persephone `npm run typecheck` passes with the new `PathSegment`
variant.

~~**Not published.**~~ **Published 2026-09-15.** `ai-vision@1.2.0` is on the registry and
`package-lock.json` resolves it from there with an integrity hash, so `npm ci` reproduces the build.
The hand-copied `node_modules` state this note described is gone.

### 2026-09-14
- Epic created from the investigation in this session. The REST-client-to-board blocker (the
  board CSP's `connect-src 'self'`) does **not** apply here: everything the Explorer does is
  bridge traffic, no network.
- Decision: `$describe` as a path segment rather than a root `describe(path)` method — it makes
  the Persephone-side change zero for the board path, and keeps the feature host-agnostic.
