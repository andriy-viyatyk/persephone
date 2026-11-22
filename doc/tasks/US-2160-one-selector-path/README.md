# US-2160: One selector resolution path

[EPIC-206](../../epics/EPIC-206.md) · Proposal D0

## Goal

Route shared browser, app and board automation selector reads through page-side `resolveCandidates` and a single host-side module. Preserve existing behavior for valid CSS, existing `text=` and refs while extending `text=` to the formerly CSS-only selector consumers. Prepare the host seam for US-2161's CDP accessibility pre-pass; add no engine here.

## Background

`src/renderer/automation/page-scripts.ts` owns `resolveCandidatesSource()`. CSS query mode first calls `document.querySelector(selector)`, then returns `querySelectorAll` matches unfiltered in document order: the same valid-CSS list as the existing raw reads. Action mode prefers sized displayed CSS matches, falls back to displayed matches, and with force returns all. Text normalizes whitespace, matches quoted text exactly and unquoted text case-insensitively as a substring, removes ancestors and sorts by area then depth. Text query excludes undisplayed elements and prefers sized candidates. `VISIBLE_FN` requires nonzero bounds and display/visibility. Ref objects bypass selector parsing via `ref.ts`, retaining their frame sessions and stale-ref behavior.

The whole-`src/renderer/` search for `querySelector`, `querySelectorAll`, `DOM.querySelector*` and `startsWith('text=')`, together with facade tracing, found these shared locator reads:

| File and function | Existing behavior and planned change |
|---|---|
| `locator.ts` `actionabilityFunction` / `resolveActionablePoint` | CSS pre-check detects all-undisplayed matches when not forced; text skips it. Ambiguity and invalid `nth` are fatal; missing, detached, invisible, unstable, disabled and hit-test failures are transient and retried. Other errors propagate. Use query-mode pre-check for both selector kinds as explained below. |
| `locator.ts` `locatorFunction` / `runOnLocator` | CSS document-order list, text query candidates; filter visible; reject multiple visible unless `nth` given; `allowHidden` falls back only to exactly one candidate. Preserve errors and `nth`; refs use `callOnRef`. Used by forms, focus and mouse. |
| `page-state.ts` `takeScreenshot` | CSS document-order or text query list, then visible filtering; preserve its own no-match, ambiguity, `nth`, bounds, frame-ref restrictions and catch/undefined behavior. |
| `queries.ts` `getElementText`, `getElementValue`, `getElementAttribute`, `getElementHtml`, `elementExists`, selector branch of `waitFor` | Query first match; preserve null/boolean results, polling, state and timeout. Text/textGone waits search body text and are not selector reads; refs use `callOnRef`. |
| `mouse.ts` `clickElement`, `hoverElement` synthetic selector branches | Query resolver with `visibleOnly: true` and `nth: options.nth ?? 0`, first match, `Element not found`; ref branches use `callOnRef`. Trusted actions use actionability. |
| `synthetic.ts` `focusElementBySelector`, `fillInput` | Currently CSS-only. Focus chooses first, preferring the first positive-offsetHeight and display-not-none alternative only if first is hidden by its own legacy test. Fill independently reselects first, even when focus picked another. Preserve this behavior and `Element not found: ` plus selector; add text support. |
| `forms.ts` `setInputFiles` | CDP-node consumer: initializes DOM, counts CSS matches, requires exactly one, describes the node to get backend ID, validates input and paths, then sets files. Preserve strictness and existing no-match/ambiguity/type/path errors; add text support. |
| `snapshot.ts` `resolveSelectorRoot` | CDP-node consumer: initializes DOM, counts CSS matches, requires exactly one and describes it to get backend ID. Preserve root count and missing-backend-ID errors and root/frame handling; add text support. |

`BrowserEditorFacade.ts`, board/app facades and `AppTargetModel.ts` forward locator arguments or provide host CDP/input seams; they do not parse these selectors. `scripting/ai-vision/page-elements.ts` builds a selector from a page ID; `page-tab.ts` receives selectors produced by `createElements`; `namespaces/settings.ts` receives catalog-generated selectors. They are UI highlight/layout internals, not shared automation locator arguments. Other renderer queries use fixed UI selectors, escaped identifiers or locally generated document selectors. Arbitrary `evaluate` code is caller-authored code and is not rewritten; `snapshot.ts`'s dialog selector is a fixed diagnostic.

**Exception:** `BrowserEditorFacade.fullscreen(selector)` is a CSS-only page-tools action implemented in the main process by `BrowserGuest.enterFullscreen` with an Electron user gesture; it is outside the shared automation locator and this task.

## Implementation plan

### 1. Host entry and page resolver

- [x] Create `src/renderer/automation/selector-execution.ts` as the single host owner of how page code needing candidates runs. Export exactly:

  ```ts
  /** body is a repo-authored function expression (resolve) => result. */
  export function evaluateWithCandidates<T>(cdp: CdpSession, selector: string, body: string): Promise<T>;
  /** body returns one Element or throws; return its CDP remote object ID. */
  export function evaluateCandidateObject(cdp: CdpSession, selector: string, body: string): Promise<string>;
  ```

  Both construct one page expression using `resolveCandidatesSource()` and `JSON.stringify(selector)`, then invoke `body` with `resolve = (mode, options = {}) => resolveCandidates(selector, mode, options)`. `body` is source authored in this repository, never caller code; JSON-stringify all interpolated values. The first uses `cdp.evaluate` (already `returnByValue: true`, `awaitPromise: true`). The second sends `Runtime.evaluate` with `returnByValue: false`, `awaitPromise: true`, checks `exceptionDetails` using `cdpExceptionMessage`, requires an `objectId`, and returns it; the consumer owns its release. Both execute against the same default context currently used for string selectors; refs retain their existing session-based route. Do not add a cross-process protocol. US-2161 modifies only these two functions' internals and `resolveCandidates` for its host AX pre-pass: obtain Chromium accessibility facts, resolve element IDs via `DOM.resolveNode`, pass object IDs to `Runtime.callFunctionOn` in the same context, and release temporaries. Callers remain unchanged. There are only `query` and `action` modes; no compatibility-policy layer.
- [x] In `page-scripts.ts`, replace the resolver's free lexical `force` references with `options.force` in both CSS and text branches; retain `visibleOnly` and `nth`. Remove callers' `const force = false` declarations. Query mode continues using its existing CSS `querySelector` then `querySelectorAll`, and its existing text semantics.

### 2. Actions and locator bodies

- [x] In `locator.ts`, change `actionabilityFunction()` to take `(resolve, selector, nth, force, position, hitTest = true)` and keep the existing body, diagnostics and marker errors. Set `let el = this`; only perform selector resolution when `resolve !== null`. For the non-forced pre-check and action list:

  ```js
  // Before (selector branch)
  if (!force && !selector.startsWith('text=')) {
      const allMatches = [...document.querySelectorAll(selector)];
      if (allMatches.length > 0 && !allMatches.some(displayed))
          throw new Error('ACTIONABILITY_TRANSIENT: Element is not visible.');
  }
  const matches = resolveCandidates(selector, 'action');
  // After
  if (!force) {
      const allMatches = resolve('query');
      if (allMatches.length > 0 && !allMatches.some(displayed))
          throw new Error('ACTIONABILITY_TRANSIENT: Element is not visible.');
  }
  const matches = resolve('action', { force });
  ```

  For CSS, query mode supplies the same unfiltered list. For text, query mode only returns displayed elements, so this pre-check cannot fire, matching today's skipped check. Pass the selector as a separate safely serialized argument to `actionabilityFunction` for the unchanged ambiguity message; do not parse it there. The ref branch passes both `resolve` and `selector` as `null`.

  ```ts
  // Before: selector evaluates actionabilityFunction() directly; ref calls it with this bound.
  // After: one shared function source in both paths, no duplicated actionability implementation.
  const result = "ref" in locator
      ? await callOnRef(baseCdp, locator.ref,
          `function() { return (${actionabilityFunction()}).call(this, null, null, null, ${Boolean(options.force)}, ${JSON.stringify(options.position ?? null)}, ${options.hitTest !== false}); }`, true)
      : await evaluateWithCandidates(input.cdp, locator.selector,
          `(resolve) => (${actionabilityFunction()}).call(null, resolve, ${JSON.stringify(locator.selector)}, ${options.nth ?? "null"}, ${Boolean(options.force)}, ${JSON.stringify(options.position ?? null)}, ${options.hitTest !== false})`);
  ```

  Keep the retry loop in `resolveActionablePoint` around the whole call, ref session selection, `inputCdp` mapping, and existing retry/fatal/error classification. Construct interpolated strings with current validation and serialization conventions.
- [x] In `locatorFunction` / `runOnLocator`, keep ref `callOnRef` as-is; for selectors build a repo-authored `(resolve) => { ... }` body and pass it to `evaluateWithCandidates`:

  ```js
  // Before
  const allMatches = selector.startsWith('text=') ? resolveCandidates(selector, 'query') : [...document.querySelectorAll(selector)];
  // After
  const allMatches = resolve('query');
  ```

  Retain `VISIBLE_FN`, visible count, `nth`, `allowHidden`, error text and `(function() { body }).call(el)` unchanged.

### 3. Screenshot, reads and synthetic paths

- [x] In `page-state.ts` `takeScreenshot`, replace the selector-side `cdp.evaluate` with `evaluateWithCandidates(cdp, locator.selector, body)`; keep the ref branch, bounds and catch intact:

  ```js
  // Before: selector.startsWith('text=') ? resolveCandidates(selector, 'query') : [...document.querySelectorAll(selector)]
  // After, inside body:
  const matches = resolve('query').filter(visible);
  ```

- [x] In `queries.ts`, each selector branch uses `evaluateWithCandidates(target.cdp(tabId), locator.selector, body)`; leave the ref branches unchanged. Bodies map exactly as follows, with `attribute` JSON-stringified in the generated body:

  ```js
  // getElementText:      resolveCandidates(selector, 'query')[0]?.textContent ?? null
  // after:               resolve('query')[0]?.textContent ?? null
  // getElementValue:     resolveCandidates(selector, 'query')[0]?.value ?? null
  // after:               resolve('query')[0]?.value ?? null
  // getElementAttribute: resolveCandidates(selector, 'query')[0]?.getAttribute(attribute) ?? null
  // after:               resolve('query')[0]?.getAttribute(attribute) ?? null
  // getElementHtml:      resolveCandidates(selector, 'query')[0]?.innerHTML ?? null
  // after:               resolve('query')[0]?.innerHTML ?? null
  // elementExists:       !!resolveCandidates(selector, 'query')[0]
  // after:               !!resolve('query')[0]
  // waitFor selector poll before: const el = resolveCandidates(selector, 'query')[0];
  // after:                      const el = resolve('query')[0];
  ```

  Wrap each expression as `(resolve) => ...`; the wait body retains `VISIBLE_FN`, state logic and existing poll/timeout outside the entry. Do not change text/textGone or time waits.
- [x] In `mouse.ts`, replace each synthetic selector `cdp.evaluate` with the entry, preserving options and event bodies:

  ```js
  // Before click and hover: resolveCandidates(selector, 'query', { visibleOnly: true, nth })
  // After in each body:
  const matches = resolve('query', { visibleOnly: true, nth });
  // click: matches[0].click(); hover: dispatch existing mouseenter and mouseover events.
  ```

  Keep the `Element not found` check, ref branch and trusted branch unchanged; serialize `nth` as today.
- [x] In `synthetic.ts`, use `evaluateWithCandidates` for `focusElementBySelector` and selector `fillInput`:

  ```js
  // Before focus: let el = document.querySelector(selector); then querySelectorAll if hidden.
  // After focus:  const all = resolve('query'); let el = all[0]; // existing hidden fallback scans all
  // Before fill:  const el = document.querySelector(selector);
  // After fill:   const el = resolve('query')[0];
  ```

  Preserve first-match and legacy visibility checks, separate fresh fill lookup, scroll/focus, events, `Element not found`, ref path and `typeText`'s empty selector/ref check. These paths now accept `text=` with the resolver's query filtering and order.

### 4. Node consumers and bridge version

- [x] In `forms.ts` `setInputFiles`, keep `DOM.getDocument({ depth: 0 })` before the branch to initialize the DOM domain, and leave ref/backend/session handling unchanged. For a selector, use `evaluateCandidateObject` with a `(resolve) => { ... }` body resolving query candidates once. It throws `Element not found: ${selector}` for zero, `Ambiguous selector "${selector}": ${count} matches. Use a ref or narrow the selector.` for more than one, and returns the sole element otherwise. Embed selector with `JSON.stringify`.

  ```ts
  // Before: DOM.querySelectorAll -> count -> DOM.describeNode({ nodeId: nodeIds[0] })
  // After: strict query body -> objectId -> describe -> release
  const objectId = await evaluateCandidateObject(cdp, locator.selector, body);
  try {
      const described = await cdp.send("DOM.describeNode", { objectId }, sessionId);
      backendNodeId = described.node.backendNodeId;
  } finally {
      await cdp.send("Runtime.releaseObject", { objectId }, sessionId).catch((): undefined => undefined);
  }
  ```

  Keep subsequent type/path validation and `DOM.setFileInputFiles` unchanged. Selector session is currently undefined; refs retain their own session. Count and select in one page execution, then release on every successful object acquisition, including describe failures.
- [x] In `snapshot.ts` `resolveSelectorRoot`, retain `DOM.getDocument({ depth: 0 })` before resolving to initialize the DOM domain for `DOM.describeNode`. The strict query body throws `snapshot root selector matched no elements: ${selector}` for zero and `snapshot root selector matched ${count} elements: ${selector}` for more than one, otherwise returns the sole element. Then:

  ```ts
  // Before: DOM.querySelectorAll -> count -> DOM.querySelector -> DOM.describeNode({ nodeId })
  // After:
  const objectId = await evaluateCandidateObject(cdp, selector, body);
  try {
      const { node } = await cdp.send("DOM.describeNode", { objectId });
      if (!node.backendNodeId) throw new Error(`Could not resolve snapshot root selector: ${selector}`);
      return node.backendNodeId;
  } finally {
      await cdp.send("Runtime.releaseObject", { objectId }).catch((): undefined => undefined);
  }
  ```

  Other snapshot CDP work includes `Accessibility.getFullAXTree` and iframe DOM calls; `getOwnedIframeTargets` separately initializes the relevant parent DOM domain before `DOM.getFrameOwner`. Keep these and ref roots unchanged. Invalid selector error wording on the two former CDP query paths may change from the CDP DOM error to page `SyntaxError`; that is accepted.
- [x] Because `text=` newly works for setInputFiles, snapshot root and synthetic typing/focus through board calls, bump `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `1.59.0` to `1.60.0`. Add a new leading `Bridge 1.60.0` history paragraph in `assets/guides/agents/boards/bridge-versions.md`, following the existing `1.59.0` prose style, stating selectors resolve through one path and naming those newly supported `text=` surfaces. Later EPIC-206 tasks extend this same line without another bump. Decision 7 expressly assigns the bump to US-2160 when its change is observable by boards.

### 5. Guardrails and verification

- [x] Run `npm run typecheck` and `npm run lint`; automation and scripting are strict folders in `scripts/typecheck-strict.mjs`. Fix declared types first; null-check fixes are type-only and never alter runtime conditions. No `await import()` or wrapper to bypass an import zone; no new protocol or correlator, no board rule outside `src/shared/board/` and board registries, and no growth in roadmap §2.3 god files including `automation/operations.ts` and `BrowserWebviewModel.ts`. Owners: `selector-execution.ts` for host execution; `page-scripts.ts` for grammar; existing callers for their strictness/action rules; `ref.ts` for refs; existing `CdpSession` and IPC primitives for transport. Do not edit `.gitignore` or run `build-prod`.
- [ ] Run existing UI coverage after implementation: `npm run test:ui -- --area browser` (see `doc/standards/integration-tests.md`). `integration-test/tests/browser/automation/input/input.test.mjs` covers ref/CSS/text actions, ambiguity/nth, actionability, forms, file upload, synthetic click/type and five query reads; its scoped snapshot uses a ref. `integration-test/tests/browser/automation/observe/observe.test.mjs` covers selector wait states and timeout. For app CSS snapshot roots and text actions, also use `integration-test/tests/shell/menu-bar/menu-bar.test.mjs` and `integration-test/tests/editors/markdown/markdown.test.mjs` (outside browser area). Existing coverage does not establish full parity for synthetic hover, selector screenshots, CSS snapshot root count errors, invalid selectors, hidden/zero-size ordering, retries, OOPIF refs or board facade. Verify those and newly accepted text on synthetic typing/focus, file input and snapshot root with targeted UI integration scenarios/manual checks. No unit tests.

## Concerns

- The accepted widening of formerly CSS-only shared automation consumers changes board-observable behavior. This task makes the bridge bump under epic Decision 7; later epic tasks extend the history paragraph.
- Invalid-selector wording for the former CDP DOM queries may change to page `SyntaxError`; do not promise identical CDP error text there. Other existing selector error text and retry/fatal classification must remain unchanged. Navigation/detachment can still race node description; release remote objects in `finally`.
- Fullscreen is the documented CSS-only main-process page-tools exception above, outside this task.

## Acceptance criteria

- [x] Every caller-supplied selector read in shared browser/app/board automation uses the host entry and page-side resolver; caller code does not parse selector grammar or query it directly. Refs and arbitrary evaluate retain their separate paths.
- [ ] Valid CSS, existing `text=` and refs have identical results, ordering, visibility, ambiguity, errors, frame behavior, retry/fatal classification and synthetic events on their existing paths; `text=` additionally works on formerly CSS-only synthetic typing/focus, file upload and snapshot roots. Invalid selector error wording may change on the two former CDP DOM query paths.
- [x] CDP node consumers retain strict count and messages, use the correct node/session and release objects; the host entry allows US-2161 to add AX element arguments without changing callers.
- [ ] The bridge is `1.60.0` with its new history paragraph; later epic tasks extend it. Existing UI tests and targeted checks pass; `npm run typecheck` and `npm run lint` pass. No new selector engines or unit tests.
- [x] No new protocol, misplaced board rule, god-file growth, import-zone workaround, `.gitignore` edit or `build-prod` run.

## Files requiring no changes

`doc/active-work.md` already has the task; `doc/epics/EPIC-206.md` already links it. This work edits only the task document. During implementation, `src/renderer/automation/ref.ts`, `src/renderer/automation/CdpSession.ts`, `src/renderer/automation/AppTargetModel.ts`, board registries, and scripting facade locator signatures need no change. Fullscreen and its main-process/channel files are out of scope. Do not grow `src/renderer/automation/operations.ts` or `src/renderer/editors/browser/BrowserWebviewModel.ts`.

## Files Changed

| File | Purpose |
|---|---|
| `doc/tasks/US-2160-one-selector-path/README.md` | Investigation and implementation plan; only file changed now. |
| `src/renderer/automation/selector-execution.ts` (planned new) | Host evaluation and future AX pre-pass seam. |
| `src/renderer/automation/page-scripts.ts` (planned) | Explicit resolver `force` option and existing grammar. |
| `src/renderer/automation/locator.ts`, `page-state.ts`, `queries.ts`, `mouse.ts`, `synthetic.ts`, `forms.ts`, `snapshot.ts` (planned) | Route selector reads through the entry and preserve caller-specific rules. |
| `src/shared/board-bridge-version.ts` (planned) | Bump bridge to `1.60.0`. |
| `assets/guides/agents/boards/bridge-versions.md` (planned) | Add `1.60.0` history paragraph. |
