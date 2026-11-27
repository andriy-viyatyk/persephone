import type { IAiVisionDescriptor } from "ai-vision";
import type { TreeConflictAction } from "../../../content/tree-providers/TreeTransfer";
import type { TreeTransferConflictDialogModel, TreeTransferConflictDialogState } from "../../../api/dialogs/TreeTransferConflictDialog";
import { descriptor, dialogState, modelWith, requireButton, type DialogAdapter, type DialogEntry } from "./shared";

const OVERWRITE = "Overwrite";
const KEEP_BOTH = "Keep Both";
const SKIP = "Skip";
const CANCEL = "Cancel";

const MEMBERS = [
    { name: "title", kind: "property", summary: "The conflict dialog title." },
    { name: "message", kind: "property", summary: "The source and destination paths involved in the conflict." },
    { name: "sourceName", kind: "property", summary: "The conflicting source item name." },
    { name: "destinationPath", kind: "property", summary: "The existing destination path." },
    { name: "sourceKind", kind: "property", summary: "Whether the source is a file or folder." },
    { name: "destinationKind", kind: "property", summary: "Whether the destination is a file or folder." },
    { name: "applyToAll", kind: "property", summary: "Whether this choice will apply to subsequent conflicts." },
    { name: "buttons", kind: "property", summary: "Visible conflict choices." },
    { name: "setApplyToAll", kind: "method", signature: "setApplyToAll(enabled: boolean)", summary: "Set whether this choice applies to subsequent conflicts." },
    { name: "click", kind: "method", signature: "click(button: string)", summary: "Choose Overwrite, Keep Both, Skip, or Cancel." },
    { name: "cancel", kind: "method", signature: "cancel()", summary: "Cancel the transfer and dismiss the conflict." },
] as const;
const AI_VISION = descriptor("TreeTransferConflictDialog", "A file or folder name conflict during a tree transfer.", MEMBERS);

interface ConflictModel {
    setApplyToAll(enabled: boolean): void;
    choose(action: TreeConflictAction): Promise<boolean>;
    cancel(): void;
}

const ACTIONS: Readonly<Record<string, TreeConflictAction>> = {
    [OVERWRITE]: "overwrite",
    [KEEP_BOTH]: "keep-both",
    [SKIP]: "skip",
};

export class TreeTransferConflictDialogAdapter implements DialogAdapter {
    constructor(public readonly entry: DialogEntry) {}

    private get state(): TreeTransferConflictDialogState { return dialogState<TreeTransferConflictDialogState>(this.entry); }
    private get model(): ConflictModel { return modelWith<TreeTransferConflictDialogModel>(this.entry); }
    private get conflict() { return this.state.conflict; }

    get title(): string { return "An item with this name already exists"; }
    get message(): string { return `${this.conflict.source.title} conflicts with ${this.conflict.destinationPath}.`; }
    get sourceName(): string { return this.conflict.source.title; }
    get destinationPath(): string { return this.conflict.destinationPath; }
    get sourceKind(): string { return this.conflict.sourceKind; }
    get destinationKind(): string { return this.conflict.destinationKind; }
    get applyToAll(): boolean { return this.state.applyToAll; }
    get buttons(): readonly string[] { return [OVERWRITE, KEEP_BOTH, SKIP, CANCEL]; }
    get aiVision(): IAiVisionDescriptor { return AI_VISION; }

    setApplyToAll(enabled: boolean): void {
        if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
        this.model.setApplyToAll(enabled);
    }

    async click(button: string): Promise<unknown> {
        requireButton(this.buttons, button);
        if (button === CANCEL) return this.cancel();
        return this.model.choose(ACTIONS[button]);
    }

    async cancel(): Promise<undefined> {
        this.model.cancel();
        return undefined;
    }
}
