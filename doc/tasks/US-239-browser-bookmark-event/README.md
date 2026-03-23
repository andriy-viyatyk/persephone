# US-239: Browser Bookmark EventChannel

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-23

## Goal

Add `app.events.browser.onBookmark` EventChannel that fires before the "Add/Edit Bookmark" dialog opens. Scripts can subscribe to modify bookmark data (title, URL, images, category, tags) before the user sees the dialog. Primary use case: fix YouTube thumbnail URLs that contain expiring tokens.

## Background

### Current bookmark flow

Two paths lead to the "Add Bookmark" dialog:

**Path A: Star button** (`BrowserBookmarksUIModel.handleStarClick()` at line 192)
1. Discovers images from page (`discoverImages()` at line 255): `og:image`, `twitter:image`, `itemprop="image"`, `apple-touch-icon`
2. Merges discovered + tracked images, deduplicates
3. Opens `showEditLinkDialog()` with title, url, images

**Path B: Context menu** (`BrowserWebviewModel.handleContextMenu()` at line 333)
1. Extracts link text and image from right-clicked element
2. Opens `showEditLinkDialog()` with extracted data

Both paths call `showEditLinkDialog()` but assemble parameters differently.

### YouTube use case

YouTube page images (`og:image`, etc.) contain URLs like:
```
https://i.ytimg.com/vi/VIDEO_ID/maxresdefault.jpg?sqp=...&rs=...
```

The `?sqp=...&rs=...` query params are session tokens that expire. The stable public URL is:
```
https://i.ytimg.com/vi/VIDEO_ID/maxresdefault.jpg
```

A script can detect YouTube URLs and strip the query params from all discovered images.

## Implementation Plan

### Step 1: Refactor — Single bookmark dialog entry point

Create a unified method in `BrowserBookmarksUIModel` that both paths call:

```typescript
/**
 * Show the Add/Edit Bookmark dialog with EventChannel support.
 * Both star button and context menu route through this method.
 */
async showBookmarkDialog(params: {
    title: string;
    href: string;
    discoveredImages: string[];
    imgSrc?: string;
    category?: string;
    tags?: string[];
    existingLink?: LinkItem;
}): Promise<void> {
    const isEdit = !!params.existingLink;

    // Fire onBookmark event — scripts can modify all parameters
    const bookmarkEvent = new BookmarkEvent(
        params.title,
        params.href,
        params.discoveredImages,
        params.imgSrc || "",
        params.category || "",
        params.tags || [],
        isEdit,
    );
    await app.events.browser.onBookmark.sendAsync(bookmarkEvent);

    // Show dialog with (possibly modified) event data
    const result = await showEditLinkDialog({
        title: isEdit ? "Edit Bookmark" : "Add Bookmark",
        link: {
            title: bookmarkEvent.title,
            href: bookmarkEvent.href,
            imgSrc: bookmarkEvent.imgSrc || undefined,
            category: bookmarkEvent.category,
            tags: bookmarkEvent.tags,
        },
        categories: this.bookmarks!.linkModel.categories,
        tags: this.bookmarks!.linkModel.tags,
        discoveredImages: bookmarkEvent.discoveredImages,
    });

    if (!result) return;

    // Save
    if (params.existingLink) {
        this.bookmarks!.linkModel.updateLink(params.existingLink.id, result);
    } else {
        this.bookmarks!.linkModel.addLink(result);
    }
}
```

Then refactor `handleStarClick()` to call `showBookmarkDialog()` after image discovery, and the context menu path in `BrowserWebviewModel` to also call `showBookmarkDialog()`.

**Benefit:** EventChannel fires in one place. Both paths get script integration automatically.

### Step 2: Add BrowserEvents namespace to AppEvents

Extend `src/renderer/api/events/AppEvents.ts`:

```typescript
class BrowserEvents {
    readonly onBookmark = new EventChannel<BookmarkEvent>({
        name: "browser.onBookmark",
    });
}

class AppEvents {
    readonly fileExplorer = new FileExplorerEvents();
    readonly browser = new BrowserEvents();  // NEW
}
```

### Step 3: Create BookmarkEvent class

In `src/renderer/api/events/events.ts`:

```typescript
export class BookmarkEvent extends BaseEvent {
    constructor(
        public title: string,
        public href: string,
        public discoveredImages: string[],
        public imgSrc: string,
        public category: string,
        public tags: string[],
        public readonly isEdit: boolean,
    ) {
        super();
    }
}
```

All properties are mutable (except `isEdit`) — scripts can modify title, URL, images, category, tags before the dialog opens.

### Step 4: Add types for IntelliSense

Update `src/renderer/api/types/events.d.ts`:

```typescript
interface IBookmarkEvent extends IBaseEvent {
    title: string;
    href: string;
    discoveredImages: string[];
    imgSrc: string;
    category: string;
    tags: string[];
    readonly isEdit: boolean;
}

interface IBrowserEvents {
    readonly onBookmark: IEventChannel<IBookmarkEvent>;
}

interface IAppEvents {
    readonly fileExplorer: IFileExplorerEvents;
    readonly browser: IBrowserEvents;
}
```

### Step 5: Update assets/editor-types copy

Ensure `assets/editor-types/events.d.ts` includes the new types.

## Resolved Concerns

### 1. Multiple bookmark paths → Single method (Step 1)

Refactor both star button and context menu paths to call a single `showBookmarkDialog()` method. EventChannel fires once, in one place. No risk of missing a path.

### 2. Async event before dialog

`sendAsync()` is awaited before showing the dialog. If a script handler is slow, it delays the dialog. This is acceptable — same pattern as file explorer context menu. User's script, user's responsibility.

### 3. Edit vs Add

`isEdit` readonly flag distinguishes new bookmarks from edits. Scripts can check this to decide whether to modify data.

### 4. handled flag behavior

`event.handled = true` only stops the event from propagating to the next subscriber (by EventChannel design). The browser code always receives the modified event data and always shows the dialog. `handled` does NOT skip the dialog.

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/api/events/AppEvents.ts` | Modify | Add `BrowserEvents` class with `onBookmark` channel |
| `src/renderer/api/events/events.ts` | Modify | Add `BookmarkEvent` class |
| `src/renderer/editors/browser/BrowserBookmarksUIModel.ts` | Refactor | Extract `showBookmarkDialog()`, fire `onBookmark` event |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Modify | Route context menu bookmark to `showBookmarkDialog()` |
| `src/renderer/api/types/events.d.ts` | Modify | Add `IBookmarkEvent`, `IBrowserEvents` |
| `assets/editor-types/events.d.ts` | Modify | Copy of types |

## Acceptance Criteria

- [ ] Single `showBookmarkDialog()` method handles both star button and context menu paths
- [ ] `app.events.browser.onBookmark` EventChannel fires before dialog opens
- [ ] Scripts can modify title, href, discoveredImages, imgSrc, category, tags
- [ ] `isEdit` flag distinguishes new vs edit
- [ ] `handled = true` stops propagation but dialog still opens
- [ ] Dialog shows modified values from event
- [ ] IntelliSense types available for `IBookmarkEvent` and `IBrowserEvents`
- [ ] TypeScript compiles clean
- [ ] Existing bookmark flow works unchanged without scripts
