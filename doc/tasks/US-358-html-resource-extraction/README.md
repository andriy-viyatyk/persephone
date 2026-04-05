# US-358: HTML Resource Extraction

**Epic:** EPIC-018 (Phase 2, task 2.6)
**Status:** Planned
**Created:** 2026-04-05

## Goal

Extract resources (images, scripts, styles, media, links) from HTML content and display them as a categorized link collection page. Two entry points:
1. **"Show Resources" button** on the Monaco editor toolbar when language is `html`
2. **"Show Resources" context menu** on Browser pages (reuses existing "View Actual DOM" pattern to grab HTML)

Both use a shared utility function that parses HTML → `ILink[]` with categories, then calls `app.pages.openLinks()`.

## Background

### Existing patterns

- **"View Actual DOM"** in [BrowserWebviewModel.ts:467-483](../../src/renderer/editors/browser/BrowserWebviewModel.ts#L467-L483) — grabs HTML via `webview.executeJavaScript("document.documentElement.outerHTML")`, creates a text page. We follow the same pattern but call `openLinks()` instead.
- **TextToolbar language-specific buttons** in [TextToolbar.tsx:114](../../src/renderer/editors/text/TextToolbar.tsx#L114) — `if (isScriptLanguage(language))` adds "Run Script" button. We add `if (language === "html")` → "Show Resources" button.
- **cheerio** (`^1.2.0`) already in `package.json` — not yet used in the codebase. Use it for robust HTML parsing.
- **`app.pages.openLinks()`** (US-355) — accepts `ILink[]` with categories, creates a link collection page.

### Resource categories

Parse HTML and group extracted URLs by type:

| Category | HTML elements | Attribute |
|----------|--------------|-----------|
| `Images` | `img`, `picture source`, `input[type=image]` | `src`, `srcset` |
| `Scripts` | `script[src]` | `src` |
| `Stylesheets` | `link[rel=stylesheet]` | `href` |
| `Media` | `video`, `audio`, `video source`, `audio source` | `src` |
| `Fonts` | `link[rel=preload][as=font]`, `link[rel=font]` | `href` |
| `Links` | `a[href]` (external only, skip `#` anchors and `javascript:`) | `href` |
| `Iframes` | `iframe[src]` | `src` |
| `Favicons` | `link[rel~=icon]` | `href` |

### URL resolution

Many extracted URLs are relative. The utility should accept an optional `baseUrl` parameter to resolve relative URLs to absolute ones:
- For Monaco HTML pages with a `filePath`: use `file://` + dirname as base
- For Browser pages: use the page URL as base
- For untitled HTML pages: leave relative URLs as-is

## Implementation Plan

### Step 1: `extractHtmlResources()` utility function

**File:** `src/renderer/core/utils/html-resources.ts` (new)

```typescript
import type { ILink } from "../../api/types/io.tree";

interface ExtractOptions {
    /** Base URL for resolving relative URLs. */
    baseUrl?: string;
    /** HTML page title (used as page title for openLinks). */
    title?: string;
}

/**
 * Parse HTML and extract resource URLs grouped by category.
 * Returns ILink[] suitable for app.pages.openLinks().
 */
export function extractHtmlResources(html: string, options?: ExtractOptions): ILink[] {
    const cheerio = require("cheerio"); // eslint-disable-line @typescript-eslint/no-var-requires
    const $ = cheerio.load(html);
    const links: ILink[] = [];
    const seen = new Set<string>();

    const add = (category: string, href: string, title?: string) => {
        const resolved = resolveUrl(href, options?.baseUrl);
        if (!resolved || seen.has(resolved)) return;
        seen.add(resolved);
        links.push({
            title: title || baseName(resolved) || resolved,
            href: resolved,
            category,
            tags: [],
            isDirectory: false,
        });
    };

    // Images
    $("img[src]").each((_, el) => add("Images", $(el).attr("src")!, $(el).attr("alt")));
    $("picture source[srcset]").each((_, el) => {
        // srcset may have multiple URLs — take the first
        const first = $(el).attr("srcset")!.split(",")[0].trim().split(/\s+/)[0];
        add("Images", first);
    });
    $("input[type=image][src]").each((_, el) => add("Images", $(el).attr("src")!));

    // Scripts
    $("script[src]").each((_, el) => add("Scripts", $(el).attr("src")!));

    // Stylesheets
    $("link[rel=stylesheet][href]").each((_, el) => add("Stylesheets", $(el).attr("href")!));

    // Media
    $("video[src]").each((_, el) => add("Media", $(el).attr("src")!));
    $("audio[src]").each((_, el) => add("Media", $(el).attr("src")!));
    $("video source[src], audio source[src]").each((_, el) => add("Media", $(el).attr("src")!));

    // Fonts
    $("link[rel=preload][as=font][href]").each((_, el) => add("Fonts", $(el).attr("href")!));

    // Iframes
    $("iframe[src]").each((_, el) => add("Iframes", $(el).attr("src")!));

    // Favicons
    $("link[rel~=icon][href]").each((_, el) => add("Favicons", $(el).attr("href")!));

    // Links (external only)
    $("a[href]").each((_, el) => {
        const href = $(el).attr("href")!;
        if (href.startsWith("#") || href.startsWith("javascript:")) return;
        add("Links", href, $(el).text().trim() || undefined);
    });

    return links;
}
```

Helper functions (`resolveUrl`, `baseName`) handle URL resolution and title extraction. Details to finalize during implementation.

### Step 2: "Show Resources" button on HTML pages

**File:** `src/renderer/editors/text/TextToolbar.tsx`

Add after the script-language buttons (~line 143):

```typescript
if (language === "html") {
    actions.push(
        <Button key="show-resources" type="icon" size="small"
            title="Show Resources"
            onClick={() => showHtmlResources(model)}>
            <ResourcesIcon width={16} height={16} />
        </Button>
    );
}
```

The `showHtmlResources()` helper:
```typescript
async function showHtmlResources(model: TextFileModel) {
    const { extractHtmlResources } = await import("../../core/utils/html-resources");
    const content = model.state.get().content;
    const baseUrl = model.filePath ? /* file:// dirname */ undefined : undefined;
    const links = extractHtmlResources(content, { baseUrl });
    if (links.length === 0) {
        ui.notify("No resources found in this HTML.", "info");
        return;
    }
    pagesModel.openLinks(links, model.title + " — Resources");
}
```

### Step 3: "Show Resources" context menu on Browser pages

**File:** `src/renderer/editors/browser/BrowserWebviewModel.ts`

Add a new menu item after the "View Actual DOM" item (~line 483):

```typescript
items.push({
    label: "Show Resources",
    onClick: async () => {
        const html = await webview.executeJavaScript(
            "document.documentElement.outerHTML",
        );
        const { extractHtmlResources } = await import("../../core/utils/html-resources");
        const links = extractHtmlResources(html, { baseUrl: pageUrl });
        if (links.length === 0) {
            ui.notify("No resources found on this page.", "info");
            return;
        }
        pagesModel.openLinks(links, (tab?.pageTitle || pageUrl) + " — Resources");
    },
});
```

### Step 4: Icon

Either reuse an existing icon or add a simple one. Check `src/renderer/theme/icons.tsx` for existing resource-related icons. A link/chain icon or a list icon would work.

## Concerns

### 1. cheerio loading — require, not import
cheerio is already a dependency but should NOT be bundled into the Vite renderer build. Since Persephone runs with `nodeIntegration: true`, use `require("cheerio")` at runtime (Node.js resolves it from `node_modules`). This keeps bundle size zero and also makes cheerio available to user scripts: `const cheerio = require("cheerio")`.

**Resolution:** Use `const cheerio = require("cheerio")` inside `extractHtmlResources()`. No Vite import, no dynamic `import()`. Same pattern as other Node.js modules used in the renderer.

### 2. Large HTML documents
Browser pages can have very large DOMs. Parsing with cheerio could be slow.

**Resolution:** For the initial implementation, just parse synchronously. If performance is an issue, we can move to a web worker later. Most HTML documents parse in <100ms.

### 3. srcset parsing
`srcset` attributes contain multiple URLs with pixel density or width descriptors. Parsing all variants would create duplicates.

**Resolution:** Take only the first URL from each srcset value. Simple and sufficient.

### 4. Data URLs
Some resources use `data:` URLs (inline SVGs, base64 images). These aren't meaningful as external links.

**Resolution:** Skip `data:` URLs in the extraction.

## Acceptance Criteria

1. **HTML page button:** "Show Resources" button appears on toolbar when language is `html`
2. **Browser context menu:** "Show Resources" menu item on Browser page context menu
3. **Categorized results:** extracted resources grouped by type (Images, Scripts, Stylesheets, etc.)
4. **Deduplicated:** same URL appears only once even if referenced multiple times
5. **Relative URL resolution:** URLs resolved to absolute when baseUrl is provided
6. **Empty result:** shows notification "No resources found" when HTML has no extractable resources
7. **Link collection page:** results open in a new page with "Links" panel, clicking a link navigates to it

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/core/utils/html-resources.ts` | **New.** `extractHtmlResources()` utility |
| `src/renderer/editors/text/TextToolbar.tsx` | Add "Show Resources" button for `language === "html"` |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Add "Show Resources" context menu item |

### Files NOT changed

- `PagesLifecycleModel.ts` — `openLinks()` already handles everything
- `LinkCategoryPanel.tsx` — no changes needed
- `package.json` — cheerio already installed
