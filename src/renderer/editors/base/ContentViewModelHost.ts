import { PageEditor } from "../../../shared/types";
import { editorRegistry } from "../registry";
import { ContentViewModel } from "./ContentViewModel";
import { IContentHost } from "./IContentHost";

interface ViewModelEntry {
    vm: ContentViewModel<any>;
    refs: number;
}

/**
 * Ref-counting helper for managing content view models.
 *
 * Both TextFileModel and NoteItemEditModel compose this class and delegate
 * acquireViewModel/releaseViewModel to it. This avoids multiple inheritance.
 *
 * Usage:
 * ```
 * class TextFileModel implements IContentHost {
 *     private _vmHost = new ContentViewModelHost();
 *     acquireViewModel(editorId) { return this._vmHost.acquire(editorId, this); }
 *     releaseViewModel(editorId) { this._vmHost.release(editorId); }
 *     dispose() { this._vmHost.disposeAll(); }
 * }
 * ```
 */
export class ContentViewModelHost {
    private _viewModels = new Map<PageEditor, ViewModelEntry>();

    /**
     * Acquire a view model for the given editor.
     * - First call: validates, loads factory, creates model, calls init(), caches it
     * - Subsequent calls: increments reference count, returns cached model
     */
    async acquire(editorId: PageEditor, host: IContentHost): Promise<ContentViewModel<any>> {
        let entry = this._viewModels.get(editorId);
        if (entry) {
            entry.refs++;
            return entry.vm;
        }

        // Validate that this editor is applicable for the host
        editorRegistry.validateForHost(editorId, host);

        // Get factory — try sync first, then async load
        const factory = editorRegistry.getViewModelFactory(editorId)
            ?? await editorRegistry.loadViewModelFactory(editorId);

        // Create and initialize the view model
        const vm = factory(host);
        vm.init();

        entry = { vm, refs: 1 };
        this._viewModels.set(editorId, entry);
        return vm;
    }

    /**
     * Release a reference to a view model.
     * When refs reach 0, the model is disposed and removed from cache.
     */
    release(editorId: PageEditor): void {
        const entry = this._viewModels.get(editorId);
        if (!entry) return;

        entry.refs--;
        if (entry.refs <= 0) {
            entry.vm.dispose();
            this._viewModels.delete(editorId);
        }
    }

    /**
     * Dispose all cached view models.
     * Called when the host itself is being disposed.
     */
    disposeAll(): void {
        for (const { vm } of this._viewModels.values()) {
            vm.dispose();
        }
        this._viewModels.clear();
    }
}
