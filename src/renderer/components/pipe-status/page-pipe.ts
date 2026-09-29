import type { IContentPipe } from "../../api/types/io.pipe";
import type { PageModel } from "../../api/pages/PageModel";
import { EditorModel } from "../../editors/base/EditorModel";
import { TextHostEditorModel } from "../../editors/base/TextHostEditorModel";
import { isTextFileModel } from "../../editors/text/TextEditorModel";

/**
 * Follows the pipe that represents a page's content: the text host's pipe for text and
 * text-host editors, otherwise the main editor's own pipe. Calls `onPipe` with the current
 * pipe immediately and again whenever it may have changed (callers dedupe by identity).
 * Returns the release function.
 */
export function subscribePagePipe(page: PageModel, onPipe: (pipe: IContentPipe | null) => void): () => void {
    let releaseOwner: (() => void) | undefined;
    const rebind = (): void => {
        releaseOwner?.();
        releaseOwner = undefined;
        const editor = page.mainEditorInstance;
        const owner = isTextFileModel(editor)
            ? editor
            : editor instanceof TextHostEditorModel && isTextFileModel(editor.contentHost)
                ? editor.contentHost
                : editor instanceof EditorModel ? editor : null;
        if (!owner) {
            onPipe(null);
            return;
        }
        releaseOwner = owner.pipeState.subscribe(() => onPipe(owner.pipe));
        onPipe(owner.pipe);
    };
    const releasePage = page.state.subscribe(rebind);
    rebind();
    return () => {
        releasePage();
        releaseOwner?.();
        releaseOwner = undefined;
    };
}
