import type {
    IUserInterface,
    IConfirmOptions,
    IInputOptions,
    IInputResult,
    IPasswordOptions,
    ITextDialogOptions,
    ITextDialogResult,
    IHighlightOptions,
    IHighlightResult,
    IAlerts,
    IAlert,
    NotificationType,
} from "./types/ui";
import type { IAiHighlightApi } from "ai-vision/dom";
import { installHighlightOverlay } from "ai-vision/dom";
import { alertsBarModel, maxAlerts } from "../uikit/Notification/AlertsBar";
import type { AlertData } from "../uikit/Notification/AlertItem";

export function listAlerts(): IAlert[] {
    return alertsBarModel.state.get().alerts.map((alert, index) => ({
        key: alert.key,
        type: alert.type,
        message: alert.message,
        createdAt: alert.createdAt,
        visible: index < maxAlerts,
    }));
}

function findAlert(key: number): AlertData | undefined {
    return alertsBarModel.state.get().alerts.find((alert) => alert.key === key);
}

export function countAlerts(type?: NotificationType): number {
    return alertsBarModel.state.get().alerts.filter((alert) => type === undefined || alert.type === type).length;
}

export function closeAlert(key: number): boolean {
    const alert = findAlert(key);
    if (!alert) return false;
    alert.onClose();
    return true;
}

export function closeAllAlerts(type?: NotificationType): number {
    const alerts = alertsBarModel.state.get().alerts.filter((alert) => type === undefined || alert.type === type);
    alerts.forEach((alert) => alert.onClose());
    return alerts.length;
}

const alerts: IAlerts = {
    list: listAlerts,
    count: countAlerts,
    close: closeAlert,
    closeAll: closeAllAlerts,
};

/** Internal renderer request for a declaration-scoped temporary reveal. */
export interface IHighlightRevealRequest {
    readonly selector: string;
    readonly display: string;
}

type IHighlightApi = IAiHighlightApi;

export interface IDeclarationHighlightOptions {
    readonly id: string;
    readonly buttons: readonly string[];
    readonly onButton: (label: string, id: string) => void;
}

declare global {
    interface Window {
        __aiVisionHighlight?: IHighlightApi;
    }
}

class UserInterface implements IUserInterface {
    readonly alerts = alerts;

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
        const { showProgress } = await import("../uikit/Progress/progressModel");
        return showProgress(promise, label ?? "Processing...");
    }

    async createProgress(label?: string): Promise<import("../uikit/Progress/progressModel").ProgressHandle> {
        const { createProgress } = await import("../uikit/Progress/progressModel");
        return createProgress(label ?? "Processing...");
    }

    notifyProgress(label: string, timeout?: number): void {
        import("../uikit/Progress/progressModel").then(({ notifyProgress }) => {
            notifyProgress(label, timeout);
        });
    }

    async addScreenLock(): Promise<{ release: () => void }> {
        const { addScreenLock, removeScreenLock } = await import("../uikit/Progress/progressModel");
        const lock = addScreenLock();
        return { release: () => removeScreenLock(lock) };
    }

    async highlightElement(
        selector: string,
        text?: string,
        options?: IHighlightOptions,
        reveal?: IHighlightRevealRequest,
    ): Promise<IHighlightResult> {
        const api = await loadHighlight();
        const highlightOptions = { ...options } as IHighlightOptions;
        // reveal is declaration-owned; do not let an undeclared runtime property on a script's
        // options object turn the public highlight method into a general-purpose style override.
        delete (highlightOptions as IHighlightOptions & { reveal?: unknown }).reveal;
        return api.show({
            ...highlightOptions,
            selector,
            text: text ?? options?.text,
            ...(reveal ? { reveal } : {}),
        });
    }

    async clearHighlights(id?: string): Promise<number> {
        const api = window.__aiVisionHighlight;
        // Nothing loaded means nothing highlighted; do not install the module just to clear.
        if (!api) return 0;
        return api.clear(id);
    }
}

// Element highlighting uses the published package overlay.
let highlightLoader: Promise<IHighlightApi> | undefined;

function loadHighlight(): Promise<IHighlightApi> {
    if (!highlightLoader) {
        highlightLoader = Promise.resolve()
            .then(() => installHighlightOverlay())
            .catch((error) => {
                highlightLoader = undefined;
                throw error;
            });
    }
    return highlightLoader;
}

/** Draw a curated declaration highlight with options owned by the declaration provider. */
export async function highlightDeclarationElement(
    selector: string,
    text: string | undefined,
    options: IDeclarationHighlightOptions,
    reveal?: IHighlightRevealRequest,
): Promise<IHighlightResult> {
    const api = await loadHighlight();
    return api.show({
        id: options.id,
        buttons: options.buttons,
        onButton: options.onButton,
        selector,
        text,
        ...(reveal ? { reveal } : {}),
    });
}

export const ui = new UserInterface();
