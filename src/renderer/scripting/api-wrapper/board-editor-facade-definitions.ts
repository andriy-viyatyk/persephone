import type { IAiElementDeclaration, IAiMember } from "ai-vision";

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
    property("id", "The concrete board editor id: board-view or board-editor:<root>."),
    property("name", "The board editor's registry display name."),
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
"board-editor:<root>". This facade describes board chrome, trust state, manifest metadata, reload,
statusText, busy state, and declared secondary panels. It does not accept or return a trust decision:
untrusted content remains restricted until the user answers the Trust-this-Board dialog, shown as
"Trust this board?". The live dialog is dialogs[0]; its implementation is
src/renderer/ui/dialogs/TrustBoardDialog.ts and its scripting adapter is
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
as { ref: "..." }; plain strings are CSS selectors or text= locators. Quoted text matches exactly
and case-sensitively after whitespace normalization; unquoted text matches a case-insensitive
substring. Nested visible matches prefer the smallest element, and nth selects within those matches.
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

click() and hover() use trusted CDP mouse input by default and retry actionability failures for up
to 5 seconds. More than one visible selector match fails immediately; use a snapshot ref, narrow
the selector, or pass a zero-based { nth } index among visible matches. Click accepts button,
clickCount, modifiers, position, force, synthetic, nth, timeout and tabId; hover accepts position,
modifiers, force, synthetic, nth, timeout and tabId. Hover sends one pointer move. Pass
{ synthetic: true } for board code that needs legacy DOM-event behavior.

Keyboard, fill, check, uncheck and clear use trusted CDP input by default. type() clears editable
content before inserting; slowly sends mapped key events and submit presses Enter. select() is a
programmatic native-select operation with untrusted input/change events; custom dropdowns use
trusted click() + pressKey(). keyDown()/keyUp() keep modifier state across calls. Ctrl+C/V use the
real OS clipboard; Persephone does not save or restore clipboard contents.

drag() replays intercepted HTML5 drag data, and source and target must resolve in the same frame.
fillForm() applies named type/select/check/uncheck fields sequentially and reports the first failing
field. setInputFiles() assigns existing local files directly to hidden or visible file inputs; it
does not open or intercept the native chooser. screenshot() supports element targets and PNG/JPEG;
cross-origin frame refs are unsupported, and fullPage is unsupported for boards. evaluate() accepts
JSON-safe args for functions and function-expression strings; arrow strings are invoked.`;
