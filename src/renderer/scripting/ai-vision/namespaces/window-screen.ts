import { pagesModel } from "../../../api/pages";
import type { IBrowserAccessFlags } from "../../../editors/browser/agent-access";
import { BROWSER_AUTOMATION_MEMBERS } from "../browser-automation-members";
import type { IAiMember, IAiVisionDescriptor } from "ai-vision";
import type { IWindowScreen, IWindowRecording } from "../../../api/types/window";

const WINDOW_SCREEN_HELP = `Persephone's own application window, not a browser page. The shared
automation operations act on the complete current app-window accessibility tree, including the
active page's visible content. snapshot() returns refs that must be passed explicitly as
{ ref: "..." }; plain strings are always CSS selectors. App navigation, browser tabs, and JavaScript
dialog policy are absent because this target has none; open and switch Persephone pages through pages and
pages.showPage(pageId). Prefer ui.elements for a named, curated shell control and its purpose;
window.screen.snapshot() is the complete, purpose-free fallback for everything currently on screen,
including content or controls not in the curated list. Inactive page content is hidden and does not
appear. HTML-preview and trusted board iframe accessibility trees are joined to their own iframe
nodes; browser webviews and their frames are excluded. Use snapshot({ interactive: true }) or
snapshot({ root: selectorOrRef }) to narrow a large tree. The app window has no elements inventory.

click() and hover() use trusted CDP mouse input by default and retry actionability failures for up
to 5 seconds. More than one visible selector match fails immediately; use a snapshot ref, narrow
the selector, or pass a zero-based { nth } index among visible matches. Click accepts button,
clickCount, modifiers, position, force, synthetic, nth, timeout and tabId; hover accepts position,
modifiers, force, synthetic, nth, timeout and tabId. Hover sends one pointer move. Pass
{ synthetic: true } only when legacy DOM-event behavior is needed.

Keyboard, fill, check, uncheck and clear use trusted CDP input by default. type() clears editable
content before inserting; slowly sends mapped key events and submit presses Enter. select() is a
programmatic native-select operation with untrusted input/change events and currently also performs
pointer actionability/hit-testing; custom dropdowns use
trusted click() + pressKey(). keyDown()/keyUp() keep modifier state across calls. Ctrl+C/V use the
real OS clipboard; Persephone does not save or restore clipboard contents.

drag() replays intercepted HTML5 drag data; source and target must be in the same frame. fillForm()
applies named type/select/check/uncheck fields in order and names the first failing field.
setInputFiles() assigns existing local files directly to hidden or visible file inputs and does not
intercept a native chooser. screenshot() supports element targets and PNG/JPEG; cross-origin frame
refs and fullPage are unsupported on this host. evaluate() accepts JSON-safe args for functions and
function-expression strings; arrow strings are invoked. consoleMessages() and pageErrors() read
Persephone's renderer records; this target has no page JavaScript dialog policy.

recording.start({ region, openPlayer? }) immediately records the current Persephone window, active
page, or main editor area. Agent recordings stay closed by default; stop() returns the temporary
file path and media details, and the agent must copy the path elsewhere to retain the result.
summarize() returns only { kind: "WindowScreen" }; it never exposes the active page's content,
title, URL, editor id, or privacy state. screenshot() may return undefined when its CDP session is
unavailable. Unavailable fields are omitted rather than returned as null. Snapshots never include
password or input values, may omit hidden frame subtrees, and cover only the active page.`;

/**
 * The app-window boundary is stricter than the adjacent browser-page boundary. The latter uses
 * agentMayAccessBrowserPage(state) and its openedByAgent exception; this whole-window host cannot
 * use that exception because its snapshot includes the active private page.
 */
const recordingMembers: readonly IAiMember[] = [
    { name: "start", kind: "method", signature: "start({ region, openPlayer? })", summary: "Immediately begin recording the window, active page, or main editor area." },
    { name: "pause", kind: "method", signature: "pause()", summary: "Pause the current recording." },
    { name: "resume", kind: "method", signature: "resume()", summary: "Resume the current recording." },
    { name: "stop", kind: "method", signature: "stop()", summary: "Finalize the recording and return its temporary file path and media details." },
    { name: "cancel", kind: "method", signature: "cancel()", summary: "Discard the unfinished recording." },
    { name: "state", kind: "property", summary: "Read-only status, elapsed time, selected region, and latest result." },
];
const recordingHelp = `Recording is video-only and captures Persephone's current window. start({ region: "window" | "page" | "editor", openPlayer? }) begins immediately; pause() and resume() control the same recording shown in the app header. stop() returns { path, durationMs, mimeType, width, height, stoppedBy }. The file stays in a temporary recordings folder for seven days unless saved or discarded; copy the returned path elsewhere to retain it. Set openPlayer: true to open the built-in player; closing that player page without Save as… deletes the file. A user stop remains retrievable by a later stop() call until another recording starts.`;

function restrictedWindowScreen(): string | undefined {
    const activeEditor = pagesModel.activePage?.mainEditorInstance;
    if (!activeEditor || activeEditor.editorId !== "browser-view") return undefined;

    const state = activeEditor.state.get() as IBrowserAccessFlags;
    const mode = state.isTor ? "Tor" : state.isIncognito ? "incognito" : undefined;
    if (!mode) return undefined;
    return `Persephone's own window cannot be automated while its active page is in ${mode} mode. `
        + "Whole-window snapshots and actions would expose that private page. Activate a non-private "
        + "page with pages.showPage(pageId), then retry.";
}

export function describeWindowScreen(_instance: unknown): IAiVisionDescriptor {
    const instance = _instance as IWindowScreen;
    return {
        kind: "WindowScreen",
        summary: "Persephone's own window accessibility and automation host.",
        members: [...BROWSER_AUTOMATION_MEMBERS, { name: "recording", kind: "property", summary: "Shared window, page, or editor recording controls.", node: true }],
        provide: (name) => name === "recording" ? { value: instance.recording } : undefined,
        help: WINDOW_SCREEN_HELP,
        restricted: restrictedWindowScreen,
        summarize: () => ({ kind: "WindowScreen" }),
    };
}

export function describeWindowRecording(instance: unknown): IAiVisionDescriptor {
    const recording = instance as IWindowRecording;
    return {
        kind: "WindowRecording",
        summary: "Shared per-window recording controls and state.",
        members: recordingMembers,
        help: recordingHelp,
        summarize: () => ({ kind: "WindowRecording", status: recording.state.status, elapsedMs: recording.state.elapsedMs }),
    };
}
