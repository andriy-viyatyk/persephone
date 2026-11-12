import type { IContentPipe } from "../../api/types/io.pipe";
import type { PageModel } from "../../api/pages/PageModel";

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
        const editor = page.mainEditor;
        const owner = editor?.contentHost ?? editor;
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
