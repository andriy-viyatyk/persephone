import { produce } from "immer";
import { getHostname } from "../../components/icons/favicon-cache";
import { splitWithSeparators } from "../../core/utils/utils";
import type { LinkEditorData, LinkItem, LinkViewMode } from "./linkTypes";

export const TAG_SEPARATOR = ":";
export const CATEGORY_SEPARATOR = "/";

export interface LinkCollectionIndex {
    categories: string[];
    categoriesSize: Record<string, number>;
    tags: string[];
    tagsSize: Record<string, number>;
    hostnames: string[];
    hostnamesSize: Record<string, number>;
}

export interface LinkFilterCriteria {
    panel: "tags" | "categories" | "hostnames";
    category: string;
    tag: string;
    hostname: string;
    search: string;
}

export class LinkCollection {
    private _data: LinkEditorData;
    private _index: LinkCollectionIndex;

    private lastFilterState: LinkFilterCriteria & { links: LinkItem[] } = {
        panel: "categories",
        category: "",
        tag: "",
        hostname: "",
        search: "",
        links: [],
    };
    private lastFilteredLinks: LinkItem[] = [];

    constructor(data: LinkEditorData) {
        this._data = data;
        this._index = this.buildIndex();
    }

    get data(): LinkEditorData {
        return this._data;
    }

    get index(): LinkCollectionIndex {
        return this._index;
    }

    get links(): LinkItem[] {
        return this.data.links;
    }

    static parse(content: string): LinkCollection {
        const parsed = content.trim() ? JSON.parse(content) : {};
        const links: LinkItem[] = Array.isArray(parsed.links) ? parsed.links : [];
        for (const link of links) {
            if (link.category) {
                link.category = link.category.replace(/^[/\\]+|[/\\]+$/g, "");
            }
        }
        return new LinkCollection({ links, state: parsed.state || {} });
    }

    serialize(): string {
        return JSON.stringify({ type: "link-editor", ...this.data }, null, 4);
    }

    filter(criteria: LinkFilterCriteria): LinkItem[] {
        const last = this.lastFilterState;
        const searchExtended =
            criteria.search.startsWith(last.search) && last.search !== "";
        const panelFilterUnchanged =
            criteria.category === last.category &&
            criteria.tag === last.tag &&
            criteria.hostname === last.hostname &&
            criteria.panel === last.panel;
        const linksUnchanged = this.data.links === last.links;

        let filtered: LinkItem[];
        if (searchExtended && panelFilterUnchanged && linksUnchanged) {
            filtered = this.lastFilteredLinks;
        } else {
            filtered = this.data.links;
            if (criteria.panel === "categories" && criteria.category) {
                filtered = filtered.filter((link) =>
                    link.category?.startsWith(criteria.category),
                );
            }
            if (criteria.panel === "tags" && criteria.tag) {
                filtered = filtered.filter((link) => this.linkHasTag(link, criteria.tag));
            }
            if (criteria.panel === "hostnames" && criteria.hostname) {
                filtered = filtered.filter(
                    (link) => getHostname(link.href) === criteria.hostname,
                );
            }
            this.lastFilteredLinks = filtered;
        }

        if (criteria.search.trim()) {
            const searchWords = criteria.search.toLowerCase().trim().split(/\s+/);
            filtered = filtered.filter((link) => {
                const searchableText = [
                    link.title || "",
                    link.href || "",
                    link.category || "",
                    ...(link.tags || []),
                ]
                    .join(" ")
                    .toLowerCase();
                return searchWords.every((word) => searchableText.includes(word));
            });
        }

        this.lastFilterState = { ...criteria, links: this.data.links };
        this.lastFilteredLinks = filtered;
        return filtered;
    }

    linksWithTag(tag: string): LinkItem[] {
        if (!tag) return this.data.links;
        return this.data.links.filter((link) => this.linkHasTag(link, tag));
    }

    viewModeFor(panel: LinkFilterCriteria["panel"], key: string, data = this.data): LinkViewMode {
        if (panel === "tags") return data.state.tagViewMode?.[key] ?? "list";
        if (panel === "hostnames") return data.state.hostnameViewMode?.[key] ?? "list";
        return data.state.categoryViewMode?.[key] ?? "list";
    }

    add(item: LinkItem): void {
        this.mutate((draft) => { draft.links.unshift(item); });
    }

    addMany(items: LinkItem[]): void {
        this.mutate((draft) => {
            for (const item of items) draft.links.unshift(item);
        });
    }

    update(id: string, patch: Partial<Omit<LinkItem, "id">>): void {
        this.mutate((draft) => {
            const link = draft.links.find((item) => item.id === id);
            if (!link) return;
            if (patch.title !== undefined) link.title = patch.title;
            if (patch.href !== undefined) link.href = patch.href;
            if (patch.category !== undefined) link.category = patch.category;
            if (patch.tags !== undefined) link.tags = patch.tags;
            if (patch.imgSrc !== undefined) link.imgSrc = patch.imgSrc;
            if ("target" in patch) link.target = patch.target;
        });
    }

    remove(id: string): void {
        this.mutate((draft) => {
            draft.links = draft.links.filter((link) => link.id !== id);
            if (draft.state.pinnedLinks) {
                draft.state.pinnedLinks = draft.state.pinnedLinks.filter((pinnedId) => pinnedId !== id);
            }
        });
    }

    toggleTag(id: string, tag: string): void {
        this.mutate((draft) => {
            const link = draft.links.find((item) => item.id === id);
            if (!link) return;
            const tags = link.tags || [];
            link.tags = tags.includes(tag)
                ? tags.filter((value) => value !== tag)
                : [...tags, tag];
        });
    }

    moveToCategory(id: string, category: string): boolean {
        const link = this.data.links.find((item) => item.id === id);
        if (!link || link.category === category) return false;
        this.update(id, { category });
        return true;
    }

    moveCategory(from: string, to: string): number {
        const nameStart = from.lastIndexOf(CATEGORY_SEPARATOR) + 1;
        const prefix = from + CATEGORY_SEPARATOR;
        let changed = 0;
        this.mutate((draft) => {
            for (const link of draft.links) {
                const category = link.category;
                if (category === from || category?.startsWith(prefix)) {
                    const suffix = category.slice(nameStart);
                    const newCategory = to ? to + CATEGORY_SEPARATOR + suffix : suffix;
                    if (newCategory !== category) {
                        link.category = newCategory;
                        changed++;
                    }
                }
            }
        });
        return changed;
    }

    pin(id: string): void {
        this.mutate((draft) => {
            if (!draft.state.pinnedLinks) draft.state.pinnedLinks = [];
            if (!draft.state.pinnedLinks.includes(id)) draft.state.pinnedLinks.push(id);
        });
    }

    unpin(id: string): void {
        this.mutate((draft) => {
            if (draft.state.pinnedLinks) {
                draft.state.pinnedLinks = draft.state.pinnedLinks.filter((pinnedId) => pinnedId !== id);
            }
        });
    }

    reorderPinned(fromIndex: number, toIndex: number): void {
        this.mutate((draft) => {
            const pinned = draft.state.pinnedLinks;
            if (!pinned) return;
            const [moved] = pinned.splice(fromIndex, 1);
            pinned.splice(toIndex, 0, moved);
        });
    }

    setViewMode(panel: LinkFilterCriteria["panel"], key: string, mode: LinkViewMode): void {
        this.mutate((draft) => {
            if (panel === "tags") {
                if (!draft.state.tagViewMode) draft.state.tagViewMode = {};
                draft.state.tagViewMode[key] = mode;
            } else if (panel === "hostnames") {
                if (!draft.state.hostnameViewMode) draft.state.hostnameViewMode = {};
                draft.state.hostnameViewMode[key] = mode;
            } else {
                if (!draft.state.categoryViewMode) draft.state.categoryViewMode = {};
                draft.state.categoryViewMode[key] = mode;
            }
        });
    }

    setPinnedPanelWidth(width: number): boolean {
        return this.mutate((draft) => {
            const currentWidth = draft.state.pinnedPanelWidth;
            if (!currentWidth || currentWidth !== width) {
                draft.state.pinnedPanelWidth = width;
            }
        });
    }

    private linkHasTag(link: LinkItem, tag: string): boolean {
        if (tag.endsWith(TAG_SEPARATOR)) {
            return !!link.tags?.some((value) => value.startsWith(tag) || value === tag);
        }
        return !!link.tags?.includes(tag);
    }

    private mutate(recipe: (draft: LinkEditorData) => void): boolean {
        const nextData = produce(this.data, recipe);
        if (nextData === this.data) return false;
        this._data = nextData;
        this._index = this.buildIndex();
        return true;
    }

    private buildIndex(): LinkCollectionIndex {
        const links = this.data.links;
        const categoriesSet = new Set<string>();
        const categoriesSize: Record<string, number> = {};
        const tagsSet = new Set<string>();
        const tagsSize: Record<string, number> = { "": links.length };
        const hostnamesSize: Record<string, number> = { "": links.length };

        for (const link of links) {
            if (link.category) {
                categoriesSet.add(link.category);
                const categoryPath = splitWithSeparators(link.category, "/\\");
                while (categoryPath.length) {
                    const subCategory = categoryPath.join(CATEGORY_SEPARATOR);
                    categoriesSize[subCategory] = (categoriesSize[subCategory] || 0) + 1;
                    categoryPath.pop();
                }
            }
            categoriesSize[""] = (categoriesSize[""] || 0) + 1;

            link.tags?.forEach((tag) => {
                tagsSet.add(tag);
                tagsSize[tag] = (tagsSize[tag] || 0) + 1;
                const sepIndex = tag.indexOf(TAG_SEPARATOR);
                if (sepIndex > 0 && sepIndex < tag.length - 1) {
                    const parentTag = tag.slice(0, sepIndex) + TAG_SEPARATOR;
                    tagsSize[parentTag] = (tagsSize[parentTag] || 0) + 1;
                }
            });

            const hostname = getHostname(link.href);
            if (hostname) hostnamesSize[hostname] = (hostnamesSize[hostname] || 0) + 1;
        }

        return {
            categories: Array.from(categoriesSet),
            categoriesSize,
            tags: Array.from(tagsSet),
            tagsSize,
            hostnames: Object.keys(hostnamesSize).filter((hostname) => hostname !== "").sort(),
            hostnamesSize,
        };
    }
}
