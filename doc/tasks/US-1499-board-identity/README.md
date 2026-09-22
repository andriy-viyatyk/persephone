# US-1499 — Board identity: shared namespace, author + name requirement, scaffolding

**Status:** Planned · **Epic:** [EPIC-111: Board settings](../../epics/EPIC-111.md) · **Depends on:** none

This is an investigation and implementation plan only. It does not implement the changes, add a
settings feature, add tests or a test harness, commit anything, or modify the dashboard/epic files.

## Goal

Establish one reusable board-identity seam for board vars and the later board-settings work, while
making Persephone-created boards carry the identity that S7 requires. Preserve existing namespace
semantics for existing boards and document the deliberate consequence that changing identity fields
orphans existing board vars; no migration is part of this task.

## Background

### Settled EPIC-111 decisions in scope

- **S4:** settings reuse resolveBoardNamespace(); there is no second identity scheme. The
  namespace is trimmed, non-empty author/name, then bundled:<folder-id> for a bundled board,
  then the ordinary board root path.
- **S7:** a board is eligible for settings only when both manifest author and name are present
  and non-empty after trimming. The reusable predicate belongs in this task; settings
  normalization/registration and board-facing gating belong to US-1501, not this task.
- **S8:** the gap is Persephone's own scaffolding. The demo manifest needs name, the blank
  template must carry both fields, and the scaffold must write the requested board name through.
- **S11:** orphaned values are retained. Reinstalling a board can restore its namespace; there is
  no prune step and no admin migration surface.
- **S14:** boards.default-author supplies the scaffold author. An unset value is written as an
  empty string and must never make board creation fail.

### Current namespace implementation and caller audit

src/renderer/api/board-vars/namespace.ts currently owns three related functions:

    export async function resolveBoardNamespace(boardRoot: string): Promise<string>;
    export async function findNamespaceCollision(
        boardRoot: string,
    ): Promise<{ namespace: string; collidingRoot: string } | undefined>;
    export async function confirmNamespaceNotColliding(boardRoot: string): Promise<boolean>;

resolveBoardNamespace() reads board-manifest.json with readBoardManifest(), trims author and name,
returns author/name only when both are usable, then initializes bundledBoardRegistry and returns
bundled:<id> for a bundled root, otherwise the raw boardRoot. findNamespaceCollision() loads
boardTrust, scans boardTrust.listPaths(), skips the requested root, and resolves each trusted root
before comparing namespaces. The check is advisory: confirmNamespaceNotColliding() displays the
dialog and returns the user's choice; the caller may continue after “register anyway”.

Every direct caller found in the source is listed below. board-vars-bridge.ts was also inspected:
it does not resolve identity; BoardWebview.resolveVariable() resolves the namespace and passes it
into resolveBoardVarRequest().

| Current caller | Current use | Planned disposition |
|---|---|---|
| src/renderer/api/board-vars/index.ts:5 | Re-exports resolveBoardNamespace from the vars barrel | Remove the vars-owned export; vars storage remains exported from this barrel, while identity comes from the shared module. |
| src/renderer/api/board-vars/admin-api.ts:2,39 | Implements app.boardVars.namespaceFor() | Import the shared resolver; preserve the public method and its namespace contract. |
| src/renderer/api/board-vars/board-vars-bridge.ts | Receives a caller-bound namespace; never resolves one | No code change. Keep namespace binding in BoardWebview; do not let board-supplied arguments choose it. |
| src/renderer/editors/board/BoardWebview.ts:35,994-995 | Resolves the current frame's board root before dispatching vars | Import resolveBoardNamespace from the shared module; keep resolveBoardVarRequest imported from board vars. |
| src/renderer/api/boards.ts:319-320 | Registration-flow collision confirmation | Dynamically import confirmNamespaceNotColliding from the shared module. |
| src/renderer/editors/board/BoardEditorView.ts:283-284 | Board trust-flow collision confirmation | Update the dynamic import to the shared module. |
| src/renderer/editors/board-info/BoardInfoEditorModel.ts:656-657 | Board Info trust-flow collision confirmation | Update the dynamic import to the shared module. |
| src/renderer/api/board-vars/namespace.ts:44,54 | Internal collision lookup | Move this logic with the shared namespace module. |

The old src/renderer/api/board-vars/namespace.ts should therefore be removed rather than left as
a settings-facing dependency. The clean shared location is
src/renderer/api/board-namespace.ts, alongside the existing renderer board services. It will
export the resolver, collision finder, and registration confirmation wrapper; moving the wrapper
keeps the dialog-only registration concern together without making settings import from
board-vars/.

### Manifest and scaffold behavior

BoardManifest is defined in src/renderer/editors/board/board-manifest.ts. name and author are
currently optional fields described as metadata. defaultBoardManifest() at :220-222 returns only
{ schemaVersion }. ensureBoardManifest() at :682-685 writes that default only when no manifest
exists.

createBoardFromTemplate(name, dir, template) in
src/renderer/editors/board/board-scaffold.ts:49-72 already has the requested board name and
copies the selected template before calling ensureBoardManifest(). Because both templates ship a
manifest, ensureBoardManifest() is a no-op after a successful copy, so the copied manifest keeps
the template's fields and loses the requested name.

The app setting implementation is src/renderer/api/settings.ts. Its typed key union,
settingsComments, and defaultAppSettingsState.settings are the three places needed for the
new hidden/default setting. No Settings-page section is involved.

The intended manifest writes are:

    // Before: blank template
    {
      "schemaVersion": 1,
      "description": "",
      "author": "",
      "repository": ""
    }

    // After: template remains a template; the scaffold fills the name.
    {
      "schemaVersion": 1,
      "description": "",
      "author": "",
      "name": "",
      "repository": ""
    }

    // Before: a copied template manifest is never amended.
    await ensureBoardManifest(boardRoot);

    // After: preserve copied fields, but always write the requested identity fields.
    await ensureBoardManifest(boardRoot);
    const manifest = await readBoardManifest(boardRoot) ?? defaultBoardManifest(name);
    manifest.name = name;
    manifest.author = configuredDefaultAuthorOrEmpty;
    await writeBoardManifest(boardRoot, manifest);

The no-manifest fallback must receive the board folder name as well. Change
defaultBoardManifest() to accept the optional scaffold name, include name and author, and make
ensureBoardManifest(boardRoot) pass fpBasename(boardRoot) when it creates the fallback. The
scaffold's final write covers both a copied template and the fallback, while preserving every
other template field. author must be normalized to a string or "" when reading
settings.get("boards.default-author"); an empty or unset setting is not an error.

    // Before: src/renderer/editors/board/board-manifest.ts
    export function defaultBoardManifest(): BoardManifest {
        return { schemaVersion: BOARD_MANIFEST_SCHEMA_VERSION };
    }

    // After: the no-manifest path has the same identity shape as a copied template.
    export function defaultBoardManifest(name = ""): BoardManifest {
        const configuredAuthor = settings.get("boards.default-author");
        return {
            schemaVersion: BOARD_MANIFEST_SCHEMA_VERSION,
            name,
            author: typeof configuredAuthor === "string" ? configuredAuthor : "",
        };
    }

    // Before: src/renderer/api/settings.ts has no board author key.
    type AppSettingsKey = /* existing keys only */;

    // After: the setting is persisted as an ordinary hidden app preference.
    type AppSettingsKey = /* existing keys */ | "boards.default-author";

### Repository identity inventory and namespace risk

The tracked source tree contains four board-manifest.json files:

| Board/asset | Current author | Current name | Namespace consequence |
|---|---:|---:|---|
| assets/board-call-regex/board-manifest.json | Persephone | AiVision Regex Call | None; already portable. |
| assets/boards/excalidraw/board-manifest.json | Persephone | Excalidraw | None; already portable, and bundled resolution remains available. |
| assets/demo-board/board-manifest.json | Persephone | missing | If this asset folder is resolved as a board, it changes from its raw root-path key to Persephone/Demo Board; old vars under the raw key are stranded. Add the stable source name Demo Board. |
| assets/board-template/board-manifest.json | empty | missing | The template itself remains a root fallback while its author is empty, but every new scaffold now receives a name and the configured author. A configured author therefore produces a portable namespace instead of the old root fallback. |

The workspace also contains ignored .persephone/boards data, not tracked repository source. Its
current instances Chart.js, Demo, Dialog, Flatpickr, marked + highlight.js, Mermaid, SortableJS,
Split.js, Tabulator, Tippy.js, and Tom Select lack a usable identity; Persephone and Tasks already
have both fields. This task does not rewrite those folders, so their current namespaces do not
change merely because the source templates change. Any deliberate future edit that adds or changes
author or name on one of them will move its namespace and orphan existing vars.

Generated release/win-unpacked/resources/assets copies are not tracked source and are not an
additional board inventory. They must not be edited by the implementation.

The consequence is intentional and must be stated plainly: if a board already has vars under a
root-path fallback and its manifest is changed so both identity fields resolve, the vars remain at
the old root key. Persephone will not copy, rename, or merge that namespace. The user/agent must
perform any deliberate vars migration themselves; this task writes no migration.

### Namespace read cost and cache boundary

The current resolver performs an fs read and JSON.parse of the manifest on every call, and may
also initialize/search the bundled registry. BoardWebview awaits it for each vars request, so the
later settings read path would make this a hot path.

Add a board-root-keyed cache in the shared module, keyed with fpNormalizeForCompare() so path
spelling does not create duplicate entries. Clear the cache on both existing in-memory identity
sources of change:

- boardTrust.subscribePaths() notifications, which cover trust/register/untrust changes;
- bundledBoardRegistry.subscribe() notifications, which cover bundled-registry refreshes and
  install-path changes.

The cache must be empty for a new renderer lifetime and must be cleared before/while the registry
refresh notification is observed. There is deliberately no new manifest filesystem watcher:
manifest edits are already a cached-registry boundary and take effect after the existing trust
toggle or app restart. The scaffold's final write occurs before its trust write, so the trust
notification also prevents a stale pre-scaffold result. This is the smallest cache consistent with
the established registry lifecycle; do not add a settings-specific cache or a second identity
algorithm.

## Implementation Plan

### 1. Extract the shared namespace service and update every caller

- Add src/renderer/api/board-namespace.ts by moving the namespace, collision, and confirmation
  logic from src/renderer/api/board-vars/namespace.ts.
- Preserve the exact resolution order and collision behavior: trimmed non-empty author/name,
  bundled:<id>, then raw root path; collision checks remain advisory and continue to scan the
  loaded trusted-path list. Do not broaden the collision policy or silently reject a registration.
- Add the normalized-root cache and the two invalidation subscriptions described above. Keep path
  operations on src/renderer/core/utils/file-path.ts; no require("path") or direct renderer
  filesystem access may be introduced.
- Update src/renderer/api/board-vars/index.ts, admin-api.ts, BoardWebview.ts, boards.ts,
  BoardEditorView.ts, and BoardInfoEditorModel.ts to use the new module. Keep
  board-vars-bridge.ts unchanged because it is a namespace consumer, not a resolver caller.
- Remove the old src/renderer/api/board-vars/namespace.ts and verify there are no remaining
  imports or dynamic imports of board-vars/namespace.
- Preserve the existing errMessage use in caught values and use it for any new catch path; do not
  hand-stringify unknown errors.

### 2. Add the reusable S7 identity predicate without adding settings gating

- Add hasStableBoardIdentity(manifest: BoardManifest | null | undefined): boolean to
  src/renderer/editors/board/board-manifest.ts. It returns true only when both author and name are
  strings whose trimmed values are non-empty; missing, non-string, blank, or whitespace-only values
  return false.
- The predicate's contract is deliberately small and reusable:

      // Before: callers repeat independent author/name checks.
      const eligible = Boolean(manifest?.author && manifest?.name);

      // After: US-1501 can consume one exact S7 predicate later.
      const eligible = hasStableBoardIdentity(manifest);

- Update the BoardManifest field comments in that file so the distinction is explicit: these
  fields remain display metadata generally, but together they are the stable identity required by
  later board settings.
- Reuse the predicate in shared identity logic where it expresses the same both-fields test; do
  not add settings parsing, normalizeBoardSettings, Settings panels, a board-settings store, or
  bridge gating in this task.
- Verify by inspection against these cases: both populated → true; either field missing/blank →
  false; non-string values → false; surrounding whitespace is ignored. These are inspection/manual
  checks only—do not add unit tests or a test harness.

### 3. Add boards.default-author and make both scaffold paths write identity

- In src/renderer/api/settings.ts, add "boards.default-author" to AppSettingsKey, add a
  human-readable settingsComments entry, and seed defaultAppSettingsState.settings with "".
  This is an app setting only; do not add it as a visible Settings-page section.
- In src/renderer/editors/board/board-manifest.ts, make defaultBoardManifest(name = "")
  return schemaVersion, name, and author. Read the author from the app settings and use an empty
  string when it is unset or not a string. Change ensureBoardManifest(boardRoot) to pass
  fpBasename(boardRoot) into the default so a no-manifest fallback is complete by itself.
- In src/renderer/editors/board/board-scaffold.ts, after copying the template and calling
  ensureBoardManifest(boardRoot), read the copied manifest, set manifest.name = name, set
  manifest.author from boards.default-author or "", and write it back with writeBoardManifest().
  This must preserve the template's unrelated fields and work after a template-copy failure. The
  existing warning path must continue to create a usable board, and an unset author must never be
  converted into a creation error.
- Add the source manifest fields:
  - assets/demo-board/board-manifest.json: add name: "Demo Board".
  - assets/board-template/board-manifest.json: add name: "" beside its existing empty author; both
    fields must be present for the scaffold to fill.
- Do not update existing copied board folders or attempt to repair their namespaces.

### 4. Document identity and the orphaning rule in the two required board guides

- In assets/guides/agents/boards.md, update the manifest guidance and the environment-variable
  guidance to say that the pair author + name is the board's stable identity for portable
  namespaces. Explain that changing either field after vars exist moves the namespace and orphans
  the old values; there is no automatic migration. Keep the existing distinction between a
  missing/empty author, the root fallback, and a configured scaffold default.
- In assets/board-template/CLAUDE.md, update the “Board identity: board-manifest.json” section
  with the same stable-identity and orphaning warning. Keep the example manifest valid and explain
  that the generic template's fields are filled by Persephone's scaffold.
- Do not broaden this task into the user-facing settings feature or unrelated board guides.

### 5. Verify the seam and the risk without tests or harnesses

- Static search must show the shared module is the only implementation of namespace resolution and
  collision lookup, all enumerated callers use it, and no settings feature consumes the predicate.
- Inspect the four tracked manifests after the planned edits: only the demo source changes from
  missing name; the board-call-regex and Excalidraw identities remain stable; the blank template
  contains both fields.
- Manually exercise both scaffold inputs in the app or existing script surface: with no
  boards.default-author, creation succeeds and writes author: "" plus the requested name; with a
  configured author, creation writes that author plus the requested name; copied demo fields other
  than identity remain intact.
- In a disposable board-vars scenario, observe the namespace before and after adding/changing the
  identity fields and confirm the old vars remain under the old key. Do not copy or delete them as
  part of verification; the expected result is an explicit orphan, not a migration.
- Run the repository's ordinary type/lint verification appropriate to the implementation, but add
  no unit test files, fixtures, or harnesses.

## Concerns / Open Questions

No product decisions remain open for this task; S4, S7, S8, S11, and S14 are settled. The
implementation must preserve these constraints:

1. **Vars data can be stranded by an intentional identity edit.** The demo source asset moves from
   a raw-root namespace to Persephone/Demo Board. Existing copied boards are not rewritten, but
   any board whose manifest is deliberately changed from fallback identity to a complete pair will
   strand its old vars. The guides and acceptance criteria must say this plainly; no migration is
   allowed.
2. **The template's empty author is a valid non-failing state.** A scaffold with no default author
   may still have a root fallback and is not settings-eligible later, but creation must complete.
   Do not turn S7 into a board-creation validation error.
3. **Cache invalidation must match current registry lifecycle.** The cache is not a manifest file
   watcher. Trust-path and bundled-registry notifications clear it; manual manifest edits retain
   the existing trust-toggle/restart boundary documented in the guides.
4. **Collision behavior is intentionally unchanged.** The existing finder checks trusted paths and
   the confirmation is advisory. This task extracts it for reuse; it does not invent a collision
   policy for the future settings store.
5. **Import/process boundaries remain unchanged.** Use core/utils/file-path for path work, the
   renderer fs API for file work, and errMessage for caught values. No direct require("path")
   or new direct filesystem import is permitted.

## Acceptance Criteria

1. src/renderer/api/board-namespace.ts is the sole implementation location for
   resolveBoardNamespace() and findNamespaceCollision() (and the registration confirmation
   wrapper); src/renderer/api/board-vars/namespace.ts is gone.
2. The audited callers are updated: board-vars/index.ts, admin-api.ts, BoardWebview.ts,
   boards.ts, BoardEditorView.ts, and BoardInfoEditorModel.ts. board-vars-bridge.ts remains
   a namespace consumer with no resolver implementation.
3. Namespace resolution preserves S4's author/name → bundled id → root fallback order, and the
   cache is invalidated by trusted-path and bundled-registry notifications. No second identity
   scheme or migration is introduced.
4. hasStableBoardIdentity() exists and its inspected truth table requires both trimmed,
   non-empty manifest fields. No settings declaration, store, panel, or board-facing settings gate
   consumes it in US-1499.
5. boards.default-author exists with an empty default and does not require a Settings-page row.
   An unset/non-string value becomes an empty manifest author without failing creation.
6. defaultBoardManifest() and the no-manifest ensureBoardManifest() path write both name and
   author; the copied-template path also overwrites those two fields with the requested board name
   and configured/default author while preserving all unrelated manifest fields.
7. The demo source manifest has a stable name, and the blank template contains both identity keys.
8. The task documentation identifies the exact tracked manifests affected, distinguishes ignored
   local board data and generated release copies, and states that changing identity on an existing
   vars-bearing board strands the old namespace with no migration.
9. Both required board guides document author + name as stable identity and warn that changing
   either field orphans existing board vars.
10. No unit tests, test harnesses, settings feature, doc/active-work.md,
    doc/epics/EPIC-111.md, or commit is added or changed by this task.

## Files Changed Summary

| File | Planned change |
|---|---|
| src/renderer/api/board-namespace.ts | New shared resolver, collision lookup, registration confirmation, and invalidated namespace cache. |
| src/renderer/api/board-vars/namespace.ts | Remove after the shared extraction. |
| src/renderer/api/board-vars/index.ts | Stop owning/re-exporting namespace resolution. |
| src/renderer/api/board-vars/admin-api.ts | Import the shared resolver for namespaceFor(). |
| src/renderer/api/boards.ts | Import shared collision confirmation. |
| src/renderer/editors/board/BoardWebview.ts | Resolve the caller's namespace from shared identity code. |
| src/renderer/editors/board/BoardEditorView.ts | Import shared collision confirmation. |
| src/renderer/editors/board-info/BoardInfoEditorModel.ts | Import shared collision confirmation. |
| src/renderer/editors/board/board-manifest.ts | Add the S7 predicate, identity-aware default manifest, and complete no-manifest fallback. |
| src/renderer/editors/board/board-scaffold.ts | Write the requested name and configured/default author through copied manifests. |
| src/renderer/api/settings.ts | Add the hidden/default boards.default-author app setting and file comment. |
| assets/demo-board/board-manifest.json | Add name: Demo Board. |
| assets/board-template/board-manifest.json | Add the empty name field alongside author. |
| assets/guides/agents/boards.md | Document stable identity and variable orphaning. |
| assets/board-template/CLAUDE.md | Document stable identity and variable orphaning in the authoring template. |
| src/renderer/api/board-vars/board-vars-bridge.ts | **No change:** inspected; receives a namespace from BoardWebview and does not resolve identity. |
| assets/board-call-regex/board-manifest.json | **No change:** already has both fields. |
| assets/boards/excalidraw/board-manifest.json | **No change:** already has both fields. |
| .persephone/boards/** and release/win-unpacked/** | **No change:** ignored local/generated data, not source manifests to rewrite. |
| doc/active-work.md | **No change:** explicitly excluded by the request; EPIC-111 already links US-1499. |
| doc/epics/EPIC-111.md | **No change:** explicitly excluded; S4/S7/S8/S11/S14 are settled there. |
| Unit-test files and test harnesses | **No change:** explicitly excluded. |
