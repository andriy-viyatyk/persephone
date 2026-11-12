import type { EditorModel } from "./EditorModel";
import { runPageScript } from "../../scripting/run-page-script";
import { saveScriptToLibrary } from "../../scripting/script-library-actions";

export class TextPageKeymap {
    constructor(
        private readonly editor: EditorModel,
        private readonly boardCompatible = false,
    ) {}

    handleKeyDown = (event: KeyboardEvent): void => {
        const host = this.editor.contentHost;
        if (!host) return;

        const panelFocused = this.isPanelFocused(event);
        const panelOpen = host.script.state.get().open;
        const state = host.script.state.get();

        if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
            if (panelFocused && state.dirty && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                void saveScriptToLibrary(state, host.state.get().language, (update) => {
                    host.script.state.update(update);
                });
                return;
            }
            if (this.boardCompatible) return;
            if (!event.ctrlKey) return;
            event.preventDefault();
            void host.saveFile(event.shiftKey);
            return;
        }

        if (this.boardCompatible) {
            if (event.code === "F5" && panelFocused) {
                event.preventDefault();
                void this.runScript(false, "panel");
            }
            return;
        }

        if (event.code === "F5") {
            event.preventDefault();
            if (panelOpen) {
                void this.runScript(false, "panel");
            } else {
                void this.runScript(false, "page");
            }
            return;
        }

        if (event.ctrlKey && event.shiftKey && event.code === "KeyF") {
            event.preventDefault();
            host.openSearchInNavPanel();
        }
    };

    private isPanelFocused(event: KeyboardEvent): boolean {
        const target = event.target;
        return target instanceof Element && target.closest('[data-name="script-panel"]') !== null;
    }

    private runScript(all: boolean, source: "page" | "panel"): Promise<void> {
        const host = this.editor.contentHost;
        if (!host) return Promise.resolve();
        return runPageScript(this.editor, {
            all,
            source,
            getPanelSelection: () => host.script.getSelectedText(),
        });
    }
}
