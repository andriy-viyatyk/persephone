const path = require("path");
const fs = require("fs");
import { TComponentState } from "../../core/state/state";
import { ui } from "../../api/ui";
import { api } from "../../../ipc/renderer/api";
import { pagesModel, getLanguageByExtension } from "../../store";
import { fs as appFs } from "../../api/fs";
import { recent } from "../../api/recent";
import { FileWatcher } from "../../core/services/file-watcher";
import { getDefaultPageModelState, PageModel } from "../base/PageModel";
import { scriptRunner } from "../../core/services/scripting/ScriptRunner";
import { IPage, PageEditor } from "../../../shared/types";
import { ScriptPanelModel } from "./ScriptPanel";
import { TextEditorModel } from "./TextEditor";
import { debounce } from "../../../shared/utils";
import { shell } from "../../api/shell";
import { editorRegistry } from "../registry";
import { NavPanelModel } from "../../features/navigation/nav-panel-store";

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

export class TextFileModel extends PageModel<TextFilePageModelState, void> {
    private modificationSaved = true;
    private fileWatcher: FileWatcher | null = null;
    script = new ScriptPanelModel(this);
    editor = new TextEditorModel(this);
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

    get encripted(): boolean {
        return shell.encryption.isEncrypted(this.state.get().content);
    }

    get decripted(): boolean {
        return this.state.get().password !== undefined;
    }

    get withEncription(): boolean {
        return this.decripted || this.encripted;
    }

    changeContent = (newContent: string, byUser?: boolean) => {
        this.state.update((state) => {
            state.content = newContent;
            state.modified = true;
            state.encripted = shell.encryption.isEncrypted(newContent);
            state.temp = state.temp && !byUser;
        });
        this.modificationSaved = false;
        this.saveModifications();
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

    private mapContentToSave = async (): Promise<string | undefined> => {
        const text = this.state.get().content;
        const password = this.state.get().password;
        if (password) {
            try {
                return await shell.encryption.encrypt(text, password);
            } catch (error) {
                this.alertEncryptionError(error as Error);
                return undefined;
            }
        }
        return text;
    };

    private mapContentFromFile = async (
        text: string,
    ): Promise<string | undefined> => {
        const password = this.state.get().password;
        if (shell.encryption.isEncrypted(text) && password) {
            try {
                return await shell.encryption.decrypt(text, password);
            } catch (error) {
                this.alertEncryptionError(error as Error);
                return undefined;
            }
        }
        return text;
    };

    async saveState(): Promise<void> {
        if (!this.modificationSaved) {
            await this.doSaveModifications();
        }
        await super.saveState();
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

    confirmRelease = async (): Promise<boolean> => {
        if (this.skipSave) {
            return true;
        }

        const { modified, title, temp } = this.state.get();
        if (!modified || temp) {
            return true;
        }

        pagesModel.showPage(this.state.get().id);
        const confirmBt = await ui.confirm(
            `Do you want to save the changes you made to "${title}"?`,
            { title: "Unsaved Changes", buttons: ["Save", "Don't Save", "Cancel"] },
        );

        switch (confirmBt) {
            case "Save":
                return await this.saveFile();
            case "Don't Save":
                return true;
            default:
                return false;
        }
    };

    canClose = async (): Promise<boolean> => {
        const result = await this.confirmRelease();
        if (result) {
            if (!this.skipSave) {
                await this.dispose();
            }
        } else {
            pagesModel.focusPage(this as unknown as PageModel);
        }
        return result;
    };

    async dispose(): Promise<void> {
        this.fileWatcher?.dispose();
        this.fileWatcher = null;
        this.editor.dispose();
        this.script.dispose();
        await super.dispose();
    }

    saveFile = async (saveAs?: boolean): Promise<boolean> => {
        const { filePath, title, id } = this.state.get();
        let savePath: string | undefined = saveAs ? undefined : filePath;
        if (!savePath) {
            savePath = await api.showSaveFileDialog({
                title: saveAs ? "Save File As" : "Save File",
                defaultPath: title,
            });
        }

        const text = await this.mapContentToSave();
        if (text === undefined) {
            return false;
        }
        if (savePath) {
            await appFs.write(
                savePath,
                text,
                this.state.get().encoding,
            );
            await appFs.deleteCacheFile(id);
            this.state.update((s) => {
                s.modified = false;
                s.temp = false;
                s.filePath = savePath;
                s.title = path.basename(savePath);
                s.deleted = false;
            });
            this.fileWatcher?.dispose();
            this.fileWatcher = new FileWatcher(savePath, this.onFileChanged);
            if (savePath !== filePath) {
                recent.add(savePath);
            }
            return true;
        }

        return false;
    };

    renameFile = async (newName: string): Promise<boolean> => {
        const { filePath } = this.state.get();
        if (!filePath) {
            this.state.update((s) => {
                s.title = newName;
                s.temp = false;
            });
            return true;
        }

        const newPath = path.join(path.dirname(filePath), newName);
        if (fs.existsSync(newPath)) {
            ui.notify("A file or folder with that name already exists.", "warning");
            return false;
        }
        try {
            fs.renameSync(filePath, newPath);
        } catch (err) {
            ui.notify(err.message || "Failed to rename file.", "warning");
            return false;
        }
        await this.applyRenamedPath(newPath);
        return true;
    };

    /** Update filePath, title, FileWatcher and recent-files after a rename on disk. */
    applyRenamedPath = async (newPath: string) => {
        const oldPath = this.state.get().filePath;
        this.state.update((s) => {
            s.filePath = newPath;
            s.title = path.basename(newPath);
        });
        this.fileWatcher?.dispose();
        this.fileWatcher = new FileWatcher(newPath, this.onFileChanged);
        if (oldPath && newPath !== oldPath) {
            await recent.remove(oldPath);
            recent.add(newPath);
        }
    };

    async restore() {
        const { id, modified, filePath } = this.state.get();
        if (filePath) {
            this.fileWatcher?.dispose();
            this.fileWatcher = new FileWatcher(filePath, this.onFileChanged);
        }
        if (modified) {
            const cachedContent = await appFs.getCacheFile(id);
            if (cachedContent !== undefined) {
                this.state.update((s) => {
                    s.content = cachedContent;
                    s.deleted = this.fileWatcher?.stat.exists === false;
                });
            }
        } else if (filePath) {
            const ext = path.extname(filePath).toLowerCase();
            const fileContent = await this.fileWatcher.getTextContent(
                this.state.get().encoding,
            );
            const encoding = this.fileWatcher.encoding;
            this.state.update((s) => {
                s.content = fileContent || "";
                s.encripted = shell.encryption.isEncrypted(s.content);
                s.encoding = encoding;
                s.title = path.basename(filePath);
                s.language =
                    s.language ||
                    getLanguageByExtension(ext)?.id ||
                    "plaintext";
                s.deleted = this.fileWatcher?.stat.exists === false;
                s.temp = false;
            });
        }
        await this.script.restore(id);
        await super.restore();
        this.state.update((s) => {
            s.restored = true;
        });
    }

    private onFileChanged = async () => {
        if (!this.fileWatcher) return;
        const modified = this.state.get().modified;
        const deleted = !this.fileWatcher.stat.exists;
        if (deleted !== this.state.get().deleted) {
            this.state.update((s) => {
                s.deleted = deleted;
                s.modified = deleted || s.modified;
            });
        }
        if (!modified && !deleted) {
            const newContent = await this.fileWatcher.getTextContent(
                this.state.get().encoding,
            );
            const encoding = this.fileWatcher.encoding;
            const text = await this.mapContentFromFile(newContent || "");
            if (text === undefined) {
                return;
            }
            this.state.update((s) => {
                s.content = text;
                s.encripted = shell.encryption.isEncrypted(s.content);
                s.encoding = encoding;
            });
        }

        if (!modified && this.state.get().modified) {
            this.modificationSaved = false;
            this.saveModifications();
        }
    };

    private isSavingModifications = false;

    private doSaveModifications = async () => {
        if (this.modificationSaved) return;
        this.modificationSaved = true;
        this.isSavingModifications = true;
        const { id } = this.state.get();

        const text = await this.mapContentToSave();
        if (text === undefined) {
            return;
        }

        await appFs.saveCacheFile(id, text);
        this.isSavingModifications = false;
    };

    private saveModifications = debounce(
        this.doSaveModifications,
        1000,
        () => !this.isSavingModifications,
    );

    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        if (e.ctrlKey && e.code === "KeyS") {
            e.preventDefault();
            if (e.shiftKey) {
                this.saveFile(true);
            } else {
                this.saveFile();
            }
        }

        if (e.key === "F5") {
            e.preventDefault();
            if (this.script.state.get().open) {
                this.runRelatedScript();
            } else {
                this.runScript();
            }
        }

        if (e.ctrlKey && e.shiftKey && e.code === "KeyF") {
            e.preventDefault();
            this.openSearchInNavPanel();
        }
    };

    openSearchInNavPanel = () => {
        const { filePath } = this.state.get();
        if (!this.navPanel && !filePath) return;

        if (!this.navPanel) {
            const navPanel = new NavPanelModel(path.dirname(filePath), filePath);
            navPanel.id = this.id;
            navPanel.flushSave();
            this.navPanel = navPanel;
            this.state.update((s) => {
                s.hasNavPanel = true;
            });
        }

        this.navPanel.openSearch();
    };

    runScript = async (all?: boolean) => {
        const { language, content } = this.state.get();
        let script = content;
        if (!all) {
            script = this.editor.getSelectedText() || content;
        }
        if (language === "javascript") {
            await scriptRunner.runWithResult(this.id, script, this);
        }
    };

    runRelatedScript = async (all?: boolean) => {
        let script = this.script.state.get().content;
        if (!all) {
            script = this.script.getSelectedText() || script;
        }
        await scriptRunner.runWithResult(this.id, script, this);
    };

    encript = async (password: string): Promise<void> => {
        if (this.encripted) {
            ui.notify("File is already encrypted", "warning");
            return;
        }
        try {
            const encryptedContent = await shell.encryption.encrypt(
                this.state.get().content,
                password,
            );
            const modified =
                this.state.get().modified ||
                this.state.get().password !== password;
            this.state.update((s) => {
                s.content = encryptedContent;
                s.encripted = true;
                s.password = undefined;
                s.modified = modified;
                s.temp = s.temp && !modified;
            });
            this.modificationSaved = false;
            this.saveModifications();
        } catch (error) {
            ui.notify((error as Error).message, "warning");
        }
    };

    encryptWithCurrentPassword = async (): Promise<void> => {
        const password = this.state.get().password;
        if (!password) {
            ui.notify("No password set for encryption", "warning");
            return;
        }
        await this.encript(password);
    };

    alertEncryptionError = (err: Error) => {
        ui.notify(err.message || err.name || "Unknown encryption error", "warning");
    };

    decript = async (password: string): Promise<boolean> => {
        if (!this.encripted) {
            return false;
        }
        try {
            const decrypted = await shell.encryption.decrypt(
                this.state.get().content,
                password,
            );
            this.state.update((s) => {
                s.content = decrypted;
                s.encripted = false;
                s.password = password;
            });
            return true;
        } catch (error) {
            this.alertEncryptionError(error as Error);
        }
    };

    showEncryptionDialog = async () => {
        const mode = this.encripted && !this.decripted ? "decrypt" : "encrypt";
        const password = await ui.password({ mode });
        if (!password) return;

        if (mode === "decrypt") {
            await this.decript(password);
        } else {
            await this.encript(password);
        }
        this.editor.focusEditor();
    };

    makeUnencrypted = () => {
        this.state.update((s) => {
            s.password = undefined;
            s.modified = true;
        });
        this.modificationSaved = false;
        this.saveModifications();
    };

    setCompareMode = (compareMode: boolean) => {
        this.state.update((s) => {
            s.compareMode = compareMode;
        });
    };
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
