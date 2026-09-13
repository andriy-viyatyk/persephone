import type { IAiVisionDescriptor } from "ai-vision";
import type { TrustBoardDialogProps } from "../../../ui/dialogs/TrustBoardDialog";
import { cancelDialog, closeWithResult, descriptor, dialogState, requireButton, type DialogAdapter, type DialogEntry } from "./shared";

const MEMBERS = [
    { name: "title", kind: "property", summary: "The dialog title." },
    { name: "message", kind: "property", summary: "The trust warning." },
    { name: "boardPath", kind: "property", summary: "The board root folder." },
    { name: "buttons", kind: "property", summary: "Visible response buttons." },
    {
        name: "click", kind: "method", signature: "click(button: string)",
        summary: "Click an exact visible response button; returns the boolean close result.",
        caution: "\"Trust Board\" is the user's decision — never click it on your own judgement; click it only when the user has asked for the board to be trusted.",
    },
    { name: "cancel", kind: "method", signature: "cancel()", summary: "Dismiss the dialog without trusting it." },
] as const;
const TRUST_BOARD_HELP = `Trusting a board grants it the user's full privileges: any command line
through the OS shell, absolute-path file reads and writes, and persephone.call() over the whole
object model. Review the board before this dialog is answered — guides.agents["board-review"] is
the checklist, and it also covers why code a board downloads at runtime cannot be reviewed at all.
Report what you found rather than deciding: never click "Trust Board" on your own judgement. When
the user has asked for the board to be trusted, clicking it carries out their decision — raise any
finding first, then proceed if they confirm.`;
const AI_VISION: IAiVisionDescriptor = {
    ...descriptor("TrustBoardDialog", "A board trust confirmation dialog.", MEMBERS),
    help: TRUST_BOARD_HELP,
};

export class TrustBoardDialogAdapter implements DialogAdapter {
    constructor(public readonly entry: DialogEntry) {}

    get title(): string { return "Trust this board?"; }
    // Mirrors TrustBoardDialogView.ts:30-35 and :57.
    get message(): string {
        return "Trusting this board lets it run programs on your computer with your full user privileges — including reading and changing your files and using any signed-in command-line tools (cloud CLIs, git, etc.).";
    }
    get boardPath(): string { return dialogState<TrustBoardDialogProps>(this.entry).boardPath; }
    get buttons(): readonly string[] { return ["Cancel", "Trust Board"]; }
    get aiVision(): IAiVisionDescriptor { return AI_VISION; }

    async click(button: string): Promise<unknown> {
        requireButton(this.buttons, button);
        return await closeWithResult(this.entry, button === "Trust Board");
    }

    cancel(): Promise<undefined> { return cancelDialog(this.entry); }
}
