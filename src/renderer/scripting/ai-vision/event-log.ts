import { EventLog } from "ai-vision";

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
        origin: "board",
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

/** Reserved seam for the later board notify producer. */
export function logRemoteNotify(text: string, path?: string): void {
    const singleLineText = text.replace(/\s+/g, " ").trim();
    eventLog.push({
        kind: "remote-notify",
        ...(path ? { path } : {}),
        text: singleLineText,
        origin: "board",
    });
}

/** Reserved seam for the later guided-overlay button producer. */
export function logGuideButton(elementName: string, button: string, path?: string): void {
    eventLog.push({
        kind: "guide-button",
        ...(path ? { path } : {}),
        text: `The user pressed ${JSON.stringify(button)} on the guided step for ${JSON.stringify(elementName)}.`,
    });
}
