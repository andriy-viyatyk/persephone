# US-2163: Model refs and runtime helpers

**Epic:** [EPIC-206](../../epics/EPIC-206.md) · **Status:** Planned · **Proposals:** D3, G6

## Goal

Let saved and temporary site-extension models return ordinary browser automation refs and supply reusable page-side helpers for visibility, accessible names, controlled inputs, polling and deferred navigation. Use the existing model-call path and ref format.

## Background

- `src/site-extension-runtime.ts` owns the runtime, not `BrowserWebviewModel.ts`. The standalone IIFE is built by `scripts/dev.mjs` and `scripts/build-prod.mjs`, served by `src/main/site-extension-runtime.ts`, and inserted by `SiteExtensionInjection.createExpression` before the extension source. `BrowserSiteExtensionController` selects saved and temporary sources, including test-runner attachments. The runtime and model share the page's main world; `window.__persephoneSiteRuntime` is frozen. Board models use `src/board-shim/ai-vision-api.ts`, not this runtime; the application host has no site-extension runtime.
- `BrowserPageRemote.request` selects the site or WebMCP remote, calls `remote.handle`, serializes its result with `JSON.stringify`, and receives it through `automation/queries.ts` `evaluateInTarget`. JSON preserves JavaScript property enumeration order. AiVision 1.4.0 shapes the result inside `handle` before the host sees it: depth 8, arrays 500 and `maxLength` limits apply. `page-model-reply.ts` converts reported length cuts to `result-truncated`; structural and nested-string limits remain separate.
- `automation/ref.ts` parses snapshot refs `e<backendNodeId>` and `f<N>-e<backendNodeId>`. `resolveRef` uses `DOM.resolveNode`; `callOnRef` invokes on the resolved node, and actions use trusted CDP input by default. `snapshot.ts` owns and replaces the OOPIF frame-index map. Runtime helpers mint refs only for this main document, so use unprefixed `e...`. Reject foreign-document elements, including accessible same-origin iframe elements, rather than inventing frame indices that snapshots can replace.
- `ref.ts` already reports `Ref "…" is stale — the element is no longer in the DOM. Re-take the snapshot.` when CDP reports the node missing. CDP can still resolve a detached node; actionability in `locator.ts` can report `Element is detached.`. A removed and reinserted same node can work again. No global change to snapshot-ref semantics is intended.
- `automation/page-scripts.ts` exports `VISIBLE_FN`: positive bounding-box width and height, computed `visibility !== hidden` and `display !== none`. `synthetic.ts` `fillInput` uses native input/textarea prototype setters and bubbling `InputEvent('input')` and `change`; `forms.ts` has a native-input setter for special types. `input.ts` sends keyboard events.
- `window.persephone.call()` can invoke browser models and consume their refs, so the feature is board-observable even though board frames do not have this helper. US-2160 is planned to land first and bump the bridge to `1.60.0`.

## Implementation plan

- [x] **Shared primitives and runtime owner:** US-2160 lands first; re-read its final `src/renderer/automation/synthetic.ts` `fillInput` and `src/renderer/automation/page-scripts.ts` before extracting. Add `src/shared/automation-page-primitives.ts` as the single owner of the existing visibility definition and native setter/event sequence. `page-scripts.ts` re-exports `VISIBLE_FN`; `synthetic.ts` reuses the setter/event primitive while retaining its own focus and scrolling. Add `src/site-extension-helpers.ts` to own runtime helper behavior and the document registry. Import shared primitives and helpers directly. The automation import zone in `eslint.config.mjs` permits `src/shared/`; the shared boundary permits self-contained shared modules. `scripts/dev.mjs` uses `iifeConfig` to bundle the runtime entry, so its static shared imports are bundled in the IIFE. No zone exception, dynamic import or wrapper to bypass an import boundary. Keep `BrowserWebviewModel.ts` unchanged.

  ```ts
  // Before: src/renderer/automation/page-scripts.ts owns the source.
  export const VISIBLE_FN = `…`;
  // After: src/shared/automation-page-primitives.ts owns the same rule.
  export { VISIBLE_FN } from "../../shared/automation-page-primitives";
  ```

  ```ts
  // Before: src/site-extension-runtime.ts assembles existing runtime members.
  const runtime: SiteRuntime = { schemaVersion: AI_VISION_SCHEMA_VERSION, params, /* existing methods */ };
  // After: the collaborator supplies the new methods; dispose also calls helpers.dispose().
  const helpers = createSiteExtensionHelpers();
  const runtime: SiteRuntime = { schemaVersion: AI_VISION_SCHEMA_VERSION, params, ...helpers.publicApi, /* existing methods */ };
  ```

- [x] **Page ref registry:** `runtime.ref(element)` rejects non-Elements, elements from another document and disconnected elements at mint time. Return a plain JSON-shapable `{ ref: "persephone-ref:<n>:<padding>" }`; never mutate the DOM. Use a per-runtime safe-integer counter and `Map<number, WeakRef<Element>>`. A hard cap of 10,000 live entries throws a clear error rather than evicting an entry; dispose clears the map. A single non-enumerable runtime-private lookup consumes the registry entry when converted and returns the element; unknown, expired or collected entries fail clearly. The page and extension share the main world, so tokens are not an authorization boundary. Entries omitted by truncation or abandoned after timeout remain weak until dispose and count toward the cap. A marker must never be delivered as a ref.

  Set marker length to at least 32 ASCII characters with fixed padding. Validate the CDP backend ID as a nonnegative safe integer, at most 16 decimal digits: its `e`-prefixed ref is at most 17 ASCII characters. Reject an invalid/out-of-range ID; if the supported bound ever exceeds the marker, increase padding before accepting it. Both strings are JSON-safe ASCII, so replacing the marker with the ref can only shrink the serialized reply.

  ```js
  // Before: the model tags a row and returns a selector.
  // After: refs can be nested in ordinary arrays and objects.
  return rows.map(row => ({ id: row.id, target: runtime.ref(row.element) }));
  // Caller receives e.g. [{ id: ..., target: { ref: "e123" } }].
  ```

- [x] **Host conversion:** add `src/renderer/editors/browser/page-model-refs.ts` as the marker-conversion owner. In `BrowserPageRemote.request`, after `normalizePageModelReply` rejects reported cuts, convert only successful `ai:get`/`ai:invoke` replies of the site runtime's own exposed model. Do not convert WebMCP or unrelated page-authored remotes. Identify that the remote is the runtime's exposed remote; validate the complete marker, quote interpolated tokens safely, traverse arrays and own object values in JavaScript enumeration order, and replace only an exact marker object's `ref` string. Preserve response metadata and key order.

  Resolve each distinct token once in the same tab's main world with `Runtime.evaluate({ returnByValue: false })` through the non-enumerable lookup, then call `DOM.describeNode({ objectId })` to get `backendNodeId`; check exceptions, element type and ID bound. Always `Runtime.releaseObject` in `finally`. Reuse the resulting ref for duplicate markers, cap distinct tokens at 500 per reply, and fail the whole call clearly for unknown/expired tokens or a cap violation. Check the original document generation before and after conversion, handle overlapping calls independently and do not replay the method. This uses existing CDP/evaluate operations: no new IPC message, correlator, event channel or alternate parser.

  ```ts
  // Before
  return normalizePageModelReply(parsed, maxLength, webMcp);
  // After: only this runtime's site reply receives marker conversion.
  const normalized = normalizePageModelReply(parsed, maxLength, webMcp);
  return isRuntimeSiteReply ? await convertSiteModelRefs(normalized, context) : normalized;
  ```

  Do not add another shaping pass or patch AiVision. Since a valid marker is at least as long as the ref, conversion cannot expand a passed reply or expose a partial ref. A reply close to `maxLength` can report `result-truncated` a few characters early per ref; this conservative accounting is accepted. Preserve the existing structural and nested-string limits.

- [x] **Visibility and controlled values:** the helper's `visible(el)` reuses the extracted `VISIBLE_FN` definition, with identical automation semantics. `setValue(input, value)` accepts an `HTMLInputElement` or `HTMLTextAreaElement` and a string, invokes the correct native prototype value setter, then dispatches a bubbling `InputEvent` (`inputType: insertText`, `data: value`) and bubbling `change`. Reject unsupported controls clearly. Reuse the extracted `synthetic.ts` sequence; the helper does not focus or scroll, and its events are synthetic, not trusted typing. Keep `forms.ts` special-type validation and trusted typing unchanged.

- [x] **Accessible name:** `accessibleName(el)` is a small synchronous page-side approximation, not Chromium AX computation. Validate an Element and follow this order: `aria-labelledby` referenced text in ID order, `aria-label`, native label/alt/`<caption>`/`<legend>`, name-from-content for roles that allow it, then `title`; return an empty string if none. This does not attempt full accname and can disagree with snapshots for hidden references, native semantics, embedded controls, shadow DOM or pseudo-content. Snapshot and `role=` locator names use Chromium's AX computation under epic Decision 2; never use the approximation to implement those locators.

- [x] **Polling:** `waitFor(fn, { timeout = 5000, interval = 100 } = {})` invokes the predicate immediately and then at the interval, awaits async predicates serially, resolves with the first truthy value, and rejects with an informative timeout error. Propagate predicate errors, validate finite nonnegative timeout and positive interval, and clear the timer on settlement/disposal. The outer model-call timeout or navigation can end the call first.

- [x] **Deferred action:** track in-flight site-model method invocations and each invocation's callback queue. `afterReturn(fn)` binds only when exactly one invocation is in flight. With zero, throw `afterReturn can only be called during a model method call`; with more than one, throw a clear error naming the concurrent-call limitation. Extend the existing site-remote evaluation expression in `BrowserPageRemote.request`: establish invocation scope, await `remote.handle`, serialize the response, schedule queued callbacks using `setTimeout(..., 0)`, and return the serialized string. Clear scope on failure/disposal and catch and log callback errors to the page console. The CDP evaluation response is posted as the promise resolves, before the later macrotask; it is on its way, not acknowledged by the external caller. Document: “runs after the reply has been produced; if navigation still wins, use allowNavigation.” Preserve `page-navigated` / `allowNavigation: true` recovery. No new message, acknowledgement or host flush.

  ```js
  // Before
  return JSON.stringify(await remote.handle(request));
  // After (scope and callback queue are owned by the helper collaborator)
  const invocation = runtime.beginInvocation();
  try {
      const serialized = JSON.stringify(await remote.handle(request));
      runtime.finishInvocation(invocation, true); // schedules callbacks via setTimeout(..., 0)
      return serialized;
  } catch (error) { runtime.finishInvocation(invocation, false); throw error; }
  ```

- [x] **Types:** update both `src/renderer/api/types/site-extensions.d.ts` and `assets/editor-types/site-extensions.d.ts` consistently with helper signatures, return types and limits. Check existing `SiteExtensionActionRuntime` consumers and preserve existing members. Examples should feature-detect helpers for older runtimes.

- [x] **Bridge version:** US-2160 lands first, bumps `src/shared/board-bridge-version.ts` to `1.60.0` and creates the `1.60.0` entry in `assets/guides/agents/boards/bridge-versions.md`. Extend that same line with board-observable model refs; do not bump again. If still `1.59.0` at implementation time, perform the single bump and create the line. No board rules outside `src/shared/board/` and board registries.

- [x] **Checks:** run `npm run typecheck` and `npm run lint`; no unit tests. `scripts/dev.mjs` provides an IIFE configuration, but its normal entry clears `.vite/build` and starts the app; `package.json` has no standalone runtime-build command. Build the runtime only if a standalone command exists at implementation time that does not wipe the dev build. Never run `build-prod` or edit `.gitignore`. Strict-folder null-check fixes are type-only and do not change runtime conditions.

### Live checks (Claude)

- Exercise saved and temporary models including runner attachment, nested/repeated refs and each ref consumer including upload and snapshot root; check trusted input, foreign-document rejection, detach/reinsert and replacement.
- Check size limits and key order, expired tokens, registry caps, concurrent calls, dispose/reload and navigation races; verify a board's `window.persephone.call()` and unchanged iframe snapshot refs.
- Check visibility, approximate names against AX snapshot, controlled React input/textarea events, polling success/timeout/errors, and `afterReturn` with zero/one/multiple invocations and navigation with and without `allowNavigation`.

## Concerns — resolved decisions

1. **Reply size:** accept conservative pre-conversion accounting with markers padded beyond the maximum accepted ref length. No second shaping pass or AiVision patch. Near-cap results can truncate early.
2. **Tokens:** a per-runtime counter and capped `Map<number, WeakRef<Element>>` suffice. The host converts only the runtime's model replies through one non-enumerable lookup, consuming each distinct token, with a maximum of 500 per reply. The shared main world is not a security boundary.
3. **Lifetime and frames:** mint connected elements from the main document only. A ref resolves while its node exists; the same node removed and reinserted can work again. Detached actions use existing actionability errors, and nodes CDP no longer resolves use the existing stale-ref error. No mutation tracking or changes to `ref.ts`, `forms.ts` or `snapshot.ts`; a replacement node needs a fresh ref.
4. **AX semantics:** use the stated small synchronous approximation. Snapshots and `role=` locators use Chromium AX names and may differ; no full accname implementation is intended.
5. **Deferred action and concurrency:** `afterReturn` runs best-effort after reply production, binding only with exactly one invocation in flight. There is no end-to-end delivery acknowledgement; `allowNavigation` remains the recovery if navigation wins.

### Facts for the epic `/userdoc`

At epic completion, update `assets/guides/agents/site-extensions.md` and `assets/guides/agents/temporary-site-extensions.md` with signatures and examples; ordinary `{ ref }` and trusted actions; main-document scope, detached/reinserted nodes and re-render replacement; the visibility rule; approximate names versus Chromium AX; synthetic input events and supported controls; polling defaults/errors and outer timeout; best-effort deferred navigation and `allowNavigation`; key order, structural limits, conservative per-ref size accounting and `result-truncated`; the common saved/temporary/runner runtime and feature detection on older versions.

## Acceptance criteria

- [ ] Saved and temporary models, including runner models, expose all six helpers. Nested refs arrive as ordinary snapshot refs without DOM tagging or a new protocol.
- [ ] Click, hover, type, ref reads, upload and snapshot-root paths accept model refs with existing trusted-input behavior. Minting rejects foreign/disconnected elements; detached actions and unavailable nodes use existing errors; a reinserted same node can remain usable.
- [ ] JSON key order, existing structural limits and reported truncation behavior are preserved. Markers cannot be shorter than accepted refs; early near-cap truncation is documented and no second shaping pass is added.
- [ ] Shared visibility and native setter/events are reused; the accessible-name approximation and polling behavior match their documented contracts.
- [ ] Token limits, cleanup and duplicate markers work; `afterReturn` enforces one in-flight invocation and schedules after reply production, retaining existing navigation recovery.
- [ ] US-2160's `1.60.0` history line is extended for model refs, with the fallback bump if necessary; no board runtime helper or new board rule is introduced.
- [ ] Typecheck and lint pass; the live scenarios are handed to Claude. No unit tests, production build, dashboard edit or god-file growth.

### Files with no changes

`doc/active-work.md` (entry already exists), `doc/epics/EPIC-206.md` (task linked), `src/renderer/editors/browser/BrowserWebviewModel.ts`, `src/renderer/editors/browser/BrowserSiteExtensionController.ts`, `src/board-shim/ai-vision-api.ts`, `src/renderer/automation/input.ts`, `src/renderer/automation/ref.ts`, `src/renderer/automation/forms.ts`, `src/renderer/automation/snapshot.ts`, `src/renderer/editors/browser/page-model-reply.ts`, `.gitignore`, and the two site-extension guides (deferred to epic `/userdoc`). US-2160 lands first; re-read its changes before editing `page-scripts.ts` and `synthetic.ts`.

## Files Changed

| File | Planned change |
|---|---|
| `src/site-extension-helpers.ts` | New page helper and registry owner |
| `src/site-extension-runtime.ts` | Compose helpers and invocation/disposal lifecycle |
| `src/shared/automation-page-primitives.ts` | Shared visibility and native setter/event primitives |
| `src/renderer/editors/browser/page-model-refs.ts` | New host-side token conversion owner |
| `src/renderer/editors/browser/BrowserPageRemote.ts` | Conversion and deferred callbacks on existing call path |
| `src/renderer/automation/page-scripts.ts`, `src/renderer/automation/synthetic.ts` | Re-export and reuse primitives after US-2160 lands |
| `src/renderer/api/types/site-extensions.d.ts`, `assets/editor-types/site-extensions.d.ts` | Mirrored runtime types |
| `assets/guides/agents/boards/bridge-versions.md` | Extend US-2160's `1.60.0` history line |
| `src/shared/board-bridge-version.ts` | Fallback bump only if still `1.59.0` |
| `doc/tasks/US-2163-model-runtime-helpers/README.md` | This plan |
