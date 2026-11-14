import { app } from "../../api/app";
import { ContextMenuEvent } from "../../api/events/events";
import type { ILink } from "../../api/types/io.tree";
import { getHostname, requestFaviconSave } from "../../components/icons/favicon-cache";
import { toClipboard } from "../../core/utils/utils";
import { appendLinkOpenMenuItems } from "../shared/link-open-menu";
import { t } from "../../../shared/i18n/t";
import type { LinkItem, LinkSource } from "./linkTypes";

export function openLinkItem(model: LinkSource, link: ILink): void {
    if (!link.href) return;
    if (!model.isPrivatePage) requestFaviconSave(getHostname(link.href));
    void model.openLink(link);
}

export function buildLinkContextMenu(
    model: LinkSource,
    link: LinkItem,
    options: { pinned: boolean },
): (event: MouseEvent) => void {
    return (event: MouseEvent): void => {
        model.selectLink(link.id);
        if (options.pinned) {
            const contextEvent = ContextMenuEvent.fromNativeEvent(event, "link-pinned") as ContextMenuEvent<LinkItem>;
            const customItems = model.extraMenuItems(link);
            if (customItems?.length) contextEvent.items.push(...customItems);
            contextEvent.items.push({
                id: "pinned-link-edit",
                label: t("links.edit"),
                icon: "rename",
                onClick: () => { void model.showLinkDialog(link.id); },
                startGroup: customItems?.length ? true : undefined,
            });
            if (link.href) appendLinkOpenMenuItems(contextEvent.items, link.href, { startGroup: true });
            contextEvent.items.push({
                id: "pinned-link-copy-url",
                label: t("links.copyUrl"),
                icon: "copy",
                onClick: () => { if (link.href) toClipboard(link.href); },
                disabled: !link.href,
            });
            if (link.imgSrc) {
                const imageUrl = link.imgSrc;
                contextEvent.items.push(
                    {
                        id: "pinned-link-copy-image-url",
                        label: t("links.copyImageUrl"),
                        icon: "copy",
                        onClick: () => toClipboard(imageUrl),
                        startGroup: true,
                    },
                    {
                        id: "pinned-link-open-image-in-new-tab",
                        label: t("links.openImageNewTab"),
                        icon: "open-file",
                        onClick: async () => {
                            const { pages } = await import("../../api/pages");
                            pages.openImageInNewTab(imageUrl);
                        },
                    },
                );
            }
            contextEvent.items.push(
                {
                    id: "pinned-link-unpin",
                    label: t("shell.unpin"),
                    icon: "pin-filled",
                    onClick: () => model.togglePinLink(link.id),
                    startGroup: true,
                },
                {
                    id: "pinned-link-delete",
                    label: t("menus.delete"),
                    icon: "delete",
                    onClick: () => { void model.deleteLink(link.id); },
                },
            );
            event.contextMenuPromise = app.events.linkContextMenu.sendAsync(contextEvent);
            return;
        }

        const contextEvent = ContextMenuEvent.fromNativeEvent(event, "link-item") as ContextMenuEvent<ILink>;
        contextEvent.target = link;
        const customItems = model.extraMenuItems(link as LinkItem);
        if (customItems?.length) contextEvent.items.push(...customItems);
        contextEvent.items.push({
            id: "link-edit",
            label: t("links.edit"),
            icon: "rename",
            onClick: () => { void model.showLinkDialog(link.id); },
            startGroup: customItems?.length ? true : undefined,
        });
        contextEvent.items.push({
            id: "link-copy-url",
            label: t("links.copyUrl"),
            icon: "copy",
            onClick: () => { if (link.href) toClipboard(link.href); },
            disabled: !link.href,
        });
        if (link.imgSrc) {
            const imageUrl = link.imgSrc;
            contextEvent.items.push(
                {
                    id: "link-copy-image-url",
                    label: t("links.copyImageUrl"),
                    icon: "copy",
                    onClick: () => toClipboard(imageUrl),
                    startGroup: true,
                },
                {
                    id: "link-open-image-in-new-tab",
                    label: t("links.openImageNewTab"),
                    icon: "open-file",
                    onClick: async () => {
                        const { pages } = await import("../../api/pages");
                        pages.openImageInNewTab(imageUrl);
                    },
                },
            );
        }
        const isPinned = model.isLinkPinned(link.id);
        contextEvent.items.push(
            {
                id: isPinned ? "link-unpin" : "link-pin",
                label: isPinned ? t("shell.unpin") : t("links.pin"),
                icon: isPinned ? "pin-filled" : "pin",
                onClick: () => model.togglePinLink(link.id),
                startGroup: true,
            },
            {
                id: "link-delete",
                label: t("menus.delete"),
                icon: "delete",
                onClick: () => { void model.deleteLink(link.id); },
            },
        );
        event.contextMenuPromise = app.events.linkContextMenu.sendAsync(
            contextEvent as ContextMenuEvent<ILink>,
        );
    };
}
