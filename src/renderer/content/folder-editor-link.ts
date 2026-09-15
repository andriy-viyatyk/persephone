import { fpDirname } from "../core/utils/file-path";
import { encodeCategoryLink } from "./tree-providers/tree-provider-link";
import { encodeGitTreeLink } from "./git-tree-link";
import { encodeMnemeFolderLink } from "./mneme-folder-link";

/** Build the existing link scheme for a resolved folder editor. */
export function folderEditorLinkFor(
    editorId: string,
    anchorFolder: string,
    sourceUrl: string,
): string {
    if (editorId === "git-tree") return encodeGitTreeLink(fpDirname(anchorFolder));
    if (editorId === "mneme-root") return encodeMnemeFolderLink(fpDirname(anchorFolder));
    return encodeCategoryLink({ type: "file", url: sourceUrl, category: anchorFolder });
}
