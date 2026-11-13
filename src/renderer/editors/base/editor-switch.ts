import type { PageModel } from "../../api/pages/PageModel";
import { editorCatalog } from "./editor-catalog";
import { editorSwitchStrategies } from "./editor-switch-strategies";

export async function switchMainEditor(page: PageModel, newEditorId: string): Promise<void> {
    const oldEditor = page.mainEditor;
    if (!oldEditor || oldEditor.editorId === newEditorId) return;

    const candidate = editorCatalog.getSwitchCandidate(oldEditor, newEditorId);
    const strategy = editorSwitchStrategies.firstMatch(oldEditor, candidate);
    if (!strategy) throw new Error(`No editor registered for id: ${newEditorId}`);
    await strategy.run(page, oldEditor, candidate);
}
