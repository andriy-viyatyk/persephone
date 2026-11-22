import { errMessage } from "../../shared/utils";

const CONTEXT_LOSS_MESSAGES = ["Cannot find context with specified id", "Inspected target navigated or closed"];

export function isAutomationContextLoss(error: unknown): boolean {
    const message = errMessage(error);
    return CONTEXT_LOSS_MESSAGES.some(text => message.includes(text));
}
