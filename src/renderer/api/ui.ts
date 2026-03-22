import type {
    IUserInterface,
    IConfirmOptions,
    IInputOptions,
    IInputResult,
    IPasswordOptions,
    ITextDialogOptions,
    ITextDialogResult,
    NotificationType,
} from "./types/ui";
import { alertsBarModel } from "../ui/dialogs/alerts/AlertsBar";

class UserInterface implements IUserInterface {
    async confirm(message: string, options?: IConfirmOptions): Promise<string | null> {
        const { showConfirmationDialog } = await import("../ui/dialogs/ConfirmationDialog");
        const result = await showConfirmationDialog({
            message,
            ...options,
        });
        return result ?? null;
    }

    async input(message: string, options?: IInputOptions): Promise<IInputResult | null> {
        const { showInputDialog } = await import("../ui/dialogs/InputDialog");
        const result = await showInputDialog({
            message,
            ...options,
        });
        return result ?? null;
    }

    async password(options?: IPasswordOptions): Promise<string | null> {
        const { showPasswordDialog } = await import("../ui/dialogs/PasswordDialog");
        const result = await showPasswordDialog(options);
        return result ?? null;
    }

    notify(message: string, type?: NotificationType): Promise<string | undefined> {
        return alertsBarModel.addAlert(message, type ?? "info") as Promise<string | undefined>;
    }

    async textDialog(options: ITextDialogOptions): Promise<ITextDialogResult | null> {
        const { showTextDialog } = await import("../ui/dialogs/TextDialog");
        const result = await showTextDialog(options);
        return result ?? null;
    }

    async showProgress<T>(promise: Promise<T>, label?: string): Promise<T> {
        const { showProgress } = await import("../ui/dialogs/progress/ProgressModel");
        return showProgress(promise, label ?? "Processing...");
    }

    async createProgress(label?: string): Promise<import("../ui/dialogs/progress/ProgressModel").ProgressHandle> {
        const { createProgress } = await import("../ui/dialogs/progress/ProgressModel");
        return createProgress(label ?? "Processing...");
    }

    notifyProgress(label: string, timeout?: number): void {
        import("../ui/dialogs/progress/ProgressModel").then(({ notifyProgress }) => {
            notifyProgress(label, timeout);
        });
    }

    async addScreenLock(): Promise<{ release: () => void }> {
        const { addScreenLock, removeScreenLock } = await import("../ui/dialogs/progress/ProgressModel");
        const lock = addScreenLock();
        return { release: () => removeScreenLock(lock) };
    }
}

export const ui = new UserInterface();
