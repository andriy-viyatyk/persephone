import { errMessage } from "../../shared/utils";

const CONTEXT_LOSS_MESSAGES = [
    "cannot find context with specified id",
    "inspected target navigated or closed",
    "target closed while handling command",
    // Main's answer when the guest WebContents is already gone (a popup that closed itself on press).
    "webcontents not found or destroyed",
];

export function isAutomationContextLoss(error: unknown): boolean {
    const message = errMessage(error).toLowerCase();
    return CONTEXT_LOSS_MESSAGES.some(text => message.includes(text));
}
