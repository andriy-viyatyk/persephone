import { pagesModel } from "../../api/pages";
import { app } from "../../api/app";
import { fs } from "../../api/fs";
import { type BrowserProfile } from "../../api/settings";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { createLinkData } from "../../../shared/link-data";
import { guard } from "../../core/utils/guard";
import { bundledBoardRegistry } from "../../editors/board/bundled-board-registry";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { getBoardEditorAssociation } from "../../editors/board/board-manifest";
import { boardDisplayText, boardMetadataKeys } from "../../editors/board/board-display-text";
import {
    GridIcon, IncognitoIcon, TorIcon,
    JavascriptIcon, LinkIcon, NotebookIcon, TypescriptIcon,
} from "../../theme/language-icons";
import { DEFAULT_BROWSER_COLOR, MEMORY_ICON_COLOR } from "../../theme/palette-colors";
import { createFolderIconElement } from "../../components/icons/icon-elements";
import { createIconElement } from "../../uikit/shared/slots";
import type { IconRef } from "../../uikit";
import type { MenuItem } from "../../uikit/Menu/types";
import { englishMessage, t } from "../../../shared/i18n/t";
import type { MessageKey } from "../../../shared/i18n/en";

// =============================================================================
// Types
// =============================================================================

export interface CreatableItem {
    /** Unique stable ID for settings persistence. */
    id: string;
    /** Display label in menus and sidebar. */
    label: string;
    /** Catalog key for app-owned labels; board names remain manifest data. */
    labelKey?: MessageKey;
    labelParams?: Record<string, string | number>;
    /** Icon element for menus and sidebar. */
    icon?: IconRef;
    /** Create the page/tab. */
    create: () => void;
    /** Category for grouping in the sidebar list. */
    category: "editor" | "tool";
    /** Stable identity of a bundled board, present only for bundled-board items. */
    bundledBoardId?: string;
    /** Display-only source root for localized bundled board metadata. */
    boardRoot?: string;
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
// Static items (always available)
// =============================================================================

const staticItems: CreatableItem[] = [
    {
        id: "open-folder",
        labelKey: "shell.openFolder",
        label: englishMessage("shell.openFolder"),
        icon: createFolderIconElement(),
        create: () => {
            void (async () => {
                const picked = await fs.showFolderDialog({ title: t("shell.openFolderInExplorer") });
                const folder = picked?.[0];
                if (!folder) return;
                await pagesModel.addEmptyPageWithNavPanel(folder);
            })();
        },
        category: "tool",
    },
    {
        id: "open-file",
        labelKey: "shell.openFile",
        label: englishMessage("shell.openFile"),
        icon: createIconElement("open-file"),
        create: () => { void pagesModel.openFileFromDialog(); },
        category: "tool",
    },
    {
        id: "open-url",
        labelKey: "shell.openUrl",
        label: englishMessage("shell.openUrl"),
        icon: createIconElement("open-file"),
        create: () => { void pagesModel.openFileWithDialog(); },
        category: "tool",
    },
    {
        id: "clipboard",
        labelKey: "shell.clipboard",
        label: englishMessage("shell.clipboard"),
        icon: createIconElement("paste"),
        create: () => { void pagesModel.showClipboardPage(); },
        category: "tool",
    },
    {
        id: "script-js",
        labelKey: "shell.textScriptJs",
        label: englishMessage("shell.textScriptJs"),
        icon: JavascriptIcon.createElement(),
        create: () => pagesModel.addEditorPage("monaco", "javascript", "untitled.js"),
        category: "editor",
    },
    {
        id: "script-ts",
        labelKey: "shell.textScriptTs",
        label: englishMessage("shell.textScriptTs"),
        icon: TypescriptIcon.createElement(),
        create: () => pagesModel.addEditorPage("monaco", "typescript", "untitled.ts"),
        category: "editor",
    },
    {
        id: "grid-json",
        labelKey: "editors.gridJson",
        label: englishMessage("editors.gridJson"),
        icon: GridIcon.createElement(),
        create: () => pagesModel.addEditorPage("grid-json", "json", "untitled.grid.json"),
        category: "editor",
    },
    {
        id: "grid-csv",
        labelKey: "editors.gridCsv",
        label: englishMessage("editors.gridCsv"),
        icon: GridIcon.createElement(),
        create: () => pagesModel.addEditorPage("grid-csv", "csv", "untitled.grid.csv"),
        category: "editor",
    },
    {
        id: "notebook-view",
        labelKey: "editors.notebook",
        label: englishMessage("editors.notebook"),
        icon: NotebookIcon.createElement(),
        create: () => pagesModel.addEditorPage("notebook-view", "json", "untitled.note.json"),
        category: "editor",
    },
    {
        id: "link-view",
        labelKey: "editors.links",
        label: englishMessage("editors.links"),
        icon: LinkIcon.createElement(),
        create: () => pagesModel.addEditorPage("link-view", "json", "untitled.link.json"),
        category: "editor",
    },
    {
        id: "browser",
        labelKey: "editors.browser",
        label: englishMessage("editors.browser"),
        icon: createIconElement("globe", { color: DEFAULT_BROWSER_COLOR }),
        create: () => { pagesModel.showBrowserPage(); },
        category: "tool",
    },
    {
        id: "browser-incognito",
        labelKey: "shell.browserIncognito",
        label: englishMessage("shell.browserIncognito"),
        icon: IncognitoIcon.createElement(),
        create: () => { pagesModel.showBrowserPage({ incognito: true }); },
        category: "tool",
    },
    {
        id: "browser-tor",
        labelKey: "shell.browserTor",
        label: englishMessage("shell.browserTor"),
        icon: TorIcon.createElement(),
        create: () => { pagesModel.showBrowserPage({ tor: true }); },
        category: "tool",
    },
    {
        id: "mcp-inspector",
        labelKey: "editors.mcpInspector",
        label: englishMessage("editors.mcpInspector"),
        icon: createIconElement("mcp"),
        create: () => { pagesModel.showMcpInspectorPage(); },
        category: "tool",
    },
    {
        id: "mneme-config",
        labelKey: "editors.mneme",
        label: englishMessage("editors.mneme"),
        icon: createIconElement("memory", { color: MEMORY_ICON_COLOR }),
        create: () => { pagesModel.showMnemeConfigPage(); },
        category: "tool",
    },
    {
        id: "storybook",
        labelKey: "editors.storybook",
        label: englishMessage("editors.storybook"),
        icon: createIconElement("storybook"),
        create: () => { pagesModel.showStorybookPage(); },
        category: "tool",
    },
    {
        id: "video-view",
        labelKey: "editors.videoPlayer",
        label: englishMessage("editors.videoPlayer"),
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
        labelKey: "shell.browserProfile",
        labelParams: { profile: profile.name },
        label: englishMessage("shell.browserProfile", { profile: profile.name }),
        icon: createIconElement("globe", { color: profile.color }),
        create: () => { pagesModel.showBrowserPage({ profileName: profile.name }); },
        category: "tool" as const,
    }));

    const bundledItems: CreatableItem[] = bundledBoardRegistry.enabledEntries()
        .map((board) => {
            const label = board.manifest.name?.trim() || board.id;
            const association = getBoardEditorAssociation(board.manifest);
            return {
                id: `bundled-board:${board.id}`,
                label,
                boardRoot: board.root,
                icon: createBoardGlyphElement(board.root),
                create: () => {
                    void guard(`Failed to create ${label}`, async () => {
                        if (association?.editorKind === "content-host") {
                            await pagesModel.addBundledBoardPage(board.root);
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
    bundledBoardRegistry.setDisabled(id, true);
}

/** Resolve an app-owned creatable label at the point where UI text is rendered. */
export function getCreatableItemLabel(item: CreatableItem): string {
    if (item.boardRoot) {
        return boardDisplayText(item.boardRoot, undefined, boardMetadataKeys.name, item.label);
    }
    return item.labelKey ? t(item.labelKey, item.labelParams as never) : item.label;
}

export function enableBundledBoard(id: string): void {
    bundledBoardRegistry.setDisabled(id, false);
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
    const disabled = bundledBoardRegistry.list().filter((board) => bundledBoardRegistry.isDisabled(board.id));
    return disabled
        .map((board) => ({
            id: `bundled-board:${board.id}`,
            label: board.manifest.name?.trim() || board.id,
            boardRoot: board.root,
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
            label: t("shell.enable"),
            icon: createIconElement("check", { width: 14, height: 14 }),
            onClick: item.enable,
        }];
    }
    if (!item.disable) return undefined;
    return [{
        label: t("shell.disable"),
        icon: createIconElement("remove", { width: 14, height: 14 }),
        onClick: item.disable,
    }];
}
