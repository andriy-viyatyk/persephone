import { EditorId } from "../../../shared/editor-ids";
import { TComponentState } from "../../core/state/state";
import { defineEditorModule, type EditorModule } from "../base/editorRegistry";
import { GridEditor, defaultGridEditorState } from "./GridEditor";
import type { GridEditorId } from "./utils/grid-format";
import "../../uikit/Button/Button.css";
import { GridEditorView } from "./GridEditorView";

function makeModule(id: GridEditorId): EditorModule {
    return defineEditorModule(GridEditor, {
        createEditor: () =>
            new GridEditor(new TComponentState({ ...defaultGridEditorState }), id),
        View: GridEditorView,

    });
}

export const gridJsonModule: EditorModule = makeModule(EditorId.gridJson);
export const gridCsvModule: EditorModule = makeModule(EditorId.gridCsv);
export const gridJsonlModule: EditorModule = makeModule(EditorId.gridJsonl);

export { GridEditor, defaultGridEditorState } from "./GridEditor";
export type { GridEditorState, GridQueueEvent } from "./GridEditor";
export type { GridFormat, GridEditorId } from "./utils/grid-format";

// Re-exports kept for outside callers (utils + popovers).
export type { GridData, GridColumn } from "./utils/grid-utils";
export {
    getRowKey,
    registerRow,
    registerRows,
    getGridDataWithColumns,
    nextColumnKeys,
} from "./utils/grid-utils";
export { showColumnsOptions } from "./components/ColumnsOptions";
export { showCsvOptions } from "./components/CsvOptions";
