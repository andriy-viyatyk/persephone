import type { IContentPipe } from "../api/types/io.pipe";
import type { StoredLinkData } from "../api/types/io.link-data";
import { fpBasename } from "../core/utils/file-path";

export interface PipeSourceWatchCallbacks {
    onChanged?: () => void;
    onRecovered?: () => void;
    onMoved?: (newPath: string) => void;
}

/** Watch a content pipe once and route each source event to its matching owner callback. */
export function watchPipeSource(
    pipe: IContentPipe | null | undefined,
    callbacks: PipeSourceWatchCallbacks,
    label?: string,
): () => void {
    if ((!callbacks.onChanged && !callbacks.onRecovered && !callbacks.onMoved) || !pipe?.watch) {
        return () => {};
    }

    return pipe.watch((event, details) => {
        if (event === "available") {
            callbacks.onRecovered?.();
        } else if (event === "moved") {
            if (details) callbacks.onMoved?.(details.newPath);
        } else {
            callbacks.onChanged?.();
        }
    }, label);
}

/** Rebuild the logical path and pipe after its underlying source moves. */
export function movedSource(
    pipe: IContentPipe,
    newSourcePath: string,
    state: Readonly<{ filePath?: string; sourceLink?: StoredLinkData }>,
): { pipe: IContentPipe; filePath: string; title: string; sourceLink?: StoredLinkData } {
    const filePath = pipe.logicalPathFor(newSourcePath);
    const sourceLink = state.sourceLink;
    const filePathMatches = sourceLink?.filePath === state.filePath;
    const urlMatches = sourceLink?.url === state.filePath;
    const movedSourceLink = sourceLink && (filePathMatches || urlMatches)
        ? {
            ...sourceLink,
            ...(filePathMatches ? { filePath } : {}),
            ...(urlMatches ? { url: filePath } : {}),
        }
        : sourceLink;

    return {
        pipe: pipe.cloneForMovedSource(newSourcePath),
        filePath,
        title: fpBasename(filePath),
        sourceLink: movedSourceLink,
    };
}
