import { InternalEditorIds } from "../base/editor-ids";
import { EditorModel, type EditorModelInstance, type EditorStateBase } from "../base/EditorModel";
import { TComponentState, TOneState } from "../../core/state/state";
import type { IPageHost } from "../../api/pages/IPageHost";
import type { EditorDescriptor } from "../../../shared/persistence";
import type { EditorRestoreModule } from "../base/editorRegistry";
import { app } from "../../api/app";
import { boardRegistry } from "../../api/boards/board-registry";
import { toolsTrust } from "../../api/tools/tools-trust";
import { registeredTools } from "../../api/tools/registered-tools";
import { readToolsManifest } from "../../api/tools/tools-manifest";
import { showRegisterToolsetDialog } from "../../ui/dialogs/RegisterToolsetDialog";
import { fpBasename } from "../../core/utils/file-path";
import { createLinkData } from "../../../shared/link-data";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { openToolset as openToolsetLink } from "../../content/persephone-toolset-link";
import type { ExplorerEditorState } from "../explorer/ExplorerEditorModel";
import { untranslated } from "../../../shared/i18n/t";

export type BoardsPanelTab = "boards" | "tools";

interface BoardsPanelEditorState extends EditorStateBase {}

export function openBoardForPage(page: IPageHost, root: string, rootPath: string): void {
    void app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(root), {
        pageId: page.id,
        sourceId: "explorer",
        explorerRoot: rootPath,
    }));
}

export async function openToolsetForPage(page: IPageHost, root: string): Promise<void> {
    await toolsTrust.load();
    if (!toolsTrust.isTrusted(root)) {
        const manifest = await readToolsManifest(root);
        const ok = await showRegisterToolsetDialog({
            toolsetName: manifest?.name ?? fpBasename(root),
            toolsetRoot: root,
            tools: (manifest?.tools ?? []).map(tool => ({ name: tool.name, description: tool.description })),
        });
        if (!ok) return;
        await toolsTrust.trust(root);
        await registeredTools.refresh();
    }
    openToolsetLink(root, { pageId: page.id, sourceId: "explorer" });
}

export class BoardsPanelEditor extends EditorModel<BoardsPanelEditorState> {
    readonly editorId = InternalEditorIds.boards;
    readonly panelOrder = 1;
    readonly sidebarOptional = true;
    readonly boardsTabState = new TOneState<{ value: BoardsPanelTab }>({ value: "boards" });
    readonly rootRevision = new TOneState(0);
    private pageVersionUnsubscribe: (() => void) | null = null;
    private explorerRootUnsubscribe: (() => void) | null = null;
    private observedExplorer: EditorModelInstance | undefined;

    constructor(state: TComponentState<BoardsPanelEditorState>) {
        super(state);
        this.noLanguage = true;
        this.skipSave = true;
    }

    get rootPath(): string {
        const explorer = this.page?.findExplorer?.();
        return explorer ? (explorer.state.get() as ExplorerEditorState).rootPath : "";
    }

    get boardsTab(): BoardsPanelTab { return this.boardsTabState.get().value; }

    setBoardsTab(value: BoardsPanelTab): void {
        this.boardsTabState.update((state) => { state.value = value; });
    }

    listBoards(): string[] {
        if (!this.rootPath) return [];
        const rootKey = this.rootPath.replace(/\\/g, "/").toLowerCase();
        return boardRegistry.roots("trusted")
            .filter(path => {
                const key = path.replace(/\\/g, "/").toLowerCase();
                return key === rootKey || key.startsWith(rootKey + "/");
            })
            .slice();
    }

    listToolsets(): Array<{ root: string; name: string }> {
        if (!this.rootPath) return [];
        const rootKey = this.rootPath.replace(/\\/g, "/").toLowerCase();
        return registeredTools.toolsets
            .filter(toolset => {
                const key = toolset.root.replace(/\\/g, "/").toLowerCase();
                return key === rootKey || key.startsWith(rootKey + "/");
            })
            .map(toolset => ({ root: toolset.root, name: toolset.name }));
    }

    openBoard(root: string): void {
        const page = this.page;
        if (!page) throw new Error("Explorer action unavailable: no page host attached.");
        openBoardForPage(page, root, this.rootPath);
    }

    async openToolset(root: string): Promise<void> {
        const page = this.page;
        if (!page) throw new Error("Explorer action unavailable: no page host attached.");
        await openToolsetForPage(page, root);
    }

    closeBoards(): void {
        const page = this.page;
        this.secondaryView = undefined;
        page?.expandPanel("explorer");
    }

    beforeNavigateAway(): void {
        // Boards stays attached while the page's main editor changes.
    }

    setPage(page: IPageHost | null): void {
        this.clearPageSubscriptions();
        super.setPage(page);
        if (!page) return;
        this.pageVersionUnsubscribe = page.state.subscribe(() => this.syncExplorer(), state => state.version);
        this.syncExplorer();
    }

    private syncExplorer(): void {
        const explorer = this.page?.findExplorer?.() as EditorModelInstance | undefined;
        if (explorer === this.observedExplorer) return;
        this.explorerRootUnsubscribe?.();
        this.explorerRootUnsubscribe = null;
        this.observedExplorer = explorer;
        if (explorer) {
            this.explorerRootUnsubscribe = explorer.state.subscribe(() => {
                this.rootRevision.update(value => value + 1);
            }, state => (state as ExplorerEditorState).rootPath);
        }
        this.rootRevision.update(value => value + 1);
    }

    private clearPageSubscriptions(): void {
        this.pageVersionUnsubscribe?.();
        this.pageVersionUnsubscribe = null;
        this.explorerRootUnsubscribe?.();
        this.explorerRootUnsubscribe = null;
        this.observedExplorer = undefined;
    }

    async dispose(): Promise<void> {
        this.clearPageSubscriptions();
        await super.dispose();
    }

    static create(): BoardsPanelEditor {
        return new BoardsPanelEditor(new TComponentState({
            id: crypto.randomUUID(),
            title: untranslated("Boards"),
            modified: false,
            secondaryView: ["boards"],
        }));
    }
}

export const boardsRestoreModule: EditorRestoreModule = {
    restoreFromDescriptor: async (descriptor: EditorDescriptor): Promise<EditorModelInstance | null> => {
        if (descriptor.editorId !== InternalEditorIds.boards) return null;
        const editor = new BoardsPanelEditor(new TComponentState({
            ...descriptor.state,
            id: descriptor.id,
            title: untranslated("Boards"),
            modified: false,
        } as BoardsPanelEditorState));
        try {
            editor.applyRestoreData(descriptor.state as Parameters<typeof editor.applyRestoreData>[0]);
            await editor.restore();
            return editor;
        } catch (error) {
            await editor.dispose();
            throw error;
        }
    },
};
