import { t } from "../../../shared/i18n/t";

export function formatMcpTabTitle(title?: string): string | undefined {
    return title === "MCP Inspector" ? t("tools.mcpInspectorPageTitle") : undefined;
}
