import type { NotificationType } from "../../api/types/ui";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";

type GuardReporter = (message: string, level: NotificationType) => void;

let reporter: GuardReporter | undefined;
const pendingReports: Array<{ message: string; level: NotificationType }> = [];

export function setGuardReporter(next: GuardReporter): void {
    reporter = next;
    for (const report of pendingReports.splice(0)) next(report.message, report.level);
}

/**
 * Run `fn`, reporting any failure as a toast instead of letting it escape.
 *
 * For the very common handler shape "do the thing; if it throws, tell the user and
 * carry on". `label` is the full prefix, so `guard("Failed to open file", …)`
 * produces exactly `Failed to open file: <message>`.
 *
 * Only use this where swallowing the error is genuinely right — the caller learns
 * nothing beyond `undefined`. When the catch has to update state, log, or re-throw,
 * keep the explicit `try`/`catch`.
 */
export async function guard<T>(
    label: string,
    fn: () => T | Promise<T>,
    level: NotificationType = "error",
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err) {
        const message = t("api.actionFailed", { action: label, error: errMessage(err) });
        if (reporter) reporter(message, level);
        else pendingReports.push({ message, level });
        return undefined;
    }
}
