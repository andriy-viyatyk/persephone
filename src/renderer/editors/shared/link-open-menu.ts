import { createIconElement } from "../../uikit/shared/slots";
import type { MenuItem } from "../../uikit/Menu/types";
import { IncognitoIcon } from "../../theme/language-icons";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import { createLinkData } from "../../../shared/link-data";
import { settings } from "../../api/settings";
import { t } from "../../../shared/i18n/t";

function createDirectMenuIcon(component: { createElement?: () => SVGElement }): SVGElement {
    const icon = component.createElement();
    if (!icon) throw new Error("Menu icon does not have a DOM builder.");
    return icon;
}

function profileMenuId(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
    const identity = Array.from(name, (character) => character.codePointAt(0)!.toString(16)).join("-");
    return `open-in-profile-${slug}-${identity}`;
}

/**
 * Appends "Open in ..." menu items for a URL to the given menu items array.
 * Includes: OS default browser, internal browser (default profile),
 * each user-configured browser profile, and incognito.
 *
 * All items route through the openRawLink pipeline with target="browser"
 * and appropriate browserMode metadata.
 */
export function appendLinkOpenMenuItems(
    menuItems: MenuItem[],
    href: string,
    options?: { startGroup?: boolean; disabled?: boolean },
): void {
    const disabled = options?.disabled ?? false;

    const fireOpenRawLink = async (browserMode: string) => {
        const { app } = await import("../../api/app");
        await app.events.openRawLink.sendAsync(
            createLinkData(href, { target: "browser", browserMode }),
        );
    };

    menuItems.push(
        {
            id: "open-in-default-browser",
            label: t("menus.openInDefaultBrowser"),
            icon: createIconElement("open-file"),
            onClick: () => { fireOpenRawLink("os-default"); },
            disabled,
            startGroup: options?.startGroup,
        },
        {
            id: "open-in-internal-browser",
            label: t("menus.openInInternalBrowser"),
            icon: createIconElement("globe", { color: DEFAULT_BROWSER_COLOR }),
            onClick: () => { fireOpenRawLink("internal"); },
            disabled,
        },
        ...settings.get("browser-profiles").map((profile) => ({
            id: profileMenuId(profile.name),
            label: t("menus.openInProfile", { profile: profile.name }),
            icon: createIconElement("globe", { color: profile.color }),
            onClick: () => { fireOpenRawLink(`profile:${profile.name}`); },
            disabled,
        })),
        {
            id: "open-in-incognito",
            label: t("menus.openInIncognito"),
            icon: createDirectMenuIcon(IncognitoIcon),
            onClick: () => { fireOpenRawLink("incognito"); },
            disabled,
        },
    );
}
