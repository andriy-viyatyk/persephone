# US-1653: Widen the lint rule to every UI position; per-area baseline

## Goal

Expand `vanilla-view/no-hardcoded-ui-strings` so it reports app-owned English literals in the renderer's verified UI text positions, while excluding data, agent-facing payloads, and stable identifiers. Keep the rule at warning severity, preserve `npm run lint`, and publish a fresh per-area baseline for the remaining EPIC-125 extraction tasks.

## Background

`eslint.config.mjs` implements `no-hardcoded-ui-strings` in its `Property`, `AssignmentExpression`, and `CallExpression` visitors. Before this task it checked object properties named `label`, `title`, `placeholder`, `tooltip`, `children`, and `emptyText`; assignments to `textContent`, `title`, and `placeholder`; and calls to `createTextElement`, imported settings-native `text` / `settingsFieldLabel`, and the `ui.notify` / `app.ui.notify` forms. `literalHasLetters()` covers string literals and templates containing letters. The rule remains registered as a warning.

E1 in [EPIC-125](../../epics/EPIC-125.md) records the positions to add. Source inspection confirmed the following relevant shapes and false-positive boundaries:

| Position | Verified UI hit(s) | False-positive boundary and intended check |
|---|---|---|
| Internal UI service `notify`, `confirm`, and `input` calls | `src/renderer/api/app.ts` calls `services.ui.notify(...)`; `src/renderer/ui/app/MainPageView.ts` calls `app.ui.notify(...)`; internal renderer files call the `ui` singleton. `src/renderer/components/tree-provider/item-crud-actions.ts` calls `ui.input("Enter file name:", …)`. `src/renderer/api/ui.ts` implements `UserInterface.notify()`, `confirm()`, and `input()` on the app UI service. | One shared receiver predicate matches only a `MemberExpression` whose object is identifier `ui`, or whose object is member `.ui` of identifier `app` or `services`. Do not match arbitrary `notify()` methods such as `AboutEditor.notify()` and `BoardSettingsStore.notify()`. Keep script API declarations/examples under `src/renderer/api/types/` outside source checking as today. |
| `emptyMessage` | Literal caller props occur in `src/renderer/ui/sidebar/OpenTabsListView.ts`, `src/renderer/editors/explorer/ClipboardSecondaryView.ts`, `src/renderer/editors/explorer/BoardsSecondaryView.ts`, `src/renderer/editors/about/AboutGuideBrowserView.ts`, `src/renderer/editors/git-tree/GitRefsView.ts`, and `src/renderer/components/file-list/FileListView.ts`. The UIKit contracts are `ListBoxProps.emptyMessage` in `src/renderer/uikit/ListBox/types.ts`, `TreeProps.emptyMessage` in `src/renderer/uikit/Tree/types.ts`, and corresponding Select/MultiSelect/MultiListBox props. `SelectView.ts` and `MultiListBoxView.ts` also contain the real English defaults `"no results"` and `"no rows"`. | Treat this as rendered list/tree empty-state copy. Do not flag local variable/property names or data-only empty-state values unless they reach the text prop; story files are already excluded. |
| `ariaLabel` / `aria-label` | UIKit uses the kebab-case prop contract in `src/renderer/uikit/TagsInput/TagsInputView.ts` and `ProgressBar/ProgressBarView.ts`; `src/renderer/components/pipe-status/PagePipeStatusView.ts` sets literal accessible labels, and `src/renderer/uikit/Tree/TreeItemView.ts` sets `Loading`, `Collapse`, and `Expand`. | Add `emptyMessage`, `ariaLabel`, and the literal key `"aria-label"` to the existing property-name check. Do not report other attributes (`role`, `viewBox`, dimensions, `data-*`) or dynamic values by themselves. |
| `setAttribute("aria-label" | "title" | "placeholder", value)` | Verified literal call sites include the pipe-status accessible labels and UIKit tree labels above. `ThemeSection.ts` sets `aria-label` from `t(...)`, which must not be reported. | Match the exact attribute-name string and inspect only argument two; preserve dynamic/catalog values as non-findings. The existing assignment visitor does not see these DOM method calls. |
| Editor display `name` | `src/renderer/editors/register-editors.ts` declares the `EditorRow.name` field and literal names in `EDITORS`, then registers `name: e.name`. These names feed visible editor selection and agent-facing editor metadata. | Limit the check to the registry definition in this exact file. Split the localizable display name from the English agent name under E2; do not flag `id`, `guidePath`, `mcpHint`, or arbitrary `name` values elsewhere. Preserve editor ids and MCP behavior. |
| Dialog message/options | `src/renderer/ui/dialogs/ConfirmationDialog.ts` defines visible `title` and `message` props; `src/renderer/components/tree-provider/item-crud-actions.ts` calls `ui.input()` with a literal prompt; other internal callers use `ui.confirm()` / `ui.input()`. There are 14 direct object-literal `show…Dialog({ message: … })` call sites. | The shared receiver predicate reports argument 0 for `notify`, `confirm`, and `input`. Separately, a call whose callee name matches `/^show\w*Dialog$/` reports only the `message` property of a direct object-literal argument 0. No global `message` key is checked. `text` remains data in script/log/file-content paths; no custom literal app-dialog button-array hit was found. |
| `description` / `text` / `header` | `description` occurs in tool/MCP schemas, board manifests, settings catalog records, and editor data; `text` represents file/content/response data; UIKit `Autocomplete.header` is `SlotContent`. | No `description`, `text`, or `header` check is added. MCP schemas and payloads stay English under D3/E5. |
| `header`, `caption`, `hint`, status text | UIKit survey found `AutocompleteProps.header` is `SlotContent`; no literal-string `caption`/`hint` prop hit was found. `BoardEditorModel.setStatusText()` renders board-provided footer text from `persephone.setStatusText()`, which is board-owned text under E5. | No broad check is justified by the inspected UIKit contracts/hits. Keep slot nodes and board-owned text out of this rule; reassess only if a future concrete app-owned literal position appears. |

The project standards distinguish `services.ui.notify` / the renderer `ui` singleton (internal toast service) from script API documentation and agent-facing data. The relevant source for that distinction is `doc/standards/coding-style.md` (“Dialogs/notifications from internal UI vs. scripts”) plus `src/renderer/api/ui.ts` and `src/renderer/api/app.ts`.

The existing `isExcludedI18nFile()` already exempts shared i18n, automation, scripting agent adapters/wrappers, MCP implementation/API folders, API types, tests, and stories. Any additional whole-file exemption must be limited to a verified agent-facing data file and carry a reason comment at the exclusion. Do not add inline `eslint-disable` comments. Mixed UI/agent files should use context-aware checks or retain a separately named English field per E2 rather than suppressing the whole file.

### Before and after rule shape

Before this task, the property visitor was:

```js
if (["label", "title", "placeholder", "tooltip", "children", "emptyText"].includes(key)) {
    report(node.value);
}
```

The implemented checks use this scoped shape:

```js
const isInternalUiServiceCall = (callee, methodName) => callee.type === "MemberExpression"
    && memberName(callee) === methodName
    && (callee.object.type === "Identifier" && callee.object.name === "ui"
        || callee.object.type === "MemberExpression"
            && memberName(callee.object) === "ui"
            && callee.object.object.type === "Identifier"
            && ["app", "services"].includes(callee.object.object.name));

if (["label", "title", "placeholder", "tooltip", "children", "emptyText", "emptyMessage", "ariaLabel", "aria-label"].includes(key)
    || (filename.endsWith("/src/renderer/editors/register-editors.ts") && key === "name")) report(node.value);
const memberCalleeName = callee.type === "MemberExpression" ? memberName(callee) : undefined;
const isInternalUiTextCall = ["notify", "confirm", "input"].some((method) => isInternalUiServiceCall(callee, method));
if (isInternalUiTextCall) report(argument);
if (/^show\w*Dialog$/.test(name ?? memberCalleeName ?? "") && argument.type === "ObjectExpression") {
    for (const property of argument.properties) {
        if (property.type === "Property" && propertyKey(property) === "message") report(property.value);
    }
}
if (memberCalleeName === "setAttribute"
    && argument.type === "Literal"
    && ["aria-label", "title", "placeholder"].includes(argument.value)
    && node.arguments[1]
    && node.arguments[1].type !== "SpreadElement") report(node.arguments[1]);
```

`register-editors.ts` is an explicit file-scoped rule case for `name` values. The shared receiver test is exactly: member call with object identifier `ui`, or object member `.ui` whose object is identifier `app` or `services`. Preserve existing checks and `literalHasLetters()` behavior.

## Implementation Plan

1. [x] **Extend the rule in `eslint.config.mjs`.** Add the shared internal UI receiver predicate for `notify` / `confirm` / `input`, scoped direct `show…Dialog({ message })` detection, the `emptyMessage` / `ariaLabel` / `aria-label` property keys, exact text-targeting `setAttribute()` calls, and registry-only literal `name` checking. Keep `message`, `text`, `description`, and `header` out of global property checks. Preserve existing checks and warning severity.
2. [x] **Audit candidates and false positives against source.** Review actual call sites and UIKit contracts. No new report landed in `src/renderer/api/mcp/`, `src/renderer/api/types/`, `src/renderer/scripting/ai-vision/`, `src/renderer/scripting/api-wrapper/`, or the exempt Settings catalog, so no new whole-file exemption was needed. Registry `name` findings are intentional: the English values remain agent-facing until US-1654 performs the E2 split. No inline ESLint suppression was added.
3. [x] **Measure the widened baseline.** Run `npx eslint src -f json -o <file>`, count only `vanilla-view/no-hardcoded-ui-strings`, then bucket relative to `src/`: use the first three segments for `renderer/{editors|ui|components}/<x>/...` paths with more than three segments; otherwise use the first two segments. Drop the leading `renderer/` in displayed area names to match EPIC-125. Update its Current state table and historical totals.
4. [x] **Verify task constraints.** `npm run lint` passes with warnings only; `npm run typecheck` passes. The rule remains `warn`.

## Concerns

- `message`, `text`, and `description` are overloaded data-field names. A generic property-name visitor would report IPC/MCP/protocol payloads and user data; the implementation must bind them to a verified UI consumer.
- Forty editor registry `name` literals are now reported in `src/renderer/editors/register-editors.ts`. They are intentional findings because the names are visible in the UI and also agent-facing; US-1654 owns the E2 split. They are not silently exempted.
- `emptyMessage` in UIKit accepts `SlotContent` or `SlotText`, so the rule must scan literal content at app call sites and UIKit English defaults without treating arbitrary variable names as copy.
- A receiver spelling such as `.notify()` is not enough to establish a toast. The implementation must distinguish the alert service from state/event `notify()` methods and the script-facing API declarations/examples.
- E1 requests a warning baseline before the later US-1665 severity change. Do not promote the rule to error in this task.

## Acceptance Criteria

- [x] `vanilla-view/no-hardcoded-ui-strings` covers every verified new position in E1 plus the verified dialog and UIKit empty-state positions listed above.
- [x] Each added position has at least one real source hit and no known false positive from the reviewed candidate set.
- [x] No inline `eslint-disable` comments are added; no new whole-file exemption was needed.
- [x] The editor `name` check is limited to `src/renderer/editors/register-editors.ts`; this task does not change the registry's UI/agent name behavior, which is scoped to US-1654.
- [x] Rule severity remains `warn`; `npm run lint` passes with 975 warnings and no errors.
- [x] A new per-area count table is generated with `npx eslint src -f json -o <file>`, bucketed consistently with EPIC-125's current table, and written to [EPIC-125](../../epics/EPIC-125.md).
- [x] The task does not perform the later area string extraction or change board-owned text.

## Files Changed Summary

| File | Change |
|---|---|
| `eslint.config.mjs` | Added shared service receiver matching, direct dialog-message detection, UI text property keys, `setAttribute()` handling, and registry-only `name` checks; retained warning severity. |
| `doc/epics/EPIC-125.md` | Linked this task and replaced the pre-E1 table with the widened baseline; retained 892 / 196 as historical pre-widening totals. |
| `doc/tasks/US-1653-lint-coverage/README.md` | Recorded implementation, audit results, and completed checklist. |

Files inspected and not changed: `src/renderer/uikit/CLAUDE.md`; `doc/standards/localization.md`; `doc/standards/coding-style.md`; `src/renderer/api/ui.ts`; UIKit component files under `src/renderer/uikit/`; agent-facing MCP/script declarations under `src/renderer/api/types/`, `src/renderer/scripting/`, and `src/renderer/api/mcp/`.

Verification: `npx eslint src -f json -o <file>` reports 975 matching warnings in 201 files. `npm run lint` passes with 975 warnings and zero errors; `npm run typecheck` passes. No findings appeared in the excluded MCP/API declaration, MCP implementation, AI-vision, API-wrapper, or Settings catalog paths. The 40 intentional `register-editors.ts` warnings cover editor display names that remain English for agents until US-1654.
