import { EventLog } from "ai-vision";
import type { IAiEvent } from "ai-vision";

/** The event history shared by all AiVision calls in this renderer window. */
export const eventLog = new EventLog({ cap: 200, hostOrigin: "persephone" });

function pagePath(pageId: string, suffix: string): string {
    return `pages[${JSON.stringify(pageId)}]${suffix}`;
}

/** Record a board remote publishing a changed object-model shape. */
export function logShapeChanged(pageId: string): void {
    const path = pagePath(pageId, ".editor.app");
    eventLog.push({
        kind: "shape-changed",
        path,
        text: `The board shape changed; re-read ${path}.`,
    });
}

/** Record a browser page publishing a changed object-model shape. */
export function logBrowserShapeChanged(pageId: string): void {
    const path = pagePath(pageId, ".editor.app");
    eventLog.push({
        kind: "shape-changed",
        path,
        text: `The browser page's shape changed; re-read ${path}.`,
    });
}

/** Record a board frame re-registering after a host-triggered reload. */
export function logBoardReloaded(pageId: string): void {
    const path = pagePath(pageId, ".editor.app");
    eventLog.push({
        kind: "board-reloaded",
        path,
        text: `The board reloaded; re-read ${path}.`,
    });
}

/** Record navigation in a browser page whose tab has been used by an agent. */
export function logBrowserNavigated(pageId: string): void {
    const path = pagePath(pageId, ".editor");
    eventLog.push({
        kind: "navigated",
        path,
        text: `The browser page navigated; re-read ${path}.`,
    });
}

/**
 * Record the active page changing under an agent that was working with one of the two.
 *
 * Deliberately does NOT say the user did it. Switches the agent itself asks for are suppressed
 * where they are synchronous, but an agent that OPENS a page activates it asynchronously, past
 * the suppression flag — so attributing the change to the user would be wrong a good share of the
 * time. What the agent needs is the consequence, not the culprit.
 */
export function logPageActivated(previousPageId: string, activePageId: string): void {
    const previous = pagePath(previousPageId, "");
    eventLog.push({
        kind: "page-activated",
        path: previous,
        // "hidden" rather than "no longer active" is exact: the one case where a non-active page
        // keeps rendering — the other half of a side-by-side group — is filtered out before this
        // is called, so anything reported here really has lost its layout box.
        text: `The active page is now ${pagePath(activePageId, "")}; ${previous} is hidden, so its `
            + "elements report not visible and window.screen.snapshot() shows the active page. "
            + `Re-activate it with pages.showPage(${JSON.stringify(previousPageId)}) before `
            + "geometry-dependent reads.",
    });
}

/** Record a native renderer dialog reaching its resolution callback. */
export function logDialogAnswered(): void {
    eventLog.push({
        kind: "dialog-answered",
        text: "The user answered a dialog.",
    });
}

/** Record a safe Log View dialog answer without its input or selection values. */
export function logLogViewDialogAnswered(
    pageId: string | undefined,
    dialogId: string,
    button: string,
): void {
    const path = pageId ? pagePath(pageId, ".editor") : undefined;
    const target = path ? `; re-read ${path}` : "";
    eventLog.push({
        kind: "dialog-answered",
        ...(path ? { path } : {}),
        text: `The user answered Log View dialog ${JSON.stringify(dialogId)} with ${JSON.stringify(button)}${target}.`,
    });
}

/**
 * The only event producer that stamps remote-authored prose with a board/page origin.
 * Shape and navigation text is host-authored and keeps EventLog's default origin.
 */
export function logRemoteNotify(text: string, path?: string, origin: "board" | "page" = "board"): void {
    const singleLineText = text.replace(/\s+/g, " ").trim();
    eventLog.push({
        kind: "remote-notify",
        ...(path ? { path } : {}),
        text: singleLineText,
        origin,
    });
}

export interface GuideButtonSignal {
    readonly stepId: string;
    readonly target: string;
    readonly button: string;
    readonly event: IAiEvent;
}

const guideButtonListeners = new Set<(signal: GuideButtonSignal) => void>();

export function subscribeGuideButton(listener: (signal: GuideButtonSignal) => void): () => void {
    guideButtonListeners.add(listener);
    return () => guideButtonListeners.delete(listener);
}

/** Record a guided-overlay button press and publish its renderer-local correlation signal. */
export function logGuideButton(
    target: string,
    button: string,
    stepId: string,
    path?: string,
): void {
    const event = eventLog.push({
        kind: "guide-button",
        ...(path ? { path } : {}),
        text: `The user pressed ${JSON.stringify(button)} on the guided step for ${JSON.stringify(target)}.`,
    });
    const signal: GuideButtonSignal = { stepId, target, button, event };
    for (const listener of guideButtonListeners) {
        try {
            listener(signal);
        } catch {
            // A local waiter cannot prevent the event from reaching other waiters.
        }
    }
}
