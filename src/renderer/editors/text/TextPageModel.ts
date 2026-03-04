import { TComponentState } from "../../core/state/state";
import { shell } from "../../api/shell";
import { fs as appFs } from "../../api/fs";
import { getDefaultPageModelState, PageModel } from "../base/PageModel";
import { IPage, PageEditor } from "../../../shared/types";
import { ScriptPanelModel } from "./ScriptPanel";
import { TextEditorModel } from "./TextEditor";
import { editorRegistry } from "../registry";
import { TextFileEncryptionModel } from "./TextFileEncryptionModel";
import { TextFileIOModel } from "./TextFileIOModel";
import { TextFileActionsModel } from "./TextFileActionsModel";
import type { IContentHost } from "../base/IContentHost";
import type { EditorStateStorage } from "../base/EditorStateStorageContext";
import { ContentViewModelHost } from "../base/ContentViewModelHost";

export interface TextFilePageModelState extends IPage {
    content: string;
    deleted: boolean;
    encoding?: string;
    password?: string;
    encripted?: boolean;
    restored: boolean;
    compareMode: boolean;
    temp: boolean;
}

export const getDefaultTextFilePageModelState = (): TextFilePageModelState => ({
    ...getDefaultPageModelState(),
    type: "textFile" as const,
    language: "plaintext",
    encoding: undefined,
    compareMode: false,
    temp: true,
    // no stored state props
    content: "",
    deleted: false,
    password: undefined,
    encripted: false,
    restored: false,
});

export class TextFileModel extends PageModel<TextFilePageModelState, void> implements IContentHost {
    // Content view model host
    private _vmHost = new ContentViewModelHost();

    readonly stateStorage: EditorStateStorage = {
        getState: async (id, name) => appFs.getCacheFile(id, name),
        setState: async (id, name, state) => { await appFs.saveCacheFile(id, state, name); },
    };

    acquireViewModel(editorId: PageEditor) {
        return this._vmHost.acquire(editorId, this);
    }

    releaseViewModel(editorId: PageEditor) {
        this._vmHost.release(editorId);
    }

    // Submodels
    io = new TextFileIOModel(this);
    encryption = new TextFileEncryptionModel(this);
    actions = new TextFileActionsModel(this);
    script = new ScriptPanelModel(this);
    editor = new TextEditorModel(this);

    // Portal refs
    editorToolbarRefFirst: HTMLDivElement | null = null;
    editorToolbarRefLast: HTMLDivElement | null = null;
    editorFooterRefLast: HTMLDivElement | null = null;
    editorOverlayRef: HTMLDivElement | null = null;

    setEditorToolbarRefFirst = (ref: HTMLDivElement | null) => {
        this.editorToolbarRefFirst = ref;
    };

    setEditorToolbarRefLast = (ref: HTMLDivElement | null) => {
        this.editorToolbarRefLast = ref;
    };

    setFooterRefLast = (ref: HTMLDivElement | null) => {
        this.editorFooterRefLast = ref;
    };

    setEditorOverlayRef = (ref: HTMLDivElement | null) => {
        this.editorOverlayRef = ref;
    };

    // =========================================================================
    // Encryption delegates (getters)
    // =========================================================================

    get encripted(): boolean {
        return this.encryption.encripted;
    }

    get decripted(): boolean {
        return this.encryption.decripted;
    }

    get withEncription(): boolean {
        return this.encryption.withEncription;
    }

    // =========================================================================
    // Core state methods (remain on TextFileModel)
    // =========================================================================

    changeContent = (newContent: string, byUser?: boolean) => {
        this.state.update((state) => {
            state.content = newContent;
            state.modified = true;
            state.encripted = shell.encryption.isEncrypted(newContent);
            state.temp = state.temp && !byUser;
        });
        this.io.markModificationUnsaved();
    };

    changeEditor = (editor: PageEditor) => {
        this.state.update((s) => {
            s.editor = editor;
        });
    };

    getRestoreData() {
        const {
            content,
            deleted,
            password,
            encripted,
            restored,
            ...pageData
        } = this.state.get();
        if (this.navPanel) {
            pageData.hasNavPanel = true;
        }
        return pageData;
    }

    applyRestoreData = (data: Partial<TextFilePageModelState>): void => {
        this.needsNavPanelRestore = !!data.hasNavPanel;
        this.state.update((s) => {
            s.id = data.id || s.id;
            s.type = data.type || s.type;
            s.title = data.title || s.title;
            s.modified = data.modified || s.modified;
            s.filePath = data.filePath || s.filePath;
            s.language = data.language || s.language;
            s.encoding = data.encoding || s.encoding;
            s.editor = data.editor || s.editor;
            s.compareMode = data.compareMode || s.compareMode;
            s.temp =
                !s.filePath && (data.temp !== undefined ? data.temp : s.temp);
            s.pinned = data.pinned ?? s.pinned;
        });
    };

    // =========================================================================
    // Lifecycle
    // =========================================================================

    async saveState(): Promise<void> {
        await this.io.saveState();
        await super.saveState();
    }

    async restore() {
        await this.io.restore();
        await this.script.restore(this.state.get().id);
        await super.restore();
        this.state.update((s) => {
            s.restored = true;
        });
    }

    async dispose(): Promise<void> {
        this._vmHost.disposeAll();
        this.io.dispose();
        this.editor.dispose();
        this.script.dispose();
        await super.dispose();
    }

    // =========================================================================
    // Flat API delegates — preserve external API
    // =========================================================================

    // IO delegates
    saveFile = (saveAs?: boolean) => this.io.saveFile(saveAs);
    renameFile = (newName: string) => this.io.renameFile(newName);
    applyRenamedPath = (newPath: string) => this.io.applyRenamedPath(newPath);

    // Encryption delegates
    encript = (password: string) => this.encryption.encript(password);
    encryptWithCurrentPassword = () => this.encryption.encryptWithCurrentPassword();
    decript = (password: string) => this.encryption.decript(password);
    showEncryptionDialog = () => this.encryption.showEncryptionDialog();
    makeUnencrypted = () => this.encryption.makeUnencrypted();
    alertEncryptionError = (err: Error) => this.encryption.alertEncryptionError(err);

    // Actions delegates
    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => this.actions.handleKeyDown(e);
    openSearchInNavPanel = () => this.actions.openSearchInNavPanel();
    runScript = (all?: boolean) => this.actions.runScript(all);
    runRelatedScript = (all?: boolean) => this.actions.runRelatedScript(all);
    setCompareMode = (compareMode: boolean) => this.actions.setCompareMode(compareMode);
    confirmRelease = () => this.actions.confirmRelease();
    canClose = () => this.actions.canClose();
}

export function newTextFileModel(filePath?: string): TextFileModel {
    const editor = editorRegistry.resolveId(filePath);
    const state = {
        ...getDefaultTextFilePageModelState(),
        ...(filePath ? { filePath } : {}),
        editor,
    };

    return new TextFileModel(new TComponentState(state));
}

export function newTextFileModelFromState(
    state: Partial<IPage>,
): TextFileModel {
    const initialState: TextFilePageModelState = {
        ...getDefaultTextFilePageModelState(),
        ...state,
    };
    return new TextFileModel(new TComponentState(initialState));
}

export function isTextFileModel(
    model: PageModel<any, any>,
): model is TextFileModel {
    return model.type === "textFile";
}
