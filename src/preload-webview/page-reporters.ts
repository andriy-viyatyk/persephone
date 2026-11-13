import { BrowserGuestMessageChannel, sendToHost } from "../ipc/browser-guest-messages";
import { exitCinemaFromEscape } from "./cinema-mode";

export function installPageReporters(): void {
    const { ipcRenderer } = require("electron");
function getFavicon(): string {
    const links = document.querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"], link[rel="shortcut icon"], link[rel*="icon"]',
    );
    // Prefer the last matching link (sites often append the best one last)
    for (let i = links.length - 1; i >= 0; i--) {
        if (links[i].href) return links[i].href;
    }
    return "";
}

function getTitle(): string {
    return document.title || "";
}

// ── Reporters ────────────────────────────────────────────────────────

let lastTitle = "";
let lastFavicon = "";

function reportTitle() {
    const title = getTitle();
    if (title !== lastTitle) {
        lastTitle = title;
        sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.pageTitle, payload: title });
    }
}

function reportFavicon() {
    const favicon = getFavicon();
    if (favicon !== lastFavicon) {
        lastFavicon = favicon;
        sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.pageFavicon, payload: favicon });
    }
}

function reportAll() {
    reportTitle();
    reportFavicon();
}

// ── MutationObserver ─────────────────────────────────────────────────

function observeHead() {
    const head = document.head;
    if (!head) return;

    const observer = new MutationObserver(() => {
        reportAll();
    });

    // Watch <head> for added/removed children (new <link> or <title> tags)
    // and attribute changes on existing elements (href changes on <link>)
    observer.observe(head, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "rel"],
        characterData: true,
    });
}

// ── Overlay Dismissal ──────────────────────────────────
// A press in here fires no `pointerdown` in the host document, so a host menu or popover
// never sees an outside click and stays open over the page. Report every press so the host
// can dismiss them. The guest covers nearly the whole page, so without this there is barely
// anywhere left to click to close a menu.
//
// Unlike Ctrl+F above, this needs no deferral and ignores `defaultPrevented`: whether the
// page handles its own press is irrelevant, because a press anywhere in the guest is
// unambiguously outside every host overlay. Capture phase so a page calling
// `stopPropagation()` cannot suppress the report.
document.addEventListener("pointerdown", () => {
    sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.pointerDown });
}, true);

// ── Keyboard Shortcuts ───────────────────────────────────────────────
// Intercept shortcuts that should be handled by the host renderer (find bar).

// Ctrl+F belongs to the PAGE first and to Persephone only if the page passes
// — the rule Chrome and Edge follow. A page running its own find UI
// calls `preventDefault()`; a page that ignores the key leaves it unclaimed and
// expects the browser's find bar. The earlier version prevented and
// `stopImmediatePropagation()`'d in the capture phase, deliberately beating
// page scripts, so a page could never claim it.
//
// The choice cannot be made synchronously in this listener. This preload runs
// at document-start, so on any node and phase its listener is registered FIRST
// and so runs FIRST: a page handler on `document` — the common shape — has not
// executed yet and `defaultPrevented` is still false. Moving to the bubble
// phase would not help, since registration order decides among listeners on the
// same node. Reading the flag from a later TASK lets the entire propagation
// finish first, which is independent of both node and registration order.
//
// It must be a task (`setTimeout`), not a microtask. For a real, browser-
// dispatched event the JS stack is empty between listeners, so a microtask
// checkpoint runs after EACH listener — a `queueMicrotask` here fires before
// the page's handler and still sees `defaultPrevented === false`. Only a
// script-driven `dispatchEvent()` defers microtasks past the whole dispatch,
// which is why a synthetic test passes where a real keypress fails.
//
// Leaving the default action alone is free: the guest has no native find UI, so
// an unclaimed Ctrl+F does nothing until the host opens the find bar below.
//
// Subframe preloads are enabled by browser-service.ts; find-bar handling remains
// main-frame-only because this listener is inside the process.isMainFrame guard.
document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "f") {
        setTimeout(() => {
            if (e.defaultPrevented) return;
            sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.showFindBar });
        }, 0);
    } else if (e.key === "Escape") {
        // Cinema mode is Persephone's own overlay, so it takes the key outright.
        if (exitCinemaFromEscape()) return;
        // Otherwise the same page-first rule as Ctrl+F: a page that closes its
        // own popover on Escape calls `preventDefault()`; an unclaimed Escape
        // gets the browser meaning — stop loading, close the find bar.
        setTimeout(() => {
            if (e.defaultPrevented) return;
            window.stop();
            sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.hideFindBar });
        }, 0);
    }
}, true);

// ── Clicked Image Tracking (Phase 3.1) ──────────────────────────────
// When the user clicks an <a> that contains images (e.g. a video tile),
// send ALL image URLs to the host so they can be offered for bookmark selection.

document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    // Only track clicks that will navigate (inside an <a> with href)
    const link = target.closest("a") as HTMLAnchorElement | null;
    if (!link || !link.href) return;

    // Collect ALL images inside the link (thumbnails, overlays, icons, etc.)
    const imgs = link.querySelectorAll("img");
    const urls: string[] = [];
    const seen = new Set<string>();
    imgs.forEach((img) => {
        if (img.src && !seen.has(img.src)) {
            seen.add(img.src);
            urls.push(img.src);
        }
    });

    if (urls.length > 0) {
        sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.clickedImages, payload: urls });
    }
}, true); // Capture phase: fires before page scripts that may stopPropagation

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        reportAll();
        observeHead();
    });
} else {
    reportAll();
    observeHead();
}

// Some sites set favicon/title via JS after the load event.
// Retry shortly after load to catch those.
window.addEventListener("load", () => {
    setTimeout(reportAll, 200);
    setTimeout(reportAll, 1000);
});}
