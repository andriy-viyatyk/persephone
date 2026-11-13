import type { EditorCandidate } from "../base/editor-catalog";
import {
    editorSwitchStrategies,
    type EditorSwitchStrategy,
} from "../base/editor-switch-strategies";
import type { EditorModelInstance as EditorModel } from "../base/EditorModel";
import type { PageModel } from "../../api/pages/PageModel";

const boardInfoInstallStrategy: EditorSwitchStrategy = {
    order: 100,
    matches: (_oldEditor, candidate) => candidate.transition === "install",
    run: async (page: PageModel, _oldEditor: EditorModel, _candidate: EditorCandidate) => {
        const { transitionPageToBoardInfo } = await import("./open-board-info");
        await transitionPageToBoardInfo(page);
    },
};

export function registerBoardInfoEditorSwitchStrategies(): void {
    editorSwitchStrategies.register(boardInfoInstallStrategy);
}
