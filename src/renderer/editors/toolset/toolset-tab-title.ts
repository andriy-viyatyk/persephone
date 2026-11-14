import { englishMessage, t } from "../../../shared/i18n/t";

export function formatToolsetTabTitle(title?: string): string | undefined {
    return title === englishMessage("board.agentTool") ? t("board.agentTool") : undefined;
}
