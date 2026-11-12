import { pages } from "../api/pages";

/** Resolve the explicit page or active work page for scripts; a right-pin popover never changes the default. */
export function resolveRendererScriptEditor(pageId?: string) {
    const page = pageId ? pages.query.findPage(pageId) : pages.query.activePage;
    // scriptRunner expects a legacy EditorModel; unwrap adapter or pass undefined.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return page?.mainEditor as any ?? undefined;
}
