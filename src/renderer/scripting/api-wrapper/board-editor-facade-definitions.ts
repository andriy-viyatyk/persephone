import type { IAiElementDeclaration, IAiMember } from "ai-vision";
import { BOARD_EDITOR_ID_PREFIX } from "../../../shared/board/board-editor-id";

export const BOARD_ELEMENTS: readonly IAiElementDeclaration[] = [
    {
        name: "board-toolbar-explorer",
        purpose: "Locate the toolbar control that toggles the board's Explorer navigator.",
        where: "left edge of the board toolbar",
    },
    {
        name: "board-toolbar-more",
        purpose: "Locate the … control whose menu holds Reload board, Open board log, and Board properties; "
            + "those three items are menu entries, not toolbar controls, so they have no element names "
            + "of their own. The facade action for reload is reload().",
        where: "right side of the board toolbar, before the editor switch",
    },
    {
        name: "board-trust",
        purpose: "Locate the Trust board action in the untrusted placeholder.",
        where: "center of the untrusted board placeholder, when the board is untrusted",
    },
];

function property(name: string, summary: string): IAiMember {
    return { name, kind: "property", summary };
}

function method(name: string, signature: string, summary: string, caution?: string): IAiMember {
    return {
        name,
        kind: "method",
        signature,
        summary,
        ...(caution ? { caution } : {}),
    };
}

export const BOARD_MEMBERS: readonly IAiMember[] = [
    property("boardRoot", "The board root path, or undefined before a board root is attached."),
    property("folderPath", "The absolute folder claimed by this board, or undefined for plain/file-only boards."),
    property("boardName", "The resolved board folder name, or undefined when the board is not found."),
    property(
        "renderState",
        "Model-backed trusted, bundled, untrusted, or not-found state. A bundled board "
            + "ships with the app and is permitted without being user-trusted.",
    ),
    method(
        "getManifest",
        "getManifest(): Promise<IBoardManifest | undefined>",
        "Read a copied board manifest snapshot, or undefined when it is absent or malformed.",
    ),
    property(
        "secondaryViews",
        "Copied declared board-secondary panel records, or undefined when the board is unresolved.",
    ),
    property("statusText", "The model-backed board status text, or undefined when cleared or unresolved."),
    property("busy", "The model-backed busy flag, or undefined when the board is unresolved."),
    property("working", "The transient visual activity flag, or undefined when the board is unresolved."),
    property("frameReady", "Whether the mounted main board frame is registered and ready."),
    property("contentHostError", "The trusted content-host restore error, when present."),
    method(
        "reload",
        "reload(): Promise<IBoardReloadResult>",
        "Reload the board and report whether its main frame became ready.",
        "unsaved changes prompt the user",
    ),
    method(
        "dialogs",
        "dialogs(options?: { tabId?: string }): Promise<{ dialogs: object[] }>",
        "Read board dialog requests without accessing the blocked frame; dialogs are also "
            + "visible in window.screen.snapshot().",
    ),
    method(
        "handleDialog",
        "handleDialog(accept: boolean, promptText?: string, options?: { tabId?: string }): Promise<void>",
        "Accept or dismiss the pending JavaScript dialog in the selected board frame.",
    ),
];

export const BOARD_AUTOMATION_TAB_MEMBERS: readonly IAiMember[] = [
    method("clickAt", "clickAt(position: { x: number; y: number }, options?: { tabId?: string }): Promise<void>", "Trusted click at selected board-frame viewport CSS pixels from the top-left; points beyond the viewport are left to Chromium to clip."),
    method("mouseDown", "mouseDown(target: IBrowserPointerTarget, options?: IBrowserPointerOptions): Promise<void>", "Press left by default at an actionable locator or selected board-frame viewport CSS-pixel point; the trusted button stays held until mouseUp."),
    method("mouseMove", "mouseMove(target: IBrowserPointerTarget, options?: IBrowserMouseMoveOptions): Promise<void>", "Move to an actionable locator or viewport point while preserving the complete held-button bitmask; steps defaults to one and is capped at 1000."),
    method("mouseUp", "mouseUp(target?: IBrowserPointerTarget, options?: IBrowserPointerOptions): Promise<void>", "Release left by default at target or the last tracked point; the selected button must be held."),
    method("wheel", "wheel(delta: { deltaX: number; deltaY: number }, target?: IBrowserPointerTarget, options?: IBrowserWheelOptions): Promise<void>", "Send trusted wheel deltas unchanged in CSS pixels at target or the last tracked pointer point."),
    method("dragTo", "dragTo({ from: { x: number; y: number }, to: { x: number; y: number } }, options?: { tabId?: string; steps?: number; holdMs?: number }): Promise<void>", "Trusted drag between selected board-frame viewport CSS pixels, with optional move count and pre-move hold."),
    property("tabs", "List the board's main frame and declared secondary-view frames."),
    property("activeTab", "The selected board frame, or undefined when no frame is active."),
    method(
        "switchTab",
        "switchTab(tabId: string): Promise<void>",
        "Select the main frame or a declared board-secondary:<viewId> frame and wait until it is attachable.",
    ),
];

export const APP_MEMBER: IAiMember = {
    name: "app",
    kind: "property",
    node: true,
    summary: "The trusted board-owned remote object model exposed through AiVision.",
};

export const BOARD_HELP = `Access via pages[i].editor after narrowing editor.id to "board-view" or
"${BOARD_EDITOR_ID_PREFIX}<root>". This facade describes board chrome, trust state, manifest metadata, reload,
statusText, busy state, and declared secondary panels. It does not accept or return a trust decision:
untrusted content remains restricted until the user answers the Trust-this-Board dialog, shown as
"Trust this board?". The live dialog is dialogs[0]; its implementation is
src/renderer/api/dialogs/TrustBoardDialog.ts and its scripting adapter is
src/renderer/scripting/ai-vision/dialogs/trust-board.ts. restricted() returns text only while
renderState is "untrusted"; trusted and not-found boards are unrestricted, and not-found means an
unavailable or empty board rather than a privacy boundary.

getManifest() returns copied known metadata and never exposes the parsed manifest object.
secondaryViews contains copied board-secondary:* declarations and current expansion state; sidebar
expansion and closure belong to page.panels. statusText, busy, renderState, contentHostError, and
frameReady are model-backed and never read from the footer or board iframe. reload() uses the shared
model waiter and returns frameReady: false when a trusted frame times out or is disposed; untrusted
and not-found boards return immediately with frameReady: false.

When a trusted board registers an AiVision shape, app is its board-owned remote tree; use app.$help or\
helpSearch to discover it.

Board content is rendered in a cross-origin iframe, and the shared automation members reach that
content. Use snapshot() for the iframe's complete accessibility content and pass its returned refs
as { ref: "..." }; selector strings run in the selected board frame's main frame, while snapshot
refs may target joined cross-frame content. Strings accept CSS, text=, role=, label=, placeholder=,
testid=, title= and alt=; role= uses Chromium accessibility role/name, for example
role=button[name="Save"]. Role name matching normalizes whitespace; unquoted/plain quoted values
are case-insensitive substrings, "value"s is case-sensitive exact, and /pattern/flags is regex.
Role state filters support checked, disabled, expanded, level, pressed, and selected; ignored AX nodes
are excluded unless [include-hidden] is specified. testid= matches data-testid exactly. Quoted text=
remains exact after whitespace normalization and unquoted text= is a case-insensitive substring.
Selector strings also support \`>>\` chaining, CSS \`:has-text("...")\` and \`:visible\` suffixes,
signed nth=N steps, and a leading ref=e12 main-frame scope; for example
\`ref=e12 >> text=Save\`. A ref= step must be first. Direct { ref } retains iframe refs. Object
locators accept exactly one of role, label, placeholder, testId, title, alt, text, selector, with
name/exact/within/hasText/visible/nth modifiers and JSON-safe \`{ regex, flags? }\` role names.
Selector nth= selects from the raw ordered union; action option { nth } selects after final visibility
filtering. Snapshot roots and wait selector APIs remain selector/ref-only. Fullscreen remains CSS-only.
The board page's own chrome--toolbar
controls, the Trust-this-Board prompt, and secondary-view controls--is what elements names and
highlight points at, not iframe content. Everything rendered inside the iframe is reachable only
through snapshot() and its returned refs and never appears in elements; a board control absent from
a snapshot belongs in elements, while iframe content absent from elements belongs in snapshot().

tabs contains the main frame and declared board-secondary:<viewId> frames. Call switchTab(tabId)
before driving a secondary view and wait for it to complete. Navigation and creating or closing
tabs are not supported and are absent from this member list. Untrusted content remains restricted
by the existing Trust-this-Board gate; trusted and not-found render states differ, and not-found
is not a privacy grant. screenshot() returns the existing metadata-plus-image call result when
available. As verified live by US-1335, snapshots contain no password or plain-text input values;
evaluate() and existing value reads remain capable of exposing page data.

clickAt() and dragTo() use trusted coordinates in the selected board frame's viewport CSS pixels;
mouseDown(), mouseMove(), and mouseUp() keep trusted button state across calls so page state can be
inspected before release. Locator targets share hover actionability; coordinate targets use the
selected frame's viewport CSS pixels. wheel() passes finite deltas through in CSS pixels and uses
the last tracked pointer point when target is omitted. Adopted ctx.usePage pages release held input
at test cleanup; retiring frames also discard their input state.
they do not use host-window or board offsets. click() and hover() use trusted CDP mouse input by default and retry actionability failures for up
to 5 seconds. Hover also forces CSS :hover on the target and composed ancestors until the next
pointer action. click() checks visibility before moving; hoverFirst defaults to true and attempts
one reveal only after a not-visible actionability result. Set hoverFirst: false to disable it.
Actionable targets scroll within nested containers before hit testing; if the chosen
point remains clipped, the timeout names the nearest inspectable clipping container. More than one
visible selector match fails immediately; use a snapshot ref, narrow
the selector, or pass a zero-based { nth } index among visible matches. Click accepts button,
clickCount, hoverFirst, checkClick, modifiers, position, force, synthetic, nth, timeout and tabId. Left clicks check for a dispatched click by default; pass { checkClick: false } for pages that act on press. Hover accepts position,
modifiers, force, synthetic, nth, timeout and tabId. Hover sends one pointer move. Pass
{ synthetic: true } for board code that needs legacy DOM-event behavior.

Keyboard, fill, check, uncheck and clear use trusted CDP input by default. type() clears editable
content before inserting; slowly sends mapped key events and submit presses Enter. select() is a
programmatic native-select operation with untrusted input/change events; custom dropdowns use
trusted click() + pressKey(). Targeted key calls click by default; { focus: "focus" } focuses without
pointer input. keyDown()/keyUp() keep modifier state across calls. Ctrl+C/V use the
real OS clipboard; Persephone does not save or restore clipboard contents.

drag() replays intercepted HTML5 drag data, and source and target must resolve in the same frame.
Use { by: { x, y } } for a relative endpoint, or targetPosition for an outside-box destination
after its in-box anchor is actionable. steps defaults to 4 (maximum 1000); holdMs is a pre-move
hold up to 10000 ms.
fillForm() applies named type/select/check/uncheck fields sequentially and reports the first failing
field. setInputFiles() assigns existing local files directly to hidden or visible file inputs; it
does not open or intercept the native chooser. screenshot() supports element targets and PNG/JPEG;
cross-origin frame refs are unsupported, and fullPage is unsupported for boards. evaluate() accepts
JSON-safe args for functions and function-expression strings; arrow strings are invoked. count(),
isVisible(), isEnabled(), isChecked(), innerText(), allInnerTexts(), boundingBox() and query() read
the selected board frame. query() exposes requested page text, values, attributes and refs; values can
contain sensitive page data, and role/name come from Chromium accessibility facts. It captures at most
200 matches; increase outer call maxLength for larger requested fields. Reads are immediate and strict
where a single element is required; pass { nth } to select one. waitForFunction() executes serialized
caller-authored code in the board page and can mutate it; results and args must be JSON-safe.`;
