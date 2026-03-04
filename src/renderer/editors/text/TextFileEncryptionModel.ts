import { ui } from "../../api/ui";
import { shell } from "../../api/shell";
import type { TextFileModel } from "./TextPageModel";

export class TextFileEncryptionModel {
    constructor(private model: TextFileModel) {}

    get encripted(): boolean {
        return shell.encryption.isEncrypted(this.model.state.get().content);
    }

    get decripted(): boolean {
        return this.model.state.get().password !== undefined;
    }

    get withEncription(): boolean {
        return this.decripted || this.encripted;
    }

    encript = async (password: string): Promise<void> => {
        if (this.encripted) {
            ui.notify("File is already encrypted", "warning");
            return;
        }
        try {
            const encryptedContent = await shell.encryption.encrypt(
                this.model.state.get().content,
                password,
            );
            const modified =
                this.model.state.get().modified ||
                this.model.state.get().password !== password;
            this.model.state.update((s) => {
                s.content = encryptedContent;
                s.encripted = true;
                s.password = undefined;
                s.modified = modified;
                s.temp = s.temp && !modified;
            });
            this.model.io.markModificationUnsaved();
        } catch (error) {
            ui.notify((error as Error).message, "warning");
        }
    };

    encryptWithCurrentPassword = async (): Promise<void> => {
        const password = this.model.state.get().password;
        if (!password) {
            ui.notify("No password set for encryption", "warning");
            return;
        }
        await this.encript(password);
    };

    decript = async (password: string): Promise<boolean> => {
        if (!this.encripted) {
            return false;
        }
        try {
            const decrypted = await shell.encryption.decrypt(
                this.model.state.get().content,
                password,
            );
            this.model.state.update((s) => {
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
        this.model.editor.focusEditor();
    };

    makeUnencrypted = () => {
        this.model.state.update((s) => {
            s.password = undefined;
            s.modified = true;
        });
        this.model.io.markModificationUnsaved();
    };

    alertEncryptionError = (err: Error) => {
        ui.notify(err.message || err.name || "Unknown encryption error", "warning");
    };

    /** Encrypt content for saving to disk. Returns undefined on error. */
    mapContentToSave = async (): Promise<string | undefined> => {
        const text = this.model.state.get().content;
        const password = this.model.state.get().password;
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

    /** Decrypt content loaded from disk. Returns undefined on error. */
    mapContentFromFile = async (
        text: string,
    ): Promise<string | undefined> => {
        const password = this.model.state.get().password;
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
}
