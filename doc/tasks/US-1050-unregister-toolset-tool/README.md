# US-1050 — `tools.unregisterToolset(root)` on the object model

**Status:** Completed · **Epic:** none

## Goal

Give an agent a supported way to unregister a toolset, closing the asymmetry with
`tools.requestToolsetRegistration` / the registration prompt. The member mirrors
`boards.unregisterBoard(boardRoot)` and is implemented over the existing
`toolsTrust.untrust(root)` (`src/renderer/api/tools/tools-trust.ts:83-91`), and is reached
through the live `call` tree's `tools` node (`src/renderer/scripting/ai-vision/root.ts:191-198`).

## Background

**The premise of this task changed twice.** It was written when Persephone shipped 34 MCP
tools, and it asked for a thirty-fifth: `unregister_toolset`, beside `refresh_toolset` in
`src/renderer/api/mcp/tool-commands.ts`. EPIC-090 deleted thirty-two of those tools and
US-1353 retired the last non-`call` one, so **the manifest is `call` alone**. There is no
`refresh_toolset` tool to sit beside any more, and adding a tool is now the one thing this
project has spent a whole roadmap undoing (`src/main/mcp/server-factory.ts:9-13`; `docs/whats-new.md:13-20`).

The capability itself is still missing, and the tell is unchanged: cleaning up a scratch
toolset requires reaching into the internal `toolsTrust.untrust` through `script.execute`;
the trust module explicitly keeps that capability off the public app/script surface
(`src/renderer/api/tools/tools-trust.ts:22-24`), while `ToolsNode` now lists
`search`, `execute`, `toolsets`, `createToolset`, and `unregisterToolset` members
(`src/renderer/scripting/ai-vision/namespaces/tools.ts:30-35`).
So the task survives with its **shape** replaced — not an MCP tool, an object-model member
reachable as the `call` path `tools.unregisterToolset` (`src/renderer/scripting/ai-vision/root.ts:191-198`).

### What already exists

| Thing | Where |
|---|---|
| The trust store and the idempotent removal | `src/renderer/api/tools/tools-trust.ts:48-57,83-91` — `listPaths()` exposes the loaded registered roots; `untrust(toolsetRoot)` normalizes, filters, updates state, and persists. |
| The exact precedent to mirror | `src/renderer/api/boards.ts:265-270` — `unregisterBoard(boardRoot)` dynamically imports trust, untrusts, dynamically imports `removePin`, and returns `Promise<void>`. |
| Why no dialog | `src/renderer/api/types/boards.d.ts:159-165` states: *"No dialog — untrusting only reduces privilege."* |
| The node that must expose it | `ToolsNode` in `src/renderer/scripting/ai-vision/namespaces/tools.ts:193-270`, returned by `AiRoot.tools` at `src/renderer/scripting/ai-vision/root.ts:197`. |
| The error standard to meet | `PageCollectionWrapper.showPage` rejects an unknown id and lists open ids (`src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:318-329`); the shared validator formats value, runtime type, valid choices, and an example (`src/shared/ai-vision/argument-validation.ts:152-160,225-245`). |

### The concern the original document flagged, now decided

*"Does it need a confirmation prompt like registration?"* — **No.** Registration grants the
app permission to run someone else's scripts with the user's privileges; unregistration takes
that permission away. A dialog on a privilege *reduction* trains the user to click through
dialogs, and `boards.unregisterBoard` already settled the identical question the same way.
Decision recorded; it is not to be re-opened during implementation
(`src/renderer/api/types/boards.d.ts:159-165`).

**Validation-before-untrust is also fixed.** The call must validate against the live registered
root list before importing or calling `toolsTrust.untrust`; this preserves the standing
no-silent-no-op rule implemented by `choiceRule`/`validateCallArguments`
(`src/shared/ai-vision/argument-validation.ts:88-103,139-161`) and prevents the underlying
idempotent removal from accepting a guessed root (`src/renderer/api/tools/tools-trust.ts:83-91`).

## Implementation plan

1. **`src/renderer/scripting/ai-vision/namespaces/tools.ts` — the model method.** The exact
   insertion point is in `ToolsNode`, immediately after `execute`
   (`src/renderer/scripting/ai-vision/namespaces/tools.ts:218-226`) and before `createToolset`
   (`src/renderer/scripting/ai-vision/namespaces/tools.ts:242-244`); this is the object returned
   by `AiRoot.tools` (`src/renderer/scripting/ai-vision/root.ts:197`).
   Add a method whose descriptor signature is `unregisterToolset(root: string)`, while the
   implementation accepts `unknown` so the shared validator can reject bad runtime input.
   Mirror `boards.unregisterBoard`'s dynamic import (`src/renderer/api/boards.ts:265-270`):
   after validation, dynamically import `toolsTrust`, await `toolsTrust.untrust(validRoot)`,
   then await `registeredTools.refresh()` as the completion barrier. The ordering is explicit
   and non-partial: read registered roots, validate the argument against that snapshot, untrust
   the root, await re-enumeration, and only then return
   (`src/renderer/api/tools/registered-tools.ts:113-171`).

   Before:

   ```ts
   async execute(toolId: string, args?: unknown): Promise<ToolRunResult> { /* ... */ }

   async createToolset(name: string, dir: string): Promise<unknown> { /* ... */ }
   ```

   After:

   ```ts
   async unregisterToolset(root: unknown): Promise<void> {
       requireInitialized();
       const registeredRoots = registeredTools.toolsets.map((toolset) => toolset.root);
       const [validRoot] = validateCallArguments(
           "tools.unregisterToolset",
           [root],
           TOOLS_UNREGISTER_ARGUMENTS(registeredRoots),
       );
       const { toolsTrust } = await import("../../../api/tools/tools-trust");
       await toolsTrust.untrust(validRoot);
       await registeredTools.refresh();
   }
   ```

2. **Validation before untrust; exact choices and messages.** Import `choiceRule` beside the
   existing validator and define `TOOLS_UNREGISTER_ARGUMENTS` beside
   `TOOLS_SEARCH_ARGUMENTS`
   (`src/renderer/scripting/ai-vision/namespaces/tools.ts:18-27`). Its choice provider is
   the registered-root snapshot from `registeredTools.toolsets`: the model defines
   `toolsets` as every currently registered root (`src/renderer/api/tools/registered-tools.ts:94-95`)
   and rebuilds that state from `toolsTrust.listPaths()`
   (`src/renderer/api/tools/registered-tools.ts:107-119`), while the namespace already reads
   the same live collection (`src/renderer/scripting/ai-vision/namespaces/tools.ts:150-170`).
   Call `requireInitialized()` before reading the roots and validation
   (`src/renderer/scripting/ai-vision/namespaces/tools.ts:52-54`) so the snapshot is live.

   Use this exact rule; do not hand-roll an error. For an explicitly supplied non-string value,
   the shared helper therefore produces this shape (example with `42`):

   ```ts
   const TOOLS_UNREGISTER_ARGUMENTS = (registeredRoots: readonly string[]) => [
       choiceRule(
           "root",
           registeredRoots,
           'tools.unregisterToolset("C:/path/to/toolset")',
           { expectedType: "string" },
       ),
   ] as const;
   ```

   ```text
   Invalid argument "root" for tools.unregisterToolset: received 42 (number); expected string; valid values: "C:/scratch/qa-probe". Example: tools.unregisterToolset("C:/path/to/toolset")
   ```

   For a string that is not registered, it produces this shape:

   ```text
   Invalid argument "root" for tools.unregisterToolset: received "C:/scratch/missing" (string); expected one of the current root values; valid values: "C:/scratch/qa-probe". Example: tools.unregisterToolset("C:/path/to/toolset")
   ```

   The value and runtime type come from `invalidArgument`
   (`src/shared/ai-vision/argument-validation.ts:225-234`), the list comes from the dynamic
   `choiceRule` provider (`src/shared/ai-vision/argument-validation.ts:88-103,243-254`), and
   an empty registered-root list is rendered as `(none)`
   (`src/shared/ai-vision/argument-validation.ts:252-254`). An omitted argument remains the
   validator's required-argument error with its value, type, and copy-paste example
   (`src/shared/ai-vision/argument-validation.ts:142-147`). An empty string is a string but is
   not in the current choices, so it takes the unregistered-root error path. The validation happens before
   `untrust`, so the first call succeeds and the second call fails after the explicit refresh;
   this deliberately turns `untrust`'s underlying idempotence
   (`src/renderer/api/tools/tools-trust.ts:83-91`) into the required no-silent-no-op behavior.
   Nothing mutates between the root snapshot and the validation result: the only state-changing
   operation is the later `untrust` call (`src/renderer/api/tools/tools-trust.ts:83-91`).

3. **Registry, sidebar, pin, and refresh findings.** No toolset pin exists: the pinned-item
   union contains only editors and boards (`src/renderer/ui/sidebar/pinned-items.ts:16-18`),
   whereas the tools sidebar derives its rows from `registeredTools.toolsets` and subscribes
   to that model (`src/renderer/ui/sidebar/TrustedToolsListView.ts:33-35,74-84`). There is no
   separate toolset registry row to delete. `toolsTrust.untrust` updates its reactive paths
   (`src/renderer/api/tools/tools-trust.ts:83-91`); `registeredTools` subscribes to that change
   and starts a refresh (`src/renderer/api/tools/registered-tools.ts:68-78`), and refresh
   rebuilds both the toolset records and flat tool list from the trust paths
   (`src/renderer/api/tools/registered-tools.ts:113-171`). Thus no extra pin/cache-removal
   operation is needed, but **the plan needs more than `toolsTrust.untrust`**: the subscription
   does already exist — `toolsTrust.subscribePaths(() => { void this.refresh(); })`
   (`src/renderer/api/tools/registered-tools.ts:68-78`) — but that refresh is explicitly
   fire-and-forget. Without the awaited refresh inside `unregisterToolset`, the method can return
   before the registry has re-enumerated, so an immediate `tools.search()` can still return the
   removed toolset's tools and make a successful unregistration look broken
   (`src/renderer/scripting/ai-vision/namespaces/tools.ts:208-226`). Awaiting
   `registeredTools.refresh()` makes the method's postcondition true when it returns: the trust
   list has been removed and the flat searchable/executable cache has been rebuilt
   (`src/renderer/api/tools/registered-tools.ts:113-171`). The subscription then starts a
   second, redundant refresh; that is harmless because v1 `refresh()` is a full re-enumeration
   regardless of its optional root hint (`src/renderer/api/tools/registered-tools.ts:107-113`).
   There is no public `tools.refreshToolset`; the existing public equivalent is the whole-registry
   `tools.toolsets.refresh()` (`src/renderer/scripting/ai-vision/namespaces/tools.ts:162-176`),
   while this method should await the internal `registeredTools.refresh()` directly. The existing
   registration flow uses the same explicit refresh after trust
   (`src/renderer/api/mcp/tool-commands.ts:153-163`).

4. **Descriptor summary and `$help`.** Add this member to `TOOLS_MEMBERS`
   (`src/renderer/scripting/ai-vision/namespaces/tools.ts:30-35`):

   ```ts
   { name: "unregisterToolset", kind: "method", signature: "unregisterToolset(root: string)",
     summary: "Remove toolset registration so its tools leave search and execution.",
     caution: "changes tool availability and persisted registration state" },
   ```

   The caution is required even though there is no confirmation dialog: `IAiMember.caution` is
   the marker for side-effecting/destructive methods (`src/shared/ai-vision/types.ts:21-24`),
   and the analogous `boards.unregisterBoard` member already says it changes availability and
   sidebar state (`src/renderer/scripting/ai-vision/namespaces/boards.ts:9-16`). The surrounding
   tools members likewise caution execution and scaffolding, but not read/search/refresh
   (`src/renderer/scripting/ai-vision/namespaces/tools.ts:30-35`). Add `$help` prose to the
   existing tools help (`src/renderer/scripting/ai-vision/namespaces/tools.ts:248-270`) stating:
   `unregisterToolset(root)` takes the **toolset root folder path** from `tools.toolsets`,
   requires a currently registered root, removes the tools from search and execution without
   deleting the folder, and needs no confirmation because it reduces privilege; use the caller's
   own `fs` call if folder deletion is intended. State that a repeated root errors
   (`src/renderer/scripting/ai-vision/namespaces/tools.ts:242-270`).

5. **Typings boundary.** The generic call entry remains typed by
   `src/renderer/api/types/app.d.ts:72-85`; the runtime `tools` node is owned by `AiRoot`, not
   an `app.tools` getter (`src/renderer/scripting/ai-vision/root.ts:164-198`;
   `src/renderer/scripting/api-wrapper/AppWrapper.ts:123-140`). Add a standalone
   `src/renderer/api/types/tools.d.ts` contract for the call-tree `ITools` node, including
   `unregisterToolset(root: string): Promise<void>`; do not add `tools` to `IApp`, because the
   runtime exposes it through `app.call` only. `assets/editor-types/` is copied from
   `src/renderer/api/types/` by the Vite plugin (`vite.renderer.config.ts:7-24`); never hand-edit
   the generated copy.

6. **QA.** Append `Test T.9` to `qa/surfaces/tools.md`, matching its existing
   `Preparation`/`Start`/`Call`/`Overview route`/`Verify` format (`qa/surfaces/tools.md:14-26`)
   and its call-only, scratch-folder policy (`qa/surfaces/tools.md:3-12`). Preparation is a user-registered scratch
   toolset outside the repo; call `tools.unregisterToolset("<scratch-root>")`, read
   `tools.search()` and `tools.toolsets.refresh()` to verify the root and its tools are absent,
   then call the same root again and a bogus root. Verify both calls throw the validator message
   with the value, runtime type, registered-root list, and copy-paste example; do not run a
   registered tool (`qa/surfaces/tools.md:10-12`).

7. **User docs.** Add one line under `## Version 5.0.0 (Upcoming)` / `### For agent integrations`
   in `docs/whats-new.md:9,41-55`, describing the new `call` path and the fact that it removes
   registration without deleting the folder.

## Files that need no changes

- `src/renderer/api/mcp/tool-commands.ts` — its current handlers remain the MCP adapters for
 search/refresh/create (`src/renderer/api/mcp/tool-commands.ts:33-166`); this task adds no separate MCP tool or handler because the
  manifest is `call` alone (`src/main/mcp/server-factory.ts:9-13`).
- `src/renderer/api/tools/tools-trust.ts` — its exact-match, persisted, idempotent `untrust`
  implementation is already correct (`src/renderer/api/tools/tools-trust.ts:48-57,83-91`);
  only its public caller is added.
- `src/renderer/api/types/app.d.ts` — generic `app.call` already covers the path
  (`src/renderer/api/types/app.d.ts:72-85`);
  it must not gain an `app.tools` property because `AppWrapper` exposes no such getter
  (`src/renderer/scripting/api-wrapper/AppWrapper.ts:123-140`).
- `assets/editor-types/*.d.ts` — generated from the source declarations (`vite.renderer.config.ts:7-24`).

## Concerns

- **Verifying the success path live may need a human.** Registering a toolset requires a trust
  dialog that an agent must not answer for itself, so an autonomous run can prove the error path
  and the member's presence but may have to leave the success path to the user. Record it as a
  Needs-user-check item rather than clicking the prompt (`src/renderer/api/mcp/tool-commands.ts:134-154`;
  `qa/surfaces/tools.md:75-93`). This does not reopen either recorded decision above.

## Acceptance criteria

- `call` with path `tools.unregisterToolset` and a registered root validates first, removes the
  exact root from trust, awaits the registry rebuild, and makes its toolset/tools absent from
  `tools.toolsets` and `tools.search` (`src/renderer/api/tools/tools-trust.ts:83-91`;
  `src/renderer/api/tools/registered-tools.ts:113-171`).
- A bogus, empty, or explicitly non-string root throws the shared-validator message naming the
  value and runtime type, listing registered roots or `(none)`, and including a copy-paste example
  (`src/shared/ai-vision/argument-validation.ts:142-160,225-254`).
- The same root succeeds once and fails on the second call; no confirmation dialog is raised
  (`src/renderer/api/types/boards.d.ts:159-165`; `src/renderer/api/tools/tools-trust.ts:83-91`).
- The member appears in `ToolsNode`'s members and `$help`
  (`src/renderer/scripting/ai-vision/namespaces/tools.ts:30-35,248-270`), and the standalone
  call-tree contract declares it (`src/renderer/api/types/tools.d.ts:1-27`); `app.call` remains
  the generic typed boundary (`src/renderer/api/types/app.d.ts:72-85`).
- `npm run typecheck`, `npm run lint`, and `npm run build-prod` are clean (`package.json:9-17`).

## Files changed (summary)

| File | Change |
|---|---|
| `src/renderer/scripting/ai-vision/namespaces/tools.ts` | `ToolsNode.unregisterToolset(root)`; validation, awaited registry refresh, member, and `$help` |
| `src/renderer/api/types/tools.d.ts` | standalone call-tree `ITools` declaration, including `unregisterToolset(root)` |
| `qa/surfaces/tools.md` | one manual T.9 scenario in the existing format |
| `docs/whats-new.md` | one 5.0.0 agent-integration line |

## Live verification (2026-09-07)

**Error paths verified through `call`:**

- `tools.unregisterToolset("C:/no/such/toolset")` → rejects, naming the value and its type and
  listing the currently registered roots with a copy-paste example.
- `tools.unregisterToolset(12345)` → rejects as a non-string, same message shape.

Both come from the shared validator (`src/shared/ai-vision/argument-validation.ts`), so they meet
the `showPage` standard the task asked for without a hand-written message.

**The success path was NOT exercised, deliberately — see Needs user check.**

## Needs user check

1. **The success path is unverified, by choice.** Proving it needs a toolset that is *registered*
   and then unregistered, and neither half was available to an autonomous run:
   - Registering a scratch toolset raises the **Register this toolset?** trust dialog, which an
     agent must never answer for itself — it grants the app permission to run scripts with the
     user's privileges.
   - The only registered toolsets on this machine are the user's real ones, and unregistering one to
     watch it disappear would remove a working integration to satisfy a test.

   So the check is one call, and it is the user's to make: unregister a throwaway toolset (or a real
   one you are willing to re-register) and confirm that `tools.toolsets` no longer lists it **and
   that `tools.search()` no longer returns its tools in the same breath**. The second half is the
   one that matters. `registeredTools` subscribes to trust changes with `void this.refresh()`
   (`src/renderer/api/tools/registered-tools.ts:76-77`) — fire-and-forget — so the method awaits
   `registeredTools.refresh()` itself to make its postcondition true on return. If a search
   immediately after unregistering still shows the tools, that await is not doing its job and this
   is the line to look at.
