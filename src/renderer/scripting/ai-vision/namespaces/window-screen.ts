import { EditorId } from "../../../../shared/editor-ids";
import { pages } from "../../../api/pages";
import type { IBrowserAccessFlags } from "../../../editors/browser/agent-access";
import { BROWSER_AUTOMATION_MEMBERS } from "../browser-automation-members";
import type { IAiMember, IAiVisionDescriptor } from "ai-vision";
import type { IWindowScreen, IWindowRecording } from "../../../api/types/window";

const WINDOW_SCREEN_HELP = `Persephone's own application window, not a browser page. The shared
automation operations act on the complete current app-window accessibility tree, including the
active page's visible content. snapshot() returns refs that must be passed explicitly as
{ ref: "..." }; strings accept CSS, text=, role=, label=, placeholder=, testid=, title= and alt= locators.
role= uses Chromium's accessibility role/name, for example role=button[name="Save"]. Name matching
normalizes whitespace; unquoted/plain quoted values are case-insensitive substrings, "value"s is
case-sensitive exact, and /pattern/flags is regex. testid= matches data-testid exactly. text= keeps
its quoted exact and unquoted substring behavior. App navigation, browser tabs, and JavaScript
dialog policy are absent because this target has none; open and switch Persephone pages through pages and
pages.showPage(pageId). Page DOM reads can be scoped to
\`[data-name="page-slot"][data-page-id="<id>"]\`; popups, menus, and dialogs render outside the page
slot, so query them from the window root. Prefer ui.elements for a named, curated shell control and its purpose;
window.screen.snapshot() is the complete, purpose-free fallback for everything currently on screen,
including content or controls not in the curated list. Inactive page content is hidden and does not
appear. HTML-preview and trusted board iframe accessibility trees are joined to their own iframe
nodes; browser webviews and their frames are excluded. Use snapshot({ interactive: true }) or
snapshot({ root: selectorOrRef }) to narrow a large tree. \`interactive: true\` keeps interactive
nodes and their ancestors, and a page with no such nodes can produce an empty string. The app window
has no elements inventory.

Selector strings accept \`>>\` chains, CSS \`:has-text("...")\` and \`:visible\` suffixes, signed \`nth=N\`
steps, and a leading ref=e12 scope (main-frame only; ref= must be first). For example,
\`ref=e12 >> text=Save\` selects text below a ref. Locator objects accept one of role, label,
placeholder, testId, title, alt, text, or selector, with name/exact/within/hasText/visible/nth
modifiers; regex role names use \`{ regex, flags? }\`. Snapshot roots remain selector/ref-only.

Quoted text= matches exactly and case-sensitively after whitespace normalization; unquoted text=
matches a case-insensitive substring. role= candidates use Chromium accessibility facts and exclude
ignored nodes unless [include-hidden] is present; selector strings run in the main frame, while refs
may target joined frame content. Fullscreen remains CSS-only. Nested visible text matches prefer the smallest element, and nth
selects within that list. This shared locator works on browser pages and boards as well. focus(locator)
focuses without pointer input. clickAt({x,y}) and dragTo({from,to}) use trusted Persephone app-window
renderer viewport CSS pixels from the top-left. clickAt bypasses locator actionability; dragTo shares
drag() dispatch and accepts optional { steps, holdMs } timing.

click() and hover() use trusted CDP mouse input by default and retry actionability failures for up
to 5 seconds. This app-window target does not force CSS pseudo state. click() checks visibility
before moving; hoverFirst defaults to true and attempts one reveal only after a not-visible result
where CSS forcing is supported. Set hoverFirst: false to disable that automatic reveal attempt.
More than one visible selector match fails immediately; use a snapshot ref, narrow the selector,
or pass a zero-based { nth } index among visible matches. Click accepts button, clickCount,
hoverFirst, modifiers, position, force, synthetic, nth, timeout and tabId; hover accepts position,
modifiers, force, synthetic, nth, timeout and tabId. Hover sends one pointer move. Pass
{ synthetic: true } only when legacy DOM-event behavior is needed.

mouseDown(), mouseMove(), and mouseUp() keep trusted button state across calls for live inspection.
Locator targets use hover actionability; coordinate targets use app-window renderer viewport CSS pixels
from the top-left. mouseUp() and wheel() use the last tracked point when target is omitted. wheel()
passes finite CSS-pixel deltas through unchanged. Held keys and buttons on adopted ctx.usePage pages
are released by test cleanup.

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
function-expression strings; arrow strings are invoked. Locator reads are immediate and strict for
single-element operations; pass { nth } to select a zero-based match. query() captures at most 200
matches and requested text, values, attributes and refs expose page data; role/name come from Chromium
accessibility facts. Increase outer call maxLength for larger results. waitForFunction() executes
serialized caller-authored JavaScript in the app window and can mutate page state; args and results
must be JSON-safe. consoleMessages() and pageErrors() read
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
    { name: "start", kind: "method", signature: "start({ region, openPlayer?, hideStatusChrome? }) -> null", summary: "Immediately begin recording the window, active page, or main editor area; resolves to no value." },
    { name: "pause", kind: "method", signature: "pause()", summary: "Pause the current recording." },
    { name: "resume", kind: "method", signature: "resume()", summary: "Resume the current recording." },
    { name: "stop", kind: "method", signature: "stop()", summary: "Finalize the recording and return its temporary file path and media details." },
    { name: "cancel", kind: "method", signature: "cancel()", summary: "Discard the unfinished recording." },
    { name: "state", kind: "property", summary: "Read-only status, elapsed time, selected region, and latest result." },
];
const WINDOW_COORDINATE_MEMBERS: readonly IAiMember[] = [
    { name: "clickAt", kind: "method", signature: "clickAt({ x, y })", summary: "Trusted coordinate click in app-window viewport CSS pixels from the top-left; bypasses locator actionability." },
    { name: "mouseDown", kind: "method", signature: "mouseDown(target: IBrowserPointerTarget, options?: IBrowserPointerOptions)", summary: "Press left by default at an app locator or renderer viewport CSS-pixel point and retain the trusted button until mouseUp." },
    { name: "mouseMove", kind: "method", signature: "mouseMove(target: IBrowserPointerTarget, options?: IWindowScreenMouseMoveOptions)", summary: "Move with app-document locator actionability or renderer viewport coordinates while preserving held-button state." },
    { name: "mouseUp", kind: "method", signature: "mouseUp(target?: IBrowserPointerTarget, options?: IBrowserPointerOptions)", summary: "Release left by default at a target or the last tracked app-window pointer point." },
    { name: "wheel", kind: "method", signature: "wheel(delta: { deltaX: number; deltaY: number }, target?: IBrowserPointerTarget, options?: IBrowserWheelOptions)", summary: "Send trusted wheel deltas in CSS pixels at a target or last tracked app-window pointer point." },
    { name: "dragTo", kind: "method", signature: "dragTo({ from: { x, y }, to: { x, y } }, timing?: { steps?: number; holdMs?: number })", summary: "Drag between app-window viewport CSS pixel coordinates through the shared trusted drag path; steps is 1–1000 and holdMs is a 0–10000 ms pre-move hold." },
];
const recordingHelp = `Recording is video-only and captures Persephone's current window. start({ region: "window" | "page" | "editor", openPlayer?, hideStatusChrome? }) begins immediately; hideStatusChrome: true omits recording controls and the MCP indicator, restoring their prior visibility on stop, cancel, and errors. pause() and resume() control the same recording shown in the app header. stop() returns { path, durationMs, mimeType, width, height, stoppedBy }. The file stays in a temporary recordings folder for seven days unless saved or discarded; copy the returned path elsewhere to retain it. Set openPlayer: true to open the built-in player; closing that player page without Save as… deletes the file. A user stop remains retrievable by a later stop() call until another recording starts.`;

function restrictedWindowScreen(): string | undefined {
    const visiblePages = pages.state.get().pages.filter(
        (page) => pages.query.isPageVisible(page.id),
    );
    for (const page of visiblePages) {
        const editor = page.mainEditor;
        if (!editor || editor.editorId !== EditorId.browserView) continue;

        const state = editor.state.get() as IBrowserAccessFlags;
        const mode = state.isTor ? "Tor" : state.isIncognito ? "incognito" : undefined;
        if (mode) {
            return `Persephone's own window cannot be automated while a visible page is in ${mode} mode. `
                + "Whole-window snapshots and actions would expose that private page. Hide the private "
                + "page, including any open popover, then retry.";
        }
    }
    return undefined;
}

export function describeWindowScreen(_instance: unknown): IAiVisionDescriptor {
    const instance = _instance as IWindowScreen;
    return {
        kind: "WindowScreen",
        summary: "Persephone's own window accessibility and automation host.",
        members: [...BROWSER_AUTOMATION_MEMBERS, ...WINDOW_COORDINATE_MEMBERS, { name: "recording", kind: "property", summary: "Shared window, page, or editor recording controls.", node: true }],
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
