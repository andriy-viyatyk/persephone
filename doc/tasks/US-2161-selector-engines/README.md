# US-2161: Selector engines

[EPIC-206](../../epics/EPIC-206.md) · D1 and H2 · Planned; implementation awaits plan review

## Goal

Add the requested selector engines to the single shared locator path, with Chromium accessibility roles and names, and update the Playwright-name hints. This document is a plan only; US-2160 is already implemented in the uncommitted working tree.

## Background

`src/renderer/automation/page-scripts.ts` currently generates `resolveCandidatesSource()`: CSS uses document queries, and `text=` uses normalized text, innermost selection, visibility and area/depth ordering. `src/renderer/automation/selector-execution.ts` wraps that source in `evaluateWithCandidates` (by-value `cdp.evaluate`) and `evaluateCandidateObject` (`Runtime.evaluate`, object result). The latter's callers own its returned object. `locator.ts` calls the entry for actionability and `runOnLocator`; `queries.ts` for reads and selector waits; `page-state.ts` for screenshot targets; `mouse.ts` and `synthetic.ts` for synthetic paths; `forms.ts` and `snapshot.ts` for strict single-node CDP consumers. Ref branches continue through `ref.ts`. Actionability retries the whole evaluation after up to 100 ms; ambiguity and malformed options remain fatal. Fullscreen is a separate CSS-only main-process exception.

`snapshot.ts` obtains `Accessibility.getFullAXTree` and uses AX role/name and properties; ignored nodes are suppressed, with wrapper traversal before that check. It hides some `StaticText` lines, not all; pointer-generic lines can substitute descendant text and truncate it to 80 characters. Thus ordinary semantic snapshot lines use AX name, but pointer-generic formatting is not a general accessible-name oracle. Snapshot omission does not mean a locator must suppress a valid AX node. User-observed examples to verify live: `<button title="Refresh data">R</button>` is `button "R"`; `<label>To <input></label>` has textbox name `To `; a dialog's `<p>` can have no AX node; wrapping labels can appear as `LabelText`.

The [CDP Accessibility specification](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/#method-queryAXTree) says `queryAXTree` requires a DOM root (`objectId`, `nodeId`, or `backendNodeId`), computes role and name even for ignored nodes, accepts an exact `role` filter, and returns ignored matches. It is experimental and the online schema is tip-of-tree, not proof of availability or exact properties in the pinned Castlabs Electron 44.9.3 runtime. `getFullAXTree` is already used by snapshots but is insufficient by itself to promise role/name for ignored nodes. Choose `queryAXTree` for both normal and include-hidden roles; compare its exposed-node results with the snapshot and verify ignored node data in the actual runtime. No Blink feature flag or in-page ARIA role/name reimplementation.

Playwright's [role selector engine](https://github.com/microsoft/playwright/blob/main/packages/injected/src/roleSelectorEngine.ts) explicitly supports `name`, states and `include-hidden`, and rejects unknown attributes: `[exact]` is not supported in the string form; do not implement it. Playwright's public `role=` engine and internal `getByRole` engine differ in string equality behavior; EPIC-206 Decision 3 explicitly chooses case-insensitive substring for unquoted and plain quoted values, including `i`, and exact case-sensitive for `s`. This is a deliberate specified subset, not a claim of full Playwright engine parity. `text=` retains its existing distinct quoted-exact behavior.

## Implementation plan

### 1. Grammar and page engines

- [x] `src/renderer/automation/page-scripts.ts`: keep `resolveCandidates` as owner of grammar and every engine. Define one parser source alongside `resolveCandidatesSource`, included both in a lightweight page preflight and in the actual resolver; no host-side duplicate grammar. When invoked, preflight runs that parser in the main frame and returns only the role names required by its parsed steps. A step is an engine only if, after leading whitespace, it starts with `role=`, `label=`, `placeholder=`, `testid=`, `title=`, `alt=`, or `text=`; otherwise pass it to CSS `querySelectorAll` as today. Do not add `css=` or `xpath=` engines. Preserve existing `text=` behavior. Parse into `steps: Step[]` from the outset, even when there is just one step; retain a scope parameter and a step-dispatch loop as the US-2162 extension points. For now only one step executes. Reject top-level `>>` with `>> chaining is not supported yet`, while respecting quotes, escapes, regex character classes and bracket/parenthesis nesting so literal `>>` inside a CSS value or text is not split. US-2162 removes this temporary error. Do not implement chaining, `nth=`, `:has-text()`, `:visible`, or the object form here.

  ```js
  // Before: if (!selector.startsWith('text=')) { /* CSS */ } else { /* text */ }
  // After: const steps = parseSelector(selector); // always an array
  //        return resolveStep(steps[0], document, mode, options, axFacts);
  ```

- [x] Parse `role=<role>` plus bracket attributes `name`, `checked`, `disabled`, `expanded`, `level`, `pressed`, `selected`, `include-hidden`. Allow `[checked]` / `[checked=true|false|mixed]`, likewise `pressed` including mixed; `disabled`, `expanded`, `selected`, `include-hidden` support bare true and explicit true/false; level requires a positive integer. Reject duplicate/unknown attributes, bad flags, malformed strings/regex and unsupported operators with a clear selector error, rather than passing them as CSS. Map AX `properties` by name and compare boolean, `mixed` and numeric values without string coercion. Absent `disabled`, `selected`, `pressed` or `checked` is false; `mixed` matches only `=mixed`, never true or false. Absent `expanded` matches neither true nor false, and absent `level` never matches. Live checks confirm Chromium's property names and values; they do not decide defaults. Do not infer a role or accessible name from DOM.
- [x] A common matcher normalizes whitespace by collapsing whitespace and trimming both name/value and selector string. Normalize the AX name before matching: `role=textbox[name="To"s]` matches the snapshot's `textbox "To "` for `<label>To <input></label>`. Unquoted and JSON double-quoted values are case-insensitive substrings; `"value"s` (also with whitespace before `s` inside a role bracket) is case-sensitive equality, `"value"i` is case-insensitive substring; `/pattern/flags` tests the normalized value, resetting `lastIndex` per element. Parse escapes, delimiters and regex flags safely, and report invalid syntax. `testid=` matches the literal `data-testid` attribute exactly and case-sensitively; no implicit CSS interpolation. Preserve the existing `text=` branch byte-for-byte in behavior, including its own quote handling, sorting, filtering and force semantics.
- [x] Implement `label=` for labelable controls using their associated `HTMLInputElement.labels`/`HTMLSelectElement.labels`/`HTMLTextAreaElement.labels` etc., and `aria-labelledby` IDREF text and `aria-label` on the control; match each available label independently, avoid returning `<label>` itself, deduplicate in document order. Handle explicit and wrapping labels and multiple IDREFs, and restrict HTML `label` association to actual labelable controls. `placeholder=`, `title=`, `alt=` read the corresponding attribute and use the common matcher. Define engine query-mode candidates in DOM order; use CSS-like action mode selection (displayed, sized preference, or all with force), then retain existing `visibleOnly`/`nth` processing. Role candidates use the same policy after AX filtering; `include-hidden` affects AX membership, not downstream actionability.

### 2. Host AX pre-pass and object lifetime

- [x] In `src/renderer/automation/selector-execution.ts`, make both exported functions share a private execution helper, preserving their signatures and caller contract. Gate preflight on `selector.includes('role=')`: without that substring, use the existing single `Runtime.evaluate`/`cdp.evaluate` route unchanged. This is only a cost gate, not a grammar parser; e.g. CSS `[role=button]` is a false positive. If the substring is present, `cdp.evaluate` the page parser preflight; if it returns no role step, use the existing evaluate route without an AX query. Otherwise obtain the main document as a remote object via `Runtime.evaluate('document', returnByValue: false)`; call `Accessibility.queryAXTree({ objectId: documentId, role })` once per distinct role. Do not filter name host-side: page grammar owns all matching. Keep only nodes with backend DOM IDs and role/name/properties/`ignored` facts, and deduplicate IDs. Pass `ignored` for every fact; the page resolver excludes `ignored: true` by default and includes it with `[include-hidden]`, without interpreting ignored reasons. Resolve each with `DOM.resolveNode({ backendNodeId })` in the same main-frame execution context. Order in the page by document position, not CDP result order. Do not attach to iframe targets. Nodes that are not Elements or not connected to this document are discarded in page code.
- [x] Invoke `Runtime.callFunctionOn` on the document object, passing each resolved element by `{ objectId }` and JSON-serializable facts by `{ value }`; the function reconstructs facts associated with their elements, runs the same parser/resolver source, and invokes the repository-authored body. Supply selector and body safely as serialized data/source as in the current code; never interpolate raw caller text. Set `awaitPromise: true`; choose `returnByValue: true` for `evaluateWithCandidates`, false for `evaluateCandidateObject`, check `exceptionDetails` with `cdpExceptionMessage`, and require the latter's returned `objectId` exactly as today.

  ```ts
  // Before: Runtime.evaluate(expression, returnByValue) or cdp.evaluate(expression)
  // After: no 'role=' substring: existing evaluate; otherwise preflight -> no role: existing evaluate
  //        role: queryAXTree -> resolveNode
  //        -> Runtime.callFunctionOn(document, element object IDs + AX facts).
  ```

- [x] Release the document object and **every** successfully acquired temporary element object in `finally`, including partial resolution, parse, navigation, exception and `callFunctionOn` failures. If resolving in parallel use `Promise.allSettled` and collect all successes before propagating failure; do not abandon in-flight acquisitions. The object returned by `evaluateCandidateObject` is independently owned by `forms.ts`/`snapshot.ts` and must not be released with the temporary inputs; their existing `finally` releases remain. Do not silently drop CDP errors as zero matches. Treat a detachment/navigation race consistently with the current action retry classification; preserve error diagnostics and do not leak objects on retry.
- [ ] Hundreds of role matches mean one AX subtree traversal and up to hundreds of `DOM.resolveNode` requests per attempt, plus release requests, repeated after each 100 ms retry delay. Use bounded concurrency for node resolution and releases; do not cache across attempts because role, name, state and DOM can change. Measure wall time and UI responsiveness on hundreds of matches and retries in live checks; the delay is not a throughput guarantee and a slow pre-pass extends a retry. Never truncate candidates to improve timing: it would break ambiguity, nth and counts. This is a cost/latency risk, not a measured performance claim.

### 3. Hints, descriptions and bridge

- [x] In `src/renderer/scripting/ai-vision/browser-playwright-aliases.ts`, replace the `getByRole` unavailable suggestion and add the missing entries:

  ```ts
  // Before: getByRole: 'a CSS or text= selector ... role locators are not available yet'
  // After:  getByRole: 'click(\'role=button[name="Save"]\')'
  // getByLabel -> type('label=Email', '...'); getByText -> click('text=Save')
  // getByTestId -> click('testid=save'); getByPlaceholder -> type('placeholder=Email', '...')
  // getByTitle -> click('title=Refresh'); getByAltText -> click('alt=Logo')
  ```

  These remain suggestions, not new methods; leave `isVisible` for US-2164.
- [x] Update `src/renderer/scripting/ai-vision/browser-automation-members.ts` `snapshot` and `click` summaries, `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` help, and `src/renderer/scripting/api-wrapper/board-editor-facade-definitions.ts` help, replacing CSS/text-only claims with the supported engines, a role example and matching distinctions. Preserve action/ref details and fullscreen's CSS-only wording. `BrowserEditorFacade.ts` imports the existing member array; no facade method is added. `scripts/describe-tables-check.mjs` statically checks method membership, not documentation wording or the suggestion map: no script change is needed; run `npm run describe-tables:check` (also part of lint).
- [x] Update `IBrowserElementLocator`, `snapshot`, read, `click` and `hover` comments in both `src/renderer/api/types/browser-editor.d.ts` and `assets/editor-types/browser-editor.d.ts`; remove the incorrect claim that all plain strings are CSS. Keep their declarations synchronized and fullscreen CSS-only. For example `/** CSS selector or text= locator string ... */` → `/** CSS, text=, role=, label=, placeholder=, testid=, title= or alt= string, or a host-local snapshot ref. */`.
- [ ] Extend the existing `Bridge 1.60.0` paragraph in `assets/guides/agents/boards/bridge-versions.md` with the engines and main-frame scope; do not bump `src/shared/board-bridge-version.ts` again. Run `npm run guides:check` for this history edit. Broader user guides are deferred to epic `/userdoc`; give that pass these facts: engines and examples, role/name sourced from Chromium, whitespace/exact/regex and `text=` distinctions, `testid=` exact, state/hidden behavior, CSS-only fullscreen, main-frame selector vs cross-frame refs, trusted action visibility/ambiguity, and any verified runtime limitations.

### 4. Verification and guardrails

- [ ] Run `npm run typecheck`, `npm run lint`, `npm run guides:check`, and existing relevant UI integration coverage (`npm run test:ui -- --area browser`) when the app is available. Add no unit tests. Keep implementation out of roadmap §2.3 god files, including `automation/operations.ts` and `BrowserWebviewModel.ts`; no `.gitignore` edit or `build-prod`. Grammar/engine owner is `resolveCandidates` in `page-scripts.ts`, AX pre-pass owner is `selector-execution.ts`, refs remain `ref.ts`, caller-specific actionability remains `locator.ts`, transport remains `CdpSession`. No protocol/correlator, no board rule outside `src/shared/board/` and its registries, no dynamic-import or wrapper import-zone workaround. Strict-folder null fixes change types, not runtime conditions; run the strict typecheck gate.

## Concerns

- `queryAXTree` is experimental; `node_modules` contains no local `devtools-protocol` schema to confirm the pinned runtime. `AppTargetModel.ts` routes its `CdpSession` to the app-window webContents; `src/renderer/editors/board/BoardTargetModel.ts` uses a board tab registration key. Both already call the shared snapshot path, but that demonstrates intended routing, not live availability of `queryAXTree`/`resolveNode` on either host. Verify each; if unsupported, report the actual host limitation rather than claim success or silently approximate AX.
- `queryAXTree` promises computing role/name for ignored nodes but does not promise every ignored node has a resolvable element, computed properties, or identical results to `getFullAXTree`. Default exclusion follows `ignored: true` alone; `include-hidden` admits ignored nodes with a matching computed role and available element, regardless of ignored reason. Verify `display:none`, `visibility:hidden`, `aria-hidden` and inherited cases, state property names/values and name computation on this Electron. If the runtime returns no ignored nodes, Claude decides at live verification whether to document the resulting `include-hidden` limitation; do not silently approximate AX.
- Snapshot display is not a complete AX dump: filtered nodes and pointer-generic text are special cases. The semantic role/name guarantee applies to actual AX facts, normalized for matching, not an invented DOM role or a pointer line's substituted display label. Chromium and Playwright can differ in role/name and hidden behavior; Decision 2 selects Chromium.
- The preflight and AX pass are separate CDP operations: navigation and mutation can invalidate facts before page evaluation. Resolve and check connectedness on each attempt; do not cache stale object handles. A single operation cannot guarantee an atomic AX/DOM snapshot.

## Acceptance criteria

- [ ] Each requested engine and documented value/state form works across selector reads, actions, synthetic paths, file input and snapshot roots through the one resolver; existing CSS, `text=`, refs, action errors, visibility and ordering are retained. Malformed engine syntax fails clearly. Testid equality is exact.
- [ ] `role=` matches Chromium AX role/name and applicable states; hidden inclusion/exclusion is verified, including user-observed snapshot examples and whitespace. Selectors stay main-frame; frame refs remain unchanged.
- [ ] AX is never queried for non-role selectors, and no extra CDP round trip happens for selectors without `role=`. Repeated attempts see fresh AX data; all temporary remote objects are released on success and error; object-return ownership is preserved. Large match/retry behavior has been measured.
- [ ] App, browser and board sessions are live-checked, or any proven runtime limitation is stated. Hints, describe/help, mirrored type comments and bridge 1.60.0 history agree; checks pass. No unit tests or out-of-scope features.

### Live checks (Claude)

- Compare snapshot lines and role selectors for content vs title, wrapped label trailing space, dialog paragraph and `LabelText`; test normalized exact, substring, regex, escaping and malformed forms.
- Confirm Chromium state property names/values against the specified defaults (including false, mixed and inherited disabled); exercise `aria-hidden`, CSS-hidden and `include-hidden`; compare `queryAXTree` facts with full tree and, if it returns no ignored nodes, decide whether to document the `include-hidden` limitation.
- Exercise labels, placeholder, title, alt, testid and unchanged text/CSS, with query, trusted and synthetic actions, file upload, snapshot root, ambiguity and retry; verify frame scope and ref behavior.
- Run role selection against browser, app window and board; measure hundreds of matches and repeated missing/unstable action retries; inspect remote-object cleanup on success, failure and navigation.

## Files requiring no changes

`doc/active-work.md` and `doc/epics/EPIC-206.md` already contain the entry/link. `src/renderer/automation/{locator,queries,page-state,mouse,synthetic,forms,snapshot}.ts`, `ref.ts`, `CdpSession.ts`, `AppTargetModel.ts`, `src/renderer/editors/board/BoardTargetModel.ts`, `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, `scripts/describe-tables-check.mjs`, and `src/shared/board-bridge-version.ts` need no implementation changes under this plan. Fullscreen and main-process protocol files stay untouched. US-2163 site-extension runtime files are outside scope. User guides other than the required bridge history are deferred.

## Files Changed

| File | Purpose |
|---|---|
| `doc/tasks/US-2161-selector-engines/README.md` | This investigation and implementation plan; only file changed for this planning task. |
| `src/renderer/automation/page-scripts.ts` (planned) | Shared step parser and page-side engines. |
| `src/renderer/automation/selector-execution.ts` (planned) | AX pre-pass, CDP object transport and cleanup. |
| `src/renderer/scripting/ai-vision/browser-playwright-aliases.ts` (planned) | Playwright suggestions. |
| `src/renderer/scripting/ai-vision/browser-automation-members.ts`, `src/renderer/scripting/ai-vision/namespaces/window-screen.ts`, `src/renderer/scripting/api-wrapper/board-editor-facade-definitions.ts` (planned) | Describe and help text. |
| `src/renderer/api/types/browser-editor.d.ts`, `assets/editor-types/browser-editor.d.ts` (planned) | Matching public locator comments. |
| `assets/guides/agents/boards/bridge-versions.md` (planned) | Extend existing 1.60.0 entry. |
