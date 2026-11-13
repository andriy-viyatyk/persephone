import { EditorId } from "../../../shared/editor-ids";
import type { PagesModel } from "./PagesModel";
import type {
    PageDescriptor,
    WindowState,
} from "../../../shared/persistence";
import { openFilesNameTemplate } from "../../../shared/constants";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce, errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { editorRegistry } from "../../editors/base/editorRegistry";
import type { EditorModelInstance as EditorModel } from "../../editors/base/EditorModel";
import { RestoreFailedEditor } from "../../editors/restore-failed/RestoreFailedEditor";
import { attachExplorer } from "../../editors/explorer/page-explorer";
import { appWindow } from "../window";
import { fs as appFs } from "../fs";
import { PageModel } from "./PageModel";
import { RecoveryPlaceholder } from "./RecoveryPlaceholder";
import { normalizePageDescriptor, normalizePinSide } from "./descriptor-migrations";

type RestoreAttempt = { kind: "restored"; page: PageModel } | { kind: "invalid" } | { kind: "failed"; error: unknown };

export class PagesPersistenceModel {
    constructor(private model: PagesModel) {}

    /**
     * False until `restoreState()` has finished. Restore attaches pages one at a
     * time — and `attachPage` subscribes each one to `saveStateDebounced` — so
     * until the final `state.update` commits, a save would serialise an empty or
     * partial page list over the real session.
     *
     * The flag tracks *restore in progress* and nothing else. A descriptor that
     * fails to restore is an expected outcome (a `schemaVersion` bump discards
     * every page by design), and persistence must keep working afterwards, so
     * nothing in `restorePage`/`applyState` may clear it and `init()` sets it in
     * a `finally`.
     */
    private restored = false;

    saveState = async (): Promise<void> => {
        if (!this.restored || appWindow.isBoardMode) return;

        const { pages, leftRight } = this.model.state.get();
        const pageDescriptors: PageDescriptor[] = pages.map((p) => p.getDescriptor());
        const storedState: WindowState = {
            schemaVersion: 4,
            pages: pageDescriptors,
            groupings: Array.from(leftRight.entries()),
            activePageId: this.model.query.activePage?.id,
        };

        await appFs.saveDataFile(
            openFilesNameTemplate,
            JSON.stringify(storedState, null, 4),
        );
    };

    // The `canRun` gate re-schedules rather than drops, so a save suppressed
    // during restore still runs once restore completes.
    saveStateDebounced = debounce(this.saveState, 500, () => this.restored);

    restoreState = async () => {
        if (appWindow.isBoardMode) return;
        const data = parseObject(
            await appFs.getDataFile(openFilesNameTemplate),
        ) as Partial<WindowState> | undefined;
        if (!data || !Array.isArray(data.pages)) return;
        if (data.schemaVersion !== 4) return;
        await this.applyState(data as WindowState);
    };

    createRestoreFailedPage = (descriptor: PageDescriptor, error: unknown): PageModel => {
        const page = new PageModel(descriptor.id);
        page.pinSide = normalizePinSide(descriptor);
        const main = descriptor.editors.find((editor) => editor.id === descriptor.mainEditorId);
        const candidate = main?.host?.state.title ?? main?.state.title;
        const title = typeof candidate === "string" && candidate ? candidate : t("editors.restoreFailedTitle");
        const originalIds = new Set(descriptor.editors.map((editor) => editor.id.toLowerCase()));
        let id = crypto.randomUUID();
        while (originalIds.has(id.toLowerCase())) id = crypto.randomUUID();
        const editor = new RestoreFailedEditor(id, title, errMessage(error, t("editors.restoreFailedTitle")));
        editor.retry = () => this.model.lifecycle.recoverPage(page.id);
        editor.closePage = () => page.close();
        page.attach(editor);
        page.mainEditor = editor;
        page.recovery = new RecoveryPlaceholder(descriptor);
        return page;
    };

    restorePage = async (descriptor: PageDescriptor, options: { seedSecondaryViewsWidth?: boolean } = {}): Promise<PageModel | null> => {
        const ids = descriptor.editors.map((editor) => editor.id);
        appFs.protectCacheIds(ids);
        let transferred = false;
        try {
            const result = await this.constructPage(descriptor, options);
            if (result.kind === "restored") return result.page;
            if (result.kind === "invalid") return null;
            const page = this.createRestoreFailedPage(descriptor, result.error);
            transferred = true;
            return page;
        } finally {
            if (!transferred) appFs.releaseCacheIds(ids);
        }
    };

    constructPage = async (descriptor: PageDescriptor, options: { seedSecondaryViewsWidth?: boolean } = {}): Promise<RestoreAttempt> => {
        const constructed: EditorModel[] = [];
        let page: PageModel | undefined;
        let failure: unknown;
        let failed = false;
        try {
        const desc = await normalizePageDescriptor(descriptor);
        page = new PageModel(desc.id, {
            seedSecondaryViewsWidth: options.seedSecondaryViewsWidth ?? false,
        });
        page.pinSide = normalizePinSide(desc);
        // Pixel sizes only; a value of 1 or less is a fraction saved by an earlier build and is dropped.
        const popoverSize = desc.popoverSize;
        page.popoverSize = popoverSize
            && Number.isFinite(popoverSize.width)
            && Number.isFinite(popoverSize.height)
            && popoverSize.width > 1 && popoverSize.height > 1
            ? { width: popoverSize.width, height: popoverSize.height, ...(popoverSize.fullHeight === true ? { fullHeight: true } : {}) }
            : undefined;
        page.seedNavBack(desc.navBack);
        const folderFallbacks: { sourceEditorId: string; folderPath: string }[] = [];

        const editors = await Promise.all(
            desc.editors.map(async (d) => {
                try {
                    const editor = await editorRegistry.restoreFromDescriptor(d, {
                        mainEditorId: desc.mainEditorId,
                        requestFolderFallback: (request) => folderFallbacks.push(request),
                    });
                    if (editor) constructed.push(editor);
                    return editor;
                } catch (err) {
                    console.warn(
                        `[restore] editor ${d.editorId} in page ${desc.id}:`,
                        err,
                    );
                    failed = true;
                    failure = err;
                    return null;
                }
            }),
        );

        if (failed) throw failure;
        for (const editor of editors) {
            if (editor) page.attach(editor);
        }

        const folderFallback = folderFallbacks[0];
        if (folderFallback) {
            if (!page.findExplorer()) {
                await attachExplorer(page, { rootPath: folderFallback.folderPath }, explorer => {
                    constructed.push(explorer);
                });
            }

            const { buildFolderCategoryLink, CategoryEditorModel } = await import(
                "../../editors/category/CategoryEditorModel"
            );
            const category = await editorRegistry.createEditor(
                EditorId.categoryView,
                folderFallback.sourceEditorId,
            );
            constructed.push(category);
            if (!(category instanceof CategoryEditorModel)) {
                throw new Error("Folder View fallback created an unexpected editor.");
            }
            category.initFromLink(
                buildFolderCategoryLink(page, folderFallback.folderPath),
            );
            await category.restore();
            page.attach(category);
        }

        if (
            desc.mainEditorId &&
            page.editors.some((e) => e.id === desc.mainEditorId)
        ) {
            page.assignMain(desc.mainEditorId);
        }

        if (desc.sidebar) {
            page.applySidebarDescriptor(desc.sidebar);
        }

        if (page.editors.length === 0) {
            await page.dispose();
            return { kind: "invalid" };
        }
        return { kind: "restored", page };
        } catch (error) {
            const attached = new Set(page?.editors ?? []);
            if (page) {
                try { await page.dispose(); } catch (disposeError) { console.warn("[restore] page cleanup:", disposeError); }
            }
            for (const editor of constructed) {
                if (attached.has(editor)) continue;
                try { await editor.dispose(); } catch (disposeError) { console.warn("[restore] editor cleanup:", disposeError); }
            }
            return { kind: "failed", error };
        }
    };

    private applyState = async (data: WindowState): Promise<void> => {
        const results = await Promise.all(
            data.pages.map(async (d) => {
                try {
                    return await this.restorePage(d);
                } catch (err) {
                    console.warn(`[restore] page ${d.id}:`, err);
                    const ids = d.editors.map((editor) => editor.id);
                    appFs.protectCacheIds(ids);
                    try { return this.createRestoreFailedPage(d, err); }
                    catch (placeholderError) { appFs.releaseCacheIds(ids); throw placeholderError; }
                }
            }),
        );

        const models: PageModel[] = results.filter(
            (p): p is PageModel => p !== null,
        );
        for (const p of models) this.model.attachPage(p);

        const pagesByZone = this.model.layout.sortByPinSide(models);
        this.model.setPageArrays({ pages: pagesByZone, ordered: [] });

        const nonRight = pagesByZone.filter((page) => !this.model.query.isRightPinned(page.id));
        const normal = nonRight.filter((page) => page.pinSide === undefined);
        const requested = nonRight.find((page) => page.id === data.activePageId);
        const active = requested ?? normal.at(-1) ?? nonRight.at(-1);
        const orderedModels = active
            ? [...nonRight.filter((page) => page !== active), active]
            : [];
        this.model.setPageArrays({ ordered: orderedModels });

        if (data.groupings && Array.isArray(data.groupings)) {
            data.groupings.forEach((el) => {
                if (Array.isArray(el) && el.length === 2) {
                    if (this.model.query.isRightPinned(el[0]) || this.model.query.isRightPinned(el[1])) return;
                    this.model.layout.group(el[0], el[1]);
                }
            });
            this.model.layout.fixGrouping();
        }
        if (!nonRight.length) this.model.lifecycle.addEmptyPage();
    };

    /**
     * Initialize pages: restore from storage. Called from app.initPages() during bootstrap.
     * Launch inputs are opened later by the app bootstrap after event registration.
     */
    init = async () => {
        try {
            if (!appWindow.isBoardMode) await this.restoreState();
        } finally {
            this.restored = true;
        }
    };
}
