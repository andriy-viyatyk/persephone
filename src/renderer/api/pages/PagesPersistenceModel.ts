import type { PagesModel } from "./PagesModel";
import { IEditorState, PageDescriptor, WindowState } from "../../../shared/types";
import { openFilesNameTemplate } from "../../../shared/constants";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";
import { EditorModel } from "../../editors/base";
import { api } from "../../../ipc/renderer/api";
import { fs as appFs } from "../fs";
import { editorRegistry } from "../../editors/registry";
import { app } from "../app";
import { createLinkData } from "../../../shared/link-data";
import { PageModel } from "./PageModel";

/**
 * PagesPersistenceModel — Load/save window state to storage.
 */
export class PagesPersistenceModel {
    constructor(private model: PagesModel) {}

    saveState = async (): Promise<void> => {
        const { pages, leftRight } = this.model.state.get();
        const pageDescriptors: PageDescriptor[] = pages.map((page) => ({
            id: page.id,
            pinned: page.pinned,
            modified: page.modified,
            hasSidebar: page.hasSidebar,
            editor: page.mainEditor?.getRestoreData() ?? {},
        }));
        const groupings = Array.from(leftRight.entries());

        const activePageId = this.model.query.activePage?.id;
        const storedState: WindowState = {
            pages: pageDescriptors,
            groupings: groupings,
            activePageId,
        };

        await appFs.saveDataFile(
            openFilesNameTemplate,
            JSON.stringify(storedState, null, 4)
        );
    };

    saveStateDebounced = debounce(this.saveState, 500);

    restoreModel = async (data: Partial<IEditorState>): Promise<EditorModel | null> => {
        const editors = editorRegistry.getAll();
        const editorDef = editors.find((e) => e.editorType === data.type);
        let model: EditorModel | null = null;

        if (editorDef) {
            const module = await editorDef.loadModule();
            model = await module.newEmptyEditorModel(data.type);
        }

        if (model) {
            model.applyRestoreData(data);
            await model.restore();
        }
        return model;
    };

    restoreState = async () => {
        const data = parseObject(
            await appFs.getDataFile(openFilesNameTemplate)
        );
        if (!data || !data.pages || !Array.isArray(data.pages)) {
            return;
        }

        // Detect old format: old pages have "type" at top level (flat IEditorState)
        // New format has PageDescriptor with "editor" object containing the editor state
        const isOldFormat = data.pages.length > 0
            && data.pages[0]?.type && typeof data.pages[0]?.type === "string"
            && !data.pages[0]?.editor?.type;

        if (isOldFormat) {
            // Old format — skip. App starts with empty window.
            // User's first interaction saves new format.
            return;
        }

        const models: PageModel[] = [];

        for (const desc of data.pages as PageDescriptor[]) {
            const editorData = desc.editor;

            const page = new PageModel(desc.id);
            page.pinned = desc.pinned ?? false;

            // Restore editor if present (empty pages have no editor)
            if (editorData && Object.keys(editorData).length > 0) {
                const editor = await this.restoreModel(editorData);
                if (!editor) continue;
                page.mainEditor = editor;
                editor.setPage(page);

                // Restore sidebar from cache if page had one
                if (desc.hasSidebar) {
                    await page.restoreSidebar();
                    await page.restoreSecondaryEditors(editor);
                }
            } else if (desc.hasSidebar) {
                // Empty page with sidebar only (folder explorer, link collection)
                await page.restoreSidebar();
                await page.restoreSecondaryEditors(null);
            } else {
                // No editor and no sidebar — skip this descriptor
                continue;
            }

            this.model.attachPage(page);
            models.push(page);
        }

        const activeModel = models.find(
            (m) => m.id === data.activePageId
        );
        const orderedModels = activeModel
            ? [...models.filter((m) => m !== activeModel), activeModel]
            : models;

        this.model.state.update((s) => {
            s.pages = models;
            s.ordered = orderedModels;
        });

        if (data.groupings && Array.isArray(data.groupings)) {
            data.groupings.forEach((el: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                if (Array.isArray(el) && el.length === 2) {
                    this.model.layout.group(el[0], el[1]);
                }
            });
            this.model.layout.fixGrouping();
        }
    };

    /**
     * Initialize pages: restore from storage + handle CLI arguments.
     * Called from app.initPages() during bootstrap.
     */
    init = async () => {
        await this.restoreState();

        const fileToOpen = await api.getFileToOpen();
        if (fileToOpen) {
            await app.events.openRawLink.sendAsync(createLinkData(fileToOpen));
        }

        const urlToOpen = await api.getUrlToOpen();
        if (urlToOpen) {
            await this.model.lifecycle.handleExternalUrl(urlToOpen);
        }

        this.model.checkEmptyPage();
    };

    onAppQuit = async () => {
        await Promise.all(
            this.model.state.get().pages.map((page) => page.saveState())
        );
        await this.saveState();
        api.setCanQuit(true);
    };
}
