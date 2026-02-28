import { settings } from "../api/settings";
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
    profileName?: string;
    /** External URLs (from OS) use left-to-right search and match only the default profile. */
    external?: boolean;
}): Promise<void> {
    const pages = pagesModel.state.get().pages;
    const activePage = pagesModel.activePage;
    const activeIndex = activePage ? pages.indexOf(activePage) : -1;

    // When a specific profile is requested, only match browser tabs with that profile.
    // For external URLs without explicit profile, match only the default profile.
    // When no profile is specified on internal URLs, match any non-incognito browser tab.
    // When incognito is requested, match any incognito browser tab.
    const matchesBrowser = (pageState: any) => {
        if (pageState.type !== "browserPage") return false;
        if (options?.incognito) return !!pageState.isIncognito;
        const targetProfile = options?.profileName !== undefined
            ? (options.profileName || "")
            : options?.external
                ? (settings.get("browser-default-profile") || "")
                : undefined;
        return !pageState.isIncognito &&
            (targetProfile === undefined || (pageState.profileName ?? "") === targetProfile);
    };

    const addTabToPage = (index: number) => {
        const pageState = pages[index].state.get();
        (pages[index] as any).addTab(url);
        pagesModel.showPage(pageState.id);
    };

    if (options?.external) {
        // External URLs: simple left-to-right search for the first matching browser page
        for (let i = 0; i < pages.length; i++) {
            if (matchesBrowser(pages[i].state.get())) {
                addTabToPage(i);
                return;
            }
        }
    } else {
        // Internal URLs: search right from active page, then left
        for (let i = activeIndex + 1; i < pages.length; i++) {
            if (matchesBrowser(pages[i].state.get())) {
                addTabToPage(i);
                return;
            }
        }
        for (let i = activeIndex - 1; i >= 0; i--) {
            if (matchesBrowser(pages[i].state.get())) {
                addTabToPage(i);
                return;
            }
        }
    }

    // No matching browser tab found — create new one as last tab.
    // Pass the URL directly so the initial tab's webview src is set before React mounts
    // the component — avoids a race condition where navigate() is called before the
    // webview is ready, causing the page to stay blank.
    const profileName = options?.incognito
        ? undefined
        : (options?.profileName ?? settings.get("browser-default-profile")) || undefined;
    const showOptions: ShowBrowserPageOptions = {
        url,
        ...(options?.incognito ? { incognito: true } : profileName ? { profileName } : {}),
    };
    await showBrowserPage(showOptions);
}
