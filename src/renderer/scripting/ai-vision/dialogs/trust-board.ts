import type { IAiVisionDescriptor } from "ai-vision";
import type { TrustBoardDialogProps } from "../../../ui/dialogs/TrustBoardDialog";
import { BOARD_PERMISSION_INTRODUCTION, PERMISSION_CHANGE_TITLE, boardPermissionDiffLines, boardPermissionLines, permissionChangeMessage } from "../../../editors/board/board-permission-copy";
import { cancelDialog, closeWithResult, descriptor, dialogState, requireButton, type DialogAdapter, type DialogEntry } from "./shared";

const MEMBERS = [
    { name: "title", kind: "property", summary: "The dialog title." },
    { name: "message", kind: "property", summary: "The board permission explanation." },
    { name: "boardPath", kind: "property", summary: "The board root folder." },
    { name: "permissions", kind: "property", summary: "The permission set currently proposed in the trust dialog." },
    { name: "permissionLines", kind: "property", summary: "Read-only plain-language permission lines, including Full access emphasis. In a permission change, each line starts with \"✓ \" (kept), \"+ \" (added) or \"- \" (removed)." },
    { name: "change", kind: "property", summary: "Read-only granted/proposed sets and permission-change details when re-trusting." },
    { name: "serviceDeclared", kind: "property", summary: "Whether a valid service entry is declared." },
    { name: "capabilities", kind: "property", summary: "Capability ids disclosed by the board." },
    { name: "buttons", kind: "property", summary: "Visible response buttons." },
    {
        name: "click", kind: "method", signature: "click(button: string)",
        summary: "Click an exact visible response button; returns the boolean close result.",
        caution: "\"Trust Board\", \"Accept\" and \"Unregister board\" are the user's decisions; never click them on your own judgement. Click one only when the user has explicitly asked for that outcome.",
    },
    { name: "cancel", kind: "method", signature: "cancel()", summary: "Dismiss the dialog without a decision. A new board stays untrusted; a board with a permission change does not run and is removed from its pages (a page left empty closes)." },
] as const;

const TRUST_BOARD_HELP = `Two modes. "Trust this board?" (buttons Cancel / Trust Board) asks to trust a new board and
lists its requested permissions. "Board permissions changed" (buttons Unregister board / Accept,
no cancel button) appears when a trusted board's manifest adds or widens a permission; Accept
grants the new set, Unregister board untrusts the board (and uninstalls a catalog install), and
closing the dialog removes the board from its pages without deciding.
permissionLines provides the same plain-language list shown to the user. A permission-denied error has the form permission-denied: "<flag>" is not enabled
in board-manifest.json. Inspect the source call, add only its required flag or level, then explain
that added grants prompt for approval the next time the board opens or reloads; reductions apply
silently. Review the board before answering using guides.agents["board-review"]. Never click
"Trust Board", "Accept" or "Unregister board" unless the user explicitly asked for that outcome.`;

const AI_VISION: IAiVisionDescriptor = {
    ...descriptor("TrustBoardDialog", "A board trust confirmation dialog.", MEMBERS),
    help: TRUST_BOARD_HELP,
};

export class TrustBoardDialogAdapter implements DialogAdapter {
    constructor(public readonly entry: DialogEntry) {}

    private get state(): TrustBoardDialogProps { return dialogState<TrustBoardDialogProps>(this.entry); }
    get title(): string { return this.state.change ? PERMISSION_CHANGE_TITLE : "Trust this board?"; }
    get message(): string {
        return this.state.change ? permissionChangeMessage(this.state.boardName) : BOARD_PERMISSION_INTRODUCTION;
    }
    get boardPath(): string { return dialogState<TrustBoardDialogProps>(this.entry).boardPath; }
    get permissions(): TrustBoardDialogProps["permissions"] {
        return dialogState<TrustBoardDialogProps>(this.entry).permissions;
    }
    get permissionLines(): readonly string[] {
        const change = this.state.change;
        if (change) {
            const marks = { kept: "✓ ", added: "+ ", removed: "- " } as const;
            return boardPermissionDiffLines(change.granted, change.proposed).map(({ text, fullAccess, mark }) =>
                marks[mark] + text + (fullAccess && mark !== "removed" ? " (Full access)" : ""));
        }
        return boardPermissionLines(this.permissions).flatMap(({ text, fullAccess }) =>
            fullAccess ? [text, "Full access", "Can reach everything your user account can."] : [text]);
    }
    get change(): TrustBoardDialogProps["change"] {
        const change = dialogState<TrustBoardDialogProps>(this.entry).change;
        return change ? { ...change, changes: change.changes.map((item) => ({ ...item })) } : undefined;
    }
    get serviceDeclared(): boolean { return dialogState<TrustBoardDialogProps>(this.entry).serviceDeclared; }
    get capabilities(): readonly string[] { return dialogState<TrustBoardDialogProps>(this.entry).capabilities; }
    get buttons(): readonly string[] {
        return this.state.change ? ["Unregister board", "Accept"] : ["Cancel", "Trust Board"];
    }
    get aiVision(): IAiVisionDescriptor { return AI_VISION; }

    async click(button: string): Promise<unknown> {
        requireButton(this.buttons, button);
        const results: Record<string, boolean | "accept" | "unregister"> = {
            "Cancel": false, "Trust Board": true, "Accept": "accept", "Unregister board": "unregister",
        };
        return await closeWithResult(this.entry, results[button]);
    }

    cancel(): Promise<undefined> { return cancelDialog(this.entry); }
}
