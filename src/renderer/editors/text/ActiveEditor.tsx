import { TextFileModel } from "./TextPageModel";
import { AsyncEditor } from "../../ui/app/AsyncEditor";
import { TextEditor } from "./TextEditor";
import { editorRegistry } from "../registry";
import { PageEditor } from "../../../shared/types";

interface ActiveEditorProps {
    model: TextFileModel;
}

const getEditorModule = (editor: PageEditor) => async () => {
    const def = editorRegistry.getById(editor);
    if (!def) throw new Error(`Editor "${editor}" not registered`);
    return def.loadModule();
};

export function ActiveEditor({ model }: ActiveEditorProps) {
    const { editor, encrypted } = model.state.use((s) => ({
        editor: s.editor,
        encrypted: s.encrypted,
    }));

    // Always show text editor for encrypted content
    if (encrypted) {
        return <TextEditor model={model} />;
    }

    // Use registry to load alternative editors
    if (editor && editor !== "monaco") {
        return (
            <AsyncEditor
                key={editor}
                getEditorModule={getEditorModule(editor)}
                model={model}
                cacheKey={editor}
            />
        );
    }

    // Default to Monaco text editor
    return <TextEditor model={model} />;
}
