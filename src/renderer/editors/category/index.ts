import { TComponentState } from "../../core/state/state";
import {
    CategoryEditorModel,
    getDefaultCategoryEditorModelState,
    newCategoryEditorModelForFolder,
} from "./CategoryEditorModel";
import { CategoryEditorView } from "./CategoryEditor";
import { defineEditorModule } from "../base/editorRegistry";
import type { EditorModelInstance as EditorModel } from "../base/EditorModel";
import type { IPageHost } from "../../api/pages/IPageHost";

export const categoryModule = defineEditorModule(CategoryEditorModel, {
    createEditor: () =>
        new CategoryEditorModel(new TComponentState(getDefaultCategoryEditorModelState())),
    View: CategoryEditorView,
    newEditorModel: async (filePath?: string) => {
        const { CategoryEditorModel } = await import("./CategoryEditorModel");
        const { decodeCategoryLink } = await import("../../content/tree-providers/tree-provider-link");
        const model = new CategoryEditorModel();
        if (filePath) {
            const link = decodeCategoryLink(filePath);
            if (link) model.initFromLink(link);
        }
        return model as unknown as EditorModel;
    },
    newEditorModelForFolder: async (anchorFolder: string, page?: IPageHost) => {
        const model = page
            ? newCategoryEditorModelForFolder(page, anchorFolder)
            : new CategoryEditorModel();
        if (!page) model.initFromLink({ type: "file", url: anchorFolder, category: anchorFolder });
        return model as unknown as EditorModel;
    },
});

export {
    CategoryEditorModel,
    getDefaultCategoryEditorModelState,
} from "./CategoryEditorModel";
export type { CategoryEditorModelState } from "./CategoryEditorModel";
