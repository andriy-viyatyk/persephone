import { englishMessage, t } from "../../../shared/i18n/t";

export function formatSettingsTabTitle(title?: string): string | undefined {
    return title === englishMessage("settings.pageTitle") ? t("settings.pageTitle") : undefined;
}
