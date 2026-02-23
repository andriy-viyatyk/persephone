# US-028: Browser Bookmarks (Links Editor Integration)

## Status

**Status:** Complete
**Priority:** Low
**Started:** 2026-02-23
**Completed:** 2026-02-23
**Depends on:** US-027 (Browser Profiles & Downloads), US-033 (Link Editor)

## Summary

Add bookmark functionality to the browser editor, with each browser profile associated with a `.link.json` file. The browser includes a slide-in bookmarks panel that renders a fully functional Link Editor. Clicking a link in the panel navigates the current browser tab. All edits auto-save to the associated file.

## Why

- Bookmarks are essential for a usable browser experience
- Per-profile bookmark files let users maintain separate link collections (work, personal, research)
- Embedding the Link Editor directly in the browser avoids context-switching — users browse and organize bookmarks in one place
- Auto-save eliminates manual save steps for a fluid bookmarking workflow

## Prerequisites

This task depends on:
1. **US-033 Link Editor** — A structured editor for `.link.json` files (similar to Notebook editor), storing links by categories and tags.
2. **US-025, US-026, US-027** — Basic browser, tabs, and profiles

## Acceptance Criteria

- [x] Browser profile settings include a "bookmarks file" field (path to `.link.json`) for Default, named profiles, and Incognito
- [x] Incognito row in Settings shows bookmarks file path
- [x] **Star button (☆)** inside the URL bar (after the "go" button) — opens Edit Link Dialog for quick bookmarking
- [x] Star button: empty star when URL not bookmarked, filled star when already bookmarked
- [x] If profile has no associated file: prompt user to "Associate with existing file" or "Create new links file"
- [x] Bookmark dialog (Edit Link Dialog from US-033): URL and title prefilled, user picks category/tags, discovered images shown
- [x] **"Open Links" button** on browser toolbar (before DevTools gear button) — opens bookmarks overlay drawer
- [x] Bookmarks overlay drawer renders a fully functional Link Editor (categories, tags, search, view modes)
- [x] Link click in the bookmarks drawer opens URL in a **new internal tab** (or navigates current tab if about:blank)
- [x] Drawer closes after link click navigation
- [x] All link edits in the bookmarks drawer auto-save to the `.link.json` file
- [x] Visual indicator in URL bar (filled star) when current URL is already bookmarked
- [x] Works with all profiles (each profile can have a different bookmarks file)
- [x] Incognito mode: bookmarks fully functional (uses incognito bookmarks file from settings)
- [x] Documentation updated
- [x] No regressions in existing functionality

## Technical Approach

### Profile ↔ Bookmarks File Association

Bookmarks file paths are stored in app settings. Named profiles use a `bookmarksFile` field on the `BrowserProfile` object. The default profile and incognito mode use dedicated top-level settings keys (since they are not part of the `browser-profiles` array):

```json
{
  "browser-default-bookmarks-file": "C:/Users/.../default-bookmarks.link.json",
  "browser-incognito-bookmarks-file": "C:/Users/.../incognito-bookmarks.link.json",
  "browser-profiles": [
    {
      "name": "Work",
      "color": "#4a9eff",
      "bookmarksFile": "C:/Users/.../work-bookmarks.link.json"
    }
  ]
}
```

### Settings UI: Bookmarks File per Profile

The **Settings → Browser Profiles** section is extended so that each profile row shows a secondary line with the associated bookmarks file path:

```
┌─────────────────────────────────────────────────────────────┐
│ ● Default                          [default]  [clear data]  │
│   📁 default-bookmarks.link.json            [×]            │
├─────────────────────────────────────────────────────────────┤
│ ● Work                          [set default]  [clear data] │
│   📁 work-bookmarks.link.json               [×]            │
├─────────────────────────────────────────────────────────────┤
│ 🕶 Incognito                                                │
│   📁 incognito-bookmarks.link.json          [×]            │
│   (bookmarks fully functional in incognito)                  │
└─────────────────────────────────────────────────────────────┘
```

- **Default profile** row — unchanged behavior, plus a bookmarks file path line below
- **Named profiles** — unchanged behavior, plus a bookmarks file path line below
- **Incognito** — new row at the end of the profile list (before "Add profile" form). Shows only the bookmarks file path — no "set default", "clear data", or delete buttons (incognito sessions are ephemeral). Styled with an incognito icon instead of a color dot.
- **Bookmarks file line**: shows the filename (or "No bookmarks file" placeholder). Clicking the filename or a browse icon opens an Electron file dialog (filter `.link.json`). The `×` button clears the association.
- **Incognito bookmarks**: when a browser page is in incognito mode, the bookmarks panel loads from the incognito bookmarks file. All bookmark functionality is available — add, edit, delete links — same as regular profiles. Only browsing data (cookies, history, cache) is ephemeral in incognito; bookmarks are persisted to the file.

### Bookmarks Model Architecture (TextFileModel + LinkEditorModel)

The Link Editor is a **content-view** that depends on `TextFileModel` for all file I/O:

```
File on Disk (.link.json)
    ↓
TextFileModel
    ├─ state.content (raw JSON string)
    ├─ encryption/decryption (transparent)
    ├─ FileWatcher (external changes)
    ├─ save/restore (cache + disk)
    └─ changeContent() ← called by LinkEditorModel
    ↓
LinkEditorModel
    ├─ receives TextFileModel as props.model
    ├─ updateContent() ← reacts to state.content changes
    ├─ onDataChanged() → calls model.changeContent()
    └─ skipNextContentUpdate flag (prevents infinite loops)
```

**Why both models are needed:**
- `LinkEditorModel` cannot exist without `TextFileModel` — it reads `state.content` and writes back via `changeContent()`
- `TextFileModel` handles encryption/decryption transparently — if the user encrypts their `.link.json` bookmarks file, `TextFileModel.mapContentFromFile()` decrypts before `LinkEditorModel` ever sees the data
- `TextFileModel` provides `FileWatcher` — useful if the same `.link.json` is open in both a standalone Link Editor tab and the browser bookmarks panel simultaneously
- `TextFileModel` handles debounced cache saves (1s) and full save-to-disk flow

**BrowserBookmarks helper class** wraps both models into a single instance stored on `BrowserPageModel`:

```typescript
// Stored as BrowserPageModel.bookmarks (null by default)
class BrowserBookmarks {
    textModel: TextFileModel;      // file I/O, encryption, content
    linkModel: LinkEditorModel;    // parsed link data, categories, tags, filters

    constructor(filePath: string) { ... }
    async init(): Promise<void> { ... }   // textModel.restore() → linkModel.updateContent()
    dispose(): void { ... }               // cleanup watchers, subscriptions
}
```

### LinkEditor Reuse via Portal Placeholders (No Refactoring Needed)

The existing `LinkEditor` component renders its toolbar (Add Link, View Mode, Search) and footer (link count) via `createPortal()` into placeholder `<div>` refs on `TextFileModel`:
- `model.editorToolbarRefFirst` — portal target for breadcrumb (Categories/Tags)
- `model.editorToolbarRefLast` — portal target for Add Link, View Mode, Search
- `model.editorFooterRefLast` — portal target for link count

In the normal `TextPageView`, these refs point to empty `<EditorToolbarRoot>` divs rendered by `TextToolbar`. The LinkEditor portals its elements there without knowing what hosts them.

**Browser drawer reuse — same pattern:**
- The sliding drawer renders its own toolbar area with the same empty placeholder `<div>` elements
- `BrowserBookmarks.init()` assigns these placeholder refs to `textModel.editorToolbarRefFirst`, `textModel.editorToolbarRefLast`, and `textModel.editorFooterRefLast`
- The existing `LinkEditor` component is rendered inside the drawer, receiving `textModel` as `props.model`
- `LinkEditor` creates its own `LinkEditorModel` via `useComponentModel()` as usual
- `LinkEditor` portals its toolbar/footer elements into the drawer's placeholder divs — no code changes needed
- The `state.content` sync effect in `LinkEditor` works as before since `textModel` provides the content

**What the drawer needs to add beyond the placeholders:**
- `onLinkClick` interception — the drawer wraps `LinkEditor` and intercepts link click events to open URLs in new internal tabs and close the drawer
- `panelPosition` — Categories/Tags panel on the right side (achieved via CSS flex `row-reverse` on the drawer's `LinkEditor` container, or a prop if we add one later)
- Close triggers (Esc, backdrop click) — handled by the drawer component itself

### Bookmarks Lazy Loading Lifecycle

The `BrowserPageModel` gets a `bookmarks` property (initially `null`). The bookmarks models are **not** created when the browser page opens — they are lazily initialized on first user action:

1. **User clicks ☆ or "Open Links"** → check `bookmarks !== null`
2. **If `bookmarks` is null** → check profile settings for associated `.link.json` file path
3. **If no file path** → show "Associate Bookmarks File" dialog (new component):
   - **"Select a file"** → Electron open file dialog (filter `.link.json`) → update profile settings with selected path
   - **"Create a file"** → Electron save dialog → enforce `.link.json` extension → write empty `LinkEditorData` to that path → update profile settings
   - **Cancel** → abort the operation
4. **Now we have a file path** → create `BrowserBookmarks(filePath)`:
   - Creates `TextFileModel` with the file path
   - Calls `textModel.restore()` to load content (handles decryption if encrypted)
   - Creates `LinkEditorModel` with `textModel` as `props.model`
   - Calls `linkModel.updateContent(textModel.state.get().content)` for initial parse
   - Stores on `BrowserPageModel.bookmarks`
5. **Proceed** with the original action (open Edit Link Dialog or open bookmarks drawer)
6. The same `bookmarks` instance is reused for: star indicator checks, edit dialog, and the bookmarks drawer
7. **Auto-save**: `LinkEditorModel.onDataChanged()` → `TextFileModel.changeContent()` → debounced save to disk. No manual save needed.

### Star Button Behavior

The star button (☆) is rendered inside the URL bar after the "go" button:

- **Inactive/default color**: `bookmarks` is null or current URL not found in bookmarks
- **Active color** (blue in default theme): `bookmarks` is loaded AND current URL exists in bookmarks (matched by `href`)
- **Click when not bookmarked**: opens Edit Link Dialog with URL/title prefilled for creating a new bookmark
- **Click when already bookmarked**: opens Edit Link Dialog with existing bookmark data (no field changes), but still passes discovered images so user can update the image
- Discovered images (from meta tags) are always passed to the dialog regardless of new/existing

### Bookmarks Panel (Overlay Drawer)

A right-anchored overlay drawer that slides in over the browser page content, with a semi-transparent backdrop:

```
┌─────────────────────────────────────────────────────┐
│ Browser Toolbar                          [☆] [📑]  │
├─────────────────────────────────────────────────────┤
│░░░░░░░░░░░░░░░░░│S│                                │
│░░░░░ backdrop ░░░│p│  Link list       ┌───────────┐│
│░░░ (click to  ░░░│l│  or tiles        │ Tags      ││
│░░░  close)    ░░░│i│                  │ Categories││
│░░░░░░░░░░░░░░░░░│t│  (click →        ├───────────┤│
│░░ web content ░░░│t│   navigate &     │ Search    ││
│░░░ visible    ░░░│e│   close panel)   │ View mode ││
│░░░ underneath ░░░│r│                  │           ││
│░░░░░░░░░░░░░░░░░│ │                  │           ││
├─────────────────────────────────────────────────────┤
```

- **Overlay, not shrink** — the webview stays full-width; the bookmarks panel overlays on top with a semi-transparent backdrop
- **Right-anchored drawer** — slides in from the right edge with animation (like the Sidebar component)
- **Initial width** — ~60% of the browser page width
- **Resizable** via Splitter on the left edge (same pattern as Sidebar)
- **Panel position flipped** — the Link Editor's Categories/Tags panel renders on the **right** side (closer to the edge), link list/tiles on the left. Achieved via a `panelPosition` prop on the Link Editor view component (`"left"` default for standalone, `"right"` for browser bookmarks)
- **Closes on**: `Esc` key, backdrop click, or automatically after navigating via link click
- Toggle via a toolbar button (e.g., bookmarks/panel icon)
- Renders the `LinkEditorView` component with the `bookmarks.linkModel` and a custom `onLinkClick` callback
- `onLinkClick` opens URL in a new internal tab (via `model.addTab(url)`) and closes the drawer
- Panel width persisted in browser page state

### Auto-Save

When the Link Editor is embedded in the browser bookmarks panel:
- The `LinkEditorModel` operates on in-memory data loaded from the `.link.json` file
- Every mutation (add, edit, delete, reorder) triggers a debounced write-back to the file
- Uses the same file I/O pattern as other editors (Node.js `fs` via `nodeIntegration`)
- No "unsaved changes" indicator needed — changes are always saved

### Two Entry Points

**1. Star button (☆) — inside the URL bar, after the "go" button**
- Quick bookmarking without opening the full Link Editor
- Click → opens Edit Link Dialog with current page URL/title prefilled
- Browser discovers page images (meta tags) → shown in the dialog's "Discovered Images" section
- User picks category/tags/image → saved to profile's `.link.json`
- If URL is already bookmarked: filled star, click opens dialog with existing bookmark data for editing
- If URL is not bookmarked: empty star, click opens dialog for creating a new bookmark

**2. "Open Links" button — on the browser toolbar, before the DevTools gear button**
- Opens the bookmarks overlay drawer with the full Link Editor
- User can browse, search, edit, and manage all bookmarks
- **Link click opens URL in a new internal tab** (preserves the current page)
- Drawer closes automatically after link click navigation
- Uses a new icon (to be designed)

### Star Indicator

The star button in the URL bar reflects the bookmark state of the current page:
- **Empty star**: current URL is not in the bookmarks file
- **Filled star**: current URL exists in the loaded bookmarks (match by `href`)

### Image Discovery for Bookmarks

When bookmarking a page, the browser collects candidate images from multiple sources:

1. **Meta tags** (current page): `og:image`, `twitter:image`, `meta[name="thumbnail"]`, and similar — extracted via `executeJavaScript` on the webview
2. **Pre-navigation capture**: When the user clicks a link on a page (e.g., a video tile, article card), the browser captures images from the clicked element *before* navigation. If the clicked `<a>` contains an `<img>`, or is inside a tile/card that has an `<img>`, that image URL is remembered and associated with the new page. This way, when the user bookmarks the destination page, the tile image from the source page is available as a suggested image.
3. **Context menu "Add to Bookmarks"**: Right-clicking on a link/tile element shows an "Add to Bookmarks" option. The context menu handler extracts `href`, `imgSrc` (from the nearest `<img>` in the element or its parent tile), and `title` (from text content or `alt` attribute). This opens the Edit Link Dialog pre-filled with all three fields plus any discovered images.
4. All discovered images are passed to the Edit Link Dialog's "Discovered Images" section.
5. User selects one (or pastes a custom URL), which becomes the link's `imgSrc`.

**Note:** Phase 3 implementation includes testing across various sites (YouTube, news sites, social media) to verify image discovery covers enough real-world cases. Edge cases will be handled iteratively.

## Implementation Progress

### Phase 1: Settings Page — Bookmarks File per Profile
- [x] Add `bookmarksFile` field to `BrowserProfile` type
- [x] Add `browser-default-bookmarks-file` and `browser-incognito-bookmarks-file` settings keys
- [x] Add bookmarks file path line to each profile row in Settings UI (Default, named profiles)
- [x] Add Incognito row to Settings → Browser Profiles (bookmarks file path only, no other controls)
- [x] File path line: shows filename (or "No bookmarks file"), browse button, clear (×) button

### Phase 2: Bookmarks Model Integration & Overlay Drawer
- [x] `BrowserBookmarks` helper class wrapping `TextFileModel` + `LinkEditorModel`
- [x] Add `bookmarks` property to `BrowserPageModel` (null by default)
- [x] "Associate Bookmarks File" dialog component ("Select a file" / "Create a file" / Cancel)
- [x] Lazy initialization flow (check profile → show dialog if needed → create BrowserBookmarks)
- [x] TextFileModel created with `.link.json` path, `restore()` loads content (handles encryption)
- [x] Auto-save via existing two-way binding: LinkEditorModel → TextFileModel.changeContent() → disk
- [x] Overlay drawer component with backdrop, slide-in animation, Splitter resize
- [x] Drawer toolbar with portal placeholder divs (same pattern as TextToolbar's `EditorToolbarRoot`)
- [x] Assign placeholder refs to `textModel.editorToolbarRefFirst/Last` and `editorFooterRefLast`
- [x] Render existing `LinkEditor` component inside the drawer — portals toolbar/footer into placeholders without any changes
- [x] Panel position: CSS `flex-direction: row-reverse` on drawer's LinkEditor container (Categories/Tags on right)
- [x] Intercept link clicks → open URL in new internal tab & close drawer
- [x] "Open Links" toolbar button (new icon) before DevTools gear button
- [x] Close on: Esc, backdrop click, link click navigation
- [x] Initial width ~60% of browser page, panel width persisted
- [x] Incognito: bookmarks fully functional (add/edit/delete links, same as regular profiles)
- [x] Dispose bookmarks models on browser page close

### Phase 3: Star Button, Image Discovery & Context Menu Bookmarking
- [x] Add star button (☆) inside URL bar, after the "go" button
- [x] Star click → open Edit Link Dialog with URL/title prefilled
- [x] Filled/empty star indicator based on whether current URL is bookmarked
- [x] Filled star click → edit existing bookmark in Edit Link Dialog
- [x] Image discovery: extract `og:image`, `twitter:image`, and similar meta tags from current page
- [x] Save link to the profile's `.link.json` file
- [x] Context menu: "Add to Bookmarks" on right-click over link/tile elements — captures href, imgSrc, and title from the clicked element
- [x] Testing & refinement across various sites to cover image discovery edge cases

### Phase 3.1: Per-Tab Image Tracking with Navigation Levels
- [x] Define `TrackedImageLevel` type (`{ level: number; imgUrls: string[] }`) for per-tab image history
- [x] Add `trackedImagesRef` (`Map<tabId, TrackedImageLevel[]>`) in BrowserPageView
- [x] On `did-navigate`: increment all levels by 1, drop levels > 2, add empty level 0
- [x] Add "Use Image for Bookmark" context menu item when right-clicking images — pushes image URL to level 0
- [x] Merge tracked images (all levels, deduplicated) with meta-tag images in the star button bookmark flow
- [x] Testing across video sites (YouTube, etc.) to verify image tracking works reliably

### Phase 4: Encrypted Bookmarks File Support & Documentation
- [x] Test and polish encrypted `.link.json` bookmarks file flow
- [x] Redesign "enter password" dialog as an async call (currently built into TextPageView) — same approach as other app dialogs (e.g., `showConfirmationDialog`)
- [x] Encrypted bookmarks flow: user clicks ☆ → file is encrypted → show async password dialog → decrypt → search for existing link → show add/edit dialog. Cancel at password step cancels the whole operation.
- [x] Same async flow for "Open Links" button with encrypted file
- [x] Verify encryption/decryption round-trip works for bookmarks auto-save
- [x] Update browser editor docs
- [x] Update user docs (`docs/editors.md`, `docs/whats-new.md`)
- [x] Update architecture docs (`doc/architecture/browser-editor.md`)

## Notes

### 2026-02-24 — Encrypted Bookmarks File Support
- **Async password dialog**: The current "enter password" UI is built into `TextPageView` as inline state. For browser bookmarks, we need a standalone async password dialog (same pattern as `showConfirmationDialog`) that can be `await`ed from any code path.
- **Encrypted bookmarks flow example**: User clicks ☆ → `BrowserBookmarks.init()` calls `textModel.restore()` → content is encrypted → show async password dialog → user enters password → decrypt → `linkModel.updateContent()` → search for existing link by URL → show add/edit dialog. If user cancels password dialog → cancel the entire operation, do not create bookmarks models.
- **All encryption logic already exists in TextFileModel**: `mapContentFromFile()` decrypts, `mapContentToSave()` encrypts. The only missing piece is the async password prompt outside of `TextPageView`.
- **Phase 4 task**: Test and polish after main implementation. Should not be too complicated once the async dialog is in place — everything wraps into an async function.

### 2026-02-24 — LinkEditor Reuse via Portal Placeholders
- **No LinkEditor refactoring needed**: The existing `LinkEditor` component renders toolbar/footer via `createPortal()` into placeholder `<div>` refs on `TextFileModel`. The sliding drawer simply provides its own placeholder divs and assigns them to the same refs — `LinkEditor` portals its elements there without any code changes.
- **Same pattern as TextToolbar**: `TextToolbar` renders empty `<EditorToolbarRoot>` divs that `TextPageModel` stores refs to. The drawer does exactly the same thing.
- **Panel position via CSS**: Categories/Tags panel moved to the right side using `flex-direction: row-reverse` on the drawer's `LinkEditor` container — no prop needed on LinkEditor itself.
- **Link click interception**: The drawer wraps `LinkEditor` and intercepts link navigation events to open URLs in new internal tabs and close the drawer.

### 2026-02-24 — TextFileModel + LinkEditorModel Architecture
- **LinkEditorModel depends on TextFileModel**: LinkEditorModel is a content-view — it reads `state.content` from TextFileModel and writes back via `changeContent()`. It cannot work standalone.
- **TextFileModel handles encryption**: `.link.json` bookmarks files can be encrypted. TextFileModel's `mapContentFromFile()` / `mapContentToSave()` handle decryption/encryption transparently. LinkEditorModel never sees encrypted data.
- **TextFileModel handles file I/O**: FileWatcher for external changes, debounced cache saves, full save-to-disk flow. Also useful if the same file is open in both a standalone Link Editor tab and the browser bookmarks panel.
- **BrowserBookmarks wrapper**: New helper class that wraps both `TextFileModel` + `LinkEditorModel` into a single instance. Stored as `BrowserPageModel.bookmarks` (null by default, lazily created). Handles init (restore + parse) and dispose (cleanup watchers, subscriptions).
- **Auto-save for free**: The existing two-way binding between LinkEditorModel and TextFileModel means every mutation automatically triggers a debounced write to disk. No additional auto-save logic needed.
- **Renamed property**: `BrowserPageModel.linkModel` → `BrowserPageModel.bookmarks` (a `BrowserBookmarks` instance, not just a LinkEditorModel).

### 2026-02-24 — Phase Reorder & Context Menu Bookmarking
- **Phases reordered**: Phase 1 = Settings page (bookmarks file per profile). Phase 2 = Link model integration + sliding drawer. Phase 3 = Star button, image discovery, and context menu bookmarking. Phase 4 = Documentation.
- **Star button moved to Phase 3**: Image discovery and star button are the most complex parts — extracting meta tags, pre-navigation image capture, context menu bookmarking. Pushing these to Phase 3 allows focused testing across different sites.
- **Pre-navigation image capture**: When the user clicks a link on a page, the browser remembers images from the clicked element (e.g., video tile `<img>`) *before* navigation. These images are then available as suggestions when bookmarking the destination page.
- **Context menu "Add to Bookmarks"**: New context menu item when right-clicking on link/tile elements. Extracts href, imgSrc (from nearest `<img>`), and title (from text content or alt). Opens Edit Link Dialog pre-filled with all captured data.

### 2026-02-24 — Design Review (continued)
- **Settings UI for bookmarks file path**: Each profile row in Settings → Browser Profiles shows a secondary line with the associated bookmarks file path. Clicking the path or a browse icon opens an Electron file dialog (filter `.link.json`). A `×` button clears the association.
- **Incognito row in Settings**: New row at the end of the profile list (before "Add profile" form). Shows only the bookmarks file path — no "set default", "clear data", or delete buttons. Styled with incognito icon instead of color dot.
- **Data model**: Named profiles get `bookmarksFile?: string` on the `BrowserProfile` interface. Default profile and incognito use separate top-level settings keys: `"browser-default-bookmarks-file"` and `"browser-incognito-bookmarks-file"` (since they are not part of the `browser-profiles` array).
- **Incognito full bookmark support**: Incognito mode has full bookmark functionality — add, edit, delete links. Only browsing data (cookies, history, cache) is ephemeral; bookmarks persist to the configured incognito bookmarks file. This makes sense because bookmarks are a user's curated link collection, not browsing traces.

### 2026-02-24 — Design Review
- **Two separate buttons**: Star button (☆) in the URL bar for quick bookmarking (opens Edit Link Dialog). "Open Links" button on the toolbar for browsing bookmarks (opens overlay drawer with full Link Editor).
- **Star in URL bar**: Placed after the "go" button. Active/blue color when bookmarks is loaded and URL is bookmarked, default color otherwise. Click opens Edit Link Dialog — creating new or editing existing bookmark. Existing bookmarks open with original field values but with fresh discovered images.
- **Lazy bookmarks loading**: `BrowserPageModel.bookmarks` is null by default. Created on first ☆ or "Open Links" click. Checks profile settings for associated `.link.json` file. If no file, shows "Associate Bookmarks File" dialog with "Select a file" / "Create a file" options. `BrowserBookmarks` (wrapping TextFileModel + LinkEditorModel) is then stored on BrowserPageModel and reused for all subsequent operations.
- **Link click in drawer opens new internal tab**: Clicking a bookmark in the drawer opens the URL in a new internal tab (not navigate the current tab), preserving the user's current page. Drawer auto-closes after navigation.
- **Overlay drawer, not webview shrink**: Bookmarks panel is a right-anchored overlay with backdrop, not a side-by-side layout that deforms the webview. Web content stays visible underneath the semi-transparent backdrop.
- **Panel position prop**: Link Editor view gets a `panelPosition` parameter (`"left"` | `"right"`). Default `"left"` for standalone editor, `"right"` when embedded in browser bookmarks — places Categories/Tags closer to the right edge.
- **Drawer sizing**: Initial width ~60% of browser page width, resizable via Splitter (same pattern as Sidebar).
- **Slide animation**: Same approach as Sidebar component.
- **Close triggers**: Esc key, backdrop click, or automatic on link click navigation.

### 2026-02-23
- Redesigned approach: per-profile bookmarks file instead of global default file
- Bookmarks panel slides in from the right (not a grouped page) — keeps everything in one browser tab
- Link Editor rendered fully functional inside the panel with `onLinkClick` override
- Auto-save eliminates manual save steps
- Image discovery (meta tags + click tracking) populates the Edit Link Dialog's image selection

### 2026-02-19
- Split from original US-021 vision. This is the final piece of the browser feature set.
- The page grouping redesign (minimize to thin panel, expand as overlay) is a separate task that will enhance the browser + Links editor UX but is not a dependency.

## Related

- Depends on: [US-025 Basic Browser Editor](../US-025-basic-browser-editor/README.md)
- Depends on: [US-026 Browser Internal Tabs](../US-026-browser-internal-tabs/README.md)
- Depends on: [US-027 Browser Profiles & Downloads](../US-027-browser-profiles-downloads/README.md)
- Depends on: [US-033 Link Editor](../US-033-link-editor/README.md)
