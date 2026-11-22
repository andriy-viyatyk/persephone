# US-2162: Chaining, filters and the object form

[EPIC-206](../../epics/EPIC-206.md) · D2 · Planned; implementation awaits review

## Goal

Add chained selector steps, CSS suffix filters, positional steps and a JSON-safe object locator, all through the existing shared resolver. This document is a plan only; US-2161's implementation is already staged, with verification fixes in the working tree.

## Background

The binding decisions are EPIC-206 Decisions 1, 3, 4, 5 and 7; the proposal is [review section 3 D](../../reviews/web-app-testing-review.md#d-locators-address-elements-the-way-playwright-does). `src/renderer/automation/page-scripts.ts` emits `selectorParserSource()` for preflight and `resolveCandidatesSource()` for execution. `parseSelector` already returns steps but rejects top-level `>>`; its engine names omit `=`. `selectorRoleNames` parses role steps, and `selector-execution.ts` gates preflight on `selector.includes("role=")`, queries AX facts, passes DOM objects to `Runtime.callFunctionOn`, and releases temporary objects. Preserve the checked/pressed tristate token conversion. Chromium `queryAXTree` does not return `display:none` or `aria-hidden` nodes; `[include-hidden]` remains a documented limitation.

Today CSS and attribute/role action mode prefer displayed, sized matches (or all with force); query mode returns all. Text has its own existing displayed, innermost, size and area/depth ordering, including in query mode, and force behavior. `actionabilityFunction` calls query for a visibility precheck, then action, and enforces ambiguity and nonnegative option `nth` on the final list. `locatorFunction` has its own visible/strict handling. Keep these single-step behaviors; introduce an unfiltered intermediate evaluation without accidentally changing a standalone `text=` selector.

`role` uses `scope.contains` (which includes scope itself); CSS and attribute engines use `scope.querySelectorAll` (descendants only). `text=` currently searches `document.querySelectorAll('body *')`, ignoring scope. `label=` searches scoped controls but restricts `aria-labelledby` targets to that scope even though `control.labels` may be outside it. Labels describe controls, so scope restricts candidate controls, not their associated labels or IDREF targets; look up IDREFs in the control's document. Ref resolution in `ref.ts` provides `parseRef`, `resolveRef` and frame sessions. Existing selector evaluation is main-frame only; an object `within` ref must be main-frame on the selected target, with an explicit error for `fN-eN`.

Entry points verified: `AutomationSurface.ts` normalizes action, drag and file locators; `BrowserEditorFacade.ts` normalizes read locators and the string-only `waitForSelector`; `forms.ts` normalizes `fillForm` fields; `keyboard.ts` normalizes `options.target`; `page-state.ts` normalizes screenshot target. `src/renderer/api/window-screen.ts` delegates to `AutomationSurface`; board definitions describe that shared facade. Selector-only wait and snapshot-root APIs remain selector/ref APIs, not object-locator APIs. `forms.ts` currently strips a locator to selector/ref for synthetic typing; `mouse.ts`, `queries.ts`, `page-state.ts`, and `locator.ts` pass only `locator.selector` into execution. These consumers already pass the compiled selector, so a leading `ref=` step needs no per-consumer scope plumbing.

## Implementation plan

### 1. Parser and page-side resolution

- [x] In `src/renderer/automation/page-scripts.ts`, change `parseSelector` to split top-level `>>` while tracking per-step quoted strings, escapes, brackets, parentheses, and regex delimiters/classes. Reset text-mode state per step; do not split literals such as `[title="a >> b"]` or a role regex containing `>>`. Reject empty steps and malformed syntax with actionable errors. Recognize `nth=<signed integer>` as a step only, require a preceding step, reject malformed/non-safe integers, and retain engine names without `=`. Replace `selectorRoleNames` with `selectorHostFacts(selector)` returning `{ roles, refs }` from the parsed steps. Recognize public `ref=<ref>` as a scope-independent engine that must be the first step; reject it elsewhere with a clear error. A leading ref yields its resolved element as the first candidate, including when it is the only step. The existing direct `{ ref }` form remains unchanged.

  ```js
  // Before
  throw new Error('>> chaining is not supported yet');
  // After (outline)
  const steps = splitTopLevelSteps(selector).map(parseStep);
  return steps;
  ```

- [x] In `resolveCandidates`, resolve each non-nth descendant step against every prior scope (the leading `ref=` step instead yields its supplied element); union, deduplicate by identity and sort in document order before the next step. Descendant engines exclude the scope element (including AX facts: require `element !== scope`), except the explicit CSS `:scope` case below. Apply `nth` to the entire preceding ordered union, with `index = n < 0 ? length + n : n`; out of range yields `[]`. Consecutive nth steps work. A final nth is applied before final action visibility filtering, and any later step uses the selected elements as scopes. Preserve final strictness at existing callers; existing action `{ nth }` remains nonnegative and selects after the selector and its action visibility selection. Thus `li >> nth=-1` selects the last raw list item first; `{ nth: 0 }` then selects the first surviving final candidate, while `{ nth: 1 }` cannot select another item.
- [x] Split candidate generation from final selection. Intermediate steps must not apply displayed/visible/force filtering. For intermediate text, retain text matching and innermost rule but calculate it over scoped descendants without display/size/area filtering; union is document order. For final text retain existing standalone matching and visibility/size preference, innermost selection and area/depth sorting for a single step; a chain's final union is document order. Final CSS/attribute/role candidates receive the existing action preference once globally, not independently per parent. `options.visibleOnly` and `options.nth` stay last, as today. Explicit `:visible` is a requested filter and applies at its step even when intermediate. Scope text queries to descendants (`body *` for document preserves current behavior); ensure no scope self-match except explicit `:scope`.
- [x] Parse suffixes on CSS steps only: zero or more `:has-text(<JSON double-quoted string>)` and `:visible`, either order. Scan with quote/escape/bracket/parenthesis awareness; ignore literal pseudo text in attribute values and escaped CSS, but reject these pseudo tokens inside `:is(...)`, before a combinator or other CSS, or anywhere except the suffix, naming the pseudo and saying it must be a CSS-step suffix. Reject malformed arguments clearly before browser CSS parsing. Strip filters before `querySelectorAll`, using `*` for an otherwise empty CSS base. Apply every `:has-text` using normalized `innerText || textContent || ''`, case-insensitive substring as unquoted `text=`; apply `visible` from `VISIBLE_FN`. Keep ordinary CSS errors unchanged.
- [x] Support only an exact CSS base `:scope` followed by one or more of these suffixes as a same-element filter: for an element scope evaluate that element, rather than relying on `element.querySelectorAll(':scope')`; for document scope use its document element. This is the string grammar used by object filters on non-CSS engines and avoids selecting descendants. Every other use of `:scope`, including bare `:scope` and other CSS combinations, retains ordinary browser behavior. Object-generated `:scope` steps must be evaluated per parent then deduplicated.
- [x] Correct `label=` IDREF lookup as above; preserve `control.labels` associations and the existing supported controls. Change scoped `text=` lookup and AX self-exclusion; verify all attribute engines and CSS use the scope. Keep existing role-property logic and include-hidden behavior intact.

### 2. Compile object locators once

- [x] In `src/renderer/automation/locator.ts`, keep `SelectorLocator` as `{ selector: string }` and `ElementLocator` as `RefLocator | SelectorLocator`; retain string and `{ ref }` normalization exactly as today, including existing permissiveness of ref objects. Compile new objects only in `resolveElementLocator`, recursively normalizing `within`: a string or compiled object prepends `<within> >> `, while `{ ref: "e12" }` prepends `ref=e12 >> `. Nested `within` forms compose into one selector. Reject cycles and invalid/empty strings with clear errors. Preserve existing direct iframe ref behavior; the `ref=` engine rejects frame refs at execution.
- [x] Supported object keys: exactly one of `role`, `label`, `placeholder`, `testId`, `title`, `alt`, `text`, `selector`; modifiers `name`, `exact`, `within`, `hasText`, `visible`, `nth`. Reject unknown keys with that complete supported list, multiple/missing what keys, arrays, wrong types, and incompatible modifiers. `name` is role-only and is a string or `{ regex: string, flags?: string }`; validate regex and flags, encode safely as `/pattern/flags` (escape unescaped delimiter slashes without changing regex meaning), and reject `exact` with regex. `exact` is boolean and applies only to role name or label/placeholder/title/alt/text; require a value and reject it for role without name, CSS or testId. `hasText` is a string, `visible` a boolean (false adds no filter), `nth` a safe signed integer. `role` must match the existing role grammar `^[\w-]+$`; other what values are strings. `testId` is always exact. No live `RegExp` object is accepted: board `call` transports JSON.
- [x] JSON-quote literal values so quotes, backslashes and `>>` cannot escape their step. Compile role name as `[name=${JSON.stringify(name)}${exact ? 's' : ''}]`; other attribute engines use their existing quoted matcher and `s` for exact. `testid` uses its existing quoted exact behavior. For object `text`, extend the text parser in `page-scripts.ts` to accept JSON-quoted `i` suffix for substring while retaining existing `text="..."` exact semantics; compile default as `text="..."i`, exact as `text="..."`. Do not interpret a plain string name as regex; only the JSON regex object is regex. Append ` >> :scope:has-text(${JSON.stringify(hasText)}):visible` as applicable, then ` >> nth=N`. CSS `selector` can itself contain the existing full string grammar; filters apply to its resulting elements.

  ```ts
  // Before
  if (typeof value === "string") return { selector: value };
  // After (illustrative)
  resolveElementLocator({ role: "button", name: "Start", within: { ref: "e12" }, hasText: "Go", nth: -1 });
  // { selector: 'ref=e12 >> role=button[name="Start"] >> :scope:has-text("Go") >> nth=-1' }
  ```

### 3. Ref and AX host facts

- [x] In `src/renderer/automation/selector-execution.ts`, keep both public evaluation signatures unchanged. Gate the shared preflight on `selector.includes("role=") || selector.includes("ref=")`; a CSS `[href=?]` can cause a harmless false positive. If neither occurs, retain the single `Runtime.evaluate` path. Extend `selectorPreflightSource()` to return `selectorHostFacts(selector)` with `{ roles, refs }`; when preflight finds neither, retain the normal evaluation path. Do not parse grammar host-side.
- [x] Resolve each named ref using `parseRef` and `resolveRef` from `ref.ts`, explicitly reject `fN-eN` with a clear main-frame-only rule, and pass the remote objects as additional `Runtime.callFunctionOn` arguments alongside AX element objects and facts. This path works with refs and no roles, roles and no refs, or both. In the page closure coerce text nodes to their parent element as `callOnRef` does; require an element connected to the selected main document, using the existing stale-ref wording for disconnected/stale refs and a clear wrong-document error otherwise. Supply keyed ref facts to `resolveCandidates`; a leading `ref=` selects its element independent of the initial scope. Re-resolve on each actionability retry. Release every resolved ref object, document object and AX object in the existing `finally`, including partial failures; do not release a returned candidate object owned by `evaluateCandidateObject`'s caller. No new protocol.

  ```ts
  // Before: preflight returns selectorRoleNames(selector)
  // After:  preflight returns selectorHostFacts(selector) // { roles, refs }
  // Runtime.callFunctionOn supplies ref objects beside AX objects; resolve() uses those facts.
  ```

- [x] Existing locator consumers pass the compiled selector unchanged. Keep drag offset `{ by }` distinct and retain direct ref frame sessions. Snapshot root, `waitForSelector` and `waitFor({ selector })` contracts remain unchanged, but string selectors through the resolver gain public `ref=` and chaining; fullscreen remains CSS-only.

### 4. Public descriptions and validation

- [x] Update `IBrowserElementLocator` in `src/renderer/api/types/browser-editor.d.ts` and mirrored `assets/editor-types/browser-editor.d.ts` with the recursive JSON-safe object form and clear key/regex/exact/nth/ref-scope documentation. Include this sentence in the type comment: "Selector `nth=` selects from the raw ordered union; action option `{ nth }` selects after final visibility filtering." Model exactly one what key with a discriminated union or equivalent exclusive keys; keep mirrors identical. Update affected locator signatures and summaries in `src/renderer/scripting/ai-vision/browser-automation-members.ts`, `src/renderer/scripting/ai-vision/namespaces/window-screen.ts`, and `src/renderer/scripting/api-wrapper/board-editor-facade-definitions.ts`; document public `ref=e12 >> text=Save` and its main-frame/first-step rule, and distinguish string-only snapshot/wait APIs. Change the `locator` hint in `src/renderer/scripting/ai-vision/browser-playwright-aliases.ts` to demonstrate `>>` and object form. Extend the existing `1.60.0` paragraph in `assets/guides/agents/boards/bridge-versions.md`; no bridge bump (Decision 7).
- [ ] Run `npm run typecheck`, `npm run lint`, and `npm run guides:check` after implementation; no unit tests and no production build. Live checks below are manual and cannot be run by Codex without Persephone. Record results during implementation.

## Concerns

- The existing text engine's query mode filters visibility and sorts by area/depth, unlike CSS. Preserve standalone behavior and deliberately document chained ordering; intermediate matching must not hide candidates. `nth` indexes the raw step union, so selecting a hidden final candidate can make an action fail even if another candidate is visible.
- A CSS filter is not an accessibility-name filter; object `hasText` checks DOM text on the result itself. Label references may lie outside scope without allowing out-of-scope controls to match.
- Only the exact `:scope` base followed by suffix filters is a same-element step for object sugar; scoped results remain in one document and do not traverse iframe documents or shadow roots beyond the existing engines' behavior. Reject frame refs as scopes rather than silently selecting the wrong document.
- Validate regex encoding against escaped slashes, character classes and flags; quoted strings and pseudo scanning must not turn data into syntax. Preserve fast path and release remote objects on exceptions, including failure partway through AX resolution.

## Acceptance criteria

- [ ] Chains mix all engines, union overlapping scopes without duplicates in document order, and ignore intermediate visibility; final action ambiguity, force and actionability work as before.
- [ ] Signed `nth` operates on the whole prior ordered set, composes with later steps and action `{ nth }`, handles empty/out-of-range and rejects invalid placement/values.
- [ ] CSS suffix filters match normalized text and `VISIBLE_FN`, combine and repeat; unsupported positions name the pseudo and supported suffix position; quoted attribute literals are untouched.
- [ ] Recursive object locators compile safely to the same grammar, reject unknown/incompatible keys, work via browser, board and `window.screen` locator consumers (including synthetic typing, file input, keyboard target and screenshot), and support main-frame `{ ref }` scope and public leading `ref=` with clear errors for iframe/stale/wrong-document refs and noninitial ref steps.
- [ ] Existing string/ref behavior, single-step text selection, AX role preflight and tristate values, and include-hidden limitation remain intact. Type mirrors, help, hint and bridge history agree; required checks pass.

### Live checks (Claude)

- Exercise mixed chains with overlapping and hidden parents, text and external label IDREFs, repeated roles, `nth=-1`, and action option `nth`.
- Check both CSS suffix orders, repeated text filters, escaped quotes, attribute literals and rejected nested/mid-selector pseudos.
- Exercise object locators with escaped values, regex names, nested `within`, main-frame ref scope and direct `ref=e12 >> text=Save`, noninitial ref steps, invalid/iframe/stale refs, and a scoped synthetic fill, screenshot and file input.
- Recheck single-step text ordering, AX checked/pressed true/false/mixed, strict ambiguity, board and `window.screen` help.

## Files with no changes

`src/renderer/automation/ref.ts` provides existing ref helpers; `src/renderer/automation/queries.ts`, `mouse.ts`, `forms.ts`, `synthetic.ts`, and `page-state.ts` already pass selector strings and need no scope threading; `locator.ts` consumer signatures and the `SelectorLocator`/`ElementLocator` types remain unchanged; `src/renderer/automation/snapshot.ts` and selector-only wait APIs already call shared execution. `src/main/browser/BrowserGuest.ts` fullscreen remains CSS-only. `src/shared/board-bridge-version.ts` stays at 1.60.0. No protocol, board rule, `.gitignore`, US-2164 document, or `doc/active-work.md` change is part of this task plan.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/automation/page-scripts.ts` | Parse and execute chains, nth and suffix filters; scope engines. |
| `src/renderer/automation/locator.ts` | Compile and validate object locators into selector strings. |
| `src/renderer/automation/selector-execution.ts` | Preflight, resolve, transport and release ref and AX objects. |
| `src/renderer/api/types/browser-editor.d.ts`, `assets/editor-types/browser-editor.d.ts` | Mirrored public locator types and documentation. |
| `src/renderer/scripting/ai-vision/browser-automation-members.ts`, `namespaces/window-screen.ts`, `browser-playwright-aliases.ts` | Help, signatures and locator hint. |
| `src/renderer/scripting/api-wrapper/board-editor-facade-definitions.ts` | Board locator description. |
| `assets/guides/agents/boards/bridge-versions.md` | Extend 1.60.0 history. |
| `doc/tasks/US-2162-locator-chaining/README.md` | This plan. |
