import { ZipPageView } from "./ZipPageView";
import type { EditorModule } from "../types";
import type { PageType, IPageState } from "../../../shared/types";

const zipEditorModule: EditorModule = {
    Editor: ZipPageView,
    newPageModel: async (filePath?: string) => {
        const { ZipPageModel } = await import("./ZipPageModel");
        const model = new ZipPageModel();
        if (filePath) await model.initFromArchive(filePath);
        return model;
    },
    newEmptyPageModel: async (pageType: PageType) => {
        if (pageType !== "zipFile") return null;
        const { ZipPageModel } = await import("./ZipPageModel");
        return new ZipPageModel();
    },
    newPageModelFromState: async (state: Partial<IPageState>) => {
        const { ZipPageModel } = await import("./ZipPageModel");
        const model = new ZipPageModel();
        model.applyRestoreData(state as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        return model;
    },
};

export default zipEditorModule;
