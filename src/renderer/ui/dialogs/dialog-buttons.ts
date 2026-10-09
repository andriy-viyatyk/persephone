import { t } from "../../../shared/i18n/t";

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

const BUILT_IN_LABEL_KEYS: Record<string, Parameters<typeof t>[0]> = {
    [DialogButton.delete]: "dialogs.buttonDelete",
    [DialogButton.save]: "dialogs.buttonSave",
    [DialogButton.dontSave]: "dialogs.buttonDontSave",
    [DialogButton.cancel]: "dialogs.buttonCancel",
    [DialogButton.overwrite]: "dialogs.buttonOverwrite",
    [DialogButton.yes]: "dialogs.buttonYes",
    [DialogButton.no]: "dialogs.buttonNo",
    [DialogButton.ok]: "dialogs.buttonOk",
    [DialogButton.move]: "dialogs.buttonMove",
    [DialogButton.copy]: "dialogs.buttonCopy",
    [DialogButton.create]: "dialogs.buttonCreate",
    [DialogButton.rename]: "dialogs.buttonRename",
    [DialogButton.clear]: "dialogs.buttonClear",
    [DialogButton.reset]: "dialogs.buttonReset",
    [DialogButton.remove]: "dialogs.buttonRemove",
    [DialogButton.add]: "dialogs.buttonAdd",
    [DialogButton.commit]: "dialogs.buttonCommit",
    [DialogButton.commitAndPush]: "dialogs.buttonCommitAndPush",
};

export function dialogButtonLabel(button: DialogButtonDefinition): string {
    const key = BUILT_IN_LABEL_KEYS[button.id];
    return key && button.label === button.id ? t(key) : button.label;
}

export function builtInDialogButtonLabel(id: string): string | undefined {
    const key = BUILT_IN_LABEL_KEYS[id];
    return key ? t(key) : undefined;
}

export function dialogButton(id: string): DialogButtonDefinition {
    return { id, label: id };
}

export type DialogButtonInput = string | DialogButtonDefinition;

export function normalizeDialogButton(button: DialogButtonInput): DialogButtonDefinition {
    return typeof button === "string" ? dialogButton(button) : button;
}
