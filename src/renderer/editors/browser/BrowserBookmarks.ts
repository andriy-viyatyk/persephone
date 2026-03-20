const fs = require("fs");
import { debounce } from "../../../shared/utils";
import { TComponentState } from "../../core/state/state";
import { TextFileModel, getDefaultTextFilePageModelState } from "../text/TextPageModel";
import { LinkViewModel } from "../link-editor/LinkViewModel";
import { LinkItem } from "../link-editor/linkTypes";
import { PageEditor } from "../../../shared/types";
import { shell } from "../../api/shell";
import { ui } from "../../api/ui";

/**
 * Wraps TextFileModel + LinkViewModel for browser bookmarks.
 * Stored on BrowserPageModel.bookmarks (null until lazily initialized).
 *
 * The LinkViewModel is acquired through the host's ContentViewModelHost so that
 * BookmarksDrawer's LinkEditor (which also calls acquireViewModel) shares
 * the same cached instance via ref-counting.
 */
export class BrowserBookmarks {
    textModel: TextFileModel;
    linkModel!: LinkViewModel;
    private saveDebounced = debounce(() => this.textModel.saveFile(), 300);

    constructor(filePath: string) {
        const state = {
            ...getDefaultTextFilePageModelState(),
            filePath,
            language: "json",
            editor: "link-view" as PageEditor,
        };
        this.textModel = new TextFileModel(new TComponentState(state));
        // TextFileModel creates sub-models (script, editor) we don't need,
        // but they are lightweight and won't cause issues.
        this.textModel.skipSave = true;
    }

    /**
     * Initialize bookmarks: load file, handle encryption, acquire LinkViewModel.
     * @param options.silent When true, skip password dialog for encrypted files (return false instead).
     */
    async init(options?: { silent?: boolean }): Promise<boolean> {
        await this.textModel.restore();

        // If the bookmarks file is encrypted, prompt for password (unless silent)
        if (shell.encryption.isEncrypted(this.textModel.state.get().content || "")) {
            if (options?.silent) return false; // silent mode — don't prompt
            const password = await ui.password({ mode: "decrypt" });
            if (!password) return false; // user cancelled
            const ok = await this.textModel.decript(password);
            if (!ok) return false; // wrong password
        }

        // Acquire via host so LinkEditor shares the same instance (ref-counted)
        this.linkModel = await this.textModel.acquireViewModel("link-view") as LinkViewModel;

        // Auto-save to disk when modified by user
        this.textModel.state.subscribe(() => {
            if (this.textModel.state.get().modified) {
                this.saveDebounced();
            }
        });
        return true;
    }

    async dispose(): Promise<void> {
        this.textModel.releaseViewModel("link-view");
        await this.textModel.dispose();
    }

    /** Check if a URL exists in the bookmarks. */
    findByUrl(url: string): LinkItem | undefined {
        return this.linkModel.state.get().data.links.find(
            (link) => link.href === url,
        );
    }
}

/** Create an empty .link.json file at the given path. */
export function createEmptyLinkFile(filePath: string): void {
    const emptyData = JSON.stringify({ links: [], state: {} }, null, 4);
    fs.writeFileSync(filePath, emptyData, "utf-8");
}
