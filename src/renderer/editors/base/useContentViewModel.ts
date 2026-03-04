import { useEffect, useState } from "react";
import { PageEditor } from "../../../shared/types";
import { ContentViewModel } from "./ContentViewModel";
import { IContentHost } from "./IContentHost";

/**
 * React hook for acquiring a content view model from a host.
 *
 * - On mount: calls host.acquireViewModel(editorId) (async, but typically instant
 *   because AsyncEditor has already loaded the module)
 * - On unmount: calls host.releaseViewModel(editorId)
 * - Returns T | null (null while loading — usually just the first render)
 *
 * Handles unmount-during-load via a cancelled flag.
 *
 * @param host - The content host (TextFileModel or NoteItemEditModel)
 * @param editorId - The editor type to acquire a view model for
 * @returns The view model instance, or null while loading
 */
export function useContentViewModel<T extends ContentViewModel<any>>(
    host: IContentHost,
    editorId: PageEditor,
): T | null {
    const [viewModel, setViewModel] = useState<T | null>(null);

    useEffect(() => {
        let cancelled = false;
        let acquired = false;

        host.acquireViewModel(editorId).then((vm) => {
            if (!cancelled) {
                acquired = true;
                setViewModel(vm as T);
            } else {
                // Component unmounted before acquire completed — release immediately
                host.releaseViewModel(editorId);
            }
        });

        return () => {
            cancelled = true;
            if (acquired) {
                host.releaseViewModel(editorId);
            }
            // If !acquired, the .then() handler will see cancelled=true and release
        };
    }, [host, editorId]);

    return viewModel;
}
