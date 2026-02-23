import { debounce } from "../../../shared/utils";
import { TComponentModel } from "../../core/state/model";
import { CategoryTreeItem } from "../../components/TreeView";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { uuid } from "../../core/utils/node-utils";
import { splitWithSeparators } from "../../core/utils/utils";
import { LinkItem, LinkEditorData, LinkEditorProps, LinkViewMode } from "./linkTypes";
import { showEditLinkDialog } from "./EditLinkDialog";
import { showConfirmationDialog } from "../../features/dialogs";

// =============================================================================
// State
// =============================================================================

export type ExpandedPanel = "tags" | "categories";

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
    // Filtering
    selectedCategory: "" as string,
    selectedTag: "" as string,
    searchText: "" as string,
    filteredLinks: [] as LinkItem[],
    // Selection
    selectedLinkId: "" as string,
};

export type LinkEditorState = typeof defaultLinkEditorState;

// =============================================================================
// Model
// =============================================================================

export class LinkEditorModel extends TComponentModel<
    LinkEditorState,
    LinkEditorProps
> {
    private lastSerializedData: LinkEditorData | null = null;
    private stateChangeSubscription: (() => void) | undefined;
    private skipNextContentUpdate = false;
    gridModel: RenderGridModel | null = null;
    containerElement: HTMLElement | null = null;
    private lastFilterState = { searchText: "", selectedCategory: "", selectedTag: "", expandedPanel: "" };

    // =========================================================================
    // Lifecycle
    // =========================================================================

    init = () => {
        this.stateChangeSubscription = this.state.subscribe(() => {
            this.onDataChangedDebounced();
        });
    };

    dispose = () => {
        this.stateChangeSubscription?.();
    };

    // =========================================================================
    // Sync: state → file content
    // =========================================================================

    private onDataChanged = () => {
        const { data, error } = this.state.get();
        if (error) return;
        if (data !== this.lastSerializedData) {
            this.lastSerializedData = data;
            this.skipNextContentUpdate = true;
            const content = JSON.stringify(data, null, 4);
            this.props.model.changeContent(content, true);
        }
    };

    private onDataChangedDebounced = debounce(this.onDataChanged, 300);

    // =========================================================================
    // Sync: file content → state
    // =========================================================================

    updateContent = (content: string) => {
        if (this.skipNextContentUpdate) {
            this.skipNextContentUpdate = false;
            return;
        }
        this.loadData(content);
    };

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
    };

    setSelectedTag = (tag: string) => {
        this.state.update((s) => {
            s.selectedTag = tag;
        });
        this.applyFilters();
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
    // Filtering
    // =========================================================================

    applyFilters = () => {
        const { data, selectedCategory, selectedTag, expandedPanel, searchText, filteredLinks } = this.state.get();
        const last = this.lastFilterState;

        const searchExtended = searchText.startsWith(last.searchText) && last.searchText !== "";
        const categoryTagUnchanged =
            selectedCategory === last.selectedCategory &&
            selectedTag === last.selectedTag &&
            expandedPanel === last.expandedPanel;

        let filtered: LinkItem[];

        if (searchExtended && categoryTagUnchanged) {
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

        this.lastFilterState = { searchText, selectedCategory, selectedTag, expandedPanel };

        this.state.update((s) => {
            s.filteredLinks = filtered;
        });
    };

    // =========================================================================
    // View Mode (per category or per tag)
    // =========================================================================

    getViewMode = (): LinkViewMode => {
        const { expandedPanel, selectedCategory, selectedTag, data } = this.state.get();
        if (expandedPanel === "tags") {
            return data.state.tagViewMode?.[selectedTag] ?? "list";
        }
        return data.state.categoryViewMode?.[selectedCategory] ?? "list";
    };

    setViewMode = (mode: LinkViewMode) => {
        const { expandedPanel, selectedCategory, selectedTag } = this.state.get();
        this.state.update((s) => {
            if (expandedPanel === "tags") {
                if (!s.data.state.tagViewMode) {
                    s.data.state.tagViewMode = {};
                }
                s.data.state.tagViewMode[selectedTag] = mode;
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
            id: uuid(),
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
        this.applyFilters();
    };

    deleteLink = async (id: string, skipConfirm = false) => {
        if (!skipConfirm) {
            const link = this.getLinkById(id);
            const label = link?.title || link?.href || "this link";
            const bt = await showConfirmationDialog({
                title: "Delete Link",
                message: `Are you sure you want to delete "${label}"?`,
                buttons: ["Delete", "Cancel"],
            });
            this.containerElement?.focus();
            if (bt !== "Delete") return;
        }
        this.state.update((s) => {
            s.data.links = s.data.links.filter((l) => l.id !== id);
        });
        this.loadCategories();
        this.loadTags();
        this.applyFilters();
    };

    getLinkById = (id: string): LinkItem | undefined => {
        return this.state.get().data.links.find((l) => l.id === id);
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
                    id: uuid(),
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
                this.applyFilters();
            }
        }
    };
}
