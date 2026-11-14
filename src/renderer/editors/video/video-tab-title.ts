import { englishMessage, t } from "../../../shared/i18n/t";

export function formatVideoTabTitle(title?: string): string | undefined {
    return title === englishMessage("editors.videoPlayer") ? t("editors.videoPlayer") : undefined;
}
