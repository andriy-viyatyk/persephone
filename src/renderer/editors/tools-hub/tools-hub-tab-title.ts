import { t } from "../../../shared/i18n/t";

export function formatToolsHubTabTitle(title?: string): string | undefined {
    return title === "Tools & Editors" ? t("tools.toolsHubPageTitle") : undefined;
}
