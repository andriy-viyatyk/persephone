import type { IAiVisionDescriptor } from "ai-vision";
import type { TrustBoardDialogProps } from "../../../ui/dialogs/TrustBoardDialog";
import { BOARD_PERMISSION_INTRODUCTION, boardPermissionLines } from "../../../editors/board/board-permission-copy";
import { cancelDialog, closeWithResult, descriptor, dialogState, requireButton, type DialogAdapter, type DialogEntry } from "./shared";

const MEMBERS = [
    { name: "title", kind: "property", summary: "The dialog title." },
    { name: "message", kind: "property", summary: "The board permission explanation." },
    { name: "boardPath", kind: "property", summary: "The board root folder." },
    { name: "permissions", kind: "property", summary: "The permission set currently proposed in the trust dialog." },
    { name: "permissionLines", kind: "property", summary: "Read-only plain-language permission lines, including Full access emphasis." },
    { name: "change", kind: "property", summary: "Read-only granted/proposed sets and permission-change details when re-trusting." },
    { name: "serviceDeclared", kind: "property", summary: "Whether a valid service entry is declared." },
    { name: "capabilities", kind: "property", summary: "Capability ids disclosed by the board." },
    { name: "buttons", kind: "property", summary: "Visible response buttons." },
    {
        name: "click", kind: "method", signature: "click(button: string)",
        summary: "Click an exact visible response button; returns the boolean close result.",
        caution: "\"Trust Board\" is the user's decision; never click it on your own judgement. Click it only when the user has explicitly asked for this board to be trusted.",
    },
    { name: "cancel", kind: "method", signature: "cancel()", summary: "Dismiss the dialog without trusting it." },
] as const;

const TRUST_BOARD_HELP = `This dialog shows the permissions proposed by the board and, when re-trusting,
the current granted set and pending change. permissionLines provides the same plain-language list
shown to the user. A permission-denied error has the form permission-denied: "<flag>" is not enabled
in board-manifest.json. Inspect the source call, add only its required flag or level, then explain
that added grants prompt for approval the next time the board opens or reloads; reductions apply
silently. Review the board before answering using guides.agents["board-review"]. Never click
"Trust Board" unless the user explicitly asked you to trust this board.`;

const AI_VISION: IAiVisionDescriptor = {
    ...descriptor("TrustBoardDialog", "A board trust confirmation dialog.", MEMBERS),
    help: TRUST_BOARD_HELP,
};

export class TrustBoardDialogAdapter implements DialogAdapter {
    constructor(public readonly entry: DialogEntry) {}

    get title(): string { return "Trust this board?"; }
    get message(): string { return BOARD_PERMISSION_INTRODUCTION; }
    get boardPath(): string { return dialogState<TrustBoardDialogProps>(this.entry).boardPath; }
    get permissions(): TrustBoardDialogProps["permissions"] {
        return dialogState<TrustBoardDialogProps>(this.entry).permissions;
    }
    get permissionLines(): readonly string[] {
        return boardPermissionLines(this.permissions).flatMap(({ text, fullAccess }) =>
            fullAccess ? [text, "Full access", "Can reach everything your user account can."] : [text]);
    }
    get change(): TrustBoardDialogProps["change"] {
        const change = dialogState<TrustBoardDialogProps>(this.entry).change;
        return change ? { ...change, changes: change.changes.map((item) => ({ ...item })) } : undefined;
    }
    get serviceDeclared(): boolean { return dialogState<TrustBoardDialogProps>(this.entry).serviceDeclared; }
    get capabilities(): readonly string[] { return dialogState<TrustBoardDialogProps>(this.entry).capabilities; }
    get buttons(): readonly string[] { return ["Cancel", "Trust Board"]; }
    get aiVision(): IAiVisionDescriptor { return AI_VISION; }

    async click(button: string): Promise<unknown> {
        requireButton(this.buttons, button);
        return await closeWithResult(this.entry, button === "Trust Board");
    }

    cancel(): Promise<undefined> { return cancelDialog(this.entry); }
}
