import { fpBasename, fpDirname, fpExtname, fpJoin } from "../../core/utils/file-path";

import { api } from "../../../ipc/renderer/api";
import { fs as appFs } from "../../api/fs";
import { recent } from "../../api/recent";
import { getLanguageByExtension } from "../../core/utils";
import { shell } from "../../api/shell";
import { FileWatcher } from "../../core/utils/file-watcher";
import { debounce } from "../../../shared/utils";
import type { TextFileModel } from "./TextPageModel";

export class TextFileIOModel {
    fileWatcher: FileWatcher | null = null;
    private modificationSaved = true;
    private isSavingModifications = false;

    constructor(private model: TextFileModel) {}

    /** Called by encryption submodel when content changes need cache save. */
    markModificationUnsaved = () => {
        this.modificationSaved = false;
        this.saveModifications();
    };

    saveFile = async (saveAs?: boolean): Promise<boolean> => {
        const { filePath, title, id } = this.model.state.get();
        let savePath: string | undefined = saveAs ? undefined : filePath;
        if (!savePath) {
            savePath = await api.showSaveFileDialog({
                title: saveAs ? "Save File As" : "Save File",
                defaultPath: title,
            });
        }

        const text = await this.model.encryption.mapContentToSave();
        if (text === undefined) {
            return false;
        }
        if (savePath) {
            await appFs.write(
                savePath,
                text,
                this.model.state.get().encoding,
            );
            await appFs.deleteCacheFile(id);
            this.model.state.update((s) => {
                s.modified = false;
                s.temp = false;
                s.filePath = savePath;
                s.title = fpBasename(savePath);
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
        const { filePath } = this.model.state.get();
        if (!filePath) {
            this.model.state.update((s) => {
                s.title = newName;
                s.temp = false;
            });
            return true;
        }

        const newPath = fpJoin(fpDirname(filePath), newName);
        if (await appFs.exists(newPath)) {
            const { ui } = await import("../../api/ui");
            ui.notify("A file or folder with that name already exists.", "warning");
            return false;
        }
        try {
            await appFs.rename(filePath, newPath);
        } catch (err) {
            const { ui } = await import("../../api/ui");
            ui.notify(err.message || "Failed to rename file.", "warning");
            return false;
        }
        await this.applyRenamedPath(newPath);
        return true;
    };

    /** Update filePath, title, FileWatcher and recent-files after a rename on disk. */
    applyRenamedPath = async (newPath: string) => {
        const oldPath = this.model.state.get().filePath;
        this.model.state.update((s) => {
            s.filePath = newPath;
            s.title = fpBasename(newPath);
        });
        this.fileWatcher?.dispose();
        this.fileWatcher = new FileWatcher(newPath, this.onFileChanged);
        if (oldPath && newPath !== oldPath) {
            await recent.remove(oldPath);
            recent.add(newPath);
        }
    };

    async restore() {
        const { id, modified, filePath } = this.model.state.get();
        if (filePath) {
            this.fileWatcher?.dispose();
            this.fileWatcher = new FileWatcher(filePath, this.onFileChanged);
        }
        if (modified) {
            const cachedContent = await appFs.getCacheFile(id);
            if (cachedContent !== undefined) {
                this.model.state.update((s) => {
                    s.content = cachedContent;
                    s.deleted = this.fileWatcher?.stat.exists === false;
                });
            }
        } else if (filePath) {
            const ext = fpExtname(filePath).toLowerCase();
            const fileContent = await this.fileWatcher.getTextContent(
                this.model.state.get().encoding,
            );
            const encoding = this.fileWatcher.encoding;
            this.model.state.update((s) => {
                s.content = fileContent || "";
                s.encripted = shell.encryption.isEncrypted(s.content);
                s.encoding = encoding;
                s.title = fpBasename(filePath);
                s.language =
                    s.language ||
                    getLanguageByExtension(ext)?.id ||
                    "plaintext";
                s.deleted = this.fileWatcher?.stat.exists === false;
                s.temp = false;
            });
        }
    }

    async saveState(): Promise<void> {
        if (!this.modificationSaved) {
            await this.doSaveModifications();
        }
    }

    private onFileChanged = async () => {
        if (!this.fileWatcher) return;
        const modified = this.model.state.get().modified;
        const deleted = !this.fileWatcher.stat.exists;
        if (deleted !== this.model.state.get().deleted) {
            this.model.state.update((s) => {
                s.deleted = deleted;
                s.modified = deleted || s.modified;
            });
        }
        if (!modified && !deleted) {
            const newContent = await this.fileWatcher.getTextContent(
                this.model.state.get().encoding,
            );
            const encoding = this.fileWatcher.encoding;
            const text = await this.model.encryption.mapContentFromFile(newContent || "");
            if (text === undefined) {
                return;
            }
            this.model.state.update((s) => {
                s.content = text;
                s.encripted = shell.encryption.isEncrypted(s.content);
                s.encoding = encoding;
            });
        }

        if (!modified && this.model.state.get().modified) {
            this.modificationSaved = false;
            this.saveModifications();
        }
    };

    private doSaveModifications = async () => {
        if (this.modificationSaved) return;
        this.modificationSaved = true;
        this.isSavingModifications = true;
        const { id } = this.model.state.get();

        const text = await this.model.encryption.mapContentToSave();
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

    dispose() {
        this.fileWatcher?.dispose();
        this.fileWatcher = null;
    }
}
