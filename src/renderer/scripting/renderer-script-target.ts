import { pages } from "../api/pages";

/** Resolve the explicit page or active work page for scripts; a right-pin popover never changes the default. */
export function resolveRendererScriptEditor(pageId?: string) {
    const page = pageId ? pages.query.findPage(pageId) : pages.query.activePage;
    return page?.mainEditor ?? undefined;
}
