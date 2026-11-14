import { t } from "../../../shared/i18n/t";

export function formatAboutTabTitle(title?: string): string | undefined {
    return title === "About" ? t("editors.about") : undefined;
}
