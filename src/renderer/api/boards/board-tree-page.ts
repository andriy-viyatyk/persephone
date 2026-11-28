import type { BoardOpenTreeRequest, BoardRefreshTreeRequest } from "../../../shared/board/board-tree-request";
import { isBoardOpenTreeRequest } from "../../../shared/board/board-tree-request";
import { isValidBoardTreePath } from "../../../shared/board/board-tree-path";
import type { PagesModel } from "../pages/PagesModel";
import { PageModel } from "../pages/PageModel";
import { attachExplorerSync } from "../../editors/explorer/page-explorer";
import type { ExplorerEditor } from "../../editors/explorer/ExplorerEditorModel";
import { refreshExplorerTree } from "../../editors/explorer/explorer-tree-refresh";
import {
    acceptedBoardTreeProviderForRoot,
    whenProviderDeclarationsReady,
} from "../../content/registry";
import { boardTreeBackingStoreIdentity, boardTreeSourceIdentity } from "../../content/tree-providers/tree-provider-identity";

function matchingExplorerPage(pages: PagesModel, descriptor: BoardOpenTreeRequest): PageModel | undefined {
    const requestedIdentity = boardTreeSourceIdentity(descriptor);
    return pages.query.pages.find((page) => {
        const explorer = page.findExplorer() as ExplorerEditor | undefined;
        const tree = explorer?.state.get().tree;
        return tree !== undefined && boardTreeSourceIdentity(tree) === requestedIdentity;
    });
}

export async function refreshBoardTreePages(
    pages: PagesModel,
    request: BoardRefreshTreeRequest,
    callerRoot: string,
): Promise<number> {
    await whenProviderDeclarationsReady();
    if (!acceptedBoardTreeProviderForRoot(request.type, callerRoot)) {
        throw new Error(`Board is not the accepted owner of tree provider \"${request.type}\".`);
    }

    const backingIdentity = boardTreeBackingStoreIdentity(request);
    const sourceIdentity = request.rootPath === undefined
        ? undefined
        : boardTreeSourceIdentity({ ...request, rootPath: request.rootPath });
    let count = 0;
    for (const page of pages.query.pages) {
        const explorer = page.findExplorer() as ExplorerEditor | undefined;
        const tree = explorer?.state.get().tree;
        if (!explorer || !tree || boardTreeBackingStoreIdentity(tree) !== backingIdentity
            || (sourceIdentity !== undefined && boardTreeSourceIdentity(tree) !== sourceIdentity)) continue;

        count++;
        try {
            await refreshExplorerTree(explorer);
        } catch (error: unknown) {
            console.warn("Explorer tree refresh failed", error);
        }
    }
    return count;
}

export async function openBoardTreePage(
    pages: PagesModel,
    request: unknown,
    callerRoot: string,
): Promise<void> {
    if (!isBoardOpenTreeRequest(request) || !isValidBoardTreePath(request.rootPath)) {
        throw new Error("Invalid board openTree request.");
    }
    await whenProviderDeclarationsReady();
    if (!acceptedBoardTreeProviderForRoot(request.type, callerRoot)) {
        throw new Error(`Board is not the accepted owner of tree provider "${request.type}".`);
    }

    const existing = matchingExplorerPage(pages, request);
    if (existing) {
        existing.ensureSecondaryViewsModel();
        existing.expandPanel("explorer");
        pages.navigation.showPage(existing.id);
        return;
    }

    const tree = {
        type: request.type,
        config: request.config,
        rootPath: request.rootPath,
    };
    const title = request.title ?? `${request.type} — ${request.rootPath}`;
    const page = new PageModel();
    let explorer: ExplorerEditor | undefined;
    try {
        explorer = attachExplorerSync(page, { rootPath: request.rootPath, tree, title });
        page.ensureSecondaryViewsModel();
        page.expandPanel("explorer");
    } catch (error: unknown) {
        void page.dispose();
        throw error;
    }

    // Keep lookup and insertion in one synchronous turn so concurrent opens cannot duplicate pages.
    pages.lifecycle.addPage(null, page);
    pages.navigation.showPage(page.id);
    await page.restore.start(async () => explorer?.restore());
}
