import { debounce } from "../../../shared/utils";
import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { MenuItem } from "../../components/overlay/PopupMenu";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";

import { splitWithSeparators } from "../../core/utils/utils";
import { getHostname } from "../../components/tree-provider/favicon-cache";
import { LinkItem, LinkEditorData, LinkViewMode } from "./linkTypes";
import { showEditLinkDialog } from "./EditLinkDialog";
import { ui } from "../../api/ui";
import type { ILink } from "../../api/types/io.tree";
import { createLinkData } from "../../../shared/link-data";
import type { ILinkData } from "../../../shared/link-data";
import type { TextFileModel } from "../text/TextEditorModel";
import { LinkTreeProvider } from "./LinkTreeProvider";

// =============================================================================
// State
// =============================================================================

export type ExpandedPanel = "tags" | "categories" | "hostnames";

export const defaultLinkEditorState = {
    data: { links: [], state: {} } as LinkEditorData,
    error: undefined as string | undefined,
    leftPanelWidth: 200,
    expandedPanel: "categories" as ExpandedPanel,
    // Category tree
    categories: [] as string[],
    categoriesSize: {} as { [key: string]: number },
    // Tags list
    tags: [] as string[],
    tagsSize: {} as { [key: string]: number },
    // Hostnames list
    hostnames: [] as string[],
    hostnamesSize: {} as { [key: string]: number },
    // Filtering
    selectedCategory: "" as string,
    selectedTag: "" as string,
    selectedHostname: "" as string,
    searchText: "" as string,
    filteredLinks: [] as LinkItem[],
    // Selection
    selectedLinkId: "" as string,
};

export type LinkEditorState = typeof defaultLinkEditorState;

// =============================================================================
// View Model
// =============================================================================

export class LinkViewModel extends ContentViewModel<LinkEditorState> {
    private lastSerializedData: LinkEditorData | null = null;
    /** Flag to skip reloading content that we just serialized ourselves */
    private skipNextContentUpdate = false;
    private selectionRestored = false;
    /** Previous filter state for incremental search optimization */
    private lastFilterState = { searchText: "", selectedCategory: "", selectedTag: "", selectedHostname: "", expandedPanel: "" };
    private static cacheName = "link-editor";

    private _treeProvider: LinkTreeProvider | null = null;

    gridModel: RenderGridModel | null = null;
    containerElement: HTMLElement | null = null;

    /**
     * Optional callback to modify link data before it enters the openRawLink pipeline.
     * Used by BrowserEditorModel to set target/browserPageId so links open in the owning browser page.
     * The callback modifies data in-place.
     */
    onLinkOpen?: (data: ILinkData) => void;

    /**
     * Optional callback to provide extra context menu items for a link.
     * Returned items are prepended to the context menu (before Edit).
     * Used by browser editor to add "Open in New Tab" action.
     */
    onGetLinkMenuItems?: (link: LinkItem) => MenuItem[];

    constructor(host: IContentHost) {
        super(host, defaultLinkEditorState);
    }

    /** Access the underlying TextFileModel (for script context). */
    get pageModel(): TextFileModel {
        return this.host as unknown as TextFileModel;
    }

    /** ITreeProvider adapter over this view model's link data. */
    get treeProvider(): LinkTreeProvider {
        if (!this._treeProvider) {
            this._treeProvider = new LinkTreeProvider(this, this.pageModel.filePath || "");
        }
        return this._treeProvider;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected onInit(): void {
        this.addSubscription(this.state.subscribe(() => {
            this.onDataChangedDebounced();
        }));

        const content = this.host.state.get().content || "";
        this.loadData(content);
    }

    protected onContentChanged(content: string): void {
        if (this.skipNextContentUpdate) {
            this.skipNextContentUpdate = false;
            return;
        }
        this.loadData(content);
    }

    protected onDispose(): void {
        // Flush pending debounced save
        this.onDataChanged();
        this.containerElement = null;
        this._treeProvider = null;
    }

    // =========================================================================
    // Serialization: state → file content
    // =========================================================================

    private onDataChanged = () => {
        const { data, error } = this.state.get();
        if (error) return;
        if (data !== this.lastSerializedData) {
            this.lastSerializedData = data;
            this.skipNextContentUpdate = true;
            const content = JSON.stringify({ type: "link-editor", ...data }, null, 4);
            this.host.changeContent(content, true);
        }
    };

    private onDataChangedDebounced = debounce(this.onDataChanged, 300);

    // =========================================================================
    // Selection state cache
    // =========================================================================

    private restoreSelectionState = async () => {
        const data = await this.host.stateStorage.getState(this.host.id, LinkViewModel.cacheName);
        if (!data) return;
        try {
            const saved = JSON.parse(data);
            this.state.update((s) => {
                if (saved.expandedPanel) s.expandedPanel = saved.expandedPanel;
                if (saved.selectedCategory) s.selectedCategory = saved.selectedCategory;
                if (saved.selectedTag) s.selectedTag = saved.selectedTag;
                if (saved.selectedHostname) s.selectedHostname = saved.selectedHostname;
            });
            this.applyFilters();
        } catch {
            // ignore corrupted cache
        }
    };

    private saveSelectionState = () => {
        const { expandedPanel, selectedCategory, selectedTag, selectedHostname } = this.state.get();
        const data = JSON.stringify({ expandedPanel, selectedCategory, selectedTag, selectedHostname });
        this.host.stateStorage.setState(this.host.id, LinkViewModel.cacheName, data);
    };

    private saveSelectionStateDebounced = debounce(this.saveSelectionState, 300);

    // =========================================================================
    // Data Loading
    // =========================================================================

    private loadData = (content: string) => {
        try {
            const parsed = content.trim() ? JSON.parse(content) : {};
            this.state.update((s) => {
                const links: LinkItem[] = Array.isArray(parsed.links) ? parsed.links : [];
                // Normalize categories: trim leading/trailing separators
                for (const link of links) {
                    if (link.category) {
                        link.category = link.category.replace(/^[/\\]+|[/\\]+$/g, "");
                    }
                }
                s.data = {
                    links,
                    state: parsed.state || {},
                };
                s.error = undefined;
            });
            this.lastSerializedData = this.state.get().data;
            this.loadCategories();
            this.loadTags();
            this.loadHostnames();
            if (!this.selectionRestored) {
                this.selectionRestored = true;
                this.restoreSelectionState();
            }
            this.applyFilters();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.state.update((s) => {
                s.error = message;
            });
        }
    };

    // =========================================================================
    // Grid model ref
    // =========================================================================

    setGridModel = (model: RenderGridModel | null) => {
        this.gridModel = model;
    };

    // =========================================================================
    // Selection
    // =========================================================================

    selectLink = (id: string) => {
        this.state.update((s) => {
            s.selectedLinkId = id;
        });
    };

    // =========================================================================
    // Left panel
    // =========================================================================

    setExpandedPanel = (panel: string) => {
        this.state.update((s) => {
            s.expandedPanel = panel as ExpandedPanel;
        });
        this.applyFilters();
        this.saveSelectionStateDebounced();
    };

    setLeftPanelWidth = (width: number) => {
        this.state.update((s) => {
            s.leftPanelWidth = width;
        });
    };

    setSelectedCategory = (category: string) => {
        this.state.update((s) => {
            s.selectedCategory = category;
        });
        this.applyFilters();
        this.saveSelectionStateDebounced();
    };

    setSelectedTag = (tag: string) => {
        this.state.update((s) => {
            s.selectedTag = tag;
        });
        this.applyFilters();
        this.saveSelectionStateDebounced();
    };

    setSelectedHostname = (hostname: string) => {
        this.state.update((s) => {
            s.selectedHostname = hostname;
        });
        this.applyFilters();
        this.saveSelectionStateDebounced();
    };

    setSearchText = (text: string) => {
        this.state.update((s) => {
            s.searchText = text;
        });
        this.applyFilters();
    };

    clearSearch = () => {
        this.setSearchText("");
    };

    // =========================================================================
    // Categories
    // =========================================================================

    loadCategories = () => {
        const links = this.state.get().data.links;
        const categoriesSet = new Set<string>();
        const categoriesSize: { [key: string]: number } = {};

        links.forEach((link) => {
            if (link.category) {
                categoriesSet.add(link.category);
                const categoryPath = splitWithSeparators(link.category, "/\\");
                while (categoryPath.length) {
                    const subCategory = categoryPath.join("/");
                    categoriesSize[subCategory] = (categoriesSize[subCategory] || 0) + 1;
                    categoryPath.pop();
                }
            }
            categoriesSize[""] = (categoriesSize[""] || 0) + 1;
        });

        this.state.update((s) => {
            s.categories = Array.from(categoriesSet);
            s.categoriesSize = categoriesSize;
        });
    };

    getCategoryCount = (category: string): number => {
        return this.state.get().categoriesSize[category] ?? 0;
    };


    // =========================================================================
    // Tags
    // =========================================================================

    loadTags = () => {
        const links = this.state.get().data.links;
        const tagsSet = new Set<string>();
        const tagsSize: { [key: string]: number } = {};
        const separator = ":";

        tagsSize[""] = links.length;

        links.forEach((link) => {
            link.tags?.forEach((tag) => {
                tagsSet.add(tag);
                tagsSize[tag] = (tagsSize[tag] || 0) + 1;

                const sepIndex = tag.indexOf(separator);
                if (sepIndex > 0 && sepIndex < tag.length - 1) {
                    const parentTag = tag.slice(0, sepIndex) + separator;
                    tagsSize[parentTag] = (tagsSize[parentTag] || 0) + 1;
                }
            });
        });

        this.state.update((s) => {
            s.tags = Array.from(tagsSet);
            s.tagsSize = tagsSize;
        });
    };

    getTagCount = (tag: string): number => {
        return this.state.get().tagsSize[tag] ?? 0;
    };

    // =========================================================================
    // Hostnames
    // =========================================================================

    loadHostnames = () => {
        const links = this.state.get().data.links;
        const hostnamesSize: { [key: string]: number } = {};

        hostnamesSize[""] = links.length;

        links.forEach((link) => {
            const hostname = getHostname(link.href);
            if (hostname) {
                hostnamesSize[hostname] = (hostnamesSize[hostname] || 0) + 1;
            }
        });

        const hostnames = Object.keys(hostnamesSize).filter((h) => h !== "").sort();

        this.state.update((s) => {
            s.hostnames = hostnames;
            s.hostnamesSize = hostnamesSize;
        });
    };

    getHostnameCount = (hostname: string): number => {
        return this.state.get().hostnamesSize[hostname] ?? 0;
    };

    // =========================================================================
    // Filtering
    // =========================================================================

    applyFilters = () => {
        const { data, selectedCategory, selectedTag, selectedHostname, expandedPanel, searchText, filteredLinks } = this.state.get();
        const last = this.lastFilterState;

        const searchExtended = searchText.startsWith(last.searchText) && last.searchText !== "";
        const panelFilterUnchanged =
            selectedCategory === last.selectedCategory &&
            selectedTag === last.selectedTag &&
            selectedHostname === last.selectedHostname &&
            expandedPanel === last.expandedPanel;

        let filtered: LinkItem[];

        if (searchExtended && panelFilterUnchanged) {
            filtered = filteredLinks;
        } else {
            filtered = data.links;

            if (expandedPanel === "categories" && selectedCategory) {
                filtered = filtered.filter(
                    (link) => link.category?.startsWith(selectedCategory)
                );
            }

            if (expandedPanel === "tags" && selectedTag) {
                const separator = ":";
                if (selectedTag.endsWith(separator)) {
                    filtered = filtered.filter((link) =>
                        link.tags?.some((tag) => tag.startsWith(selectedTag) || tag === selectedTag)
                    );
                } else {
                    filtered = filtered.filter((link) =>
                        link.tags?.includes(selectedTag)
                    );
                }
            }

            if (expandedPanel === "hostnames" && selectedHostname) {
                filtered = filtered.filter(
                    (link) => getHostname(link.href) === selectedHostname
                );
            }
        }

        if (searchText.trim()) {
            const searchWords = searchText.toLowerCase().trim().split(/\s+/);
            filtered = filtered.filter((link) => {
                const searchableText = [
                    link.title || "",
                    link.href || "",
                    link.category || "",
                    ...(link.tags || []),
                ].join(" ").toLowerCase();

                return searchWords.every((word) => searchableText.includes(word));
            });
        }

        this.lastFilterState = { searchText, selectedCategory, selectedTag, selectedHostname, expandedPanel };

        this.state.update((s) => {
            s.filteredLinks = filtered;
        });
    };

    // =========================================================================
    // View Mode (per category or per tag)
    // =========================================================================

    getViewMode = (): LinkViewMode => {
        const { expandedPanel, selectedCategory, selectedTag, selectedHostname, data } = this.state.get();
        if (expandedPanel === "tags") {
            return data.state.tagViewMode?.[selectedTag] ?? "list";
        }
        if (expandedPanel === "hostnames") {
            return data.state.hostnameViewMode?.[selectedHostname] ?? "list";
        }
        return data.state.categoryViewMode?.[selectedCategory] ?? "list";
    };

    setViewMode = (mode: LinkViewMode) => {
        const { expandedPanel, selectedCategory, selectedTag, selectedHostname } = this.state.get();
        this.state.update((s) => {
            if (expandedPanel === "tags") {
                if (!s.data.state.tagViewMode) {
                    s.data.state.tagViewMode = {};
                }
                s.data.state.tagViewMode[selectedTag] = mode;
            } else if (expandedPanel === "hostnames") {
                if (!s.data.state.hostnameViewMode) {
                    s.data.state.hostnameViewMode = {};
                }
                s.data.state.hostnameViewMode[selectedHostname] = mode;
            } else {
                if (!s.data.state.categoryViewMode) {
                    s.data.state.categoryViewMode = {};
                }
                s.data.state.categoryViewMode[selectedCategory] = mode;
            }
        });
    };

    // =========================================================================
    // CRUD
    // =========================================================================

    addLink = (link?: Partial<LinkItem>) => {
        const { expandedPanel, selectedCategory, selectedTag, searchText } = this.state.get();

        let category = link?.category ?? "";
        let tags = link?.tags ?? [];
        let title = link?.title ?? "";

        if (!link?.category) {
            if (expandedPanel === "categories" && selectedCategory) {
                category = selectedCategory;
            }
        }
        if (!link?.tags?.length) {
            if (expandedPanel === "tags" && selectedTag) {
                tags = [selectedTag];
            }
        }
        if (!link?.title && searchText.trim()) {
            title = searchText.trim();
        }

        const newLink: LinkItem = {
            id: crypto.randomUUID(),
            title,
            href: link?.href ?? "",
            category,
            tags,
            isDirectory: false,
            imgSrc: link?.imgSrc,
        };

        this.state.update((s) => {
            s.data.links.unshift(newLink);
        });
        this.loadCategories();
        this.loadTags();
        this.loadHostnames();
        this.applyFilters();
        return newLink;
    };

    /**
     * Import one or more ILink items into the collection.
     * Directories are scanned recursively; if the scan exceeds 100 files,
     * a confirmation dialog asks the user before proceeding.
     * Duplicate hrefs (already in collection) are skipped.
     */
    importLinks = async (items: ILink[]) => {
        const fp = await import("../../core/utils/file-path");
        const existingHrefs = new Set(
            this.state.get().data.links.map((l) => l.href.toLowerCase()),
        );

        const directLinks: Partial<LinkItem>[] = [];
        const foldersToScan: ILink[] = [];

        for (const item of items) {
            if (item.isDirectory) {
                foldersToScan.push(item);
            } else {
                if (existingHrefs.has(item.href.toLowerCase())) continue;
                existingHrefs.add(item.href.toLowerCase());
                directLinks.push({
                    title: item.title,
                    href: item.href,
                    category: item.category || "",
                    tags: item.tags?.length ? item.tags : undefined,
                    imgSrc: item.imgSrc,
                });
            }
        }

        const SCAN_LIMIT = 100;
        let folderLinks: Partial<LinkItem>[] = [];

        if (foldersToScan.length) {
            const scanned = await this.scanFolders(
                foldersToScan, existingHrefs, fp, SCAN_LIMIT,
            );

            if (scanned.limitReached) {
                const choice = await ui.confirm(
                    `The folder contains more than ${SCAN_LIMIT} files. Import all files?`,
                    { title: "Import Folder", buttons: ["Import All", "Cancel"] },
                );
                if (choice !== "Import All") return;

                const existingHrefs2 = new Set(
                    this.state.get().data.links.map((l) => l.href.toLowerCase()),
                );
                for (const dl of directLinks) {
                    if (dl.href) existingHrefs2.add(dl.href.toLowerCase());
                }
                const fullScan = await this.scanFolders(
                    foldersToScan, existingHrefs2, fp, 0,
                );
                folderLinks = fullScan.links;
            } else {
                folderLinks = scanned.links;
            }
        }

        const allLinks = [...directLinks, ...folderLinks];

        if (!allLinks.length) {
            const { app } = await import("../../api/app");
            app.ui.notify("All items already exist in this collection", "info");
            return;
        }

        for (const link of allLinks) {
            this.addLink(link);
        }

        if (allLinks.length > 1) {
            const { app } = await import("../../api/app");
            app.ui.notify(`Imported ${allLinks.length} links`, "info");
        }
    };

    private scanFolders = async (
        folders: ILink[],
        existingHrefs: Set<string>,
        fp: typeof import("../../core/utils/file-path"),
        limit: number,
    ): Promise<{ links: Partial<LinkItem>[]; limitReached: boolean }> => {
        const { app } = await import("../../api/app");
        const links: Partial<LinkItem>[] = [];
        const queue = [...folders];

        while (queue.length > 0) {
            const folder = queue.shift()!;
            let entries: { name: string; isDirectory: boolean }[];
            try {
                entries = await app.fs.listDirWithTypes(folder.href);
            } catch {
                continue;
            }

            for (const entry of entries) {
                const fullPath = fp.fpJoin(folder.href, entry.name);
                if (entry.isDirectory) {
                    queue.push({
                        title: entry.name,
                        href: fullPath,
                        category: folder.category || "",
                        tags: [],
                        isDirectory: true,
                    });
                    continue;
                }
                if (existingHrefs.has(fullPath.toLowerCase())) continue;
                existingHrefs.add(fullPath.toLowerCase());
                links.push({
                    title: entry.name,
                    href: fullPath,
                    category: folder.category || "",
                });
                if (limit > 0 && links.length >= limit) {
                    return { links, limitReached: true };
                }
            }
        }

        return { links, limitReached: false };
    };

    updateLink = (id: string, updates: Partial<Omit<LinkItem, "id">>) => {
        this.state.update((s) => {
            const link = s.data.links.find((l) => l.id === id);
            if (link) {
                if (updates.title !== undefined) link.title = updates.title;
                if (updates.href !== undefined) link.href = updates.href;
                if (updates.category !== undefined) link.category = updates.category;
                if (updates.tags !== undefined) link.tags = updates.tags;
                if (updates.imgSrc !== undefined) link.imgSrc = updates.imgSrc;
                if ("target" in updates) link.target = updates.target;
            }
        });
        if (updates.category !== undefined) this.loadCategories();
        if (updates.tags !== undefined) this.loadTags();
        if (updates.href !== undefined) this.loadHostnames();
        this.applyFilters();
    };

    deleteLink = async (id: string, skipConfirm = false) => {
        if (!skipConfirm) {
            const link = this.getLinkById(id);
            const label = link?.title || link?.href || "this link";
            const bt = await ui.confirm(
                `Are you sure you want to delete "${label}"?`,
                { title: "Delete Link", buttons: ["Delete", "Cancel"] },
            );
            this.containerElement?.focus();
            if (bt !== "Delete") return;
        }
        this.state.update((s) => {
            s.data.links = s.data.links.filter((l) => l.id !== id);
            if (s.data.state.pinnedLinks) {
                s.data.state.pinnedLinks = s.data.state.pinnedLinks.filter((pid) => pid !== id);
            }
        });
        this.loadCategories();
        this.loadTags();
        this.loadHostnames();
        this.applyFilters();
    };

    getLinkById = (id: string): LinkItem | undefined => {
        return this.state.get().data.links.find((l) => l.id === id);
    };

    // =========================================================================
    // Drag-and-drop
    // =========================================================================

    moveLinkToCategory = (linkId: string, category: string) => {
        const link = this.getLinkById(linkId);
        if (!link || link.category === category) return;
        this.updateLink(linkId, { category });
    };

    moveCategory = async (fromCategory: string, toCategory: string) => {
        if (!fromCategory) return;
        if (fromCategory === toCategory) return;
        if (toCategory.startsWith(fromCategory + "/")) return;

        const leafName = fromCategory.split("/").pop() || "";
        const newCategory = toCategory ? `${toCategory}/${leafName}` : leafName;

        if (newCategory === fromCategory) return;

        const links = this.state.get().data.links;
        const count = links.filter(
            (l) => l.category === fromCategory || l.category.startsWith(fromCategory + "/")
        ).length;

        const result = await ui.confirm(
            `Move ${count} link${count !== 1 ? "s" : ""} from "${fromCategory}" to "${newCategory}"?`,
            { title: "Move Category", buttons: ["Move", "Cancel"] },
        );

        if (result !== "Move") return;

        this.state.update((s) => {
            for (const link of s.data.links) {
                if (link.category === fromCategory) {
                    link.category = newCategory;
                } else if (link.category.startsWith(fromCategory + "/")) {
                    link.category = newCategory + link.category.slice(fromCategory.length);
                }
            }
            const sel = s.selectedCategory;
            if (sel === fromCategory) {
                s.selectedCategory = newCategory;
            } else if (sel.startsWith(fromCategory + "/")) {
                s.selectedCategory = newCategory + sel.slice(fromCategory.length);
            }
        });
        this.loadCategories();
        this.applyFilters();
    };

    // =========================================================================
    // Pinned Links
    // =========================================================================

    isLinkPinned = (id: string): boolean => {
        return this.state.get().data.state.pinnedLinks?.includes(id) ?? false;
    };

    pinLink = (id: string) => {
        this.state.update((s) => {
            if (!s.data.state.pinnedLinks) {
                s.data.state.pinnedLinks = [];
            }
            if (!s.data.state.pinnedLinks.includes(id)) {
                s.data.state.pinnedLinks.push(id);
            }
        });
    };

    unpinLink = (id: string) => {
        this.state.update((s) => {
            if (s.data.state.pinnedLinks) {
                s.data.state.pinnedLinks = s.data.state.pinnedLinks.filter((pid) => pid !== id);
            }
        });
    };

    togglePinLink = (id: string) => {
        if (this.isLinkPinned(id)) {
            this.unpinLink(id);
        } else {
            this.pinLink(id);
        }
    };

    reorderPinnedLink = (fromIndex: number, toIndex: number) => {
        this.state.update((s) => {
            const pinned = s.data.state.pinnedLinks;
            if (!pinned) return;
            const [moved] = pinned.splice(fromIndex, 1);
            pinned.splice(toIndex, 0, moved);
        });
    };

    getPinnedLinks = (): LinkItem[] => {
        const { data } = this.state.get();
        const pinnedIds = data.state.pinnedLinks;
        if (!pinnedIds?.length) return [];
        const linkMap = new Map(data.links.map((l) => [l.id, l]));
        return pinnedIds.map((id) => linkMap.get(id)).filter(Boolean) as LinkItem[];
    };

    setPinnedPanelWidth = (width: number) => {
        this.state.update((s) => {
            if (!s.data.state.pinnedPanelWidth || s.data.state.pinnedPanelWidth !== width) {
                s.data.state.pinnedPanelWidth = width;
            }
        });
    };

    // =========================================================================
    // Edit Link Dialog
    // =========================================================================

    showLinkDialog = async (linkId?: string) => {
        const state = this.state.get();
        const link = linkId ? state.data.links.find((l) => l.id === linkId) : undefined;

        const defaults: Partial<LinkItem> = link ? { ...link } : {};
        if (!linkId) {
            const { expandedPanel, selectedCategory, selectedTag, searchText } = state;
            if (expandedPanel === "categories" && selectedCategory) {
                defaults.category = selectedCategory;
            }
            if (expandedPanel === "tags" && selectedTag) {
                defaults.tags = [selectedTag];
            }
            if (searchText.trim()) {
                defaults.title = searchText.trim();
            }
        }

        const result = await showEditLinkDialog({
            title: link ? "Edit Link" : "Add Link",
            link: defaults,
            categories: state.categories,
            tags: state.tags,
        });

        this.containerElement?.focus();

        if (result) {
            if (linkId) {
                this.updateLink(linkId, result);
            } else {
                const newLink: LinkItem = {
                    id: crypto.randomUUID(),
                    title: result.title,
                    href: result.href,
                    category: result.category,
                    tags: result.tags,
                    isDirectory: false,
                    imgSrc: result.imgSrc,
                    target: result.target,
                };
                this.state.update((s) => {
                    s.data.links.unshift(newLink);
                });
                this.loadCategories();
                this.loadTags();
                this.loadHostnames();
                this.applyFilters();
            }
        }
    };

    // =========================================================================
    // Link Opening
    // =========================================================================

    openLink = async (link: ILink | { href: string; target?: string }) => {
        const url = link.href;
        if (!url) return;

        const linkData = createLinkData(url, { target: link.target || undefined });

        // Let owner (e.g., Browser) modify linkData before pipeline dispatch
        this.onLinkOpen?.(linkData);

        const { app } = await import("../../api/app");
        await app.events.openRawLink.sendAsync(linkData);
    };
}

// =============================================================================
// Factory
// =============================================================================

export function createLinkViewModel(host: IContentHost): LinkViewModel {
    return new LinkViewModel(host);
}
