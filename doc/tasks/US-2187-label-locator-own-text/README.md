# US-2187: `label=` matches the label's own text, not the wrapped control's

**Epic:** [EPIC-210](../../epics/EPIC-210.md) — item 13
**Status:** Planned

## Goal

`label="Show:"s` finds the `<select>` in `<label>Show:<select>…</select></label>`, as Playwright's
`getByLabel` does. A wrapping label's text must not include the labeled control's own content.

## Background

- `src/renderer/automation/page-scripts.ts:219-286` embeds `resolveCandidatesSource()` in the
  page. Its `evaluateStep()` enumerates non-hidden inputs, selects, textareas, buttons, meters,
  outputs and progress elements, then matches each associated `control.labels`, each resolved
  `aria-labelledby` node and `aria-label` through `matchesValue()`.
- For a wrapping label, `innerText || textContent` includes descendant option text, so the exact
  match in the Goal fails. An input's `value` is not DOM text; it is not evidence of this bug.
  Textarea child text and nested button text can also contaminate a label.
- `selectorParserSource()` defines `matchesValue()` and `normalize()` (`page-scripts.ts:149-156`):
  exact, substring and regex matches all normalize whitespace. `selector-execution.ts` injects
  the resolver into both ordinary and role/ref-aware evaluations; `role=` names come from
  Chromium accessibility facts, not this label code.
- `forms.ts:57-72` reads label text only to describe an editable-element error; it does not
  match a locator. `aria-labelledby` can refer to an ancestor, not only a separate node.

## Implementation Plan

1. In `src/renderer/automation/page-scripts.ts`, make `resolveCandidatesSource()` own the
   associated-label text rule. Define `labelOwnText(label)` inside its generated resolver, near
   `evaluateStep`, so it is included in both existing selector execution paths without a new
   protocol or import. Reuse `matchesValue()` for normalization and matching. For a label with
   no descendant form controls, retain `label.innerText || label.textContent || ''` unchanged.
   Otherwise walk its child nodes without cloning or modifying the page: collect text in DOM
   order; skip entire `input`, `select`, `textarea`, `button`, `meter`, `output` and `progress`
   subtrees (including the labeled control); skip `script`, `style`, `[hidden]` and computed
   `display: none` subtrees. Ignore text whose parent has computed `visibility: hidden` or
   `collapse`, but still visit descendants that override visibility. Insert whitespace for
   `<br>` and block boundaries, while preserving adjacency of inline text; `matchesValue()`
   collapses that whitespace. Use this page-side implementation (inside the raw source string):

   ```js
   function labelOwnText(label) {
       const controls = 'input,select,textarea,button,meter,output,progress';
       if (!label.querySelector(controls)) return label.innerText || label.textContent || '';
       let text = '';
       function walk(node) {
           if (node.nodeType === Node.TEXT_NODE) {
               const visibility = getComputedStyle(node.parentElement).visibility;
               if (visibility !== 'hidden' && visibility !== 'collapse') text += node.nodeValue || '';
               return;
           }
           if (node.nodeType !== Node.ELEMENT_NODE || node.matches(controls + ',script,style,[hidden]')) return;
           const display = getComputedStyle(node).display;
           if (display === 'none') return;
           if (node.localName === 'br') { text += ' '; return; }
           const block = /^(block|flow-root|list-item|flex|grid|table)/.test(display);
           if (block) text += ' ';
           for (const child of node.childNodes) walk(child);
           if (block) text += ' ';
       }
       walk(label);
       return text;
   }
   ```

   This is a defined visible-text approximation, not a claim to reproduce every CSS detail of
   `innerText`.

2. In the `label` branch of `evaluateStep()`, separate associated labels from ARIA references.
   Keep the existing `aria-labelledby` and `aria-label` text behavior even when a reference is
   an ancestor: changing ARIA semantics is outside this fix. Multiple labels/references remain
   alternatives, and ID lookup stays in `control.ownerDocument`. The relevant change is:

   ```js
   // Before
   const labels = [];
   if ('labels' in control && control.labels) labels.push(...control.labels);
   const ids = (control.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
   for (const id of ids) { const node = control.ownerDocument.getElementById(id); if (node) labels.push(node); }
   const ariaLabel = control.getAttribute('aria-label');
   return labels.some(label => matchesValue(label.innerText || label.textContent || '', wanted))
       || (ariaLabel !== null && matchesValue(ariaLabel, wanted));

   // After
   const labels = 'labels' in control && control.labels ? [...control.labels] : [];
   const ids = (control.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
   const references = ids.map(id => control.ownerDocument.getElementById(id)).filter(Boolean);
   const ariaLabel = control.getAttribute('aria-label');
   return labels.some(label => matchesValue(labelOwnText(label), wanted))
       || references.some(node => matchesValue(node.innerText || node.textContent || '', wanted))
       || (ariaLabel !== null && matchesValue(ariaLabel, wanted));
   ```

3. Extend `integration-test/fixtures/http/browser/automation/input-controls.html` and add a test
   in `integration-test/tests/browser/automation/input/input.test.mjs`, using its `openInputPage`,
   `editor.waitFor`, `editor.count`, `ctx.expect` and `closeBrowserPage` pattern. Add a uniquely
   named wrapping select `id="label-show"` with `Show:` and option `All` (value `all`), nested inline label text, a wrapped input,
   a textarea with child text, hidden label text, a separate `for` label, and controls with
   `aria-label` / `aria-labelledby` (including an ancestor reference). Assert:
   - exact `label="Show:"s` and substring `label=Show` each count one; `label=All` counts zero;
     select through the exact locator and verify the selected value;
   - wrapped input and textarea labels match without their contents; inline text and whitespace,
     hidden descendants, `<br>` / block boundaries and exclusion of another control are covered;
   - separate labels, multiple labels, both ARIA sources (including the ancestor case), regex and
     object `{ label: ..., exact: true }` retain their behavior. Use unique fixture names to avoid
     unrelated matches and assert identity via `query` or an action, not only a positive count.

   Example assertion change:

   ```js
   // Before: no wrapping-select regression case
   // After, inside the existing try/finally page lifecycle:
   ctx.expect(await editor.count('label="Show:"s')).toBe(1);
   ctx.expect(await editor.count('label=Show')).toBe(1);
   ctx.expect(await editor.count('label=All')).toBe(0);
   await editor.select('label="Show:"s', 'all');
   ctx.expect(await editor.evaluate("document.querySelector('#label-show').value")).toBe('all');
   ```

   Codex writes and runs the UI integration test during implementation. With the dev server running,
   run `npm run test:ui -- --area browser/automation/input`, plus `npm run typecheck` and
   `npm run lint`. No unit tests or new harnesses.

4. In `assets/guides/agents/browser-automation.md`, extend the `label=` table description with
   one sentence explaining that associated label text excludes nested form controls. In
   `assets/guides/whats-new.md`, add a wrapping-select locator fix under the upcoming Bug Fixes.

## Concerns

- **Decision:** change associated HTML labels only; ARIA references keep their current independent
  text matching, including ancestor references. This limits compatibility changes and preserves the
  current OR behavior rather than pretending to implement the full accessible-name algorithm.
- **Decision:** exclude all nested labelable form controls, not only the target. This avoids another
  control's content contaminating the associated label. Substring matches that depended on such
  content stop matching; this is intentional. Non-control label text remains searchable.
- The walker approximates rendered text for labels containing controls; CSS-generated content and
  unusual layout/whitespace need not match `innerText` exactly. Keep the old extraction for labels
  without nested controls to limit the change. The goal is the stated case, not complete Playwright
  parity.
- No `window.persephone` API or board bridge changes are planned, so no bridge version bump is needed.

## Acceptance Criteria

- [ ] `label="Show:"s` and `label=Show` resolve the wrapped select; `label=All` does not resolve it
  via option text, and selecting through the locator works.
- [ ] Wrapped controls, whitespace and visibility cases and the existing separate-label and ARIA
  behaviors above are covered by passing UI integration tests.
- [ ] Existing input automation tests, typecheck and lint pass; guide and release note are updated.

## Files needing no changes

- `src/renderer/automation/forms.ts` - error context, not locator matching.
- `src/renderer/automation/selector-execution.ts`, `locator.ts`, and `locator-reads.ts` - already
  consume the shared resolver / existing locator grammar; no new transport or public API is needed.
- `src/shared/board/`, board registries and bridge - no board rule or `window.persephone` change.
- Roadmap section 2.3 files, including `src/renderer/automation/operations.ts` - this behavior lives in
  `page-scripts.ts`, which is not listed there.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/automation/page-scripts.ts` | Own associated-label extraction inside the existing generated resolver; reuse `matchesValue()`. |
| `integration-test/fixtures/http/browser/automation/input-controls.html` | Add local label regression fixtures. |
| `integration-test/tests/browser/automation/input/input.test.mjs` | Exercise matching and action behavior through the UI suite. |
| `assets/guides/agents/browser-automation.md` | Clarify associated-label matching. |
| `assets/guides/whats-new.md` | Add the bug-fix note. |
