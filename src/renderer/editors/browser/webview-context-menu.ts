const { ipcRenderer } = require("electron");
import { BrowserChannel } from "../../../ipc/browser-ipc";
import { app } from "../../api/app";
import { pagesModel } from "../../api/pages";
import { ui } from "../../api/ui";
import { showAppPopupMenu } from "../../ui/dialogs/poppers/showPopupMenu";
import type { MenuItem } from "../../uikit/Menu";
import { toClipboard, withTimeout } from "../../core/utils/utils";
import { guard } from "../../core/utils/guard";
import { t, untranslated } from "../../../shared/i18n/t";
import type { BrowserEditorModel } from "./BrowserEditorModel";

const SVG_PROBE_TIMEOUT = 250;
const LINK_PROBE_TIMEOUT = 1000;

export interface BrowserContextMenuInput {
    model: BrowserEditorModel;
    webview: Electron.WebviewTag;
    internalTabId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
    showResources: (regKey: string, pageUrl: string, title: string) => void;
}

export async function showBrowserContextMenu({
    model,
    webview,
    internalTabId,
    data,
    showResources,
}: BrowserContextMenuInput): Promise<void> {
        const menuX = data.x || 0;
        const menuY = data.y || 0;

        const wvRect = webview.getBoundingClientRect();
        const probeX = menuX - wvRect.left;
        const probeY = menuY - wvRect.top;
        // SVG probe only used to decide whether to include the "Open SVG in Editor" item.
        // `webview.executeJavaScript` queues on the page renderer's main thread; if the page
        // is mid-load and the renderer is busy, awaiting it can block the menu for many
        // seconds. Race against a short budget on idle pages the probe returns near-
        // instantly; on busy pages we drop the SVG item and open the menu immediately.
        const svgProbe: Promise<string | null> = webview.executeJavaScript(`
            (() => {
                const el = document.elementFromPoint(${probeX}, ${probeY});
                const svg = el?.closest('svg');
                if (!svg) return null;

                const clone = svg.cloneNode(true);

                if (!clone.getAttribute('xmlns')) {
                    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                }

                if (!clone.getAttribute('viewBox')) {
                    try {
                        const bb = svg.getBBox();
                        if (bb.width > 0 && bb.height > 0) {
                            clone.setAttribute('viewBox',
                                bb.x + ' ' + bb.y + ' ' + bb.width + ' ' + bb.height);
                        }
                    } catch (e) {}
                }

                if (!clone.getAttribute('width') && !clone.getAttribute('height')) {
                    const vb = clone.getAttribute('viewBox');
                    if (vb) {
                        const parts = vb.split(/[\\s,]+/);
                        if (parts.length === 4) {
                            clone.setAttribute('width', parts[2]);
                            clone.setAttribute('height', parts[3]);
                        }
                    }
                }

                let html = clone.outerHTML;
                html = html.replace(/<!--[\\s\\S]*?-->/g, '');
                return html;
            })()
        `);
        const svgSource = await withTimeout<string | null>(svgProbe, SVG_PROBE_TIMEOUT, null);

        const items: MenuItem[] = [];

        // Link items
        if (data.linkURL) {
            const linkURL = data.linkURL;
            items.push({
                id: "open-link-in-new-tab",
                label: t("browser.toolbarOpenLinkNewTab"),
                onClick: () => {
                    const parentTab = model.state.get().tabs.find((t) => t.id === internalTabId);
                    model.addTab(linkURL, parentTab?.groupId);
                },
            });
            items.push({
                id: "copy-link-address",
                label: t("browser.toolbarCopyLinkAddress"),
                onClick: () => toClipboard(linkURL),
            });
            items.push({
                id: "add-to-bookmarks",
                label: t("browser.toolbarAddToBookmarks"),
                onClick: async () => {
                    const bm = await model.bookmarksUI.ensureBookmarks();
                    if (!bm) return;
                    // Same busy-page hazard as the SVG probe above: the title/image are
                    // suggestions only, so open the dialog without them rather than wait.
                    const linkProbe: Promise<{ title: string; imgSrc: string }> = webview.executeJavaScript(`
                        (() => {
                            const el = document.elementFromPoint(${probeX}, ${probeY});
                            const link = el?.closest('a');
                            const img = link?.querySelector('img') || el?.querySelector('img');
                            return {
                                title: link?.textContent?.trim()?.substring(0, 200) || '',
                                imgSrc: img?.src || '',
                            };
                        })()
                    `);
                    // `linkURL` not `linkInfo` is what guarantees the dialog always has
                    // a URL; it comes from the context-menu params, never from the page.
                    const linkInfo = await withTimeout(linkProbe, LINK_PROBE_TIMEOUT, {
                        title: "",
                        imgSrc: "",
                    });
                    const existingLink = bm.findByUrl(linkURL);
                    await model.bookmarksUI.showBookmarkDialog({
                        title: linkInfo.title,
                        href: linkURL,
                        discoveredImages: linkInfo.imgSrc ? [linkInfo.imgSrc] : [],
                        imgSrc: linkInfo.imgSrc || undefined,
                        existingLink,
                    });
                },
            });
        }

        // Image items
        if (data.srcURL && data.mediaType === "image") {
            const srcURL = data.srcURL;
            items.push({
                id: "open-image-in-new-tab",
                label: t("browser.toolbarOpenImageNewTab"),
                startGroup: items.length > 0,
                onClick: async () => {
                    // A Tor/proxied page's image is read through its session (US-1557).
                    const sessionHandle = await model.network.sessionSource(srcURL);
                    if (sessionHandle === null) {
                        ui.notify(t("browser.secureRouteImageFailed"), "warning");
                        return;
                    }
                    pagesModel.openImageInNewTab(srcURL, undefined, sessionHandle);
                },
            });
            items.push({
                id: "copy-image-address",
                label: t("browser.toolbarCopyImageAddress"),
                onClick: () => toClipboard(srcURL),
            });
            items.push({
                id: "use-image-for-bookmark",
                label: t("browser.toolbarUseImageForBookmark"),
                onClick: () => {
                    model.bookmarksUI.trackClickedImages(internalTabId, [srcURL]);
                },
            });
        }

        // Selection items
        if (data.selectionText) {
            const selectionText = data.selectionText;
            items.push({
                id: "copy-selection",
                label: t("menus.copy"),
                startGroup: items.length > 0,
                onClick: () => {
                    toClipboard(selectionText);
                    webview.focus();
                },
            });
        }

        // Editable field items
        if (data.isEditable) {
            if (data.editFlags?.canCut) {
                items.push({
                    id: "cut-field",
                    label: t("menus.cut"),
                    startGroup: !data.selectionText && items.length > 0,
                    onClick: () => {
                        webview.focus();
                        webview.cut();
                    },
                });
            }
            if (!data.selectionText && data.editFlags?.canCopy) {
                items.push({
                    id: "copy-field",
                    label: t("menus.copy"),
                    onClick: () => {
                        webview.focus();
                        webview.copy();
                    },
                });
            }
            if (data.editFlags?.canPaste) {
                items.push({
                    id: "paste-field",
                    label: t("menus.paste"),
                    onClick: () => {
                        webview.focus();
                        webview.paste();
                    },
                });
            }
        }

        // Navigation items
        const state = model.state.get();
        const tab = state.tabs.find((t) => t.id === internalTabId);
        items.push({
            id: "back",
            label: t("browser.back"),
            startGroup: true,
            disabled: !tab?.canGoBack,
            onClick: () => webview.goBack(),
        });
        items.push({
            id: "forward",
            label: t("browser.forward"),
            disabled: !tab?.canGoForward,
            onClick: () => webview.goForward(),
        });
        items.push({
            id: "reload",
            label: t("browser.reload"),
            onClick: () => webview.reload(),
        });

        // View Source
        const pageUrl = tab?.url || "";
        items.push({
            id: "view-source",
            label: t("browser.toolbarViewSource"),
            startGroup: true,
            disabled: !pageUrl || pageUrl === "about:blank",
            onClick: async () => {
                const resp = await webview.executeJavaScript(
                    `fetch(location.href).then(r => r.text())`,
                );
                await app.capabilities.invoke("text.open", {
                    content: resp,
                    language: "html",
                    title: "Source: " + (tab?.pageTitle || pageUrl),
                });
            },
        });

        // View actual DOM (includes iframe content via main process)
        const regKey = `${model.id}/${internalTabId}`;
        items.push({
            id: "view-actual-dom",
            label: t("browser.toolbarViewActualDom"),
            onClick: async () => {
                const html = await ipcRenderer.invoke(
                    BrowserChannel.collectDom,
                    regKey,
                );
                await app.capabilities.invoke("text.open", {
                    content: html,
                    language: "html",
                    title: "DOM: " + (tab?.pageTitle || pageUrl),
                });
            },
        });

        // Show resources extracted from the page DOM + network log
        items.push({
            id: "show-resources",
            label: t("browser.toolbarShowResources"),
            onClick: () => showResources(regKey, pageUrl, tab?.pageTitle || pageUrl),
        });

        // SVG item
        if (svgSource) {
            items.push({
                id: "open-svg-in-editor",
                label: t("browser.toolbarOpenSvgEditor"),
                onClick: () => {
                    void guard("Failed to open SVG source", () => app.capabilities.invoke("text.open", {
                        content: svgSource,
                        language: "xml",
                        title: untranslated("untitled.svg"),
                    }));
                },
            });
        }

        // Inspect Element
        items.push({
            id: "inspect-element",
            label: t("browser.toolbarInspectElement"),
            onClick: () => webview.inspectElement(probeX, probeY),
        });

        model.state.update((s) => { s.popupOpen = true; });
        showAppPopupMenu(menuX, menuY, items, {
            skipInspect: true,
        }).then(() => {
            model.state.update((s) => { s.popupOpen = false; });
        });

}
