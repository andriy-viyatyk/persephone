import { EditorId } from "../../shared/editor-ids";
import { pages } from "./pages";
import { app } from "./app";
import { fs } from "./fs";
import type { BrowserProfile } from "./settings-schema";
import { encodePersephoneBoardLink } from "../content/persephone-board-link";
import { createLinkData } from "../../shared/link-data";
import { guard } from "../core/utils/guard";
import { boardRegistry } from "./boards/board-registry";
import { boardDisplayText, boardMetadataKeys } from "./boards/board-display-text";
import {
    GridIcon, IncognitoIcon, TorIcon,
    JavascriptIcon, LinkIcon, TypescriptIcon,
} from "../theme/language-icons";
import { DEFAULT_BROWSER_COLOR, MEMORY_ICON_COLOR } from "../theme/palette-colors";
import { createFolderIconElement } from "../components/icons/icon-elements";
import { createIconElement } from "../uikit/shared/slots";
import { englishMessage, t } from "../../shared/i18n/t";
import type { MessageKey } from "../../shared/i18n/en";

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
    /** A fresh icon node per call; DOM nodes are single-use. */
    createIcon?: () => Node;
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
        createIcon: () => createFolderIconElement(),
        create: () => {
            void (async () => {
                const picked = await fs.showFolderDialog({ title: t("shell.openFolderInExplorer") });
                const folder = picked?.[0];
                if (!folder) return;
                await pages.lifecycle.addEmptyPageWithNavPanel(folder);
            })();
        },
        category: "tool",
    },
    {
        id: "open-file",
        labelKey: "shell.openFile",
        label: englishMessage("shell.openFile"),
        createIcon: () => createIconElement("open-file"),
        create: () => { void pages.openFileFromDialog(); },
        category: "tool",
    },
    {
        id: "open-url",
        labelKey: "shell.openUrl",
        label: englishMessage("shell.openUrl"),
        createIcon: () => createIconElement("open-file"),
        create: () => { void pages.openFileWithDialog(); },
        category: "tool",
    },
    {
        id: "clipboard",
        labelKey: "shell.clipboard",
        label: englishMessage("shell.clipboard"),
        createIcon: () => createIconElement("paste"),
        create: () => { void pages.standalonePages.show("clipboard-page").then((): undefined => undefined); },
        category: "tool",
    },
    {
        id: "script-js",
        labelKey: "shell.textScriptJs",
        label: englishMessage("shell.textScriptJs"),
        createIcon: () => JavascriptIcon.createElement(),
        create: () => pages.lifecycle.addEditorPage(EditorId.monaco, "javascript", "untitled.js"),
        category: "editor",
    },
    {
        id: "script-ts",
        labelKey: "shell.textScriptTs",
        label: englishMessage("shell.textScriptTs"),
        createIcon: () => TypescriptIcon.createElement(),
        create: () => pages.lifecycle.addEditorPage(EditorId.monaco, "typescript", "untitled.ts"),
        category: "editor",
    },
    {
        id: EditorId.gridJson,
        labelKey: "editors.gridJson",
        label: englishMessage("editors.gridJson"),
        createIcon: () => GridIcon.createElement(),
        create: () => pages.lifecycle.addEditorPage(EditorId.gridJson, "json", "untitled.grid.json"),
        category: "editor",
    },
    {
        id: EditorId.gridCsv,
        labelKey: "editors.gridCsv",
        label: englishMessage("editors.gridCsv"),
        createIcon: () => GridIcon.createElement(),
        create: () => pages.lifecycle.addEditorPage(EditorId.gridCsv, "csv", "untitled.grid.csv"),
        category: "editor",
    },
    {
        id: EditorId.linkView,
        labelKey: "editors.links",
        label: englishMessage("editors.links"),
        createIcon: () => LinkIcon.createElement(),
        create: () => pages.lifecycle.addEditorPage(EditorId.linkView, "json", "untitled.link.json"),
        category: "editor",
    },
    {
        id: "browser",
        labelKey: "editors.browser",
        label: englishMessage("editors.browser"),
        createIcon: () => createIconElement("globe", { color: DEFAULT_BROWSER_COLOR }),
        create: () => { pages.showBrowserPage(); },
        category: "tool",
    },
    {
        id: "browser-incognito",
        labelKey: "shell.browserIncognito",
        label: englishMessage("shell.browserIncognito"),
        createIcon: () => IncognitoIcon.createElement(),
        create: () => { pages.showBrowserPage({ incognito: true }); },
        category: "tool",
    },
    {
        id: "browser-tor",
        labelKey: "shell.browserTor",
        label: englishMessage("shell.browserTor"),
        createIcon: () => TorIcon.createElement(),
        create: () => { pages.showBrowserPage({ tor: true }); },
        category: "tool",
    },
    {
        id: "mcp-inspector",
        labelKey: "editors.mcpInspector",
        label: englishMessage("editors.mcpInspector"),
        createIcon: () => createIconElement("mcp"),
        create: () => { pages.showMcpInspectorPage(); },
        category: "tool",
    },
    {
        id: EditorId.mnemeConfig,
        labelKey: "editors.mneme",
        label: englishMessage("editors.mneme"),
        createIcon: () => createIconElement("memory", { color: MEMORY_ICON_COLOR }),
        create: () => { pages.standalonePages.show("mneme-config-page").then((): undefined => undefined); },
        category: "tool",
    },
    {
        id: "storybook",
        labelKey: "editors.storybook",
        label: englishMessage("editors.storybook"),
        createIcon: () => createIconElement("storybook"),
        create: () => { pages.standalonePages.show("storybook-page").then((): undefined => undefined); },
        category: "tool",
    },
    {
        id: EditorId.videoView,
        labelKey: "editors.videoPlayer",
        label: englishMessage("editors.videoPlayer"),
        createIcon: () => createIconElement("player", { color: DEFAULT_BROWSER_COLOR }),
        create: () => pages.standalonePages.show("video-player").then((): undefined => undefined),
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
        createIcon: () => createIconElement("globe", { color: profile.color }),
        create: () => { pages.showBrowserPage({ profileName: profile.name }); },
        category: "tool" as const,
    }));

    const bundledItems: CreatableItem[] = boardRegistry.bundled().filter((board) => board.enabled)
        .map((board) => {
            const label = board.manifest.name?.trim() || board.id;
            const association = board.manifest.association;
            return {
                id: `bundled-board:${board.id}`,
                label,
                boardRoot: board.root,
                create: () => {
                    void guard(`Failed to create ${label}`, async () => {
                        if (association?.editorKind === "content-host") {
                            await pages.boardPageRouter.addBundledBoardPage(board.root);
                            return;
                        }
                        await app.events.openRawLink.sendAsync(
                            createLinkData(encodePersephoneBoardLink(board.root)),
                        );
                    });
                },
                category: "editor",
                bundledBoardId: board.id,
                disable: () => boardRegistry.setBundledDisabled(board.id, true),
            } satisfies CreatableItem;
        });

    return [...staticItems, ...bundledItems, ...profileItems];
}

/** Resolve an app-owned creatable label at the point where UI text is rendered. */
export function getCreatableItemLabel(item: CreatableItem): string {
    if (item.boardRoot) {
        return boardDisplayText(item.boardRoot, undefined, boardMetadataKeys.name, item.label);
    }
    return item.labelKey ? t(item.labelKey, item.labelParams as never) : item.label;
}

/**
 * Rows standing in for bundled boards the user has disabled.
 *
 * `getCreatableItems` excludes them by contract because the flag gates the creatable
 * item), which on its own left Disable as a one-way door: the row vanished, and with it the only
 * place the action lived, so the board could be brought back solely by hand-editing the settings
 * file. These rows restore the way back without weakening — they are not creatable, they only
 * carry Enable.
 */
export function getDisabledBundledBoardItems(): CreatableItem[] {
    const disabled = boardRegistry.bundled().filter((board) => !board.enabled);
    return disabled
        .map((board) => ({
            id: `bundled-board:${board.id}`,
            label: board.manifest.name?.trim() || board.id,
            boardRoot: board.root,
            create: () => {},
            category: "editor" as const,
            bundledBoardId: board.id,
            enable: () => boardRegistry.setBundledDisabled(board.id, false),
            disabled: true,
        }));
}

