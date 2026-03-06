import { TComponentState } from "../../core/state/state";
import { shell } from "../../api/shell";
import { fs as appFs } from "../../api/fs";
import { getDefaultPageModelState, PageModel } from "../base/PageModel";
import { IPageState, PageEditor } from "../../../shared/types";
import { ScriptPanelModel } from "./ScriptPanel";
import { editorRegistry } from "../registry";
import { TextFileEncryptionModel } from "./TextFileEncryptionModel";
import { TextFileIOModel } from "./TextFileIOModel";
import { TextFileActionsModel } from "./TextFileActionsModel";
import type { IContentHost } from "../base/IContentHost";
import type { EditorStateStorage } from "../base/EditorStateStorageContext";
import { ContentViewModelHost } from "../base/ContentViewModelHost";
import type { TextViewModel } from "./TextEditor";

export interface TextFilePageModelState extends IPageState {
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

    async acquireViewModel(editorId: PageEditor) {
        const vm = await this._vmHost.acquire(editorId, this);
        if (editorId === "monaco") {
            const textVm = vm as TextViewModel;
            if (this._pendingRevealLine !== null) {
                textVm.pendingRevealLine = this._pendingRevealLine;
                this._pendingRevealLine = null;
            }
            if (this._pendingHighlightText !== undefined) {
                textVm.pendingHighlightText = this._pendingHighlightText;
                this._pendingHighlightText = undefined;
            }
        }
        return vm;
    }

    releaseViewModel(editorId: PageEditor) {
        this._vmHost.release(editorId);
    }

    // =========================================================================
    // TextViewModel delegates (synchronous access via tryGet)
    // =========================================================================

    getTextViewModel(): TextViewModel | null {
        return (this._vmHost.tryGet("monaco") as TextViewModel) ?? null;
    }

    focusEditor() {
        this.getTextViewModel()?.focusEditor();
    }

    revealLine(lineNumber: number) {
        const vm = this.getTextViewModel();
        if (vm) {
            vm.revealLine(lineNumber);
        } else {
            this._pendingRevealLine = lineNumber;
        }
    }

    setHighlightText(text: string | undefined) {
        const vm = this.getTextViewModel();
        if (vm) {
            vm.setHighlightText(text);
        } else {
            this._pendingHighlightText = text;
        }
    }

    getSelectedText(): string {
        return this.getTextViewModel()?.getSelectedText() ?? "";
    }

    // Submodels
    io = new TextFileIOModel(this);
    encryption = new TextFileEncryptionModel(this);
    actions = new TextFileActionsModel(this);
    script = new ScriptPanelModel(this);

    // Pending operations — applied when TextViewModel is first acquired
    private _pendingRevealLine: number | null = null;
    private _pendingHighlightText: string | undefined = undefined;

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
        const language = this.state.get().language ?? "";
        const validated = editorRegistry.validateForLanguage(editor, language);
        this.state.update((s) => {
            s.editor = validated;
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
    state: Partial<IPageState>,
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
