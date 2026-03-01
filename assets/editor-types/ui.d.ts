/**
 * Options for the confirmation dialog.
 *
 * @example
 * await app.ui.confirm("Delete this file?", { title: "Confirm Delete", buttons: ["Delete", "Keep"] });
 */
export interface IConfirmOptions {
    /** Dialog title. Defaults to "Confirmation". */
    title?: string;
    /** Button labels. Defaults to ["Yes", "Cancel"]. */
    buttons?: string[];
}

/**
 * Options for the input dialog.
 *
 * @example
 * const result = await app.ui.input("Enter file name:", { value: "untitled.txt", selectAll: true });
 */
export interface IInputOptions {
    /** Dialog title. Defaults to "Input". */
    title?: string;
    /** Initial input value. Defaults to "". */
    value?: string;
    /** Button labels. Defaults to ["OK", "Cancel"]. */
    buttons?: string[];
    /** Select all text on open. Defaults to false. */
    selectAll?: boolean;
}

/**
 * Result returned by the input dialog on confirm.
 */
export interface IInputResult {
    /** The value entered by the user. */
    value: string;
    /** The button label that was clicked. */
    button: string;
}

/**
 * Options for the password dialog.
 *
 * @example
 * const password = await app.ui.password({ mode: "encrypt" });
 */
export interface IPasswordOptions {
    /** Dialog mode: "encrypt" shows confirm field, "decrypt" does not. Defaults to "decrypt". */
    mode?: "encrypt" | "decrypt";
}

/** Notification type for toast alerts. */
export type NotificationType = "info" | "success" | "warning" | "error";

/**
 * Dialogs and notifications.
 *
 * @example
 * const answer = await app.ui.confirm("Save changes?");
 * if (answer === "Yes") { ... }
 *
 * app.ui.notify("File saved", "success");
 */
export interface IUserInterface {
    /**
     * Show a confirmation dialog.
     * Returns the clicked button label, or `null` if dismissed.
     *
     * @example
     * const answer = await app.ui.confirm("Delete this item?");
     * if (answer === "Yes") { deleteItem(); }
     */
    confirm(message: string, options?: IConfirmOptions): Promise<string | null>;

    /**
     * Show an input dialog.
     * Returns the input result, or `null` if dismissed.
     *
     * @example
     * const result = await app.ui.input("Enter name:", { value: "default" });
     * if (result) { console.log(result.value); }
     */
    input(message: string, options?: IInputOptions): Promise<IInputResult | null>;

    /**
     * Show a password dialog.
     * Returns the entered password, or `null` if dismissed.
     *
     * @example
     * const password = await app.ui.password({ mode: "encrypt" });
     * if (password) { await app.shell.encryption.encrypt(data, password); }
     */
    password(options?: IPasswordOptions): Promise<string | null>;

    /**
     * Show a toast notification.
     * Resolves with `"clicked"` if the user clicks the notification, or `undefined` if dismissed.
     * Can be used fire-and-forget (ignore the returned promise) or awaited for interaction.
     *
     * @example
     * app.ui.notify("Operation complete", "success");
     * app.ui.notify("Something went wrong", "error");
     *
     * const result = await app.ui.notify("Click me!", "info");
     * if (result === "clicked") { console.log("User clicked the notification"); }
     */
    notify(message: string, type?: NotificationType): Promise<string | undefined>;
}
