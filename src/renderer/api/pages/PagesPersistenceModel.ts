import type { PagesModel } from "./PagesModel";
import { IEditorState, WindowState } from "../../../shared/types";
import { openFilesNameTemplate } from "../../../shared/constants";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";
import { EditorModel } from "../../editors/base";
import { api } from "../../../ipc/renderer/api";
import { fs as appFs } from "../fs";
import { editorRegistry } from "../../editors/registry";
import { app } from "../app";
import { RawLinkEvent } from "../events/events";

/**
 * PagesPersistenceModel — Load/save window state to storage.
 */
export class PagesPersistenceModel {
    constructor(private model: PagesModel) {}

    saveState = async (): Promise<void> => {
        const { pages, leftRight } = this.model.state.get();
        const activePagesData = pages.map((model) => model.getRestoreData());
        const groupings = Array.from(leftRight.entries());

        const activePageId = this.model.query.activePage?.state.get().id;
        const storedState: WindowState = {
            pages: activePagesData,
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

        const modelsPromise = (data.pages as Partial<IEditorState>[]).map((pageData) =>
            this.restoreModel(pageData)
        );
        const models = (await Promise.all(modelsPromise)).filter(
            (model) => model
        ) as EditorModel[];

        models.forEach((model) => this.model.attachPage(model));
        const activeModel = models.find(
            (m) => m.state.get().id === data.activePageId
        );
        const orderedModels = activeModel
            ? [...models.filter((m) => m !== activeModel), activeModel]
            : models;

        this.model.state.update((s) => {
            s.pages = models;
            s.ordered = orderedModels;
        });

        if (data.groupings && Array.isArray(data.groupings)) {
            data.groupings.forEach((el: any) => {
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
            await app.events.openRawLink.sendAsync(new RawLinkEvent(fileToOpen));
        }

        const urlToOpen = await api.getUrlToOpen();
        if (urlToOpen) {
            await this.model.lifecycle.handleExternalUrl(urlToOpen);
        }

        this.model.checkEmptyPage();
    };

    onAppQuit = async () => {
        await Promise.all(
            this.model.state.get().pages.map((model) => model.saveState())
        );
        await this.saveState();
        api.setCanQuit(true);
    };
}
