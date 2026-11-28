import type { ExplorerEditor } from "./ExplorerEditorModel";

/** Refresh an Explorer without mounting its sidebar or changing page navigation. */
export async function refreshExplorerTree(explorer: ExplorerEditor): Promise<void> {
    const viewModel = explorer.treeProviderViewModel;
    if (viewModel) {
        await viewModel.buildTree();
        return;
    }

    const provider = explorer.treeProvider;
    if (!provider) return;
    try {
        await provider.list(provider.rootPath);
    } catch (error: unknown) {
        // Mounted trees surface list errors in their existing view state. Keep the
        // same best-effort behavior for an unmounted tree and continue other pages.
        console.warn("Explorer tree refresh failed", error);
    }
}
