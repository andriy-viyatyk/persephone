import type { LogViewModel } from "../../editors/log-view/LogViewModel";
import type { StyledText, ConfirmDialogData, TextDialogData, ButtonsDialogData, DialogResult } from "../../editors/log-view/logTypes";

/**
 * Script facade for the `ui` global variable.
 * Wraps a LogViewModel to provide logging and dialog methods.
 */
export class UiFacade {
    constructor(private readonly vm: LogViewModel) {}

    // =========================================================================
    // Logging (fire-and-forget)
    // =========================================================================

    log(message: StyledText) { this.vm.addEntry("log.text", message); }
    info(message: StyledText) { this.vm.addEntry("log.info", message); }
    warn(message: StyledText) { this.vm.addEntry("log.warn", message); }
    error(message: StyledText) { this.vm.addEntry("log.error", message); }
    success(message: StyledText) { this.vm.addEntry("log.success", message); }
    text(message: StyledText) { this.vm.addEntry("log.text", message); }
    clear() { this.vm.clear(); }

    // =========================================================================
    // Dialogs (async, returns Promise)
    // =========================================================================

    readonly dialog = {
        confirm: (message: StyledText, buttons?: string[]): Promise<DialogResult> => {
            const data: ConfirmDialogData = { message, buttons };
            return this.vm.addDialogEntry("input.confirm", data);
        },

        buttons: (buttons: string[], title?: StyledText): Promise<DialogResult> => {
            const data: ButtonsDialogData = { buttons, title };
            return this.vm.addDialogEntry("input.buttons", data);
        },

        textInput: (title?: StyledText, options?: { placeholder?: string; defaultValue?: string; buttons?: string[] }): Promise<DialogResult> => {
            const data: TextDialogData = { title, ...options };
            return this.vm.addDialogEntry("input.text", data);
        },
    };

    // =========================================================================
    // Output (Phase 3 stub)
    // =========================================================================

    readonly show: undefined = undefined;
}
