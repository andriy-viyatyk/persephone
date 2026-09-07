import { ui } from "../../../api/ui";
import { createElements } from "../elements";
import type { IMenuBar } from "../../../api/types/window";
import type { IAiElementDeclaration, IAiMember, IAiVisionDescriptor } from "../../../../shared/ai-vision/types";

const MENU_BAR_MEMBERS: readonly IAiMember[] = [
    { name: "isOpen", kind: "property", summary: "Whether the Menu Bar is open; the backdrop remains in the DOM while closed and is CSS-hidden, so use this property rather than element presence." },
    { name: "folders", kind: "property", summary: "Live built-in and configured user-folder records with IDs, labels, kinds, and optional paths." },
    { name: "selected", kind: "property", summary: "The currently selected live folder record." },
    { name: "open", kind: "method", signature: "open(folderId?: string)", summary: "Open and select by a current folder ID; unknown IDs, labels, paths, and stale IDs are rejected with the valid folder list.", caution: "changes the visible UI" },
    { name: "close", kind: "method", signature: "close()", summary: "Close the Menu Bar; repeated calls are safe.", caution: "changes the visible UI" },
];

const MENU_BAR_ELEMENTS: readonly IAiElementDeclaration[] = [
    { name: "menu-bar", purpose: "The Menu Bar backdrop; it remains in the DOM while the Menu Bar is closed and is hidden with `display: none`, so `visible` is false then. Use `window.menuBar.isOpen` to learn whether it is open; never infer openness from element presence.", where: "full-window overlay over the page area below the header, when open" },
    { name: "menu-bar-content", purpose: "The sliding Menu Bar panel containing its controls, category list, and selected category content.", where: "left side of the full-window Menu Bar overlay" },
    { name: "menubar-categories", purpose: "The left Menu Bar column containing the action row, folder list, and Add Folder region.", where: "left category column of the full-window Menu Bar overlay" },
    { name: "menubar-toolbar", purpose: "The horizontal Menu Bar action row.", where: "top action row of the left category column" },
    { name: "menubar-open-file", purpose: "Opens the file picker from the Menu Bar.", where: "top action row of the left category column, left end" },
    { name: "menubar-new-window", purpose: "Opens a new Persephone window from the Menu Bar.", where: "top action row of the left category column, after Open File" },
    { name: "menubar-about", purpose: "Opens the About page.", where: "top action row of the left category column, right group, first" },
    { name: "menubar-user-guide", purpose: "Opens the User Guide at its contents.", where: "top action row of the left category column, right group, after About" },
    { name: "menubar-settings", purpose: "Opens the Settings page.", where: "top action row of the left category column, right end, immediately right of User Guide" },
    { name: "menubar-folders", purpose: "Lists the built-in and configured user-folder categories and selects the right-hand content.", where: "left category column, below the action row and above Add Folder" },
    { name: "menubar-content", purpose: "The right-hand pane for the selected Menu Bar category.", where: "right content pane of the Menu Bar, beside the category column" },
    { name: "menubar-add-folder", purpose: "The bottom region of the left category column containing Add Folder.", where: "bottom of the left category column, below the folder list" },
    { name: "menubar-add-folder-button", purpose: "Adds a configured folder category to the Menu Bar.", where: "bottom of the left category column, centered in the Add Folder region" },
    { name: "menubar-splitter", purpose: "Resizes the Menu Bar category list and right-hand content pane.", where: "between the left category column and right content pane" },
];

export function describeMenuBar(instance: unknown): IAiVisionDescriptor {
    const menuBar = instance as IMenuBar;
    const elements = createElements(MENU_BAR_ELEMENTS, ui.highlightElement.bind(ui));
    return {
        kind: "MenuBar",
        summary: "The sidebar behind the Persephone glyph: its category folders, which one is selected, and its controls.",
        members: [...MENU_BAR_MEMBERS, ...elements.members],
        provide: elements.provide,
        elements: MENU_BAR_ELEMENTS,
        help: "Use folders to discover the four built-in IDs open-tabs, recent-files, tools-editors, and script-library plus the current user-folder IDs. Pass a current folder ID to open(folderId); display labels and paths are not accepted, and unknown or stale values are rejected with the valid folder list.",
        summarize: () => ({
            kind: "MenuBar",
            isOpen: menuBar.isOpen,
            folders: menuBar.folders,
            selected: menuBar.selected,
        }),
    };
}
