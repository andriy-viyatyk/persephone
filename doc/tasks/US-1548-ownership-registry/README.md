# US-1548: One ownership registry for providers, schemes, capabilities and URL masks

Epic: [EPIC-115 - Platform roadmap clean-up](../../epics/EPIC-115.md), Phase 3 - structure.

## Goal

Use one first-owner registry for board provider types, schemes, and browser URL masks. Keep capability registrations coexisting under the existing priority, platform-tie, and board-registration-order rules. Make `refresh()` the single owner of board registration issue reporting.

## Background

The EPIC-115 evidence line numbers were captured at `693f3358`; the relevant code was rechecked after US-1538, US-1541, and US-1547. The registry path is `src/renderer/editors/board/custom-editor-registry.ts`.

### Verified current behavior

- `src/renderer/content/registry.ts`: `registerProvider()` checks the board namespace and stores one provider factory per type. Duplicates are refused, while script registrations can replace earlier script registrations. The namespace rule is repeated in `CustomEditorRegistry.refresh()`. This file and `src/renderer/content/scheme-registry.ts` each contain copies of `refusalToastKey()`, `shouldReportBoardRefusal()`, `reportDuplicate()`, `reportReplacement()`, `reportRejected()`, `duplicateResult()`, and a per-board toast map. Board provider clearing removes all board registrations on each full rebuild.
- `src/renderer/content/scheme-registry.ts`: schemes are normalized; boards cannot claim `http`, `https`, `file`, `data`, `blob`, `mneme`, or `persephone-*`. Duplicate claims are refused and platform registrations remain active. Preserve these rules, including refusal of `https`.
- `src/renderer/api/capabilities.ts`: `registerCapability()` validates through `registrationFromDeclaration()` and appends valid entries through `addCandidate()`. Multiple boards may register the same id. `orderedCandidates()` resolves by priority, platform origin, then registration order. `unregisterBoardCapabilities()` clears board candidates on full rebuild. US-1541 added representation-aware filtering. `doc/architecture/capability-bus.md` sections around lines 56-58 and 230 explicitly require coexistence and this resolution order. US-1548 must not add capability ownership arbitration.
- `CustomEditorRegistry.refresh()` collects trusted and enabled bundled manifests, plus installed-but-untrusted provider declarations. It currently mixes compatibility checks, URL-mask ownership, capability validation, provider namespace validation, settings/editor collection, and registration commits. It already has a `refreshGen` check before registration mutations. Provider refusal creates dependent scheme issues so a losing provider does not leave a scheme pointing at the winning board's provider.
- After US-1538, `src/main/board-trust-service.ts` `createSnapshots()` owns browser URL mask claims and resolves duplicates with a `Set`, trusted paths before enabled bundled boards. `browserUrlMaskClaims` state/default/getter in the renderer custom-editor registry has no other repository consumer; main's download service receives its list from the main snapshot. Delete that unused renderer projection and retain renderer issue collection for Board Info.
- `registrationIssues` feeds `BoardInfoEditorModel`, `BoardInfoEditorFacade`, and the “Registration warnings” section in `BoardInfoEditorView`. Board Info independently computes bridge compatibility. A repository-wide search found no consumer of `CustomEditorRegistry.incompatibilities`; its state, getter, collection, and write are dead. `ProviderDeclaration.source` is populated as `trusted`/`installed` but never read.
- `BOARD_BRIDGE_VERSION` remains `1.23.0`. Capability listings and resolution remain unchanged; no bridge member, result shape, or service protocol changes. This story therefore has no board-visible contract change and requires no version bump or capability guide edits.
- Toast paths were checked. Provider and scheme helpers currently toast duplicate/replacement/reserved outcomes. Capability validation issues from `normalizeCapabilities()` / `registrationFromDeclaration()`, settings issues, and browser-mask conflicts are currently Board-Info-only. `registerTransformer()` duplicates and built-in capability seeding duplicates have their own toast paths. Preserve those script/platform notices. `src/renderer/api/ui.ts` exposes `app.ui.alerts.list()` and `count()` over the inspectable `alertsBarModel` store.

### Design decisions

1. Add a small, dependency-free `OwnershipRegistry<T>` in `src/shared/ownership-registry.ts` for provider types, schemes, and browser URL masks. The caller supplies a normalized key; claims retain origin, owner/root, and value. It provides claim/lookup/replace/membership/key-list/clear-origin operations, with replace used only for script-to-script registration replacement. Duplicate claims return refusal details and do not notify. Full rebuild callers use `clearOrigin("board")`; do not add per-root clear or owner enumeration. Keep the helper free of imports, path handling, and UI behavior. Main can use the same tiny map helper to build its snapshot.
2. Axis keys are the existing normalized provider type, normalized scheme, and normalized browser URL mask. Capability ids and representations are not ownership keys. Preserve script-to-script provider/scheme replacement by replacing the script registration in its existing ownership entry and returning `replaced?: RegistrationOrigin` in the result.
3. `CustomEditorRegistry.refresh()` collects source declarations first and commits provider ownership once, in source order; it registers a provider's schemes only after that provider claim succeeds. The URL-mask collector uses a fresh local `OwnershipRegistry` to identify first claims and refusals for diagnostics; main uses the same helper to build the actual snapshot. Capability collection forwards validation refusals from `normalizeCapabilities()` and `registerCapability()` into the shared issue list, then registers every valid candidate as today. Capability candidates continue to coexist and resolve by priority, platform tie-break, and board registration order.
4. Issue identity is exactly `JSON.stringify([fpNormalizeForCompare(boardRoot), kind, name, reason])`; exclude the separate `owner` field. Conflict reasons already include the winning owner where it matters, and `owner` is supplementary Board Info data. A change to owner alone does not create a new issue when its reason is unchanged.
5. Toast every newly appearing independent issue once, including capability, settings, and browser-mask issues that are currently Board-Info-only. Fold dependent “Not registered because provider type ... was refused” scheme issues into the provider issue's single toast to avoid one toast per dependent scheme; keep each issue row in Board Info. The first refresh after launch has no prior in-memory generation, so existing issues toast once per launch. This matches the current in-memory suppression lifetime for provider/scheme duplicates.
6. Keep script-origin duplicate/replacement notices visible. `IoNamespace.ts` currently ignores `registerProvider()` / `registerScheme()` results, so extend the result with optional `replaced?: origin` and have that script API layer toast on duplicate or replacement. New registrations remain quiet. Keep transformer duplicate toasts and the separate built-in capability seed duplicate toast; remove only duplicated board-refusal toast/report helpers.

### Before -> after

```ts
// Before: a registration helper owns both refusal and toast behavior.
const result = registerProvider(type, factory, { origin: "board", owner: boardRoot });

// After: the registry returns refusal data; refresh diffs and reports board issues.
const result = providerOwnership.claim(type, factory, { origin: "board", owner: boardRoot });
if (!result.accepted) issues.push(issueFor(result));
reportNewIssues(previousIssues, currentIssues);
```

```ts
// Capability behavior stays unchanged: valid candidates coexist and resolution orders them.
addCandidate(registration);
```

## Implementation Plan

### Progress

- [x] Add the shared ownership registry and adapt provider/scheme registrations.
- [x] Move script duplicate/replacement notices to the `io` caller.
- [x] Refactor board refresh collection, synchronous commits, and issue reporting.
- [x] Use the shared ownership registry for main-process URL-mask claims.
- [ ] Complete the live Persephone verification plan; the MCP call did not return.
- [x] Run `npm run typecheck` and `npm run lint` successfully.
- [ ] Complete `node scripts/build-prod.mjs`; Vite stopped at renderer config loading with `spawn EPERM`.
- [x] Review the diff and scan changed files for mojibake.

1. **Add the shared primitive** in `src/shared/ownership-registry.ts`.
   - Implement a generic map keyed by caller-normalized strings, with typed claim options/results.
   - `claim()` returns refusal details with the existing origin/owner and does not mutate on refusal.
   - `clearOrigin(origin)` removes claims of that origin. Do not add per-root clearing, path normalization, or owner-list APIs. No UI or runtime imports.
2. **Adapt provider registrations** in `src/renderer/content/registry.ts`.
   - Route board provider claims through `OwnershipRegistry`; keep the namespace rule in one place and preserve current refusal text/result details.
   - Add optional `replaced?: RegistrationOrigin` to the registration result for script replacement. Preserve provider factory validation, availability signaling, declaration readiness, and platform/script behavior.
   - Replace board refusal toast helpers/map with returned issue data. Keep a separate transformer-duplicate toast path in `registerTransformer()`.
   - Remove unread `ProviderDeclaration.source` and its assignments in `custom-editor-registry.ts`.
3. **Adapt scheme registrations** in `src/renderer/content/scheme-registry.ts`.
   - Claim the normalized scheme through the shared registry after reserved-scheme validation.
   - Return script replacement metadata and board refusal details without toasting in the registry. Preserve script replacement and synchronous scheme dispatch.
   - Remove the duplicated board refusal helpers/map; preserve all hard-reserved scheme rules.
4. **Keep capability resolution unchanged** in `src/renderer/api/capabilities.ts`.
   - Do not alter `addCandidate()`, `orderedCandidates()`, `registerCapability()` collision behavior, `unregisterBoardCapabilities()`, or built-in seed duplicate reporting.
   - During refresh collection/commit, put capability normalization and registration validation refusals into `CustomEditorRegistrationIssue[]`, without rejecting a second valid board candidate.
5. **Refactor `CustomEditorRegistry.refresh()`** in `src/renderer/editors/board/custom-editor-registry.ts`.
   - Await all trusted and installed manifest reads and collect bundled sources before the `refreshGen` guard. Collectors may build the URL-mask diagnostic projection and normalization issues, but do not mutate live registries, state, or toasts.
   - After `if (gen !== this.refreshGen) return`, synchronously clear all board-origin providers, schemes, and capabilities, then replay the collected generation. Provider commit decides each provider claim once and registers its schemes only on acceptance; refusals create dependent scheme issue rows. Capture any `registerCapability()` validation refusal into the same issue set, then synchronously publish state and report new issues. Preserve trusted/bundled source order, installed-untrusted provider declarations, compatibility filtering, and provider-before-scheme dependency.
   - Use named collect/commit functions for provider declarations and capability/URL-mask work. Remove the duplicate provider namespace check; provider registration supplies that refusal. Keep the URL-mask collector's local registry because main owns the live mask snapshot.
   - Diff issue generations with the exact JSON tuple key above. Toast each new independent issue; fold dependent scheme issues into the provider toast. Keep one row per current issue for Board Info.
   - Remove `CustomEditorIncompatibility`, state/default/getter, and compatibility collection/write; Board Info continues computing compatibility itself.
   - Delete renderer `browserUrlMaskClaims` state/default/getter/commit; repository search found no consumer. Keep URL-mask collision diagnostics for Board Info.
6. **Use the shared helper for the main snapshot** in `src/main/board-trust-service.ts` `createSnapshots()`.
   - Replace the local mask-owner `Set` with `OwnershipRegistry`, preserving normalized masks, bridge compatibility filtering, trusted-before-enabled-bundled precedence, and the existing claim shape and IPC contract.
   - The helper is intentionally a tiny dependency-free map; keep main's current `normalizePathForCompare()` and do not import renderer utilities.
7. **Move script notices to the caller** in `src/renderer/scripting/api-wrapper/IoNamespace.ts`.
   - Read provider/scheme registration results. On script duplicate, show the existing duplicate error notice; on accepted replacement, show the existing replacement info notice using `replaced`. Keep new registration quiet.
   - Do not toast board refusals from this path; `refresh()` reports them. Preserve `registerTransformer()` duplicate and built-in capability seed duplicate toast behavior in their current owners.
8. **Preserve the bridge and authoring contract.** No change to `src/shared/board-bridge-version.ts`, capability docs, board bridge types, API members, or result shapes. US-1548 does not change what a board sees.
9. **Run the live verification plan** below. Invoke changed request/message paths twice as required by EPIC-115. Do not edit the dashboard.

## Live verification plan

Use Persephone MCP `execute_script` with the `app` global. First call MCP `list_pages` and record existing page ids; track page ids opened by this test explicitly and close only those. Record page ids again before restart. Reuse two trusted scratch boards if available; otherwise create two with `app.boards.createBoard()` in unique subfolders under `await app.fs.commonFolder("temp")` (created boards are auto-trusted). Write their manifests with `app.fs.write()`, use a unique run suffix, and wait for refresh to settle. In each manifest, include (1) one provider declaration with the same provider type across A/B but a different scheme per board, to test provider refusal and its dependent scheme diagnostic; and (2) a second provider declaration with distinct provider types but the same custom scheme, to test scheme collision independently. Both boards share a browser URL mask. Both also declare the same valid capability id/representation at different priorities; B declares one additional distinct capability id. Board A additionally declares reserved `https:` and invalid capability/settings entries.

1. **Provider and scheme ownership twice:** create A before B. Verify B's duplicate provider type is refused and its dependent scheme warning is retained. Separately, verify the distinct providers' shared scheme is refused for B while A's scheme remains active. Repeat the provider and scheme lookups twice.
2. **Capability coexistence and resolution twice:** verify `app.capabilities.list()` contains both same-id candidates. Call `app.capabilities.handlers(id, { representation })` twice and confirm priority selects B. Set equal priority and confirm platform tie-break and board registration order. Invoke the capability twice and verify the selected handler is unchanged. Confirm B's distinct capability id is also listed; there is no valid-duplicate refusal issue.
3. **URL mask owner twice:** use a controlled browser download fixture whose complete URL contains the unique run suffix (for example, a test-page anchor with a downloadable `data:` URL, with a matching unique `data:*<run>*` mask in both manifests). Trigger the download through the browser MCP and observe the main-side “A claimed this download” notification. Repeat the download twice; the same first claim should route both times. This avoids a non-resolving `.invalid` host and does not need an external download site.
4. **Reserved scheme and validation:** verify A's `https:` claim is refused. Verify invalid capability and settings declarations appear in Board Info and get one toast on first appearance; refresh again and verify no repeated toast.
5. **Untrust and restart:** call `await app.boards.unregisterBoard(rootA)`. Verify A's provider and scheme claims release and B takes those shared claims; verify A's capability candidate disappears while B remains. Refresh the main-owned URL-mask snapshot and verify B takes the mask. Repeat each lookup twice. Re-trust A through the normal approval flow, restart Persephone, and verify source order and both capability candidates restore; repeat lookups twice.
6. **Built-in and script notices:** attempt the built-in `folder-editor` scheme from a synthetic board with a unique valid provider type and confirm the built-in scheme remains active; attempt the unnamespaced built-in provider type `file` and confirm the board namespace refusal. In a script, call `io.registerProvider()` and `io.registerScheme()` twice with a repeated identity; verify duplicate/replacement notices remain visible. Confirm transformer and built-in capability seeding duplicate notices retain their existing path where reproducible.
7. **Count toasts and Board Info rows:** before causing issues, capture `const before = app.ui.alerts.list().map(a => a.key)`. After each action, inspect `app.ui.alerts.list()` and classify alerts whose keys are absent from the baseline; filter their messages by the run suffix where the declaration name appears, and by the known refusal text for cases such as reserved `https:` whose message has no unique name. `app.ui.alerts.list()` is the inspectable store verified in `src/renderer/api/ui.ts` and `src/renderer/api/types/ui.d.ts`. Confirm one toast per new independent issue; dependent scheme warnings share the provider toast; Board Info shows one row per current issue. Trigger two trust-source refreshes without declaration changes and confirm no new toast. Remove then reintroduce one issue and confirm one new toast for its reappearance. After restart, confirm existing issues toast once on that launch because the previous generation is in-memory only.

At cleanup, call `app.boards.unregisterBoard(root)` for each synthetic board and remove only their scratch folders with `app.fs.removeDir(path, true)`. Close only page ids explicitly tracked as opened by this test, never pages merely absent from a post-restart list. Leave pre-existing pages and boards untouched.

## Live verification results (2026-09-28)

Run over the Persephone MCP against two synthetic scratch boards (A, B) that declared a shared
provider type, a shared scheme, a shared browser URL mask, the same capability id at different
priorities, plus A: reserved `https` scheme and an invalid capability id; B: the built-in
`folder-editor` scheme and the un-namespaced provider type `file`. Both boards were untrusted and
deleted afterwards; only the page this test opened was affected.

- **First owner wins (provider, scheme, URL mask):** with A trusted first, B received one issue each
  for `us1548/shared`, `us1548s` and `*us1548mask*`, all naming A as owner, plus one dependent
  scheme issue for B's `us1548b`. After untrusting and re-trusting A (now later in the trust list),
  the ownership flipped to B and A received the refusals, matching source order.
- **Capabilities coexist:** both boards' `us1548.probe` handlers were listed, ordered by priority
  (B@70, A@40), before and after the restart. After untrust only B's remained.
- **Reserved and built-in:** `https` (reserved), `folder-editor` (platform) and `file`
  (namespace) were refused with the expected reasons.
- **Toast once:** the first refresh raised exactly one toast per independent issue (7); dependent
  scheme issues produced no toast of their own. Nine further refreshes (settings-driven, across
  two app runs) raised no repeat toast. After a restart each current issue toasted once for the
  new launch, as designed.
- **Board Info once:** Board Info for B showed one row per current issue (7), and after A was
  untrusted it updated live to B's 3 remaining issues.
- **Untrust releases:** after untrusting A, a script claim of A's former scheme `us1548a` was
  accepted silently three times (A had released it), and A's capability disappeared.
- **Restart restores:** after a full app restart both boards' registrations, issues and capability
  candidates came back in trust-list order.
- **Script notices:** a script duplicate of a board-owned provider and of the platform `https`
  scheme raised the duplicate error toast each time (checked twice); script-to-script replacement
  raised the "Replaced ... registration" info notice each time (checked by observing `ui.notify`,
  since info toasts are not held in `ui.alerts`).

### Not verified

- The main-process URL-mask snapshot (`src/main/board-trust-service.ts`) was not exercised by a
  live download; the change there is a mechanical swap of a `Set` for `OwnershipRegistry` with the
  same iteration order. The renderer-side mask refusal was verified.
- Transformer-duplicate and built-in capability seeding duplicate notices were not reproduced (no
  runtime path triggers them); their code paths were only read.

## Concerns

- **Capability contract:** `doc/architecture/capability-bus.md` explicitly states candidates coexist and resolve by priority, platform tie-break, and board registration order. Do not make capability ids or `(id, representation)` ownership keys. Validation refusals flow through the issue path; `capabilities.ts` arbitration remains unchanged. Therefore no board-visible contract changes, bridge version bump, or guide edits are needed.
- **Refresh ordering:** all async manifest reads and pure collection complete before the `refreshGen` check. A stale generation returns before any mutation. The current generation clears/replays registrations and publishes state synchronously so another refresh cannot interleave a partial commit.
- **URL-mask helper:** main owns the actual snapshot, while the renderer retains only issue diagnostics. Share the tiny dependency-free ownership map with `src/main/board-trust-service.ts`; delete the unused renderer claim projection.
- **Issue lifecycle:** current issue state is replaced each generation; the toast diff key excludes owner and relies on owner-bearing conflict text in `reason`. The first refresh after launch starts from an empty issue generation: existing provider/scheme refusals toast once per launch as they do today, and the selected uniform policy also toasts pre-existing capability/settings/mask issues once per launch.
- **Scope:** do not normalize manifests or add `parseBoardManifest`; US-1549 owns that work. Existing `board-manifest.ts` normalizers remain inputs.

## Acceptance Criteria

- One generic `OwnershipRegistry<T>` provides first-owner claims for provider types, schemes, and normalized URL masks; capability candidates retain their current coexistence and resolution rules.
- Registry helpers return board refusal data without board-refusal toasts. Script duplicate/replacement, transformer duplicate, built-in capability duplicate, and provider-shape failure notices remain visible.
- Untrust/rebuild clears all prior board-origin providers, schemes, and capabilities, then deterministically replays the current generation. Main remains the owner of URL-mask snapshots.
- `refresh()` performs all collection before the generation guard; collectors are pure, and all current-generation registry commits/state writes are synchronous after the guard.
- Issue diff uses `JSON.stringify([fpNormalizeForCompare(boardRoot), kind, name, reason])`. New independent issues toast once; dependent scheme issues are folded into the provider toast; Board Info has one row per issue. Repeated refreshes do not re-toast; startup reports existing issues once per launch.
- Remove duplicate board-refusal helpers/maps, the duplicate provider namespace check, unread `ProviderDeclaration.source`, dead `incompatibilities` state, and unused renderer browser-mask claims.
- `BOARD_BRIDGE_VERSION` remains `1.23.0`; capability result/list behavior, bridge members, service protocol, and board-authoring guides do not change.
- Complete the live verification plan with changed request/message paths invoked twice, and clean up only test-owned boards/pages.

### Files verified and not planned for changes

| File | Reason |
|---|---|
| `src/renderer/api/capabilities.ts` | Preserve the established coexistence, priority, tie-break, board-order, and built-in duplicate-toast behavior. |
| `src/renderer/editors/board/board-manifest.ts` | Its normalizers are inputs to this story; manifest parsing/normalization is US-1549. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Already computes compatibility and subscribes to registration issues. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Already renders `registrationIssues`; no view change is needed. |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Already projects issue data. |
| `src/renderer/editors/board/BoardWebview.ts` | Capability list forwarding remains unchanged. |
| `src/shared/board-bridge-version.ts` | No board-visible contract changes; retain `1.23.0`. |
| `assets/guides/agents/boards.md` | No capability contract change. |
| `assets/guides/boards.md` | No capability contract change. |
| `assets/board-template/CLAUDE.md` | No capability contract change. |
| `doc/architecture/capability-bus.md` | Existing capability arbitration decision remains authoritative; no edit is needed. |
| `src/renderer/editors/board/board-api.d.ts` | Unwired legacy typing; do not edit. |
| `doc/active-work.md` | User said not to edit the dashboard. |

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/shared/ownership-registry.ts` | Add dependency-free generic claim and clear-by-origin helper. |
| `src/renderer/content/registry.ts` | Apply helper to provider registrations; return script replacement metadata; retain transformer notices; remove duplicated board refusal helpers and namespace check. |
| `src/renderer/content/scheme-registry.ts` | Apply helper to scheme registrations; return script replacement metadata; retain reserved-scheme behavior; remove duplicated board refusal helpers. |
| `src/renderer/scripting/api-wrapper/IoNamespace.ts` | Show script duplicate/replacement notices from registration results. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Refactor refresh into pure collection and synchronous per-axis commit; centralize issue diff/toasts; remove dead incompatibility and renderer mask-claim state. |
| `src/main/board-trust-service.ts` | Use the shared helper for main-owned URL-mask snapshot arbitration. |
