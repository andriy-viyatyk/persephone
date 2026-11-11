/**
 * Reserved paths on a board's `board://<host>` origin that the platform serves, never the board's own files.
 * This module owns their spelling, builders, parser and the dialog XHR payload shape. Dependency-free:
 * the shim (browser script), main and the renderer all import it.
 */

export const BOARD_DIALOG_PATH = "/__persephone/dialog";
const BOARD_PIPE_PAGE_PREFIX = "/__pipe/";
const BOARD_PIPE_RESOURCE_PREFIX = "/__pipe/resource/";

/** Body limit for the dialog XHR in UTF-8 bytes. The shim refuses to send more; main answers 413. */
export const BOARD_DIALOG_MAX_BYTES = 65536;

export type BoardDialogKind = "alert" | "confirm" | "prompt";

/** JSON body the shim POSTs to BOARD_DIALOG_PATH (the synchronous XHR behind alert/confirm/prompt). */
export interface BoardDialogXhrRequest {
    type: BoardDialogKind;
    message: string;
    defaultPrompt: string;
    /** `location.href` of the calling frame. */
    url: string;
    /** The frame URL's `v` query value; `null` when absent (main rejects that). */
    nonce: string | null;
    /** The frame URL's `view` query value, `"main"` for the main frame. */
    view: string;
}

/** Response body: alert -> null, confirm -> boolean, prompt -> string | null. */
export type BoardDialogXhrResult = string | boolean | null;

/** Shape check of a parsed dialog body; `null` when any field is missing or mistyped. Authorization stays in main. */
export function parseBoardDialogXhrRequest(input: unknown): (BoardDialogXhrRequest & { nonce: string }) | null {
    if (!input || typeof input !== "object") return null;
    const data = input as Record<string, unknown>;
    if (
        (data.type !== "alert" && data.type !== "confirm" && data.type !== "prompt") ||
        typeof data.message !== "string" ||
        typeof data.defaultPrompt !== "string" ||
        typeof data.url !== "string" ||
        typeof data.nonce !== "string" ||
        typeof data.view !== "string"
    ) return null;
    return data as unknown as BoardDialogXhrRequest & { nonce: string };
}

export function boardPipePagePath(pageId: string): string { return BOARD_PIPE_PAGE_PREFIX + encodeURIComponent(pageId); }
export function boardPipeResourcePath(resourceId: string): string { return BOARD_PIPE_RESOURCE_PREFIX + encodeURIComponent(resourceId); }

export type BoardOriginRoute =
    | { kind: "dialog" }
    | { kind: "pipe-page"; pageId: string }
    | { kind: "pipe-resource"; resourceId: string }
    /** A reserved `/__pipe/` path whose id is empty, contains "/" or does not decode. Answer 404. */
    | { kind: "invalid" };

/** Classifies a request pathname; `null` means "not reserved, serve the board's own file". */
export function parseBoardOriginRoute(pathname: string): BoardOriginRoute | null {
    if (pathname === BOARD_DIALOG_PATH) return { kind: "dialog" };
    if (pathname.startsWith(BOARD_PIPE_RESOURCE_PREFIX)) {
        const encodedResourceId = pathname.slice(BOARD_PIPE_RESOURCE_PREFIX.length);
        if (!encodedResourceId || encodedResourceId.includes("/")) return { kind: "invalid" };
        try {
            return { kind: "pipe-resource", resourceId: decodeURIComponent(encodedResourceId) };
        } catch {
            return { kind: "invalid" };
        }
    }
    if (pathname.startsWith(BOARD_PIPE_PAGE_PREFIX)) {
        const encodedPageId = pathname.slice(BOARD_PIPE_PAGE_PREFIX.length);
        if (!encodedPageId || encodedPageId.includes("/")) return { kind: "invalid" };
        try {
            return { kind: "pipe-page", pageId: decodeURIComponent(encodedPageId) };
        } catch {
            return { kind: "invalid" };
        }
    }
    return null;
}
