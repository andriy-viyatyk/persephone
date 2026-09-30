import { pagesModel } from "../../../api/pages";
import type { IBrowserAccessFlags } from "../../../editors/browser/agent-access";
import { BROWSER_AUTOMATION_MEMBERS } from "../browser-automation-members";
import type { IAiVisionDescriptor } from "ai-vision";

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

summarize() returns host identity only ({ kind: "WindowScreen" }). Because a terminal
window.screen walk ends before this descriptor's restricted() is consulted by the per-hop resolver
(node_modules/ai-vision/dist/core/resolver.js:85-87), it never exposes active-page content, title, URL, editor id,
or privacy state. screenshot() may return undefined when its CDP session is unavailable, and
unavailable object fields are omitted from call answers rather than represented by undefined or null.
As verified live by US-1335, snapshots returned no password or ordinary input value; US-1336 found
that Chromium can omit hidden loaded frame subtrees, and doc/architecture/browser-editor.md explains
that the app snapshot contains only the active page's content.`;

/**
 * The app-window boundary is stricter than the adjacent browser-page boundary. The latter uses
 * agentMayAccessBrowserPage(state) and its openedByAgent exception; this whole-window host cannot
 * use that exception because its snapshot includes the active private page.
 */
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
    return {
        kind: "WindowScreen",
        summary: "Persephone's own window accessibility and automation host.",
        members: [...BROWSER_AUTOMATION_MEMBERS],
        help: WINDOW_SCREEN_HELP,
        restricted: restrictedWindowScreen,
        summarize: () => ({ kind: "WindowScreen" }),
    };
}
