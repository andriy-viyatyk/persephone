/**
 * A text segment with optional inline styles.
 *
 * @example
 * ui.log([
 *     { text: "Hello ", styles: { color: "#888" } },
 *     { text: "World", styles: { fontWeight: "bold" } },
 * ]);
 */
export interface IStyledSegment {
    text: string;
    styles?: Record<string, string | number>;
}

/** Text that can be either a plain string or an array of styled segments. */
export type IStyledText = string | IStyledSegment[];

// =============================================================================
// Dialog Results
// =============================================================================

/**
 * Result of a dialog interaction.
 * `button` is the label of the clicked button, or `undefined` if the dialog was canceled
 * (e.g., the Log View page was closed while the dialog was pending).
 *
 * The result object also contains all the original data fields passed to the dialog,
 * plus any fields added by user interaction (e.g., `text` for text input dialogs).
 */
export interface IDialogResult {
    button: string | undefined;
    [key: string]: any;
}

// =============================================================================
// Dialog Namespace
// =============================================================================

export interface IUiDialog {
    /**
     * Show a confirmation dialog with a message and optional custom buttons.
     * Default buttons: ["No", "Yes"].
     *
     * @example
     * const result = await ui.dialog.confirm("Delete all items?");
     * if (result.button === "Yes") { deleteAll(); }
     *
     * @example
     * const result = await ui.dialog.confirm("Save changes?", ["Save", "Discard", "Cancel"]);
     * if (result.button === "Save") { save(); }
     */
    confirm(message: IStyledText, buttons?: string[]): Promise<IDialogResult>;

    /**
     * Show a dialog with custom buttons. Use `!` prefix to mark a button as requiring input.
     *
     * @example
     * const result = await ui.dialog.buttons(["Option A", "Option B", "Cancel"], "Choose an option");
     * if (!result.button) return; // canceled
     */
    buttons(buttons: string[], title?: IStyledText): Promise<IDialogResult>;

    /**
     * Show a text input dialog. Returns the entered text in `result.text`.
     * Default buttons: ["OK"]. Use `!` prefix for buttons that require non-empty input.
     *
     * @example
     * const result = await ui.dialog.textInput("Enter your name", {
     *     placeholder: "Name...",
     *     defaultValue: "World",
     *     buttons: ["!OK", "Cancel"],
     * });
     * if (result.button === "OK") {
     *     ui.log(`Hello, ${result.text}!`);
     * }
     */
    textInput(title?: IStyledText, options?: {
        placeholder?: string;
        defaultValue?: string;
        buttons?: string[];
    }): Promise<IDialogResult>;
}

// =============================================================================
// Main Interface
// =============================================================================

/**
 * Log View UI facade. Available as the global `ui` variable in scripts.
 *
 * The `ui` object is lazy-initialized: the Log View page is created when the script
 * first accesses `ui`. If the script runs in context of a page, the Log View is
 * auto-grouped with that page.
 *
 * @example
 * // Logging
 * ui.log("Hello, world!");
 * ui.info("Processing...");
 * ui.warn("Watch out!");
 * ui.error("Something went wrong");
 * ui.success("Done!");
 *
 * // Styled text
 * ui.log([
 *     { text: "Status: " },
 *     { text: "OK", styles: { color: "#4caf50", fontWeight: "bold" } },
 * ]);
 *
 * // Dialogs
 * const result = await ui.dialog.confirm("Continue?");
 * if (result.button === "Yes") {
 *     const input = await ui.dialog.textInput("Enter value");
 *     if (input.button) {
 *         ui.success(`You entered: ${input.text}`);
 *     }
 * }
 */
export interface IUiLog {
    /** Log a message (default level). */
    log(message: IStyledText): void;
    /** Log an info message. */
    info(message: IStyledText): void;
    /** Log a warning message. */
    warn(message: IStyledText): void;
    /** Log an error message. */
    error(message: IStyledText): void;
    /** Log a success message. */
    success(message: IStyledText): void;
    /** Alias for `log()`. */
    text(message: IStyledText): void;
    /** Remove all log entries. */
    clear(): void;

    /** Dialog methods for interactive user input. */
    readonly dialog: IUiDialog;
}
