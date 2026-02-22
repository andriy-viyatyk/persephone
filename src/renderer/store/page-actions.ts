import { appSettings } from "./app-settings";
import { pagesModel } from "./pages-store";

/**
 * Opens the About page. If already open, activates it.
 */
export async function showAboutPage(): Promise<void> {
    const aboutModule = await import("../editors/about/AboutPage");
    const model = await aboutModule.default.newEmptyPageModel("aboutPage");
    if (model) {
        pagesModel.addPage(model);
    }
}

/**
 * Opens the Settings page. If already open, activates it.
 */
export async function showSettingsPage(): Promise<void> {
    const settingsModule = await import("../editors/settings/SettingsPage");
    const model = await settingsModule.default.newEmptyPageModel("settingsPage");
    if (model) {
        pagesModel.addPage(model);
    }
}

export interface ShowBrowserPageOptions {
    profileName?: string;
    incognito?: boolean;
}

/**
 * Opens a new Browser page.
 */
export async function showBrowserPage(options?: ShowBrowserPageOptions): Promise<void> {
    const browserModule = await import("../editors/browser/BrowserPageView");
    const model = await browserModule.default.newEmptyPageModel("browserPage");
    if (model) {
        if (options?.profileName || options?.incognito) {
            model.state.update((s: any) => {
                if (options.profileName) s.profileName = options.profileName;
                if (options.incognito) s.isIncognito = true;
            });
        }
        await model.restore();
        pagesModel.addPage(model);
    }
}

/**
 * Opens a URL in the nearest browser tab (search right, then left from active page).
 * If no browser tab exists (or incognito requested), creates a new browser page.
 */
export async function openUrlInBrowserTab(url: string, options?: {
    incognito?: boolean;
}): Promise<void> {
    const pages = pagesModel.state.get().pages;
    const activePage = pagesModel.activePage;
    const activeIndex = activePage ? pages.indexOf(activePage) : -1;

    if (!options?.incognito) {
        // Search right for existing browser tab
        for (let i = activeIndex + 1; i < pages.length; i++) {
            if (pages[i].state.get().type === "browserPage") {
                (pages[i] as any).addTab(url);
                pagesModel.showPage(pages[i].state.get().id);
                return;
            }
        }
        // Search left for existing browser tab
        for (let i = activeIndex - 1; i >= 0; i--) {
            if (pages[i].state.get().type === "browserPage") {
                (pages[i] as any).addTab(url);
                pagesModel.showPage(pages[i].state.get().id);
                return;
            }
        }
    }

    // No browser tab found (or incognito requested) — create new one as last tab
    const profileName = options?.incognito ? undefined : appSettings.get("browser-default-profile") || undefined;
    await showBrowserPage(options?.incognito ? { incognito: true } : profileName ? { profileName } : undefined);
    // Navigate the newly created browser page's initial tab to the URL
    const newPages = pagesModel.state.get().pages;
    const lastPage = newPages[newPages.length - 1];
    if (lastPage?.state.get().type === "browserPage") {
        (lastPage as any).navigate(url);
    }
}
