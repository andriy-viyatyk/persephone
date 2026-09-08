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
    NotificationType,
} from "./types/ui";
import type { IAiHighlightApi } from "ai-vision/dom";
import { installHighlightOverlay } from "ai-vision/dom";
import { alertsBarModel } from "../uikit";

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
