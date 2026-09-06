# US-1050 — `tools.unregisterToolset(root)` on the object model

**Status:** Planned · **Epic:** none

## Goal

Give an agent a supported way to unregister a toolset, closing the asymmetry with
`tools.requestToolsetRegistration` / the registration prompt. The member mirrors
`boards.unregisterBoard(boardRoot)` and is implemented over the existing
`toolsTrust.untrust(root)`.

## Background

**The premise of this task changed twice.** It was written when Persephone shipped 34 MCP
tools, and it asked for a thirty-fifth: `unregister_toolset`, beside `refresh_toolset` in
`src/renderer/api/mcp/tool-commands.ts`. EPIC-090 deleted thirty-two of those tools and
US-1353 retired the last non-`call` one, so **the manifest is `call` alone**. There is no
`refresh_toolset` tool to sit beside any more, and adding a tool is now the one thing this
project has spent a whole roadmap undoing.

The capability itself is still missing, and the tell is unchanged: cleaning up a scratch
toolset requires reaching into the internal `toolsTrust.untrust` through `script.execute`.
So the task survives with its **shape** replaced — not an MCP tool, an object-model member
reachable as the `call` path `tools.unregisterToolset`.

### What already exists

| Thing | Where |
|---|---|
| The trust store and the idempotent removal | `src/renderer/api/tools/tools-trust.ts` — `ToolsTrust.untrust(toolsetRoot)` (line ~84); filters the trusted-paths list with `fpNormalizeForCompare`, persists via `fs.saveDataFile`. Already idempotent, already exact-match-normalised. |
| The exact precedent to mirror | `src/renderer/api/boards.ts` — `unregisterBoard(boardRoot)` (line ~265): `boardTrust.untrust(root)` then `removePin(...)`, returns `Promise<void>`, **no dialog**. |
| Why no dialog | `src/renderer/api/types/boards.d.ts` (~line 160) states the rule in one line: *"No dialog — untrusting only reduces privilege."* |
| The node that must expose it | the `tools` namespace under `src/renderer/scripting/ai-vision/namespaces/` |
| The error standard to meet | `pages.showPage` — an unknown id throws and **lists the valid ids**. EPIC-091's standing rule: never let a node silently accept guessed input. |

### The concern the original document flagged, now decided

*"Does it need a confirmation prompt like registration?"* — **No.** Registration grants the
app permission to run someone else's scripts with the user's privileges; unregistration takes
that permission away. A dialog on a privilege *reduction* trains the user to click through
dialogs, and `boards.unregisterBoard` already settled the identical question the same way.
Decision recorded; it is not to be re-opened during implementation.

## Implementation plan

1. **`src/renderer/api/tools/` — the model method.** Add `unregisterToolset(toolsetRoot: string):
   Promise<void>` on the public tools API object (the same object that owns `search` /
   `execute` / the toolset members), implemented as `await toolsTrust.untrust(toolsetRoot)`.
   Follow `boards.unregisterBoard`'s dynamic-import style. If toolsets carry a pin or a
   registry entry the way boards do, remove it here too; if they do not, do nothing extra and
   say so in a comment.
2. **Validation before the call.** Reject a non-string / empty `root` and a root that is not
   currently registered, throwing an actionable message in the `showPage` house style:
   `` `"<root>" is not a registered toolset root. Registered roots: <a, b, c>.` `` — and when
   none are registered, say that instead of printing an empty list. Use the shared
   argument-validation helper (the one `addEditorPage`, `deleteRows`, `openUrl` and `highlight`
   use — EPIC-091 spread it across the surface; reuse it, do not hand-roll a message).
   **Idempotence note:** `untrust` is idempotent by construction, but an unregistered root is
   still an agent mistake worth reporting, so the *validation* is what makes this call fail —
   deliberately, matching the epic's "no silent no-op" rule. Unregistering the same root twice
   therefore errors the second time, exactly as `closePage` on a closed page will after
   EPIC-091.
3. **Expose it on the `tools` node** under `src/renderer/scripting/ai-vision/namespaces/` with a
   member summary and a `[CAUTION: ...]`-free line (it reduces privilege), plus `$help` text
   naming the argument as the **toolset root folder path** and stating that the folder itself is
   not deleted — that stays the caller's own `fs` call.
4. **Typings.** Add the method to the tools declaration under `src/renderer/api/types/`.
   `assets/editor-types/*.d.ts` is generated — never hand-edit it.
5. **QA.** Add one scenario line to the tools surface file `qa/surfaces/tools.md`: unregister a
   scratch toolset root through `call`, and assert the error path against a bogus root.
6. **User docs.** One line in `docs/whats-new.md` under `## Version 5.0.0 (Upcoming)`.

## Files that need no changes

- `src/renderer/api/mcp/tool-commands.ts` — the MCP tool layer this task originally targeted is
  gone; do not add anything there.
- `src/renderer/api/tools/tools-trust.ts` — `untrust` is already correct and idempotent.
- `assets/editor-types/*.d.ts` — generated.

## Concerns / open questions

- **Verifying the success path live may need a human.** Registering a toolset requires a trust
  dialog that an agent must not answer for itself, so an autonomous run can prove the error path
  and the member's presence but may have to leave the success path to the user. Record it as a
  Needs-user-check item rather than clicking the prompt.

## Acceptance criteria

- `call` with path `tools.unregisterToolset` and a registered root removes it from the trust
  store; a re-read of the toolset list no longer shows it.
- A bogus / non-string root throws an error naming the value and listing the registered roots.
- No confirmation dialog is raised.
- The member appears in the `tools` node's members and `$help`, and in `src/renderer/api/types/`.
- `npm run typecheck`, `npm run lint`, `npm run build-prod` clean.

## Files changed (summary)

| File | Change |
|---|---|
| `src/renderer/api/tools/*` | new `unregisterToolset(root)` model method |
| `src/renderer/scripting/ai-vision/namespaces/*` (tools node) | member + `$help` |
| `src/renderer/api/types/*` | typings |
| `qa/surfaces/tools.md` | one scenario |
| `docs/whats-new.md` | one 5.0.0 line |
