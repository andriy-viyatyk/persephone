import type { IPipeStageStatus } from "../../api/types/io.provider";
import { englishMessage, t } from "../../../shared/i18n/t";

/** Localize built-in HTTP provider status for views while leaving the pipe/API status untouched. */
export function httpStatusDisplayText(
    stageType: string,
    status: IPipeStageStatus,
): string | undefined {
    if (stageType !== "http") return undefined;
    switch (status.state) {
        case "connecting":
        case "active":
            return status.text === englishMessage("api.httpReceiving") ? t("api.httpReceiving") : undefined;
        case "done":
            return status.text === englishMessage("api.httpDownloadComplete") ? t("api.httpDownloadComplete") : undefined;
        case "idle":
            return status.text === englishMessage("api.httpDownloadCanceled") ? t("api.httpDownloadCanceled") : undefined;
        case "error":
            return status.text === englishMessage("api.httpDownloadFailed") ? t("api.httpDownloadFailed") : undefined;
    }
}
