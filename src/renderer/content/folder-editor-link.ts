import { fpDirname } from "../core/utils/file-path";
import { parseBoardEditorId } from "../editors/board/custom-editor-registry";
import { encodeCategoryLink } from "./tree-providers/tree-provider-link";
import { encodeGitTreeLink } from "./git-tree-link";
import { encodeMnemeFolderLink } from "./mneme-folder-link";

export const FOLDER_EDITOR_PREFIX = "folder-editor://";

export interface FolderEditorLinkPayload {
    editorId: string;
    anchorFolder: string;
}

function isFolderEditorLinkPayload(value: unknown): value is FolderEditorLinkPayload {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const payload = value as Partial<FolderEditorLinkPayload>;
    return typeof payload.editorId === "string"
        && payload.editorId.length > 0
        && typeof payload.anchorFolder === "string"
        && payload.anchorFolder.length > 0;
}

/** Encode a generic folder-editor link with UTF-8-safe base64 JSON. */
export function encodeFolderEditorLink(
    editorId: string,
    anchorFolder: string,
): string {
    const bytes = new TextEncoder().encode(JSON.stringify({ editorId, anchorFolder }));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return FOLDER_EDITOR_PREFIX + btoa(binary);
}

/** Decode a generic folder-editor link, or return null when its payload is invalid. */
export function decodeFolderEditorLink(raw: string): FolderEditorLinkPayload | null {
    if (!raw.startsWith(FOLDER_EDITOR_PREFIX)) return null;
    try {
        const binary = atob(raw.slice(FOLDER_EDITOR_PREFIX.length));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const payload: unknown = JSON.parse(json);
        return isFolderEditorLinkPayload(payload) ? payload : null;
    } catch {
        return null;
    }
}

/** Build the existing link scheme for a resolved folder editor. */
export function folderEditorLinkFor(
    editorId: string,
    anchorFolder: string,
    sourceUrl: string,
): string {
    if (editorId === "git-tree") return encodeGitTreeLink(fpDirname(anchorFolder));
    if (editorId === "mneme-root") return encodeMnemeFolderLink(fpDirname(anchorFolder));
    if (parseBoardEditorId(editorId) !== null) {
        return encodeFolderEditorLink(editorId, anchorFolder);
    }
    return encodeCategoryLink({ type: "file", url: sourceUrl, category: anchorFolder });
}
