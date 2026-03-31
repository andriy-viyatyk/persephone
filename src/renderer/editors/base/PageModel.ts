import { TDialogModel } from "../../core/state/model";

import { IPageState } from "../../../shared/types";
import { editorRegistry } from "../registry";
import { NavigationData } from "../../ui/navigation/NavigationData";
import { fs } from "../../api/fs";
import type { IContentPipe } from "../../api/types/io.pipe";
import { createPipeFromDescriptor } from "../../content/registry";

export const getDefaultPageModelState = (): IPageState => ({
    id: crypto.randomUUID(),
    type: "textFile",
    title: "untitled",
    modified: false,
    language: undefined,
    filePath: undefined,
    editor: undefined,
    pinned: false,
});

export class PageModel<T extends IPageState = IPageState, R = any> extends TDialogModel<T, R> {
    skipSave = false;
    getIcon?: () => React.ReactNode;
    noLanguage = false;
    /** In-memory data storage for scripts. Available on all page types. Does not persist to disk. */
    scriptData: Record<string, any> = {};
    navigationData: NavigationData | null = null;
    /** Content pipe (provider + transformers). Owned by the page, disposed on close. */
    pipe: IContentPipe | null = null;
    /** Flag for restore(): NavigationData needs to be created from cache */
    protected needsNavigatorRestore = false;

    get id() {
        return this.state.get().id;
    }

    get type() {
        return this.state.get().type;
    }

    get title() {
        return this.state.get().title;
    }

    get modified() {
        return this.state.get().modified;
    }

    get pinned() {
        return this.state.get().pinned;
    }

    get filePath() {
        return this.state.get().filePath;
    }

    get language() {
        return this.state.get().language;
    }

    /**
     * Prompt the user to save unsaved changes before releasing the page.
     * @param closing — true when the tab is being closed (not just navigated).
     *   When closing, secondary editor models in NavigationData are also checked.
     */
    async confirmRelease(closing?: boolean): Promise<boolean> {
        if (closing && this.navigationData) {
            const released = await this.navigationData.confirmSecondaryRelease();
            if (!released) return false;
        }
        return true;
    }

    async dispose(): Promise<void> {
        this.navigationData?.dispose();
        this.navigationData = null;
        this.pipe?.dispose();
        this.pipe = null;
        await fs.deleteCacheFiles(this.state.get().id);
    }

    async restore(): Promise<void> {
        // Restore NavigationData from cache if page had one.
        // needsNavigatorRestore: set by applyRestoreData (app startup path)
        // hasNavigator on state: set by newPageModelFromState (drag/drop path)
        // Also check legacy hasNavPanel for backward compat
        if (this.needsNavigatorRestore || this.state.get().hasNavigator || (this.state.get() as any).hasNavPanel) { // eslint-disable-line @typescript-eslint/no-explicit-any
            this.needsNavigatorRestore = false;
            const navData = new NavigationData("");
            await navData.restore(this.id);
            this.navigationData = navData;
            // Set hasNavigator AFTER navigationData is ready, so React sees both together
            this.state.update((s) => {
                s.hasNavigator = true;
            });
        }
    }

    getRestoreData(): Partial<T> {
        const data = JSON.parse(JSON.stringify(this.state.get()));
        if (this.navigationData) {
            data.hasNavigator = true;
        }
        if (this.pipe) {
            data.pipe = this.pipe.toDescriptor();
        }
        return data;
    }

    async saveState(): Promise<void> {
        await this.navigationData?.flushSave();
    }

    applyRestoreData(data: Partial<T>): void {
        this.needsNavigatorRestore = !!(data.hasNavigator || (data as any).hasNavPanel); // eslint-disable-line @typescript-eslint/no-explicit-any
        // Reconstruct pipe from descriptor if present
        if (data.pipe) {
            try {
                this.pipe = createPipeFromDescriptor(data.pipe as any); // eslint-disable-line @typescript-eslint/no-explicit-any
            } catch {
                // Unknown provider/transformer type — fall back to filePath restore
                this.pipe = null;
            }
        }
        this.state.update((s) => {
            s.id = data.id || s.id;
            s.type = data.type || s.type;
            s.title = data.title || s.title;
            s.modified = data.modified || s.modified;
            s.filePath = data.filePath || s.filePath;
            s.editor = data.editor || s.editor;
            s.pinned = data.pinned ?? false;
            if ((data as any).sourceLink) s.sourceLink = (data as any).sourceLink; // eslint-disable-line @typescript-eslint/no-explicit-any
        });
    }

    /** Create NavigationData if not yet attached. Returns existing or new NavigationData.
     *  Panel starts closed — caller should use toggleNavigator() to open it. */
    ensureNavigationData(rootPath: string): NavigationData {
        if (!this.navigationData) {
            const navData = new NavigationData(rootPath);
            const navModel = navData.ensurePageNavigatorModel();
            // Start closed — toggleNavigator() will open it
            navModel.state.update((s) => { s.open = false; });
            navData.updateId(this.id);
            navData.flushSave();
            this.navigationData = navData;
            this.state.update((s) => {
                s.hasNavigator = true;
            });
        }
        return this.navigationData;
    }

    changeLanguage = (language: string | undefined) => {
        this.state.update((s) => {
            s.language = language;
            s.editor = editorRegistry.validateForLanguage(s.editor, language || "");
        });
    };
}
