import { globalKeyDown } from "../../core/state/events";
import { pages } from "../pages";
import { api } from "../../../ipc/renderer/api";
import { appWindow } from "../window";
import { themeService } from "../theme-service";
import { getGuideIndex, type GuideTreeNode } from "../../guides";
import { getBoardGuideMountId } from "../../guides/board-guide-mounts";
import { BOARD_GUIDES_PREFIX, BOARD_SELF_EDITOR_ID } from "../../../shared/guides/mounted-source";
import { errMessage } from "../../../shared/utils";
import { guard } from "../../core/utils/guard";
import { t } from "../../../shared/i18n/t";

function findGuidePath(
    nodes: readonly GuideTreeNode[],
    editorId: string,
    boardMountId?: string,
): string | undefined {
    const matches: Array<{ path: string; rank: number }> = [];
    collectGuideMatches(nodes, editorId, boardMountId, matches);
    matches.sort((left, right) => left.rank - right.rank);
    return matches[0]?.path;
}

/**
 * A board's real editor id embeds an absolute path (`board-editor:C:\...`), which differs per
 * machine and can never be written into a shipped guide, so a board's own page claims its board
 * with the token `editorId: "board"` — honored only for pages that live under that board's own
 * mount. A board page therefore reaches its documentation with F1 exactly as a built-in
 * editor's page does.
 */
function claimsEditor(
    node: Extract<GuideTreeNode, { readonly kind: "page" }>,
    editorId: string,
    boardMountId: string | undefined,
): "self" | "editor" | undefined {
    const ids = node.editorId === undefined
        ? []
        : Array.isArray(node.editorId) ? node.editorId : [node.editorId];
    // A board's OWN page wins over the generic built-in guide for board pages: the board documents
    // the thing the user is actually looking at.
    if (boardMountId !== undefined
        && node.path.startsWith(`${BOARD_GUIDES_PREFIX}/${boardMountId}/`)
        && ids.includes(BOARD_SELF_EDITOR_ID)) return "self";
    return ids.includes(editorId) ? "editor" : undefined;
}

function collectGuideMatches(
    nodes: readonly GuideTreeNode[],
    editorId: string,
    boardMountId: string | undefined,
    matches: Array<{ path: string; rank: number }>,
): void {
    for (const node of nodes) {
        if (node.kind === "page") {
            const claim = claimsEditor(node, editorId, boardMountId);
            if (claim) {
                const rank = (claim === "self" ? -2 : 0) + (node.audience === "user" ? 0 : 1);
                matches.push({ path: node.path, rank });
            }
            continue;
        }

        collectGuideMatches(node.children, editorId, boardMountId, matches);
    }
}

/**
 * Global keyboard service for application-wide shortcuts.
 * Handles: F1, F12, Ctrl+Tab, Ctrl+W, Ctrl+N, Ctrl+O, theme cycling.
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
                void guard(t("api.failedToOpenUserGuide"), () => openFocusedGuideOrContents());
                break;

            case "F12":
                // An active browser page claims for its own page's DevTools (it prevents
                // the default first); everywhere else F12 opens Persephone's DevTools.
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.defaultPrevented) break;
                e.preventDefault();
                void api.openDevTools();
                break;

            case "Tab":
                if (e.ctrlKey) {
                    e.preventDefault();
                    pages.closePopover();
                    if (e.shiftKey) pages.navigation.showPrevious();
                    else pages.navigation.showNext();
                }
                break;

            case "F4":
            case "KeyW":
                if (e.ctrlKey) {
                    e.preventDefault();
                    const focusedPage = pages.query.focusedPage;
                    if (focusedPage && pages.query.isRightPinned(focusedPage.id)) {
                        pages.closePopover();
                    } else if (focusedPage) {
                        focusedPage.close();
                    }
                }
                break;

            case "KeyN":
                if (e.ctrlKey) {
                    e.preventDefault();
                    if (e.shiftKey) {
                        api.openNewWindow();
                    } else if (!appWindow.isBoardMode) {
                        // Board windows open only the board's own pages.
                        pages.lifecycle.addEmptyPage();
                    }
                }
                break;

            case "KeyO":
                if (e.ctrlKey) {
                    e.preventDefault();
                    pages.openFileWithDialog();
                }
                break;

            case "BracketRight":
            case "BracketLeft":
                if (e.ctrlKey && e.altKey) {
                    e.preventDefault();
                    themeService.cycle(e.code === "BracketRight" ? 1 : -1);
                }
                break;
        }
    };
}

export async function openFocusedGuideOrContents(): Promise<void> {
    const editorInstance = pages.query.focusedPage?.mainEditor;
    const editorId = editorInstance?.editorId;
    // A board page (plain `board-view` or a custom-editor `board-editor:<root>`) exposes the board
    // folder it renders; that is what maps onto the board's own guide branch.
    const boardRoot = (editorInstance as { boardRoot?: string } | undefined)?.boardRoot;
    let guidePath: string | undefined;

    if (editorId) {
        try {
            const boardMountId = boardRoot ? await getBoardGuideMountId(boardRoot) : undefined;
            const guideTree = await getGuideIndex().getTree("user");
            guidePath = findGuidePath(guideTree, editorId, boardMountId);
        } catch (error) {
            console.error("Failed to resolve active guide:", errMessage(error));
        }
    }

    if (!guidePath) {
        await pages.standalonePages.show("about-page", { atContents: true }).then((): undefined => undefined);
        return;
    }

    await pages.standalonePages.show("about-page").then((): undefined => undefined);
    const { AboutEditor } = await import("../../editors/about");
    const editor = pages.query.activePage?.mainEditor;
    if (!(editor instanceof AboutEditor)) {
        throw new Error("About page did not expose an AboutEditor after opening.");
    }
    editor.guideBrowser.openGuide({ kind: "guide", path: guidePath });
}
