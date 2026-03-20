import { debounce } from "../../../shared/utils";
import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { CategoryTreeItem, DragItem } from "../../components/TreeView";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";

import { splitWithSeparators } from "../../core/utils/utils";
import { getHostname } from "./favicon-cache";
import { LinkItem, LinkEditorData, LinkViewMode, LINK_DRAG, LINK_CATEGORY_DRAG } from "./linkTypes";
import { showEditLinkDialog } from "./EditLinkDialog";
import { ui } from "../../api/ui";
import { settings } from "../../api/settings";
import { shell } from "../../api/shell";
import type { TextFileModel } from "../text/TextPageModel";

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
    // Browser selection for link opening.
    // "": use pagesModel.handleOpenUrl (BookmarksDrawer), "os-default": OS browser,
    // "internal-default": built-in default profile, "profile:<name>": named profile,
    // "incognito": incognito mode.
    selectedBrowser: "" as string,
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

    gridModel: RenderGridModel | null = null;
    containerElement: HTMLElement | null = null;

    /**
     * Optional callback for handling default link clicks internally.
     * When set, clicking a link (with no specific browser selected) calls this instead of pagesModel.handleOpenUrl.
     * Used by browser editor to route links to the correct browser page/tab.
     * @param url The URL to open
     */
    onInternalLinkOpen?: (url: string) => void;

    constructor(host: IContentHost) {
        super(host, defaultLinkEditorState);
    }

    /** Access the underlying TextFileModel (for script context). */
    get pageModel(): TextFileModel {
        return this.host as unknown as TextFileModel;
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
                s.data = {
                    links: Array.isArray(parsed.links) ? parsed.links : [],
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

    categoryItemClick = (item: CategoryTreeItem) => {
        this.setSelectedCategory(item.category);
    };

    getCategoryItemSelected = (item: CategoryTreeItem): boolean => {
        return item.category === this.state.get().selectedCategory;
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

    updateLink = (id: string, updates: Partial<Omit<LinkItem, "id">>) => {
        this.state.update((s) => {
            const link = s.data.links.find((l) => l.id === id);
            if (link) {
                if (updates.title !== undefined) link.title = updates.title;
                if (updates.href !== undefined) link.href = updates.href;
                if (updates.category !== undefined) link.category = updates.category;
                if (updates.tags !== undefined) link.tags = updates.tags;
                if (updates.imgSrc !== undefined) link.imgSrc = updates.imgSrc;
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

    categoryDrop = (dropItem: CategoryTreeItem, dragItem: DragItem) => {
        if (dragItem.type === LINK_DRAG) {
            this.moveLinkToCategory(dragItem.linkId, dropItem.category);
        } else if (dragItem.type === LINK_CATEGORY_DRAG) {
            this.moveCategory(dragItem.category, dropItem.category);
        }
    };

    getCategoryDragItem = (item: CategoryTreeItem): DragItem | null => {
        if (!item.category) return null;
        return { type: LINK_CATEGORY_DRAG, category: item.category };
    };

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
                    imgSrc: result.imgSrc,
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
    // Browser Selection
    // =========================================================================

    /**
     * Initialize browser selection based on settings.
     * Called by the component (not in onInit) — BookmarksDrawer skips this
     * to keep selectedBrowser as "" for its own open-link handling.
     */
    initBrowserSelection = () => {
        const behavior = settings.get("link-open-behavior");
        if (behavior === "default-browser") {
            this.state.update((s) => { s.selectedBrowser = "os-default"; });
        } else {
            this.state.update((s) => { s.selectedBrowser = "internal-default"; });
        }
    };

    setSelectedBrowser = (value: string) => {
        this.state.update((s) => { s.selectedBrowser = value; });
    };

    openLink = async (url: string) => {
        // If a browser page owns this link model, route links there
        if (this.onInternalLinkOpen) {
            this.onInternalLinkOpen(url);
            return;
        }

        const { selectedBrowser } = this.state.get();

        if (!selectedBrowser) {
            const { pagesModel } = await import("../../api/pages");
            pagesModel.handleOpenUrl(url);
            return;
        }

        if (selectedBrowser === "os-default") {
            shell.openExternal(url);
            return;
        }

        const { pagesModel } = await import("../../api/pages");

        if (selectedBrowser === "incognito") {
            pagesModel.openUrlInBrowserTab(url, { incognito: true });
            return;
        }

        if (selectedBrowser.startsWith("profile:")) {
            const profileName = selectedBrowser.slice("profile:".length);
            pagesModel.openUrlInBrowserTab(url, { profileName });
            return;
        }

        // "internal-default" — pass empty profileName to match only default-profile tabs
        pagesModel.openUrlInBrowserTab(url, { profileName: "" });
    };
}

// =============================================================================
// Factory
// =============================================================================

export function createLinkViewModel(host: IContentHost): LinkViewModel {
    return new LinkViewModel(host);
}
