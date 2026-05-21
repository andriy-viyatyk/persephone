import { useMemo } from "react";
import { EditorModel as LegacyEditorModel } from "../../editors/base";
import { TextEditorView, TextFileModel } from "../../editors/text";
import { editorRegistry } from "../../editors/registry";
import { editorRegistry as v4EditorRegistry, LegacyEditorAdapter } from "../../editors/base/v4";
import type { EditorModel as V4EditorModel } from "../../editors/base/v4/EditorModel";
import { AsyncEditor } from "./AsyncEditor";
import { EditorType } from "../../../shared/types";
import type { EditorViewModule, FileEditorComponent } from "../../editors/types";

/**
 * Renders the appropriate editor for a page model (v4 surface).
 *
 * - v4-native editors (US-551 MonacoEditor; more in US-552+) mount via their
 *   own module's `Component` (`<TextChrome>` + `<MonacoBody>`).
 * - LegacyEditorAdapter pages route to today's `<TextEditorView>` (for text-
 *   bearing content-views) or standalone `<AsyncEditor>` (PDF / image /
 *   browser / etc.).
 *
 * The two branches are returned as separate child components so React treats
 * a v4 → legacy (or vice-versa) editor swap as a fresh mount (no hook-order
 * inconsistency).
 */
export function RenderEditor({ model }: { model: V4EditorModel }) {
    if (model instanceof LegacyEditorAdapter) {
        return <LegacyAdapterEditor adapter={model} />;
    }
    return <V4NativeEditor model={model} />;
}

// ── v4-native branch ────────────────────────────────────────────────────

const getV4EditorModule = (editorId: string) => async (): Promise<EditorViewModule> => {
    const def = v4EditorRegistry.getById(editorId);
    if (!def) throw new Error(`No v4 editor registered for id: ${editorId}`);
    const module = await def.loadModule();
    // AsyncEditor's EditorViewModule.Editor is typed for the legacy model
    // shape (IContentHost | legacy EditorModel). At runtime we pass our v4
    // editor through unchanged — both shapes share the `model` prop.
    return {
        Editor: module.Component as unknown as FileEditorComponent,
    };
};

function V4NativeEditor({ model }: { model: V4EditorModel }) {
    const editorId = model.editorId;
    const loader = useMemo(() => getV4EditorModule(editorId), [editorId]);
    return (
        <AsyncEditor
            getEditorModule={loader}
            model={model as unknown as LegacyEditorModel}
            cacheKey={`v4:${editorId}`}
        />
    );
}

// ── Legacy-adapter branch ───────────────────────────────────────────────

const getPageEditorModule = (editorType: EditorType) => async () => {
    const editors = editorRegistry.getAll();
    const def = editors.find(e => e.editorType === editorType && e.category === "standalone");
    if (!def) throw new Error(`No page editor registered for type: ${editorType}`);
    return def.loadModule();
};

function LegacyAdapterEditor({ adapter }: { adapter: LegacyEditorAdapter }) {
    const legacy = adapter.legacy;
    // Subscribe so state.type / state.editor swaps re-render.
    legacy.state.use((s) => ({ type: s.type }));

    const type = (legacy.state.get() as { type?: EditorType }).type;
    const editors = editorRegistry.getAll();
    const pageEditor = editors.find(e => e.editorType === type && e.category === "standalone");

    if (pageEditor && type) {
        return <AsyncEditor getEditorModule={getPageEditorModule(type)} model={legacy} cacheKey={type} />;
    }

    return <TextEditorView model={legacy as TextFileModel} />;
}
