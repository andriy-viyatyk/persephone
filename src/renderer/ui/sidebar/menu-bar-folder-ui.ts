import { t } from "../../../shared/i18n/t";
import { createLinkData } from "../../../shared/link-data";
import { getPlatformFeature } from "../../../shared/platform-features";
import { app } from "../../api/app";
import { api } from "../../../ipc/renderer/api";
import { libraryService } from "../../api/library-service";
import { menuFolders, type MenuFolder } from "../../api/menu-folders";
import {
    isBuiltinFolder,
    openTabsId,
    recentFilesId,
    scriptLibraryId,
    toolsEditorsId,
    type BuiltinFolderId,
} from "../../api/menu-bar";
import { settings } from "../../api/settings";
import { FileTreeProvider } from "../../content/tree-providers/FileTreeProvider";
import { TreeProviderView } from "../../components/tree-provider/TreeProviderView";
import type {
    TreeProviderViewProps,
    TreeProviderViewSavedState,
} from "../../components/tree-provider/TreeProviderViewModel";
import { createFolderIconElement } from "../../components/icons/icon-elements";
import { createIconElement, type IconRef } from "../../uikit/shared/slots";
import type { MenuItem } from "../../uikit/Menu";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { OpenTabsListView } from "./OpenTabsListView";
import { RecentFileListView } from "./RecentFileListView";
import { ScriptLibraryPanelView } from "./ScriptLibraryPanelView";
import { ToolsEditorsPanelView } from "./ToolsEditorsPanelView";

export interface MenuBarFolderUiContext {
    onClose?: () => void;
    open?: boolean;
    expandStateMap: Map<string, TreeProviderViewSavedState>;
    getProvider: (folderId: string, folderPath: string) => FileTreeProvider;
    openFolderInTab: (folder: MenuFolder) => void;
    openFolderPathInTab: (folderPath: string | undefined) => void;
    clearRecentFiles: () => Promise<void>;
}

export interface MenuBarRightViewHandle {
    buildTree?: () => void;
    showSearch?: () => void;
    reloadRecent?: () => Promise<void>;
}

interface FolderUiRow {
    label: string;
    icon: IconRef;
    tooltip: string;
}

interface FolderUiEntry {
    row: (folder: MenuFolder) => FolderUiRow;
    menu: (context: MenuBarFolderUiContext, folder: MenuFolder) => MenuItem[];
    props: (context: MenuBarFolderUiContext, key: string) => object;
    create: (props: object, context: MenuBarFolderUiContext, key: string) => VanillaView<unknown> | undefined;
    capture: (view: VanillaView<unknown>) => MenuBarRightViewHandle;
}

const genericMenu = (context: MenuBarFolderUiContext, folder: MenuFolder): MenuItem[] => {
    const items: MenuItem[] = [
        {
            label: t("shell.openInNewTab"),
            icon: createIconElement("open-file"),
            onClick: () => context.openFolderInTab(folder),
        },
        {
            label: t("shell.removeFolder"),
            icon: createIconElement("remove"),
            onClick: () => {
                const folderId = folder.id;
                if (folderId) menuFolders.remove(folderId);
            },
        },
        {
            label: t("shell.showInFileExplorer"),
            icon: createIconElement("folder-open"),
            onClick: () => { if (folder.path) api.showFolder(folder.path); },
        },
    ];
    if (getPlatformFeature("terminal.launch").available) {
        items.push({
            id: "open-terminal-here",
            label: t("shell.openTerminalHere"),
            icon: createIconElement("terminal"),
            onClick: async () => {
                const folderPath = folder.path;
                if (!folderPath) return;
                const { openTerminalAt } = await import("../../api/terminal");
                openTerminalAt(folderPath);
            },
        });
    }
    return items;
};

const genericProps = (context: MenuBarFolderUiContext, key: string): TreeProviderViewProps => {
    const folder = menuFolders.find(key);
    if (!folder?.path) return {} as TreeProviderViewProps;
    return {
        provider: context.getProvider(key, folder.path),
        initialState: context.expandStateMap.get(key),
        onStateChange: (state) => context.expandStateMap.set(key, state),
        onItemClick: (item) => {
            if (!item.isDirectory) {
                void app.events.openRawLink.sendAsync(createLinkData(item.href));
                context.onClose?.();
            }
        },
        onFolderDoubleClick: (item) => context.openFolderPathInTab(item.href),
    };
};

const genericEntry: FolderUiEntry = {
    row: (folder) => {
        const label = folder.name;
        return {
            label,
            icon: folder.path ? createFolderIconElement() : createIconElement("empty"),
            tooltip: folder.path || label,
        };
    },
    menu: genericMenu,
    props: genericProps,
    create: (props, _context, key) => {
        const folder = menuFolders.find(key);
        if (!folder?.path) return undefined;
        return new TreeProviderView(props as TreeProviderViewProps) as VanillaView<unknown>;
    },
    capture: (view) => {
        const model = (view as TreeProviderView).model;
        return {
            buildTree: () => { void model.buildTree(); },
            showSearch: () => model.showSearch(),
        };
    },
};

const builtinRow = (labelKey: Parameters<typeof t>[0], icon: IconRef | (() => IconRef)): ((_folder: MenuFolder) => FolderUiRow) => (_folder) => {
    // Built-in folders keep their English `name` for scripts; the menu shows the catalog text.
    const label = t(labelKey);
    return { label, icon: typeof icon === "function" ? icon() : icon, tooltip: label };
};

const openTabsProps = (context: MenuBarFolderUiContext) => ({ onClose: context.onClose, open: context.open });
const recentProps = (context: MenuBarFolderUiContext) => ({ onClose: context.onClose });
const toolsProps = (context: MenuBarFolderUiContext) => ({ onClose: context.onClose });
const libraryProps = (context: MenuBarFolderUiContext) => ({
    onClose: context.onClose,
    expandState: context.expandStateMap.get(scriptLibraryId),
    onExpandStateChange: (state: TreeProviderViewSavedState) => context.expandStateMap.set(scriptLibraryId, state),
});

export const BUILTIN_FOLDER_UI: Record<BuiltinFolderId, FolderUiEntry> = {
    [openTabsId]: {
        row: builtinRow("shell.openTabs", "tabs"),
        menu: () => [],
        props: (context) => openTabsProps(context),
        create: (props) => new OpenTabsListView(props as ReturnType<typeof openTabsProps>) as VanillaView<unknown>,
        capture: () => ({}),
    },
    [recentFilesId]: {
        row: builtinRow("shell.recentFiles", "history"),
        menu: (context) => [{
            label: t("shell.clearRecentFiles"),
            icon: createIconElement("clear-list"),
            onClick: () => { void context.clearRecentFiles(); },
        }],
        props: (context) => recentProps(context),
        create: (props) => new RecentFileListView(props as ReturnType<typeof recentProps>) as VanillaView<unknown>,
        capture: (view) => {
            const recentView = view as RecentFileListView;
            return {
                showSearch: () => recentView.showSearch(),
                reloadRecent: () => recentView.reload(),
            };
        },
    },
    [toolsEditorsId]: {
        row: builtinRow("editors.toolsAndEditors", "tools"),
        menu: genericMenu,
        props: (context) => toolsProps(context),
        create: (props) => new ToolsEditorsPanelView(props as ReturnType<typeof toolsProps>) as VanillaView<unknown>,
        capture: () => ({}),
    },
    [scriptLibraryId]: {
        row: builtinRow("shell.scriptLibrary", () => createIconElement("script-library")),
        menu: () => {
            const libraryPath = settings.get("script-library.path");
            const items: MenuItem[] = [{
                label: t("shell.changeLibraryFolder"),
                icon: createIconElement("folder-open"),
                onClick: () => { void libraryService.choose(); },
            }];
            if (libraryPath) {
                items.push(
                    {
                        label: t("shell.openInExplorer"),
                        icon: createIconElement("folder-open"),
                        onClick: () => { api.showFolder(libraryPath); },
                    },
                    {
                        label: t("shell.unlinkLibrary"),
                        icon: createIconElement("remove"),
                        onClick: () => libraryService.unlink(),
                    },
                );
            }
            return items;
        },
        props: (context) => libraryProps(context),
        create: (props) => new ScriptLibraryPanelView(props as ReturnType<typeof libraryProps>) as VanillaView<unknown>,
        capture: (view) => {
            const model = (view as ScriptLibraryPanelView).model;
            return model ? {
                buildTree: () => { void model.buildTree(); },
                showSearch: () => model.showSearch(),
            } : {};
        },
    },
};

export function getFolderUiEntry(folder: MenuFolder): FolderUiEntry {
    if (isBuiltinFolder(folder) && isBuiltinFolderId(folder.id)) return BUILTIN_FOLDER_UI[folder.id];
    return genericEntry;
}

export function createFolderRightView(
    entry: FolderUiEntry,
    context: MenuBarFolderUiContext,
    key: string,
): VanillaView<unknown> | undefined {
    return entry.create(entry.props(context, key), context, key);
}

function isBuiltinFolderId(id: string | undefined): id is BuiltinFolderId {
    return id === openTabsId || id === recentFilesId || id === toolsEditorsId || id === scriptLibraryId;
}
