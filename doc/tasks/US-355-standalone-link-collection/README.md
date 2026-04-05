# US-355: Standalone Link Collection Page

**Epic:** EPIC-018 (Phase 2, task 2.2)
**Status:** Planned
**Created:** 2026-04-05

## Goal

Add `app.pages.openLinks(links, title)` — creates a new page with a link collection as a secondary editor. The Categories panel appears in the sidebar; clicking a link navigates the page's main content area to that file/URL.

No new MCP tool — agents use `execute_script`. No new PageModel methods — uses existing `addSecondaryEditor()`.

## Background

### Architecture: TextFileModel as secondary editor (Pattern A)

Use a regular TextFileModel holding `.link.json` content as a **pure secondary editor** — never mainEditor. The existing `LinkCategorySecondaryEditor` already handles this case:

```tsx
// LinkCategorySecondaryEditor.tsx
const isMainEditor = model.page?.mainEditor === model; // false — it's secondary only
<LinkCategoryPanel vm={vm} useOpenRawLink={true} categoriesOnly={false} />
// Shows all items (links + categories), clicks navigate via openRawLink
```

Page structure:
```
PageModel
  ├── mainEditor: null (initially) → becomes whatever the user clicks
  ├── secondaryEditors:
  │   └── TextFileModel  ← holds .link.json content, Pattern A (pure secondary)
  │       ├── secondaryEditor: ["link-category"]
  │       ├── LinkViewModel (via useContentViewModel)
  │       └── LinkTreeProvider
  └── PageNavigator: open, "link-category" expanded
```

### Why this works without a new model class

1. **TextFileModel implements `IContentHost`** — `useContentViewModel(model, "link-view")` works, creating a `LinkViewModel` that parses the JSON content
2. **LinkCategorySecondaryEditor** detects `isMainEditor=false` → uses `openRawLink` for clicks
3. **Pattern A secondary editors survive navigation** — `beforeNavigateAway()` is only called on the old mainEditor, not on secondary editors. `onMainEditorChanged()` base is a no-op → TextFileModel stays in sidebar
4. **Persistence** — `getRestoreData()` / `restoreSecondaryEditors()` handle app restart

### High-level flow of `openLinks(links, title)`

1. Convert input `(ILink | string)[]` to `LinkItem[]` (generate UUIDs, titles from basename)
2. Build `.link.json` JSON: `{ "type": "link-editor", "links": [...], "state": {} }`
3. Create `TextFileModel` — set `language: "json"`, `editor: "link-view"`, `title: "...link.json"`
4. Set generated JSON as content, call `restore()`
5. Set `model.state.secondaryEditor = ["link-category"]` (directly in state, before page connection)
6. Create `PageModel`
7. Call `page.addSecondaryEditor(model)` — existing method, handles `setPage()` + array + version bump
8. Open PageNavigator, expand "link-category"
9. Add page to app via `addPage(null, page)`

### Link JSON format

```json
{
    "type": "link-editor",
    "links": [
        { "id": "uuid", "title": "File", "href": "C:/file.txt", "category": "", "tags": [], "isDirectory": false }
    ],
    "state": {}
}
```

## Implementation Plan

### Step 1: `openLinks()` in PagesLifecycleModel

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

Add method after `addDrawPage()` (~line 219):

```typescript
openLinks = (
    links: (ILink | string)[],
    title?: string,
): PageModel => {
    const normalizedTitle = normalizeLinksTitle(title);

    // Convert input to LinkItem[]
    const linkItems: LinkItem[] = links.map((item) => {
        if (typeof item === "string") {
            return {
                id: crypto.randomUUID(),
                title: fpBasename(item) || item,
                href: item,
                category: "",
                tags: [],
                isDirectory: false,
            };
        }
        return {
            ...item,
            id: item.id || crypto.randomUUID(),
            category: item.category ?? "",
            tags: item.tags ?? [],
            isDirectory: item.isDirectory ?? false,
        };
    });

    // Build content JSON
    const data: LinkEditorData = { links: linkItems, state: {} };
    const content = JSON.stringify({ type: "link-editor", ...data }, null, 4);

    // Create TextFileModel with link-view content
    const editorModel = newTextFileModel("");
    editorModel.state.update((s) => {
        s.title = normalizedTitle;
        s.language = "json";
        s.editor = editorRegistry.validateForLanguage("link-view", "json");
        s.secondaryEditor = ["link-category"];
    });
    editorModel.changeContent(content);
    editorModel.restore();

    // Create page with the model as secondary editor (not mainEditor)
    const page = new PageModel();
    page.addSecondaryEditor(editorModel as unknown as EditorModel);
    page.ensurePageNavigatorModel();
    page.expandPanel("link-category");

    this.addPage(null, page);
    this.model.closeFirstPageIfEmpty();
    return page;
};
```

Helper function (module-level, before the class):

```typescript
function normalizeLinksTitle(title?: string): string {
    if (!title) return "untitled.link.json";
    if (/\.link\.json$/i.test(title)) return title;
    return title + ".link.json";
}
```

**Imports to add:**
```typescript
import type { ILink } from "../../api/types/io.tree";
import type { LinkItem, LinkEditorData } from "../../editors/link-editor/linkTypes";
```

### Step 2: PagesModel delegate

**File:** `src/renderer/api/pages/PagesModel.ts`

Add after `addDrawPage` delegate (~line 188):

```typescript
openLinks = (links: (ILink | string)[], title?: string) =>
    this.lifecycle.openLinks(links, title);
```

**Import to add:** `import type { ILink } from "../types/io.tree";`

### Step 3: PageCollectionWrapper (script API)

**File:** `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`

Add after `addDrawPage()` method (~line 98):

```typescript
openLinks(
    links: (ILink | string)[],
    title?: string,
): PageWrapper {
    const page = this.pages.openLinks(links, title);
    return this.wrap(page)!;
}
```

**Import to add:** `import type { ILink } from "../../api/types/io.tree";`

### Step 4: Script type definitions

**File:** `assets/editor-types/pages.d.ts` — Add after `addDrawPage()` (~line 71):

```typescript
/**
 * Create a link collection page from an array of links or URLs.
 * The Categories panel appears in the sidebar; clicking a link navigates
 * the page's main area to show that file/URL.
 *
 * @param links Array of ILink objects or URL/path strings.
 * @param title Optional page title. Auto-suffixed with ".link.json" if missing.
 *
 * @example
 * // From file paths
 * app.pages.openLinks(["C:/data/report.csv", "C:/data/summary.txt"], "Reports");
 *
 * // From ILink objects with categories
 * app.pages.openLinks([
 *     { title: "API Docs", href: "https://docs.example.com", category: "Reference", tags: ["api"], isDirectory: false },
 *     { title: "Tutorial", href: "https://tutorial.example.com", category: "Learning", tags: ["tutorial"], isDirectory: false },
 * ], "Bookmarks");
 */
openLinks(links: (ILink | string)[], title?: string): IPage;
```

**File:** `src/renderer/api/types/pages.d.ts` — Same (keep in sync).

**File:** `assets/editor-types/_imports.txt` — Verify `io.tree` is already included.

## Concerns (all resolved)

### 1. Navigation routing: where does the clicked link open?
When the user clicks a link in Categories, `LinkCategoryPanel` calls `app.events.openRawLink.sendAsync(new RawLinkEvent(url))` without page context.

**Resolution:** `RawLinkEvent` already accepts `metadata?: ILinkMetadata` which has `pageId?: string` — "Open in this specific page instead of a new tab." Pass the owner page ID when `useOpenRawLink=true`:

```typescript
// LinkCategoryPanel — when useOpenRawLink=true:
app.events.openRawLink.sendAsync(new RawLinkEvent(navUrl, undefined, { pageId }));
```

`LinkCategorySecondaryEditor` passes `pageId={model.page?.id}` as a new prop to `LinkCategoryPanel`. **Small change to 2 files.**

### 2. Page tab title and icon
**Resolution:** Already handled by existing design. When a page has no mainEditor, the tab shows "Empty" and the icon falls back to the "plaintext" registered icon (same as opening a folder in a separate tab). Icon improvement is out of scope.

### 3. Pattern A navigation survival
**Resolution:** Should survive by current architecture — `beforeNavigateAway()` is only called on mainEditor, `onMainEditorChanged()` base is no-op. Will verify during testing.

### 4. Persistence / restore
**Resolution:** Should restore by current design — `restoreSecondaryEditors()` recreates from descriptors. Will verify during testing.

## Acceptance Criteria

1. **Script API works:** `app.pages.openLinks(["C:/file.txt"], "Test")` creates a page with Categories panel in sidebar
2. **Navigation works:** clicking a link in Categories navigates the page's main area to that file
3. **Categories panel survives navigation:** stays in sidebar after clicking a link
4. **String input:** URL/path strings converted to LinkItems with auto-generated titles
5. **ILink input:** full ILink objects accepted with categories, tags preserved
6. **Mixed input:** array can contain both strings and ILink objects
7. **Title normalization:** `.link.json` suffix auto-added if missing; default "untitled.link.json"
8. **Type definitions:** `openLinks()` appears in script IntelliSense with JSDoc
9. **Persistence:** page survives app restart

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Add `openLinks()` + `normalizeLinksTitle()` |
| `src/renderer/api/pages/PagesModel.ts` | Add `openLinks` delegate |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Add `openLinks()` wrapper |
| `assets/editor-types/pages.d.ts` | Add `openLinks()` to `IPageCollection` |
| `src/renderer/api/types/pages.d.ts` | Same (keep in sync) |

| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Pass `pageId` in `RawLinkEvent` metadata when `useOpenRawLink=true` |
| `src/renderer/editors/link-editor/panels/LinkCategorySecondaryEditor.tsx` | Pass owner page ID to `LinkCategoryPanel` |

### Files NOT changed

- `PageModel.ts` — existing `addSecondaryEditor()` is sufficient
- `LinkEditor.tsx` — no changes
- `LinkViewModel.ts` — no changes
- `LinkTreeProvider.ts` — no changes
- `register-editors.ts` — "link-category" already registered
- `TextEditorModel.ts` — no changes
- `mcp-handler.ts` / `mcp-http-server.ts` — no new MCP tool
