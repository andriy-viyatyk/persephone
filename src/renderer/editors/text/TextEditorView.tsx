import { TextFileModel } from "./TextEditorModel";
import { ActiveEditor } from "./ActiveEditor";
import { TextChrome } from "../base/v4/TextChrome";
import { pagesModel } from "../../api/pages";

interface TextEditorViewProps {
    model: TextFileModel;
}

/**
 * Thin shim that resolves the v4 adapter for the wrapped TextFileModel and
 * delegates to `<TextChrome>`. After per-editor migrations (US-551+ Monaco
 * and beyond), each text-bearing editor's loaded module will compose
 * `<TextChrome>` directly — this shim retires with US-558's RenderEditor
 * collapse.
 */
export function TextEditorView({ model }: TextEditorViewProps) {
    const { restored } = model.state.use((s) => ({ restored: s.restored }));
    const page = pagesModel.findPage(model.id);
    const v4Main = page?.mainEditorV4 ?? null;
    if (!v4Main) {
        // Defensive — should not happen post US-548. Render bare body so the
        // user isn't blocked if the adapter wiring lags behind page mount.
        return restored ? <ActiveEditor model={model} /> : null;
    }
    return (
        <TextChrome model={v4Main}>
            {restored ? <ActiveEditor model={model} /> : null}
        </TextChrome>
    );
}
