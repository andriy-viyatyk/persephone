import { t } from "../../../shared/i18n/t";

export function formatBrowserTabTitle(title?: string): string | undefined {
    if (title === "Browser") return t("browser.pageTitle");
    if (title === "Browser (agent)") return t("browser.pageTitleAgent");
    return undefined;
}
