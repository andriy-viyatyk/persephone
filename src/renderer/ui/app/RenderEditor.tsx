import { EditorModel } from "../../editors/base";
import { TextEditorView, TextFileModel } from "../../editors/text";
import { editorRegistry } from "../../editors/registry";
import { AsyncEditor } from "./AsyncEditor";
import { EditorType } from "../../../shared/types";

/**
 * Get the async module loader for a standalone page editor.
 */
const getPageEditorModule = (editorType: EditorType) => async () => {
    const editors = editorRegistry.getAll();
    const def = editors.find(e => e.editorType === editorType && e.category === "page-editor");
    if (!def) throw new Error(`No page editor registered for type: ${editorType}`);
    return def.loadModule();
};

/**
 * Renders the appropriate editor for a page model.
 *
 * - Content views (monaco, grid, markdown) are rendered inside TextEditorView
 * - Page editors (pdf, image) are rendered as standalone components
 */
export function RenderEditor({ model }: { model: EditorModel }) {
    const { type } = model.state.use((s) => ({
        type: s.type,
    }));

    // Check if this page type has a standalone page editor
    const editors = editorRegistry.getAll();
    const pageEditor = editors.find(e => e.editorType === type && e.category === "page-editor");

    if (pageEditor) {
        // Standalone page editor (PDF, Image, etc.)
        return <AsyncEditor getEditorModule={getPageEditorModule(type)} model={model} cacheKey={type} />;
    }

    // Default: content view inside TextEditorView
    return <TextEditorView model={model as TextFileModel} />;
}
