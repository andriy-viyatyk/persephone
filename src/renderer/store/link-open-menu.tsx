import React from "react";
import { MenuItem } from "../components/overlay/PopupMenu";
import { GlobeIcon, OpenFileIcon } from "../theme/icons";
import { IncognitoIcon } from "../theme/language-icons";
import { DEFAULT_BROWSER_COLOR } from "../theme/palette-colors";
import { appSettings } from "./app-settings";

const { shell } = require("electron");

/**
 * Appends "Open in ..." menu items for a URL to the given menu items array.
 * Includes: OS default browser, internal browser (default profile),
 * each user-configured browser profile, and incognito.
 */
export function appendLinkOpenMenuItems(
    menuItems: MenuItem[],
    href: string,
    options?: { startGroup?: boolean; disabled?: boolean },
): void {
    const disabled = options?.disabled ?? false;

    menuItems.push(
        {
            label: "Open in Default Browser",
            icon: <OpenFileIcon />,
            onClick: () => { shell.openExternal(href); },
            disabled,
            startGroup: options?.startGroup,
        },
        {
            label: "Open in Internal Browser",
            icon: <GlobeIcon color={DEFAULT_BROWSER_COLOR} />,
            onClick: async () => {
                const { openUrlInBrowserTab } = await import("./page-actions");
                openUrlInBrowserTab(href, { profileName: "" });
            },
            disabled,
        },
        ...appSettings.get("browser-profiles").map((profile) => ({
            label: `Open in ${profile.name}`,
            icon: <GlobeIcon color={profile.color} />,
            onClick: async () => {
                const { openUrlInBrowserTab } = await import("./page-actions");
                openUrlInBrowserTab(href, { profileName: profile.name });
            },
            disabled,
        })),
        {
            label: "Open in Incognito",
            icon: <IncognitoIcon />,
            onClick: async () => {
                const { openUrlInBrowserTab } = await import("./page-actions");
                openUrlInBrowserTab(href, { incognito: true });
            },
            disabled,
        },
    );
}
