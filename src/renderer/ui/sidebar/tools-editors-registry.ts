import { pagesModel } from "../../api/pages";
import { app } from "../../api/app";
import { fs } from "../../api/fs";
import { settings, type BrowserProfile } from "../../api/settings";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { createLinkData } from "../../../shared/link-data";
import { guard } from "../../core/utils/guard";
import { bundledBoardRegistry } from "../../editors/board/bundled-board-registry";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { getBoardEditorAssociation } from "../../editors/board/board-manifest";
import {
    DrawIcon, GridIcon, IncognitoIcon, RestClientIcon, TorIcon,
    JavascriptIcon, LinkIcon, NotebookIcon, TypescriptIcon,
} from "../../theme/language-icons";
import { DEFAULT_BROWSER_COLOR, MEMORY_ICON_COLOR } from "../../theme/palette-colors";
import { createFolderIconElement } from "../../components/icons/icon-elements";
import { createIconElement } from "../../uikit/shared/slots";
import type { IconRef } from "../../uikit";
import type { MenuItem } from "../../uikit/Menu/types";

// =============================================================================
// Types
// =============================================================================

export interface CreatableItem {
    /** Unique stable ID for settings persistence. */
    id: string;
    /** Display label in menus and sidebar. */
    label: string;
    /** Icon element for menus and sidebar. */
    icon?: IconRef;
    /** Create the page/tab. */
    create: () => void;
    /** Category for grouping in the sidebar list. */
    category: "editor" | "tool";
    /** Stable identity of a bundled board, present only for bundled-board items. */
    bundledBoardId?: string;
    /** Disable this bundled board without removing its retained pins. */
    disable?: () => void;
    /** Re-enable this bundled board. Present only on the rows `getDisabledBundledBoardItems()`
     *  returns — a disabled board keeps a row so Disable is not a one-way door. */
    enable?: () => void;
    /** True for a row that stands in for a disabled bundled board: it is shown so the user can
     *  re-enable it, and creating from it is deliberately a no-op. */
    disabled?: boolean;
}


// =============================================================================
// Default pinned IDs
// =============================================================================

export const DEFAULT_PINNED_EDITORS = [
    "open-folder", "open-file", "script-js", "draw-view", "grid-csv", "browser",
];

// =============================================================================
// Static items (always available)
// =============================================================================

const staticItems: CreatableItem[] = [
    {
        id: "open-folder",
        label: "Open Folder",
        icon: createFolderIconElement(),
        create: () => {
            void (async () => {
                const picked = await fs.showFolderDialog({ title: "Open Folder in Explorer" });
                const folder = picked?.[0];
                if (!folder) return;
                await pagesModel.addEmptyPageWithNavPanel(folder);
            })();
        },
        category: "tool",
    },
    {
        id: "open-file",
        label: "Open File",
        icon: createIconElement("open-file"),
        create: () => { void pagesModel.openFileFromDialog(); },
        category: "tool",
    },
    {
        id: "open-url",
        label: "Open URL",
        icon: createIconElement("open-file"),
        create: () => { void pagesModel.openFileWithDialog(); },
        category: "tool",
    },
    {
        id: "clipboard",
        label: "Clipboard",
        icon: createIconElement("paste"),
        create: () => { void pagesModel.showClipboardPage(); },
        category: "tool",
    },
    {
        id: "script-js",
        label: "Script (JS)",
        icon: JavascriptIcon.createElement(),
        create: () => pagesModel.addEditorPage("monaco", "javascript", "untitled.js"),
        category: "editor",
    },
    {
        id: "script-ts",
        label: "Script (TS)",
        icon: TypescriptIcon.createElement(),
        create: () => pagesModel.addEditorPage("monaco", "typescript", "untitled.ts"),
        category: "editor",
    },
    {
        id: "draw-view",
        label: "Drawing",
        icon: DrawIcon.createElement(),
        create: () => pagesModel.addEditorPage("draw-view", "json", "untitled.excalidraw"),
        category: "editor",
    },
    {
        id: "grid-json",
        label: "Grid (JSON)",
        icon: GridIcon.createElement(),
        create: () => pagesModel.addEditorPage("grid-json", "json", "untitled.grid.json"),
        category: "editor",
    },
    {
        id: "grid-csv",
        label: "Grid (CSV)",
        icon: GridIcon.createElement(),
        create: () => pagesModel.addEditorPage("grid-csv", "csv", "untitled.grid.csv"),
        category: "editor",
    },
    {
        id: "notebook-view",
        label: "Notebook",
        icon: NotebookIcon.createElement(),
        create: () => pagesModel.addEditorPage("notebook-view", "json", "untitled.note.json"),
        category: "editor",
    },
    {
        id: "link-view",
        label: "Links",
        icon: LinkIcon.createElement(),
        create: () => pagesModel.addEditorPage("link-view", "json", "untitled.link.json"),
        category: "editor",
    },
    {
        id: "rest-client",
        label: "Rest Client",
        icon: RestClientIcon.createElement(),
        create: () => pagesModel.addEditorPage("rest-client", "json", "untitled.rest.json"),
        category: "tool",
    },
    {
        id: "browser",
        label: "Browser",
        icon: createIconElement("globe", { color: DEFAULT_BROWSER_COLOR }),
        create: () => { pagesModel.showBrowserPage(); },
        category: "tool",
    },
    {
        id: "browser-incognito",
        label: "Browser (Incognito)",
        icon: IncognitoIcon.createElement(),
        create: () => { pagesModel.showBrowserPage({ incognito: true }); },
        category: "tool",
    },
    {
        id: "browser-tor",
        label: "Browser (Tor)",
        icon: TorIcon.createElement(),
        create: () => { pagesModel.showBrowserPage({ tor: true }); },
        category: "tool",
    },
    {
        id: "mcp-inspector",
        label: "MCP Inspector",
        icon: createIconElement("mcp"),
        create: () => { pagesModel.showMcpInspectorPage(); },
        category: "tool",
    },
    {
        id: "mneme-config",
        label: "Mneme",
        icon: createIconElement("memory", { color: MEMORY_ICON_COLOR }),
        create: () => { pagesModel.showMnemeConfigPage(); },
        category: "tool",
    },
    {
        id: "storybook",
        label: "Storybook",
        icon: createIconElement("storybook"),
        create: () => { pagesModel.showStorybookPage(); },
        category: "tool",
    },
    {
        id: "video-view",
        label: "Video Player",
        icon: createIconElement("player", { color: DEFAULT_BROWSER_COLOR }),
        create: () => pagesModel.showVideoPlayerPage(),
        category: "tool" as const,
    },
];

// =============================================================================
// Build full list (static + dynamic browser profiles)
// =============================================================================

export function getCreatableItems(
    browserProfiles: BrowserProfile[],
): CreatableItem[] {
    const profileItems: CreatableItem[] = browserProfiles.map((profile) => ({
        id: `browser-profile-${profile.name}`,
        label: `Browser (${profile.name})`,
        icon: createIconElement("globe", { color: profile.color }),
        create: () => { pagesModel.showBrowserPage({ profileName: profile.name }); },
        category: "tool" as const,
    }));

    const disabledBundledBoards = new Set(settings.get("disabled-bundled-boards"));
    const bundledItems: CreatableItem[] = bundledBoardRegistry.list()
        .filter((board) => !disabledBundledBoards.has(board.id))
        .map((board) => {
            const label = board.manifest.name?.trim() || board.id;
            const association = getBoardEditorAssociation(board.manifest);
            return {
                id: `bundled-board:${board.id}`,
                label,
                icon: createBoardGlyphElement(board.root),
                create: () => {
                    void guard(`Failed to create ${label}`, async () => {
                        if (association?.editorKind === "content-host") {
                            await pagesModel.addBundledBoardPage(
                                board.root,
                                "json",
                                "untitled.excalidraw",
                            );
                            return;
                        }
                        await app.events.openRawLink.sendAsync(
                            createLinkData(encodePersephoneBoardLink(board.root)),
                        );
                    });
                },
                category: "editor",
                bundledBoardId: board.id,
                disable: () => disableBundledBoard(board.id),
            } satisfies CreatableItem;
        });

    return [...staticItems, ...bundledItems, ...profileItems];
}

export function disableBundledBoard(id: string): void {
    const disabled = settings.get("disabled-bundled-boards");
    if (disabled.includes(id)) return;
    settings.set("disabled-bundled-boards", [...disabled, id]);
}

export function enableBundledBoard(id: string): void {
    const disabled = settings.get("disabled-bundled-boards");
    if (!disabled.includes(id)) return;
    settings.set("disabled-bundled-boards", disabled.filter((entry) => entry !== id));
}

/**
 * Rows standing in for bundled boards the user has disabled.
 *
 * `getCreatableItems()` excludes them by contract (EPIC-109 D4 — the flag gates the creatable
 * item), which on its own left Disable as a one-way door: the row vanished, and with it the only
 * place the action lived, so the board could be brought back solely by hand-editing the settings
 * file. These rows restore the way back without weakening D4 — they are not creatable, they only
 * carry Enable.
 */
export function getDisabledBundledBoardItems(): CreatableItem[] {
    const disabled = new Set(settings.get("disabled-bundled-boards"));
    if (disabled.size === 0) return [];
    return bundledBoardRegistry.list()
        .filter((board) => disabled.has(board.id))
        .map((board) => ({
            id: `bundled-board:${board.id}`,
            label: board.manifest.name?.trim() || board.id,
            icon: createBoardGlyphElement(board.root),
            create: () => {},
            category: "editor" as const,
            bundledBoardId: board.id,
            enable: () => enableBundledBoard(board.id),
            disabled: true,
        }));
}

export function getBundledBoardContextMenu(item: CreatableItem): MenuItem[] | undefined {
    if (!item.bundledBoardId) return undefined;
    if (item.enable) {
        return [{
            label: "Enable",
            icon: createIconElement("check", { width: 14, height: 14 }),
            onClick: item.enable,
        }];
    }
    if (!item.disable) return undefined;
    return [{
        label: "Disable",
        icon: createIconElement("remove", { width: 14, height: 14 }),
        onClick: item.disable,
    }];
}
