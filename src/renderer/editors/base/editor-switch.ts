import { TComponentState } from "../../core/state/state";
import type { EditorModel } from "./EditorModel";
import { editorRegistry } from "./editorRegistry";
// customEditorRegistry is deliberately static: the module is already required
// statically for parseBoardEditorId, so a nested dynamic import of it would be
// redundant (this whole module is only reached via PageModel's dynamic import).
import {
    getFolderEditorsForFolder,
    parseBoardEditorId,
    customEditorRegistry,
} from "../board/custom-editor-registry";
import { BOARD_INFO_EDITOR_ID } from "../board-info/board-info-id";
import type { PageModel } from "../../api/pages/PageModel";
import { guard } from "../../core/utils/guard";
import { fpBasename, fpNormalizeForCompare } from "../../core/utils/file-path";

function isFolderEditor(editor: EditorModel): boolean {
    return editor.folderAnchor !== undefined;
}

// ============================================================================
// editor-switch — the switch-widget "open this file in editor X" transition.
//
// Extracted from PageModel so the page model holds page state only; PageModel
// keeps a thin dynamic-import delegate. The pages model is reached via dynamic
// import (child→parent) exactly as the original code did from PageModel.
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
): Promise<void> {
    const released = await oldEditor.confirmRelease();
    if (!released) return; // Cancel → stay on the current editor
    const { pagesModel } = await import("../../api/pages");
    const { attachEditorToPage } = await import("../../api/pages/PagesLifecycleModel");
    // A failed module load for the target editor rejects here. Unguarded, the user
    // answered the release prompt and then nothing happened at all (US-1163's shape).
    // `confirmRelease` is a predicate and disposes nothing, so aborting leaves the
    // existing editor installed and usable — the toast explains why it stayed.
    const built = await guard(`Failed to open ${fpBasename(filePath)}`, () =>
        pagesModel.lifecycle.createEditorFromFile(filePath, undefined, newEditorId));
    if (!built) return;
    if (
        built.state.get().type === "textFile"
        && parseBoardEditorId(newEditorId) === null
    ) {
        built.state.update((s) => {
            (s as { editor?: string }).editor = newEditorId;
        });
    }
    await page.setMainEditor(attachEditorToPage(built));
}

export async function switchMainEditor(
    page: PageModel,
    newEditorId: string,
): Promise<void> {
    const oldEditor = page.mainEditorInstance;
    if (!oldEditor) return;
    if (oldEditor.editorId === newEditorId) return;

    // The "+" install target is host-TOLERANT in every direction: `BoardInfoEditorModel.switchFrom`
    // adopts a shared content host when the source holds one, and otherwise captures the source's
    // file path (the shape it was written for — the host-less Archive viewer) or, since US-1432,
    // its `folderAnchor`. It is therefore dispatched FIRST, ahead of both branches that would
    // otherwise claim it:
    //
    //  - the board branch below would dispose-and-rebuild it over the file. `board-info` declares
    //    `hasContentHost`, so the rebuild produces a bare text host and `attachEditorToPage` then
    //    throws "does not wrap a text host". The toolbar floats that promise, so the "+" click did
    //    nothing at all whenever the outgoing editor was a SIMPLE board (a content-host board took
    //    the host-transfer branch and worked, which is why this only showed up with boards like the
    //    PDF viewer).
    //  - the folder branch below rejects any target absent from the merged folder candidate list,
    //    and Board Info is an install UI target rather than a trusted folder candidate — so on a
    //    folder page it would throw instead of opening. Same bug shape as the one above, one
    //    branch over, which is why the ordering is load-bearing rather than incidental.
    //
    // Handling it here also merges three identical createEditor + switchFrom paths.
    if (newEditorId === BOARD_INFO_EDITOR_ID) {
        const boardInfo = await editorRegistry.createEditor(newEditorId);
        boardInfo.switchFrom(oldEditor);
        await boardInfo.restore();
        await page.setMainEditor(boardInfo);
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
            const { pagesModel } = await import("../../api/pages");
            const next = await pagesModel.lifecycle.createEditorFromFolder(
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
        // A content-host board (EPIC-043) transfers the shared host like Monaco↔Grid;
        // a simple board (EPIC-042) has no host and dispose-and-rebuilds. Determine the
        // NEW board's kind from the registry (a plain built-in is host-capable iff it
        // declares `hasContentHost`).
        let newBoardKind: "simple" | "content-host" | "stream-host" | undefined;
        if (newBoardRoot !== null) {
            newBoardKind =
                customEditorRegistry.entries.find((e) => e.editorId === newEditorId)
                    ?.editorKind ?? "simple";
        }
        const oldHostCapable = !!oldEditor.contentHost;
        const newHostCapable =
            newBoardRoot !== null
                ? newBoardKind === "content-host"
                : !!editorRegistry.getById(newEditorId)?.hasContentHost;

        if (oldHostCapable && newHostCapable) {
            // Host-transfer switch — no reload, no confirmRelease (nothing is lost).
            let newEditor: EditorModel;
            if (newBoardRoot !== null) {
                const { getDefaultBoardEditorState } = await import("../board");
                const { BoardContentEditorModel } = await import(
                    "../board/BoardContentEditorModel"
                );
                const filePath =
                    (oldEditor.contentHost as { filePath?: string } | null)?.filePath
                    ?? oldEditor.filePath;
                const model = new BoardContentEditorModel(
                    new TComponentState(getDefaultBoardEditorState()),
                );
                model.initFromBoardRoot(newBoardRoot, filePath ?? undefined);
                newEditor = model as unknown as EditorModel;
            } else {
                newEditor = await editorRegistry.createEditor(newEditorId);
            }
            newEditor.switchFrom(oldEditor); // extracts + adopts the shared host
            await newEditor.restore();
            await page.setMainEditor(newEditor);
            return;
        }

        // Simple board (either direction) — dispose-and-rebuild + confirmRelease (EPIC-042).
        const filePath =
            (oldEditor.contentHost as { filePath?: string } | null)?.filePath
            ?? oldEditor.filePath;
        if (!filePath) return;
        await rebuildEditorOverFile(page, oldEditor, filePath, newEditorId);
        return;
    }

    const def = editorRegistry.getById(newEditorId);
    if (!def) {
        throw new Error(`No editor registered for id: ${newEditorId}`);
    }
    // A host-transfer switch needs the OLD editor to actually hold a shared content host for
    // the new one to adopt. A host-less source — the Board Info install page that never
    // adopted a host, or the host-less Archive viewer for a zip-based file (US-864/US-876) —
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
