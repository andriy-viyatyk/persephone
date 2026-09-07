import { globalKeyDown } from "../../core/state/events";
import { pagesModel } from "../pages";
import { api } from "../../../ipc/renderer/api";
import { cycleAppTheme } from "../cycle-app-theme";
import { getGuideIndex, type GuideTreeNode } from "../../guides";
import { errMessage } from "../../../shared/utils";
import { guard } from "../../core/utils/guard";

function findGuidePath(nodes: readonly GuideTreeNode[], editorId: string): string | undefined {
    for (const node of nodes) {
        if (node.kind === "page" && (
            node.editorId === editorId
            || (Array.isArray(node.editorId) && node.editorId.includes(editorId))
        )) return node.path;
        if (node.kind !== "folder") continue;

        const path = findGuidePath(node.children, editorId);
        if (path) return path;
    }
    return undefined;
}

/**
 * Global keyboard service for application-wide shortcuts.
 * Handles: F1, Ctrl+Tab, Ctrl+W, Ctrl+N, Ctrl+O, theme cycling.
 */
export class KeyboardService {
    async init(): Promise<void> {
        // App.initEvents() owns this process-wide shortcut listener; it must outlive
        // individual views and models and is released with the renderer process.
        document.addEventListener("keydown", this.handleKeyDown);
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        // Broadcast to all subscribers
        globalKeyDown.send(e);

        // Handle specific shortcuts
        switch (e.code) {
            case "F1":
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.isComposing || e.defaultPrevented) break;
                if (e.target instanceof Element && e.target.closest(".monaco-editor")) break;
                e.preventDefault();
                void guard("Failed to open User Guide", () => this.openActiveGuideOrContents());
                break;

            case "Tab":
                if (e.ctrlKey) {
                    e.preventDefault();
                    if (e.shiftKey) pagesModel.showPrevious();
                    else pagesModel.showNext();
                }
                break;

            case "F4":
            case "KeyW":
                if (e.ctrlKey) {
                    e.preventDefault();
                    const activePage = pagesModel.activePage;
                    if (activePage) {
                        activePage.close();
                    }
                }
                break;

            case "KeyN":
                if (e.ctrlKey) {
                    e.preventDefault();
                    if (e.shiftKey) {
                        api.openNewWindow();
                    } else {
                        pagesModel.addEmptyPage();
                    }
                }
                break;

            case "KeyO":
                if (e.ctrlKey) {
                    e.preventDefault();
                    pagesModel.openFileWithDialog();
                }
                break;

            case "BracketRight":
            case "BracketLeft":
                if (e.ctrlKey && e.altKey) {
                    e.preventDefault();
                    cycleAppTheme(e.code === "BracketRight" ? 1 : -1);
                }
                break;
        }
    };

    private async openActiveGuideOrContents(): Promise<void> {
        const editorId = pagesModel.activePage?.mainEditorInstance?.editorId;
        let guidePath: string | undefined;

        if (editorId) {
            try {
                const guideTree = await getGuideIndex().getTree("user");
                guidePath = findGuidePath(guideTree, editorId);
            } catch (error) {
                console.error("Failed to resolve active guide:", errMessage(error));
            }
        }

        if (!guidePath) {
            await pagesModel.showAboutPage({ atContents: true });
            return;
        }

        await pagesModel.showAboutPage();
        const { AboutEditor } = await import("../../editors/about");
        const editor = pagesModel.activePage?.mainEditorInstance;
        if (!(editor instanceof AboutEditor)) {
            throw new Error("About page did not expose an AboutEditor after opening.");
        }
        editor.guideBrowser.openGuide({ kind: "guide", path: guidePath });
    }
}
