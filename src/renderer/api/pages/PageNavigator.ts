import type { PagesModel } from "./PagesModel";
import type { PageModel } from "./PageModel";
import type { EditorOrHost } from "../../editors/base";
import type { ILinkData } from "../../../shared/link-data";
import type { IContentPipe } from "../types/io.pipe";
import { newTextFileModel } from "../../editors/text";
import { isFocusInSidebar } from "../../core/utils/focus-utils";
import { fileIdentity, fpBasename, isVirtualPath } from "../../core/utils/file-path";
import { fs as appFs } from "../fs";
import { ui } from "../ui";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { applyOpenHints, prepareOpenedEditor, registerOpenSession } from "./open-request";
import type { PageOpenRequest } from "./open-request";
import {
    attachEditorToPage,
    createEditorFromFile,
    createEditorFromFolder,
} from "../../editors/editor-factory";

// ============================================================================
// PageNavigator — navigate an existing page to a new file.
//
// The single entry point `navigatePageTo` runs these named steps in order:
//   1. confirmLeaveCurrentEditor  — "save changes?" unless the editor survives
//   2. reuseNavigationTarget      — per-page singleton promotion (Git Tree)
//   3. reuseEditorForFile         — same-file editor lingering as a panel
//   4. buildEditor                — fresh build with missing-file/error fallbacks
//   5. prepareOpenedEditor        — preview editor vs explicit host target
//   6. attach + post-attach       — diff revisions, fragment, reveal/highlight
//   7. finishNavigation           — show/focus-unless-sidebar/save (shared exit)
// ============================================================================

export interface NavigatePageToOptions extends Omit<PageOpenRequest, "sourceLink"> {
    sourceLink?: ILinkData;
    pipe?: IContentPipe;
}

/** Shared exit for every successful navigation path: repaint, focus (unless
 * the user is working in a sidebar panel, such as the Explorer tree, so keep
 *  persist. */
function finishNavigation(model: PagesModel, page: PageModel): void {
    model.onShow.send(page);
    if (!isFocusInSidebar()) model.onFocus.send(page);
    model.persistence.saveState();
}

function sameFileIdentity(first: string, second: string): boolean {
    return fileIdentity(first) === fileIdentity(second);
}

/** Skip the "save changes?" prompt when the current main editor will survive
 *  this navigation (demote to a sidebar panel) rather than be released —
 *  nothing is being discarded. A Link editor navigating to one of its own
 *  links, or any modified Link editor, stays on the page. The prompt
 *  still fires on a genuine close (separate path).
 *  The survives check reads `mainEditorInstance` (the EditorModel subclass
 *  that carries the override); `confirmRelease` is intentionally called on
 *  the unwrapped host so it routes to the host's save dialog for text-bearing
 *  editors, matching the pre-existing pattern. */
async function confirmLeaveCurrentEditor(
    page: PageModel,
    options?: NavigatePageToOptions,
): Promise<boolean> {
    const oldEditor = page.mainEditor;
    const survives =
        page.mainEditorInstance?.survivesNavigation(options?.sourceLink) ?? false;
    if (oldEditor && !survives) {
        const released = await oldEditor.confirmRelease();
        if (!released) return false;
    }
    return true;
}

/**: a Pattern B editor that survives navigation (Git Tree) is a
 *  per-page singleton. If the page already holds an instance representing
 *  this target, promote it back to main and refresh — never build a
 *  duplicate. Duplicates would accumulate as redundant surviving secondary
 *  panels (the panel "x" would then need one click per stale instance). */
async function reuseNavigationTarget(
    model: PagesModel,
    page: PageModel,
    newFilePath: string,
    options?: NavigatePageToOptions,
): Promise<boolean> {
    const navTarget = options?.target;
    if (!navTarget) return false;
    const existing = page.editors.find(
        (e) => e.matchesNavigationTarget?.(navTarget, newFilePath),
    );
    if (!existing) return false;
    if (page.mainEditorInstance !== existing) {
        await page.setMainEditor(existing);
    }
    existing.onNavigationReuse?.();
    return true;
}

/** Reuse an editor already on this page that represents the same file,
 *  rather than building a duplicate. A modified editor that survived an
 *  earlier navigation (e.g. a Link editor with unsaved edits) lingers as
 *  a sidebar panel; re-selecting its file in the Explorer should restore
 *  that very instance — with its edits and panels — instead of spawning a
 *  second one alongside it. An explicit content-host target must still
 *  match the existing editor's type, so "open in a different view" of an
 *  already-open file is never hijacked. */
async function reuseEditorForFile(
    model: PagesModel,
    page: PageModel,
    newFilePath: string,
    options?: NavigatePageToOptions,
): Promise<boolean> {
    const navTarget = options?.target;
    const existingForFile = page.findEditorByFilePath(newFilePath);
    if (
        !existingForFile ||
        existingForFile === page.mainEditorInstance ||
        (navTarget && existingForFile.editorId !== navTarget)
    ) {
        return false;
    }
    options?.pipe?.dispose();
    await page.setMainEditor(existingForFile);
    existingForFile.onNavigationReuse?.();
    return true;
}

/** Build the new editor, falling back to an empty text page on a missing
 *  file or a build failure (with a toast either way). */
async function buildEditor(
    newFilePath: string,
    options?: NavigatePageToOptions,
): Promise<EditorOrHost> {
    if (!isVirtualPath(newFilePath) && !(await appFs.exists(newFilePath))) {
        ui.notify(t("api.fileNotFound", { name: fpBasename(newFilePath) }), "error");
        const textFileModel = newTextFileModel("");
        textFileModel.state.update((s) => {
            s.title = fpBasename(newFilePath);
        });
        await textFileModel.restore();
        return textFileModel;
    }
    if (options?.folderPath !== undefined) {
        if (!options.target) throw new Error("Folder editor link has no target editor.");
        try {
            return await createEditorFromFolder(
                options.target,
                options.folderPath,
            );
        } catch (err) {
            ui.notify(t("api.failedToOpenFolder", { error: errMessage(err) }), "error");
            throw err;
        }
    }
    try {
        return await createEditorFromFile(
            newFilePath,
            options?.pipe,
            options?.target,
            options?.title,
        );
    } catch (err) {
        ui.notify(
            t("api.failedToOpenNamedFileWithError", { name: fpBasename(newFilePath), error: errMessage(err) }),
            "error",
        );
        const textFileModel = newTextFileModel("");
        await textFileModel.restore();
        return textFileModel;
    }
}

export async function navigatePageTo(
    model: PagesModel,
    pageId: string,
    newFilePath: string,
    options?: NavigatePageToOptions,
): Promise<boolean> {
    const page = model.query.findPage(pageId);
    if (!page || page.isInert) return false;
    await page.restore.ready;
    const request: PageOpenRequest = {
        ...options,
        filePath: newFilePath,
        title: options?.title ?? options?.sourceLink?.title,
        sourceUrl: options?.sourceUrl ?? options?.sourceLink?.url ?? options?.pipe?.provider.sourceUrl ?? newFilePath,
        sourceLink: options?.sourceLink,
    };

    const currentFilePath = (page.mainEditor as { filePath?: string } | null)?.filePath;
    const needsReveal = !!(request.revealLine || request.highlightText);
    if (needsReveal && currentFilePath
        && sameFileIdentity(currentFilePath, newFilePath)) {
        if (page.mainEditorInstance?.editorId !== "monaco") {
            await page.switchMainEditor("monaco");
        }
        const textHost = page.mainEditorInstance?.contentHost;
        if (!textHost) return false;
        const editor = page.mainEditorInstance;
        if (editor) applyOpenHints(page, editor, request, { exit: "reveal" });
        finishNavigation(model, page);
        return true;
    }

    if (!(await confirmLeaveCurrentEditor(page, options))) return false;

    if (await reuseNavigationTarget(model, page, newFilePath, options)) {
        const editor = page.mainEditorInstance;
        if (editor) applyOpenHints(page, editor, request, { exit: "reuse" });
        finishNavigation(model, page);
        return true;
    }
    if (await reuseEditorForFile(model, page, newFilePath, options)) {
        const editor = page.mainEditorInstance;
        if (editor) applyOpenHints(page, editor, request, { exit: "reuse" });
        finishNavigation(model, page);
        return true;
    }

    // Build the editor or text host, deferring adapter attachment until after the
    // post-restore mutations that need the underlying TextFileModel API).
    const editorOrHost = await buildEditor(newFilePath, options);
    prepareOpenedEditor(editorOrHost, request, { selectPreview: true });

    const adapter = attachEditorToPage(editorOrHost);
    await page.setMainEditor(adapter);
    registerOpenSession(adapter, request);
    applyOpenHints(page, adapter, request, { exit: "fresh", newPage: false });

    finishNavigation(model, page);
    return true;
}
