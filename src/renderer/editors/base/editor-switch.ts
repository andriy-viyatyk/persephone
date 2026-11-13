import type { EditorModel } from "./EditorModel";
import { editorRegistry } from "./editorRegistry";
// customEditorRegistry is deliberately static: the module is already required
// statically for parseBoardEditorId, so a nested dynamic import of it would be
// redundant (this whole module is only reached via PageModel's dynamic import).
import {
    getFolderEditorsForFolder,
    customEditorRegistry,
} from "../../api/boards/custom-editor-registry";
import { parseBoardEditorId } from "../../../shared/board/board-editor-id";
import { BOARD_INFO_EDITOR_ID } from "../board-info/board-info-id";
import type { PageModel } from "../../api/pages/PageModel";
import { guard } from "../../core/utils/guard";
import { fpBasename, fpNormalizeForCompare } from "../../core/utils/file-path";
import { captureBoardSourceContext } from "../shared/source-context";
import { matchesFileMask } from "../../../shared/board/board-masks";
import type { ILinkData } from "../../../shared/link-data";
import type { BoardEditorKind } from "../../../shared/board/board-manifest-schema";
import {
    createEditorFromFile,
    createEditorFromFolder,
} from "../editor-factory";

async function boardSwitchSourceLink(
    page: PageModel,
    oldEditor: EditorModel,
    newEditorId: string,
    filePath: string,
): Promise<ILinkData | undefined> {
    const board = customEditorRegistry.findByEditorId(newEditorId);
    const sourceLink = oldEditor.sourceLink;
    if (!board || !sourceLink || !["explorer", "link-category", "link-tag"].includes(sourceLink.sourceId ?? "")) {
        return undefined;
    }

    const sourceContext = await captureBoardSourceContext({
        page,
        sourceLink,
        currentHref: sourceLink.url ?? sourceLink.href ?? filePath,
        include: (item) => board.fileMasks.length === 0
            || board.fileMasks.some((mask) => matchesFileMask(fpBasename(item.href), mask)),
    });
    return { ...sourceLink, sourceContext };
}

function isFolderEditor(editor: EditorModel): boolean {
    return editor.folderAnchor !== undefined;
}

// ============================================================================
// editor-switch — the switch-widget "open this file in editor X" transition.
//
// Extracted from PageModel so the page model holds page state only; PageModel
// keeps a thin dynamic-import delegate. Editor construction comes directly
// from the editor factory without reaching back into the pages layer.
// ============================================================================

/** Shared dispose-and-rebuild path: confirm release of the old editor, rebuild
 *  the target FRESH over the file, honor an explicit built-in target that
 *  differs from the file's natural resolveId (mirrors openFile /
 *  navigatePageTo; no-op for board targets), and install it as main. */
async function rebuildEditorOverFile(
    page: PageModel,
    oldEditor: EditorModel,
    filePath: string,
    newEditorId: string,
    sourceLink?: ILinkData,
): Promise<void> {
    const released = await oldEditor.confirmRelease();
    if (!released) return; // Cancel → stay on the current editor
    // A failed module load for the target editor rejects here. Unguarded, the user
    // answered the release prompt and then nothing happened at all ('s shape).
    // `confirmRelease` is a predicate and disposes nothing, so aborting leaves the
    // existing editor installed and usable — the toast explains why it stayed.
    const built = await guard(`Failed to open ${fpBasename(filePath)}`, () =>
        createEditorFromFile(filePath, undefined, newEditorId));
    if (!built) return;
    if (built.contentHost && parseBoardEditorId(newEditorId) === null) {
        built.contentHost.state.update((s) => {
            (s as { editor?: string }).editor = newEditorId;
        });
    }
    if (sourceLink) {
        (built.contentHost ?? built).state.update((state) => { state.sourceLink = sourceLink; });
    }
    await page.setMainEditor(built);
}

export async function switchMainEditor(
    page: PageModel,
    newEditorId: string,
): Promise<void> {
    const oldEditor = page.mainEditor;
    if (!oldEditor) return;
    if (oldEditor.editorId === newEditorId) return;

    // The "+" install target is host-TOLERANT in every direction: `BoardInfoEditorModel.switchFrom`
    // adopts a shared content host when the source holds one, and otherwise captures the source's
    // file path for a host-less Archive viewer, or the source's `folderAnchor` for a directory.
    // It is therefore dispatched FIRST, ahead of both branches that would
    // otherwise claim it:
    //
    //  - the board branch below would dispose-and-rebuild it over the file. `board-info` declares
    //    `hasContentHost`, so the rebuild produces a bare text host and the factory's
    //    content-host construction then fails. The toolbar floats that promise, so the "+" click did
    //    nothing at all whenever the outgoing editor was a SIMPLE board (a content-host board took
    //    the host-transfer branch and worked, which is why this only showed up with boards like the
    //    PDF viewer).
    //  - the folder branch below rejects any target absent from the merged folder candidate list,
    //    and Board Info is an install UI target rather than a trusted folder candidate — so on a
    //    folder page it would throw instead of opening. Same bug shape as the one above, one
    //    branch over, which is why the ordering is load-bearing rather than incidental.
    //
    // Handling it here shares Board Info's release check and source transfer with the menu opener.
    if (newEditorId === BOARD_INFO_EDITOR_ID) {
        const { transitionPageToBoardInfo } = await import("../board-info/open-board-info");
        await transitionPageToBoardInfo(page);
        return;
    }

    // Folder editors have no filePath and cannot use the regular host-transfer or
    // dispose-and-rebuild paths. Reuse a surviving Pattern B instance first, then
    // build the target from the exact Explorer anchor before those paths can observe
    // the old editor's undefined filePath.
    const anchorFolder = oldEditor.folderAnchor;
    if (anchorFolder !== undefined && isFolderEditor(oldEditor)) {
        if (!getFolderEditorsForFolder(anchorFolder).includes(newEditorId)) {
            throw new Error(
                `Folder switch unavailable: "${newEditorId}" is not offered for "${anchorFolder}".`,
            );
        }

        const anchorKey = fpNormalizeForCompare(anchorFolder);
        const existing = page.editors.find((editor) => {
            if (editor.editorId !== newEditorId) return false;
            const editorAnchor = editor.folderAnchor;
            return !!editorAnchor && fpNormalizeForCompare(editorAnchor) === anchorKey;
        });
        if (existing) {
            await page.setMainEditor(existing);
            existing.onNavigationReuse?.();
            return;
        }

        if (parseBoardEditorId(newEditorId) !== null) {
            const next = await createEditorFromFolder(
                newEditorId,
                anchorFolder,
            );
            await page.setMainEditor(next as EditorModel);
            return;
        }

        const module = await editorRegistry.getModule(newEditorId);
        const next = await module.newEditorModelForFolder?.(anchorFolder);
        if (!next) {
            throw new Error(
                `Folder switch unavailable: editor "${newEditorId}" has no folder factory.`,
            );
        }
        if (newEditorId === "category-view") {
            const { buildFolderCategoryLink, CategoryEditorModel } = await import(
                "../category/CategoryEditorModel"
            );
            if (next instanceof CategoryEditorModel) {
                next.initFromLink(buildFolderCategoryLink(page, anchorFolder));
            }
        }
        await next.restore();
        await page.setMainEditor(next);
        return;
    }

    // A board editor (either side) has no shared content host to hand over via
    // `switchFrom`, so a board-boundary switch confirms release of the old editor
    // (CE4) and rebuilds the target FRESH over the file (dispose-and-rebuild). The
    // board writes the file directly, so a rebuilt built-in reads current disk
    // content — no stale-cache handling needed.
    const newBoardRoot = parseBoardEditorId(newEditorId);
    const boardInvolved =
        newBoardRoot !== null
        || parseBoardEditorId(oldEditor.editorId) !== null;
    if (boardInvolved) {
        // A content-host board transfers the shared host like Monaco↔Grid;
        // a simple board has no host and dispose-and-rebuilds. Determine the
        // NEW board's kind from the registry (a plain built-in is host-capable iff it
        // declares `hasContentHost`).
        let newBoardKind: BoardEditorKind | undefined;
        if (newBoardRoot !== null) {
            newBoardKind = customEditorRegistry.findByEditorId(newEditorId)?.editorKind ?? "simple";
        }
        const oldHostCapable = !!oldEditor.contentHost;
        const newHostCapable =
            newBoardRoot !== null
                ? newBoardKind === "content-host"
                : !!editorRegistry.getById(newEditorId)?.hasContentHost;

        const filePath = oldEditor.filePath;
        const sourceLink = newBoardRoot !== null && filePath
            ? await boardSwitchSourceLink(page, oldEditor, newEditorId, filePath)
            : undefined;

        if (oldHostCapable && newHostCapable) {
            // Host-transfer switch — no reload, no confirmRelease (nothing is lost).
            let newEditor: EditorModel;
            if (newBoardRoot !== null) {
                const filePath = oldEditor.filePath;
                newEditor = (await (await import("../board")).createBoardEditor({
                    kind: "file",
                    boardRoot: newBoardRoot,
                    filePath: filePath ?? undefined,
                    editorKind: newBoardKind,
                })) as unknown as EditorModel;
            } else {
                newEditor = await editorRegistry.createEditor(newEditorId);
            }
            newEditor.switchFrom(oldEditor); // extracts + adopts the shared host
            if (sourceLink) {
                newEditor.state.update((state) => { state.sourceLink = sourceLink; });
            }
            await newEditor.restore();
            await page.setMainEditor(newEditor);
            return;
        }

        // Simple board (either direction) — dispose-and-rebuild + confirmRelease.
        if (!filePath) return;
        await rebuildEditorOverFile(page, oldEditor, filePath, newEditorId, sourceLink);
        return;
    }

    const def = editorRegistry.getById(newEditorId);
    if (!def) {
        throw new Error(`No editor registered for id: ${newEditorId}`);
    }
    // A host-transfer switch needs the OLD editor to actually hold a shared content host for
    // the new one to adopt. A host-less source — the Board Info install page that never
    // adopted a host, or the host-less Archive viewer for a zip-based file —
    // has nothing to hand over, and a real file editor's `switchFrom` would throw. When the
    // target is such a file editor, dispose-and-rebuild it over the file instead (mirrors the
    // simple-board branch above). The "+" install target needs no exemption here: it is
    // handled at the top of this function, before either branch can claim it.
    if (!oldEditor.contentHost) {
        const filePath = oldEditor.filePath;
        if (!filePath) return;
        await rebuildEditorOverFile(page, oldEditor, filePath, newEditorId);
        return;
    }
    const newEditor = await editorRegistry.createEditor(newEditorId);
    newEditor.switchFrom(oldEditor);
    await newEditor.restore();
    await page.setMainEditor(newEditor);
}
