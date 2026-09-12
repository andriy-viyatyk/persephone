/**
 * `persephone.openContent(...)` orchestration (EPIC-100 / US-1404) — the renderer-side entry point
 * `BoardWebview` calls for a board's `board:openContent` request.
 *
 * This is the board equivalent of `pagesModel.addEditorPage(editor, language, title, content)`: the
 * five Force Graph features that create an in-memory page in ANOTHER editor (Open as markdown, Open
 * in grid, Extract, Extract with children, Open in Drawing) have no board-side expression otherwise,
 * because `openRawLink` opens a *href* and would need a `data:` URL that cannot carry a large graph.
 *
 * ── Scope, deliberately narrow ────────────────────────────────────────────────
 * `persephone.call` is rooted at the page HOSTING the board, and this addition does not widen that.
 * `openContent` is a CREATE-ONLY constructor:
 *   • it returns the id of a page the board itself just created — never a handle to an existing one;
 *   • it cannot read, enumerate, navigate, close, or mutate any page (there is no counterpart verb);
 *   • the created page lives in the board's OWN window (this module runs in that renderer);
 *   • the caller is re-checked for trust by `BoardWebview` on every request, so an untrust blocks an
 *     already-mounted board;
 *   • a `board-editor:<root>` id is rejected outright, so a board cannot conjure another board.
 * Every other validation is `addEditorPage`'s own (unknown editor id, unknown language, standalone
 * editor), whose messages are forwarded to the board verbatim — a board author debugging a typo sees
 * the same text a script author would.
 */
import { pagesModel } from "../../api/pages";
import { errMessage } from "../../../shared/utils";
import type { BoardOpenContentRequest } from "../../../ipc/board-bridge-channels";
import type { EditorView } from "../../../shared/types";
import { BOARD_EDITOR_ID_PREFIX } from "./custom-editor-registry";

export interface BoardOpenContentReply {
    /** Id of the created page. */
    pageId?: string;
    /** Set instead of `pageId` when the request was rejected. */
    error?: string;
}

/** Upper bound on the content a board may push through one `openContent` call, in characters.
 *  Generous enough for any realistic extracted subgraph, bounded so a runaway board cannot post
 *  an unbounded string across the frame boundary. */
const MAX_OPEN_CONTENT_CHARS = 16 * 1024 * 1024;

/** Upper bound on the page title. A title is a tab label, not a file name. */
const MAX_TITLE_CHARS = 200;

/** Default language when the board does not name one — same floor as an untitled page. */
const DEFAULT_LANGUAGE = "plaintext";

/**
 * Validate a board's `openContent` request and create the page. Never throws: every rejection comes
 * back as `{ error }` so the shim can reject the board's promise with a readable message.
 */
export function resolveBoardOpenContent(
    request: BoardOpenContentRequest | undefined,
): BoardOpenContentReply {
    if (!request || typeof request !== "object") {
        return { error: 'openContent() expects an options object, e.g. { editor: "md-view" }.' };
    }

    const editor = typeof request.editor === "string" ? request.editor.trim() : "";
    if (!editor) {
        return { error: 'openContent() requires an "editor" id, e.g. { editor: "md-view" }.' };
    }
    if (editor.startsWith(BOARD_EDITOR_ID_PREFIX)) {
        return { error: "openContent() cannot open another board — pass a built-in editor id." };
    }

    if (request.content !== undefined && typeof request.content !== "string") {
        return { error: 'openContent() "content" must be a string.' };
    }
    const content = request.content ?? "";
    if (content.length > MAX_OPEN_CONTENT_CHARS) {
        return {
            error: `openContent() content is too large (${content.length} characters, limit `
                + `${MAX_OPEN_CONTENT_CHARS}). Write it to a file and use openRawLink() instead.`,
        };
    }

    const language = typeof request.language === "string" && request.language.trim()
        ? request.language.trim()
        : DEFAULT_LANGUAGE;

    const rawTitle = typeof request.title === "string" ? request.title.trim() : "";
    const title = (rawTitle || "untitled").slice(0, MAX_TITLE_CHARS);

    try {
        const page = pagesModel.addEditorPage(editor as EditorView, language, title, content);
        return { pageId: page.id };
    } catch (error) {
        return { error: errMessage(error, "openContent() failed.") };
    }
}
