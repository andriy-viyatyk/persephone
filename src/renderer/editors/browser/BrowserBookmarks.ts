const fs = require("fs");
import { debounce } from "../../../shared/utils";
import { TComponentState } from "../../core/state/state";
import { TextFileModel, getDefaultTextFilePageModelState } from "../text/TextPageModel";
import { LinkEditorModel, defaultLinkEditorState } from "../link-editor/LinkEditorModel";
import { LinkItem, LinkEditorProps } from "../link-editor/linkTypes";
import { PageEditor } from "../../../shared/types";
import { isEncrypted } from "../../core/services/encryption";
import { showPasswordDialog } from "../../features/dialogs/PasswordDialog";

/**
 * Wraps TextFileModel + LinkEditorModel for browser bookmarks.
 * Stored on BrowserPageModel.bookmarks (null until lazily initialized).
 */
export class BrowserBookmarks {
    textModel: TextFileModel;
    linkModel: LinkEditorModel;
    private saveDebounced = debounce(() => this.textModel.saveFile(), 300);

    constructor(filePath: string) {
        const state = {
            ...getDefaultTextFilePageModelState(),
            filePath,
            editor: "link-view" as PageEditor,
        };
        this.textModel = new TextFileModel(new TComponentState(state));
        // TextFileModel creates sub-models (script, editor) we don't need,
        // but they are lightweight and won't cause issues.
        this.textModel.skipSave = true;

        this.linkModel = new LinkEditorModel(
            new TComponentState(defaultLinkEditorState),
        );
        // Set props manually (normally done by useComponentModel hook)
        this.linkModel.props = { model: this.textModel } as LinkEditorProps;
    }

    async init(): Promise<boolean> {
        await this.textModel.restore();
        let content = this.textModel.state.get().content || "";

        // If the bookmarks file is encrypted, prompt for password
        if (isEncrypted(content)) {
            const password = await showPasswordDialog({ mode: "decrypt" });
            if (!password) return false; // user cancelled
            const ok = await this.textModel.decript(password);
            if (!ok) return false; // wrong password
            content = this.textModel.state.get().content || "";
        }

        this.linkModel.updateContent(content);
        this.linkModel.init();

        // Subscribe to file content changes (external edits, FileWatcher)
        // and auto-save to disk when modified by user.
        this.textModel.state.subscribe(() => {
            const newContent = this.textModel.state.get().content || "";
            this.linkModel.updateContent(newContent);
            if (this.textModel.state.get().modified) {
                this.saveDebounced();
            }
        });
        return true;
    }

    async dispose(): Promise<void> {
        this.linkModel.dispose();
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
