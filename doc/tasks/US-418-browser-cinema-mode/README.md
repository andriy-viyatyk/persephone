# US-418: Browser Cinema Mode — Expand `<video>` to Full Page

## Goal

Add a "cinema mode" feature to the browser editor's webview preload script that detects `<video>` elements on any webpage, injects an expand/collapse button (visible on hover) in the top-right corner of each video, and toggles the video to fill the entire page — hiding all other page content. This lets users watch video without distracting banners, sidebars, and comments, with the video resizing when the Persephone window resizes.

## Background

### Existing infrastructure

- **Preload script:** `src/preload-webview.ts` runs inside each browser tab's `<webview>`. Already uses `MutationObserver` on `<head>` for title/favicon tracking, keyboard shortcuts, and click image tracking. All communication with the host renderer goes through `ipcRenderer.sendToHost(channel, ...args)`.
- **IPC handling:** `src/renderer/editors/browser/BrowserEditorView.tsx` lines 311-355 — the `onIpcMessage` handler processes preload messages (`page-title`, `page-favicon`, `clicked-images`, `show-find-bar`, `hide-find-bar`).
- **No model/view changes needed on the Persephone side** — the expand/collapse is purely within the webview's DOM. An optional IPC notification (`video-cinema-enter`/`video-cinema-exit`) could be added later for host-side indicators, but is not required for this task.

### Design decisions

- **All logic lives in `preload-webview.ts`** — no new files needed. The preload script already has full DOM access inside the guest page.
- **Inline styles only** — to avoid CSS class conflicts with page styles.
- **`MutationObserver` on `document.body`** — detects dynamically added `<video>` elements (YouTube adds them after JS loads).
- **Hover-only button** — uses CSS pseudo-behavior via inline styles + mouseenter/mouseleave (since `:hover` can't be applied to inline styles, we use JS events).
- **Expand** = `position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483647; object-fit: contain; background: black` on the video element.
- **Collapse** = restore the video's original `style.cssText`.
- **Escape key** exits cinema mode (supplement to the collapse button).
- **Multiple `<video>` elements** — each gets its own button; only one can be expanded at a time.

## Implementation Plan

### Single file change: `src/preload-webview.ts`

Add a new section "Cinema Mode" after the existing "Clicked Image Tracking" section (after line 119), before the "Bootstrap" section.

#### Step 1: Video detection via MutationObserver

```typescript
// ── Cinema Mode — Expand <video> to Full Page ──────────────────────

let expandedVideo: HTMLVideoElement | null = null;
let expandedOriginalStyle = "";

function initCinemaMode() {
    // Process existing videos
    document.querySelectorAll("video").forEach(injectCinemaButton);

    // Watch for dynamically added videos
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof HTMLVideoElement) {
                    injectCinemaButton(node);
                } else if (node instanceof HTMLElement) {
                    node.querySelectorAll?.("video").forEach(injectCinemaButton);
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}
```

#### Step 2: Inject the expand/collapse button

```typescript
function injectCinemaButton(video: HTMLVideoElement) {
    if (video.dataset.cinemaReady) return;
    video.dataset.cinemaReady = "1";

    // Create a wrapper if the video's parent isn't already position:relative/absolute
    // We need a positioning anchor for the button
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:relative;display:inline-block;";
    // Only wrap if the video has a parent and isn't already in a relative container
    // Simple approach: always use the video itself as anchor via overlay
    
    // Create the button
    const btn = document.createElement("div");
    btn.style.cssText = [
        "position:absolute",
        "top:8px",
        "right:8px",
        "width:32px",
        "height:32px",
        "background:rgba(0,0,0,0.6)",
        "border:none",
        "border-radius:4px",
        "cursor:pointer",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "z-index:2147483647",
        "opacity:0",
        "transition:opacity 0.2s",
        "pointer-events:auto",
    ].join(";") + ";";
    btn.innerHTML = expandSvg;
    btn.title = "Cinema Mode";

    // Position the button relative to the video
    // Use a transparent overlay div on top of the video
    const overlay = document.createElement("div");
    overlay.dataset.cinemaOverlay = "1";
    overlay.style.cssText = [
        "position:absolute",
        "top:0",
        "left:0",
        "width:100%",
        "height:100%",
        "pointer-events:none",
        "z-index:2147483646",
    ].join(";") + ";";
    overlay.appendChild(btn);

    // Show button on video hover
    video.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    video.addEventListener("mouseleave", (e) => {
        // Don't hide if mouse moved to the button
        const related = e.relatedTarget as HTMLElement;
        if (related === btn || btn.contains(related)) return;
        btn.style.opacity = "0";
    });
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; btn.style.pointerEvents = "auto"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = "0"; });
    btn.style.pointerEvents = "auto";

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCinema(video, btn);
    });

    // Insert overlay as sibling after the video
    // The video's parent needs to be position:relative for this to work
    const parent = video.parentElement;
    if (parent) {
        const parentPos = getComputedStyle(parent).position;
        if (parentPos === "static") {
            parent.style.position = "relative";
            parent.dataset.cinemaRelative = "1"; // Mark so we can restore
        }
        parent.appendChild(overlay);
    }

    // Track overlay for cleanup
    video.dataset.cinemaOverlayId = Math.random().toString(36).slice(2);
    overlay.dataset.cinemaFor = video.dataset.cinemaOverlayId;
}
```

#### Step 3: SVG icons (inline, minimal)

```typescript
const expandSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 3h7v2H5v5H3V3zm11 0h7v7h-2V5h-5V3zM3 14h2v5h5v2H3v-7zm18 0v7h-7v-2h5v-5h2z"/>
</svg>`;

const collapseSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 3v4H5v2h7V3h-2zm4 0v6h7V7h-5V3h-2zM5 15h5v6h-2v-4H5v-2zm14 0h-5v6h2v-4h5v-2z"/>
</svg>`;
```

#### Step 4: Toggle cinema mode

```typescript
function toggleCinema(video: HTMLVideoElement, btn: HTMLElement) {
    if (expandedVideo === video) {
        // Collapse
        exitCinema();
    } else {
        // If another video is expanded, collapse it first
        if (expandedVideo) exitCinema();

        // Save original style
        expandedOriginalStyle = video.style.cssText;
        expandedVideo = video;

        // Expand video to full page
        video.style.cssText = [
            "position:fixed !important",
            "top:0 !important",
            "left:0 !important",
            "width:100vw !important",
            "height:100vh !important",
            "z-index:2147483646 !important",
            "object-fit:contain !important",
            "background:black !important",
            "margin:0 !important",
            "padding:0 !important",
            "border:none !important",
            "max-width:none !important",
            "max-height:none !important",
        ].join(";") + ";";

        // Move overlay button to be visible in expanded state
        btn.innerHTML = collapseSvg;
        btn.title = "Exit Cinema Mode";
        btn.style.opacity = "1";
        btn.style.position = "fixed";
        btn.style.top = "8px";
        btn.style.right = "8px";

        // Hide page scrollbar
        document.documentElement.dataset.cinemaActive = "1";
        document.documentElement.style.overflow = "hidden";

        ipcRenderer.sendToHost("video-cinema", true);
    }
}

function exitCinema() {
    if (!expandedVideo) return;

    expandedVideo.style.cssText = expandedOriginalStyle;
    expandedVideo = null;
    expandedOriginalStyle = "";

    // Restore all cinema buttons to expand icon and original positioning
    document.querySelectorAll<HTMLElement>("[data-cinema-overlay] > div").forEach((btn) => {
        btn.innerHTML = expandSvg;
        btn.title = "Cinema Mode";
        btn.style.opacity = "0";
        btn.style.position = "absolute";
        btn.style.top = "8px";
        btn.style.right = "8px";
    });

    // Restore scrollbar
    delete document.documentElement.dataset.cinemaActive;
    document.documentElement.style.overflow = "";

    ipcRenderer.sendToHost("video-cinema", false);
}
```

#### Step 5: Escape key handler

Update the existing keyboard shortcut handler (line 83-91) to also handle Escape for cinema mode:

**Before (line 83-91):**
```typescript
document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        e.stopImmediatePropagation();
        ipcRenderer.sendToHost("show-find-bar");
    } else if (e.key === "Escape") {
        ipcRenderer.sendToHost("hide-find-bar");
    }
}, true);
```

**After:**
```typescript
document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        e.stopImmediatePropagation();
        ipcRenderer.sendToHost("show-find-bar");
    } else if (e.key === "Escape") {
        if (expandedVideo) {
            exitCinema();
        } else {
            ipcRenderer.sendToHost("hide-find-bar");
        }
    }
}, true);
```

#### Step 6: Bootstrap

Add cinema mode initialization to the existing bootstrap section. Update the DOMContentLoaded and load handlers:

**Before (lines 123-138):**
```typescript
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        reportAll();
        observeHead();
    });
} else {
    reportAll();
    observeHead();
}

window.addEventListener("load", () => {
    setTimeout(reportAll, 200);
    setTimeout(reportAll, 1000);
});
```

**After:**
```typescript
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        reportAll();
        observeHead();
        initCinemaMode();
    });
} else {
    reportAll();
    observeHead();
    initCinemaMode();
}

window.addEventListener("load", () => {
    setTimeout(reportAll, 200);
    setTimeout(reportAll, 1000);
});
```

### Optional: IPC handler in BrowserEditorView.tsx

Not required for this task, but for future use — handle the `"video-cinema"` message in the IPC handler at `BrowserEditorView.tsx:349`:

```typescript
} else if (channel === "video-cinema") {
    // Could show/hide an indicator on the tab, or store state
    // For now: no-op — cinema mode is fully managed in the webview
}
```

This can be added later if we want a tab indicator or keyboard shortcut from the host side.

## Files Changed

| File | Change |
|------|--------|
| `src/preload-webview.ts` | Add cinema mode section: MutationObserver for `<video>` detection, button injection, expand/collapse toggle, Escape key integration, bootstrap call |

## Files NOT Changed

- `BrowserEditorView.tsx` — no host-side UI changes needed
- `BrowserEditorModel.ts` — no model changes needed
- `BrowserWebviewModel.ts` — no webview model changes needed
- No new files created — everything lives in the existing preload script

## Concerns

| # | Concern | Resolution |
|---|---------|------------|
| C1 | **Button positioning on complex layouts** — Some sites wrap `<video>` in deeply nested containers with `overflow: hidden`, `transform`, or other properties that break `position: absolute`. | Start with the simple parent-relative approach. If specific sites break, we'll fix per-site in testing. The expand itself uses `position: fixed` which ignores parent stacking context. |
| C2 | **YouTube's own fullscreen** — YouTube has its own fullscreen button. Our cinema mode is different (fills the webview, not the OS fullscreen). Both can coexist — ours is essentially "fill the webview tab area". | No conflict — different mechanisms. |
| C3 | **Video without visible controls** — Some `<video>` elements are tiny decorative background videos. We should skip those. | Skip videos with `width < 100` or `height < 50` (check `getBoundingClientRect()`). Also skip videos with `autoplay` + `muted` + `loop` (common background video pattern). |
| C4 | **Button overlap with site's own controls** — YouTube's own controls may overlap with our button in the top-right corner. | Top-right is generally clear on most players. YouTube controls are at the bottom. If needed, position can be adjusted per-site later. |

## Acceptance Criteria

- [ ] `<video>` elements on any webpage get an expand/collapse button in the top-right corner
- [ ] Button is only visible when hovering over the video area
- [ ] Clicking expand: video fills the entire webview page, all other content hidden
- [ ] Clicking collapse (or pressing Escape): video returns to its original size and position
- [ ] Video continues playing without interruption during expand/collapse
- [ ] Only one video can be expanded at a time
- [ ] Small/decorative videos are skipped
- [ ] Works on YouTube, Twitch, and standard HTML5 `<video>` pages
- [ ] No visual artifacts or style conflicts with page CSS
