import { EditorId } from "../../../shared/editor-ids";
import {
    assertFolderSwitchCandidate,
    editorSwitchStrategies,
    findReusableFolderEditor,
    type EditorSwitchStrategy,
} from "../base/editor-switch-strategies";
import type { EditorModelInstance as EditorModel } from "../base/EditorModel";

const categoryFolderStrategy: EditorSwitchStrategy = {
    order: 190,
    matches: (oldEditor, candidate) =>
        oldEditor.folderAnchor !== undefined && candidate.id === EditorId.categoryView,
    run: async (page, oldEditor, candidate) => {
        const anchorFolder = oldEditor.folderAnchor;
        if (anchorFolder === undefined) return;
        assertFolderSwitchCandidate(anchorFolder, candidate);

        const existing = findReusableFolderEditor(page, candidate.id, anchorFolder);
        if (existing) {
            await page.setMainEditor(existing);
            existing.onNavigationReuse?.();
            return;
        }

        const { newCategoryEditorModelForFolder } = await import("./CategoryEditorModel");
        const next = newCategoryEditorModelForFolder(page, anchorFolder) as unknown as EditorModel;
        await next.restore();
        await page.setMainEditor(next);
    },
};

export function registerCategoryEditorSwitchStrategies(): void {
    editorSwitchStrategies.register(categoryFolderStrategy);
}
