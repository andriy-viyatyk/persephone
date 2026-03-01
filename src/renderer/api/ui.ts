import type {
    IUserInterface,
    IConfirmOptions,
    IInputOptions,
    IInputResult,
    IPasswordOptions,
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
}

export const ui = new UserInterface();
