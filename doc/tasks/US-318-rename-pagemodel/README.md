# US-318: Rename PageModel → EditorModel

**Epic:** EPIC-017 (Page/Editor Architecture Refactor) — Phase 1, Task 1.2
**Status:** Planned

## Goal

Rename the `PageModel` base class to `EditorModel`, rename the file `PageModel.ts` → `EditorModel.ts`, and update the barrel export and all ~63 importing files. Also rename `getDefaultPageModelState` → `getDefaultEditorModelState`. This is a pure mechanical rename — no behavior changes.

## Background

`PageModel` is actually an editor model — it holds editor state (content, language, pipe), not page/tab state (pinned, navigation). Renaming it to `EditorModel` establishes the correct vocabulary before introducing the real `PageModel` (container) in Phase 2.

### What gets renamed

| Current | New | Location |
|---------|-----|----------|
| `class PageModel` | `class EditorModel` | `src/renderer/editors/base/PageModel.ts` → `EditorModel.ts` |
| `getDefaultPageModelState()` | `getDefaultEditorModelState()` | Same file |
| `export { PageModel, getDefaultPageModelState }` | `export { EditorModel, getDefaultEditorModelState }` | `src/renderer/editors/base/index.ts` |
| All imports of `PageModel` | `EditorModel` | ~63 files |
| All imports of `getDefaultPageModelState` | `getDefaultEditorModelState` | ~11 files |

### What does NOT get renamed in this task

- **Subclass names** — `TextFileModel`, `ZipPageModel`, `BrowserPageModel`, etc. stay (separate task US-319)
- **`EditorDefinition.pageType` field** — stays `pageType` for now (renamed with subclasses)
- **camelCase variables** — `pageModel`, `newPageModel`, etc. — these are local variable names, not the class name
- **`EditorModule` methods** — `newPageModel()`, `newPageModelFromState()`, `newEmptyPageModel()` — renamed with subclasses
- **`PagesModel` / `PagesLifecycleModel`** — these are page-collection models, renamed in Phase 2
- **Documentation task folders** — historical records kept as-is

### Subclasses that extend PageModel (will say `extends EditorModel` after this task)

1. `TextFileModel extends PageModel<TextFilePageModelState>`
2. `ZipPageModel extends PageModel<ZipPageModelState>`
3. `BrowserPageModel extends PageModel<BrowserPageState>`
4. `CategoryPageModel extends PageModel<CategoryPageModelState>`
5. `McpInspectorModel extends PageModel<McpInspectorPageState>`
6. `AboutPageModel extends PageModel<AboutPageModelState>`
7. `SettingsPageModel extends PageModel<SettingsPageModelState>`
8. `PdfViewerModel extends PageModel<PdfViewerModelState>`
9. `ImageViewerModel extends PageModel<ImageViewerModelState>`

## Implementation Plan

### Step 1: Rename file

```
src/renderer/editors/base/PageModel.ts → src/renderer/editors/base/EditorModel.ts
```

### Step 2: Rename class and function in the file

In `EditorModel.ts`:
- `class PageModel` → `class EditorModel`
- `getDefaultPageModelState` → `getDefaultEditorModelState`

### Step 3: Update barrel export

In `src/renderer/editors/base/index.ts`:
```typescript
// Before:
export { PageModel, getDefaultPageModelState } from './PageModel';
// After:
export { EditorModel, getDefaultEditorModelState } from './EditorModel';
```

### Step 4: Update all imports and usages

Find-replace across all ~63 files:
- `PageModel` → `EditorModel` (class name in imports, type annotations, `extends` clauses)
- `getDefaultPageModelState` → `getDefaultEditorModelState` (function calls)
- Import paths: files importing directly from `./PageModel` or `../base/PageModel` need path update

**Key import patterns to update:**

```typescript
// Pattern 1: barrel import (most common, ~50 files)
import { PageModel } from "../../editors/base";
// → import { EditorModel } from "../../editors/base";

// Pattern 2: direct import (some files)
import { PageModel, getDefaultPageModelState } from "./PageModel";
// → import { EditorModel, getDefaultEditorModelState } from "./EditorModel";

// Pattern 3: type import
import type { PageModel } from "../../editors/base";
// → import type { EditorModel } from "../../editors/base";
```

### Step 5: Update documentation

Architecture docs, standards docs, and CLAUDE.md references to `PageModel` that refer to the base class (not the future container).

### Step 6: Verify build

```bash
npm run lint
npx tsc --noEmit
```

## Concerns

1. **git rename detection** — Renaming the file `PageModel.ts` → `EditorModel.ts` should be detected as a rename by git if the content similarity is high enough (it will be, since only the class name changes inside).

2. **`PageModel` in `SecondaryEditorProps`** — The `secondary-editor-registry.ts` has `model: PageModel` in its props interface. This becomes `model: EditorModel`. The `LazySecondaryEditor` also uses it.

3. **`NavigationData` references `PageModel`** — Throughout NavigationData, `ownerModel: PageModel`, `secondaryModels: PageModel[]`, etc. These all become `EditorModel`. This is correct — NavigationData currently holds editor models.

4. **`FileEditorPage<T extends PageModel>`** — Generic constraint in `editors/types.ts`. Becomes `extends EditorModel`.

5. **Doc updates scope** — Only update architecture docs and CLAUDE.md where `PageModel` refers to the base class. Historical task docs and epic docs are left as-is.

## Acceptance Criteria

- [ ] File renamed: `PageModel.ts` → `EditorModel.ts`
- [ ] Class renamed: `PageModel` → `EditorModel`
- [ ] Function renamed: `getDefaultPageModelState` → `getDefaultEditorModelState`
- [ ] Barrel export updated in `editors/base/index.ts`
- [ ] All ~63 importing files updated
- [ ] All 9 subclass `extends` clauses updated
- [ ] Architecture docs updated
- [ ] CLAUDE.md updated
- [ ] `npm run lint` passes (no new errors)
- [ ] `npx tsc --noEmit` passes (no new errors)

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/base/PageModel.ts` → `EditorModel.ts` | Rename file + class + function |
| `src/renderer/editors/base/index.ts` | Update barrel export |
| ~63 `.ts`/`.tsx` files | Update imports + usages |
| Architecture docs | Update `PageModel` → `EditorModel` references |
| `CLAUDE.md` | Update Key Files table |
