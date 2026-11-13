import { ui } from "../../api/ui";
import type { ILinkAction, ILinkData } from "../../../shared/link-data";

export async function showNoticeAction(
    _data: ILinkData,
    action: Extract<ILinkAction, { kind: "notice" }>,
): Promise<void> {
    ui.notify(action.message, action.level);
}
