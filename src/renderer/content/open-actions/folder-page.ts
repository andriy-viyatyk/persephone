import { pages } from "../../api/pages";
import type { ILinkAction, ILinkData } from "../../../shared/link-data";

export async function openFolderPageAction(
    data: ILinkData,
    action: Extract<ILinkAction, { kind: "folder-page" }>,
): Promise<void> {
    const folderPage = await pages.lifecycle.addEmptyPageWithNavPanel(action.path);
    pages.closeFirstPageIfEmpty();
    data.openedPageId = folderPage.id;
}
