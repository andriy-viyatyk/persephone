import type { IAiElementDeclaration } from "ai-vision";

export const HEADER_ELEMENTS: readonly IAiElementDeclaration[] = [
    { name: "app-header", purpose: "The always-present top shell strip containing tabs, status indicators, and window controls.", where: "top application strip" },
    { name: "persephone-menu", purpose: "Opens the Menu Bar, where app features not on a tab live.", where: "leftmost control in the header strip, opening the Menu Bar" },
    { name: "page-tabs", purpose: "The strip of open-page tabs; tabs can be reordered, moved, and opened into their tab menu.", where: "header tab strip, immediately right of the Persephone menu" },
    { name: "page-tabs-wrapper", purpose: "The tab strip's scroll area.", where: "inside the header tab strip, around the open-page tabs" },
    { name: "page-tabs-scroll-left", purpose: "Scrolls the tab strip left; only present when the tabs overflow.", where: "left edge of the tab strip, when the tabs overflow" },
    { name: "page-tabs-scroll-right", purpose: "Scrolls the tab strip right; only present when the tabs overflow.", where: "right edge of the tab strip, when the tabs overflow" },
    { name: "page-tabs-add", purpose: "Adds an empty page; its split arrow opens the editor/profile menu.", where: "immediately right of the last visible page tab, with its split menu" },
    { name: "autoload-reload", purpose: "Reloads autoload scripts; only present when their files changed on disk and need re-running.", where: "header control, when autoload files need a reload" },
    { name: "zoom-indicator", purpose: "Shows the current zoom and resets it when clicked; only present when the window is zoomed.", where: "header control, when the window is zoomed" },
    { name: "window-minimize", purpose: "Minimizes the application window.", where: "top-right of the header strip, first window control" },
    { name: "window-toggle", purpose: "Maximizes or restores the application window.", where: "top-right of the header strip, between minimize and close" },
    { name: "window-close", purpose: "Closes the application window.", where: "top-right of the header strip, far-right window control" },
    { name: "status-indicators", purpose: "Contains the shell's optional Snip, Mneme, and MCP indicators.", where: "bottom-right of the header strip" },
    { name: "header-snip-button", purpose: "Opens the Snip Screen / Snip Persephone capture menu.", where: "bottom-right status cluster, first from the left" },
    { name: "mneme-indicator", purpose: "Shows Mneme status and opens its configuration page; only present when Mneme is enabled.", where: "bottom-right status cluster, after Snip, when Mneme is enabled" },
    { name: "mcp-indicator", purpose: "Shows MCP connection status and opens the request log; only present while the MCP server is running.", where: "bottom-right status cluster, after Mneme, when MCP is running" },
];
