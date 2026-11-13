const { ipcRenderer } = require("electron");
import type { MenuItem } from "../../uikit/Menu";
import { app } from "../../api/app";
import { pages } from "../../api/pages";
import { ui } from "../../api/ui";
import { BrowserChannel } from "../../../ipc/browser-ipc";
import { t } from "../../../shared/i18n/t";
import type { BrowserEditor } from "./BrowserEditor";

/** Build the toolbar page menu for the active browser tab. */
export function getPageMenuItems(model: BrowserEditor): MenuItem[] {
    const state = model.state.get();
    const activeTabId = state.activeTabId;
    const tab = state.tabs.find((item) => item.id === activeTabId);
    const webview = model.webview.getActiveWebview();
    const pageUrl = tab?.url || "";
    const hasPage = !!webview && !!pageUrl && pageUrl !== "about:blank";
    const regKey = `${model.id}/${activeTabId}`;

    return [
        {
            id: "view-source",
            label: t("browser.toolbarViewSource"),
            disabled: !hasPage,
            onClick: async () => {
                if (!webview) return;
                const response = await webview.executeJavaScript(
                    `fetch(location.href).then(r => r.text())`,
                );
                await app.capabilities.invoke("text.open", {
                    content: response,
                    language: "html",
                    title: "Source: " + (tab?.pageTitle || pageUrl),
                });
            },
        },
        {
            id: "view-actual-dom",
            label: t("browser.toolbarViewActualDom"),
            disabled: !hasPage,
            onClick: async () => {
                const html = await ipcRenderer.invoke(BrowserChannel.collectDom, regKey);
                await app.capabilities.invoke("text.open", {
                    content: html,
                    language: "html",
                    title: "DOM: " + (tab?.pageTitle || pageUrl),
                });
            },
        },
        {
            id: "show-resources",
            label: t("browser.toolbarShowResources"),
            disabled: !hasPage,
            onClick: () => showResources(model, regKey, pageUrl, tab?.pageTitle || pageUrl),
        },
    ];
}

/** Collect page resources and the network log, then open them as a link collection. */
export async function showResources(
    model: BrowserEditor,
    regKey: string,
    pageUrl: string,
    title: string,
): Promise<void> {
    const [html, networkLog, loadedUrls] = await Promise.all([
        ipcRenderer.invoke(BrowserChannel.collectDom, regKey),
        ipcRenderer.invoke(BrowserChannel.getNetworkLog, regKey),
        ipcRenderer.invoke(BrowserChannel.collectLoadedResources, regKey) as Promise<string[]>,
    ]);

    const { extractHtmlResources, loadedFontLinks } = await import("../../core/utils/html-resources");
    const { networkLogToLinks } = await import("./network-log-links");

    const domLinks = extractHtmlResources(html, { baseUrl: pageUrl });
    // Fonts come from Resource Timing because the network log misses cache hits.
    const domHrefs = new Set(domLinks.map((link) => link.href));
    const fontLinks = loadedFontLinks(loadedUrls).filter((link) => !domHrefs.has(link.href));
    const networkLinks = networkLogToLinks(networkLog);
    const links = [...domLinks, ...fontLinks, ...networkLinks];
    // Standalone link pages do not share a Tor or proxied browser session.
    if (model.network.imageRoute) {
        for (const link of links) delete link.imgSrc;
    }

    if (links.length === 0) {
        ui.notify(t("browser.toolbarNoResources"), "info");
        return;
    }

    pages.lifecycle.openLinks(links, title + " \u2014 Resources");
}
