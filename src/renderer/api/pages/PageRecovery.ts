import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { RestoreFailedEditor } from "../../editors/restore-failed/RestoreFailedEditor";
import type { PagesModel } from "./PagesModel";
import type { PageModel } from "./PageModel";
import type { RecoveryPlaceholder } from "./RecoveryPlaceholder";

/** Owns identity-checked replacement of a recovery page after descriptor construction. */
export class PageRecovery {
    constructor(private readonly model: PagesModel) {}

    async restore(page: PageModel): Promise<void> {
        const recovery = page.recovery;
        if (!recovery || recovery.isInvalidated) return;
        const promise = this.restoreTracked(page, recovery);
        recovery.trackRetry(promise);
        try {
            await promise;
        } finally {
            recovery.clearRetry(promise);
        }
    }

    async retry(pageId: string): Promise<void> {
        const page = this.model.query.findPage(pageId);
        const recovery = page?.recovery;
        const editor = page?.mainEditor;
        if (!page || !recovery || !(editor instanceof RestoreFailedEditor)
            || editor.state.get().retrying || recovery.isInvalidated) return;
        editor.state.update((state) => { state.retrying = true; });
        try {
            await this.restore(page);
        } catch (error) {
            editor.state.update((state) => { state.error = errMessage(error, t("editors.restoreFailedTitle")); });
        } finally {
            editor.state.update((state) => { state.retrying = false; });
        }
    }

    private async restoreTracked(page: PageModel, recovery: RecoveryPlaceholder): Promise<void> {
        const result = await this.model.persistence.constructPage(recovery.descriptor);
        if (result.kind === "failed") throw result.error;
        if (result.kind === "invalid") throw new Error(t("editors.restoreFailedTitle"));
        const recovered = result.page;
        if (recovery.isInvalidated || this.model.query.findPage(page.id) !== page) {
            await recovered.dispose();
            return;
        }

        const active = this.model.query.activePage === page;
        this.model.detachPage(page);
        this.model.attachPage(recovered);
        this.model.replacePage(page, recovered);
        recovery.releaseCacheProtection();
        await page.dispose();
        this.model.persistence.saveStateDebounced();
        this.model.layout.onMainEditorChanged(recovered);
        const groupedPage = this.model.query.getGroupedPage(recovered.id);
        if (groupedPage) this.model.layout.onMainEditorChanged(groupedPage);
        if (active) {
            this.model.onShow.send(recovered);
            this.model.onFocus.send(recovered);
        }
    }
}
