import type { IAiVisionDescriptor } from "ai-vision";
import { actionButtonLabel, type CommitDialogModel, type CommitDialogProps } from "../../../ui/dialogs/CommitDialog";
import { DialogButton } from "../../../ui/dialogs/dialog-buttons";
import { cancelDialog, descriptor, dialogState, modelWith, type DialogAdapter, type DialogEntry } from "./shared";

const MEMBERS = [
    { name: "title", kind: "property", summary: "The dialog title." },
    { name: "branch", kind: "property", summary: "The target branch." },
    { name: "message", kind: "property", summary: "The commit message." },
    { name: "name", kind: "property", summary: "The commit author name." },
    { name: "email", kind: "property", summary: "The commit author email." },
    { name: "buttons", kind: "property", summary: "Visible response buttons." },
    { name: "committing", kind: "property", summary: "Whether a commit is in progress." },
    { name: "click", kind: "method", signature: "click(idOrLabel: string)", summary: "Click by unique id first, then by unique exact displayed label." },
    { name: "cancel", kind: "method", signature: "cancel()", summary: "Dismiss the dialog without selecting a response." },
] as const;
const AI_VISION = descriptor("CommitDialog", "A commit dialog awaiting a response.", MEMBERS);

export class CommitDialogAdapter implements DialogAdapter {
    constructor(public readonly entry: DialogEntry) {}

    private get state(): CommitDialogProps { return dialogState<CommitDialogProps>(this.entry); }
    private get model(): CommitDialogModel { return modelWith<CommitDialogModel>(this.entry); }

    get title(): string | undefined { return this.state.title; }
    get message(): string { return this.state.message ?? ""; }
    get branch(): string { return this.state.branch ?? ""; }
    get name(): string { return this.state.name ?? ""; }
    get email(): string { return this.state.email ?? ""; }
    get buttons(): readonly string[] {
        const state = this.state;
        const branchChanged = !!state.branch?.trim() && state.branch.trim() !== (state.originalBranch ?? "");
        return (state.buttons ?? ["Commit", "Cancel"]).map((button) =>
            button === DialogButton.cancel ? button : actionButtonLabel(button, branchChanged),
        );
    }
    get buttonIds(): readonly string[] { return this.state.buttons ?? ["Commit", "Cancel"]; }
    get committing(): boolean { return !!this.state.committing; }
    get aiVision(): IAiVisionDescriptor { return AI_VISION; }

    async click(button: string): Promise<unknown> {
        const state = this.state;
        const branchChanged = !!state.branch.trim() && state.branch.trim() !== (state.originalBranch ?? "");
        const underlyingButtons = state.buttons ?? ["Commit", "Cancel"];
        const idMatches = underlyingButtons.filter((candidate) => candidate === button);
        if (idMatches.length > 1) throw new Error(`Dialog button id ${JSON.stringify(button)} is duplicated.`);
        const labelMatches = underlyingButtons.filter((candidate) =>
            (candidate === DialogButton.cancel ? candidate : actionButtonLabel(candidate, branchChanged)) === button,
        );
        const underlyingButton = idMatches[0] ?? (labelMatches.length === 1 ? labelMatches[0] : undefined);
        if (labelMatches.length > 1 && idMatches.length === 0) {
            throw new Error(`Dialog button label ${JSON.stringify(button)} is ambiguous.`);
        }
        if (!underlyingButton) {
            throw new Error(`Dialog button ${JSON.stringify(button)} is unavailable.`);
        }
        if (underlyingButton === "Cancel") return this.cancel();
        if (state.committing || !state.message?.trim() || !state.branch?.trim()) {
            throw new Error(`Dialog button ${JSON.stringify(button)} is disabled.`);
        }
        await this.model.submit(underlyingButton, actionButtonLabel(underlyingButton, branchChanged));
        return undefined;
    }

    cancel(): Promise<undefined> { return cancelDialog(this.entry); }
}
