export const DialogButton = {
    delete: "Delete",
    save: "Save",
    dontSave: "Don't Save",
    cancel: "Cancel",
    overwrite: "Overwrite",
    yes: "Yes",
    no: "No",
    ok: "OK",
    move: "Move",
    copy: "Copy",
    create: "Create",
    rename: "Rename",
    clear: "Clear",
    reset: "Reset",
    remove: "Remove",
    add: "Add",
    commit: "Commit",
    commitAndPush: "Commit & Push",
} as const;

export interface DialogButtonDefinition {
    id: string;
    label: string;
}

export function dialogButton(id: string): DialogButtonDefinition {
    return { id, label: id };
}

export type DialogButtonInput = string | DialogButtonDefinition;

export function normalizeDialogButton(button: DialogButtonInput): DialogButtonDefinition {
    return typeof button === "string" ? dialogButton(button) : button;
}
