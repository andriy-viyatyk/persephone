import { BrowserEditor, type BrowserNewOptions } from "./BrowserEditor";
import type { PagesModel } from "../../api/pages/PagesModel";
import type { PageModel } from "../../api/pages/PageModel";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";

// ============================================================================
// Browser page opening — the browser-specific halves of the pages lifecycle.
//
// Lives here (not in PagesLifecycleModel) so the startup-loaded pages model
// carries no static import of the browser chunk; the lifecycle reaches these
// through `await import(...)`, keeping the browser editor lazily loaded.
// ============================================================================

export type ShowBrowserPageOptions = BrowserNewOptions;

export async function showBrowserPage(
    model: PagesModel,
    options?: ShowBrowserPageOptions,
): Promise<PageModel | undefined> {
    const result = await BrowserEditor.createNew(options ?? {});
    if ("refused" in result) {
        ui.notify(result.refused, "error");
        return;
    }
    const { editor } = result;
    const page = model.lifecycle.addPage(editor);
    if (options?.tor) void editor.tor.init();
    return page;
}

export async function openUrlInBrowserTab(
    model: PagesModel,
    url: string,
    options?: {
        incognito?: boolean;
        profileName?: string;
        external?: boolean;
        openedByAgent?: boolean;
    },
): Promise<string | undefined> {
    const pages = model.state.get().pages;
    const activePage = model.query.activePage;
    const activeIndex = activePage ? pages.indexOf(activePage) : -1;

    const matchesBrowser = (page: PageModel) => {
        const editor = page.mainEditor;
        if (!(editor instanceof BrowserEditor) || model.boardPageRouter.getRunPageOwner(page)) return false;
        if (options?.incognito) {
            return editor.matches({ incognito: true, openedByAgent: !!options.openedByAgent });
        }
        return editor.matches(options?.external || options?.profileName === undefined
            ? {}
            : { profileName: options.profileName || "" });
    };

    const addTabToPage = (index: number): string | undefined => {
        const page = pages[index];
        const editor = page.mainEditor;
        if (!(editor instanceof BrowserEditor)) return undefined;
        const tabs = editor.state.get().tabs;
        if (tabs?.length === 1 && tabs[0].url === "about:blank") {
            editor.navigate(url);
        } else {
            // Search text ("big buck bunny") must become a search URL here too, not a raw tab URL.
            editor.addTab(editor.resolveAddressInput(url) || undefined);
        }
        model.navigation.showPage(page.id);
        return page.id;
    };

    if (options?.external) {
        if (activeIndex >= 0 && matchesBrowser(pages[activeIndex])) {
            return addTabToPage(activeIndex);
        }
        for (let i = 0; i < pages.length; i++) {
            if (matchesBrowser(pages[i])) {
                return addTabToPage(i);
            }
        }
    } else {
        if (activeIndex >= 0 && matchesBrowser(pages[activeIndex])) {
            return addTabToPage(activeIndex);
        }
        for (let i = activeIndex + 1; i < pages.length; i++) {
            if (matchesBrowser(pages[i])) {
                return addTabToPage(i);
            }
        }
        for (let i = activeIndex - 1; i >= 0; i--) {
            if (matchesBrowser(pages[i])) {
                return addTabToPage(i);
            }
        }
    }

    const profileName = options?.incognito
        ? undefined
        : (options?.profileName ??
              settings.get("browser-default-profile")) || undefined;
    const showOptions: ShowBrowserPageOptions = {
        url,
        ...(options?.openedByAgent ? { openedByAgent: true } : {}),
        ...(options?.incognito
            ? { incognito: true }
            : profileName
              ? { profileName }
              : {}),
    };
    const page = await showBrowserPage(model, showOptions);
    return page?.id;
}
