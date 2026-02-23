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
    url?: string;
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
        if (options?.url) {
            model.state.update((s: any) => {
                s.url = options.url;
                const tab = s.tabs?.[0];
                if (tab) {
                    tab.url = options.url;
                    tab.homeUrl = options.url;
                }
            });
        }
        await model.restore();
        pagesModel.addPage(model);
    }
}

/**
 * Opens an image URL in a new Image Viewer tab.
 */
export async function openImageInNewTab(imageUrl: string): Promise<void> {
    const imgModule = await import("../editors/image/ImageViewer");
    const imgModel = await imgModule.default.newEmptyPageModel("imageFile");
    if (imgModel) {
        imgModel.state.update((s: { title: string; url?: string }) => {
            s.title = imageUrl.split("/").pop()?.split("?")[0] || "Image";
            s.url = imageUrl;
        });
        await imgModel.restore();
        pagesModel.addPage(imgModel);
    }
}

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

    // No browser tab found (or incognito requested) — create new one as last tab.
    // Pass the URL directly so the initial tab's webview src is set before React mounts
    // the component — avoids a race condition where navigate() is called before the
    // webview is ready, causing the page to stay blank.
    const profileName = options?.incognito ? undefined : appSettings.get("browser-default-profile") || undefined;
    const showOptions: ShowBrowserPageOptions = {
        url,
        ...(options?.incognito ? { incognito: true } : profileName ? { profileName } : {}),
    };
    await showBrowserPage(showOptions);
}
