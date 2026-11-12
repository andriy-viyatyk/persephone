import type { EditorModel } from "../editors/base/EditorModel";
import { TEXT_SELECTION_TRAIT } from "../editors/base/editor-traits";
import { isScriptLanguage } from "./transpile";
import { scriptRunner } from "./ScriptRunner";

export interface RunPageScriptOptions {
    all?: boolean;
    source: "page" | "panel";
    getPanelSelection?: () => string;
}

/** Run the selected page or related-panel script using the owning editor context. */
export async function runPageScript(
    editor: EditorModel,
    options: RunPageScriptOptions,
): Promise<void> {
    const host = editor.contentHost;
    if (!host) return;

    let script: string;
    let language: string;
    if (options.source === "panel") {
        script = host.script.state.get().content;
        language = "typescript";
        if (!options.all) {
            try {
                script = options.getPanelSelection?.() || script;
            } catch {
                // The panel may unmount while a queued selection is being read.
            }
        }
    } else {
        const state = host.state.get();
        script = state.content;
        language = editor.language ?? state.language ?? "";
        if (!options.all) {
            try {
                script = (await editor.traits.get(TEXT_SELECTION_TRAIT)?.getSelectedText()) || script;
            } catch {
                // A missing or disposed selection view falls back to the full document.
            }
        }
    }

    if (!isScriptLanguage(language)) return;
    await scriptRunner.runWithResult(editor.id, script, editor, language);
}
