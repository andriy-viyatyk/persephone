import { EditorId } from "../../../shared/editor-ids";
import { TComponentState } from "../../core/state/state";
import { EditorModel, type EditorStateBase } from "../base/EditorModel";
import { TextHostEditorModel } from "../base/TextHostEditorModel";
import { TREE_PROVIDER_HOST_TRAIT, TreeProviderHost } from "../base/tree-provider-host";
import { TextFileModel } from "../content-host/TextFileModel";
import { ui } from "../../api/ui";
import { app } from "../../api/app";
import { debounce, errMessage } from "../../../shared/utils";
import type { GridModelCapability } from "../../uikit/DataGrid";
import type { ILink } from "../../api/types/io.tree";
import type { MenuItem } from "../../uikit/Menu/types";
import type { ILinkData } from "../../../shared/link-data";
import { createLinkData } from "../../../shared/link-data";
import { LinkTreeProvider } from "./LinkTreeProvider";
import { englishMessage, t, untranslated } from "../../../shared/i18n/t";
import type { ILinkSource, LinkItem, LinkEditorData, LinkViewMode } from "./linkTypes";
import { LinkCollection, type LinkFilterCriteria } from "./link-collection";
import { LinkImporter } from "./link-importer";
import { showEditLinkDialog } from "./EditLinkDialog";
import { DialogButton } from "../../ui/dialogs/dialog-buttons";

const IMPORT_ALL = englishMessage("links.importAll");
import type { ImageRoute } from "./routed-src";
import { isBoardContextSourceId } from "../base/editor-ids";

export type ExpandedPanel = "tags" | "categories" | "hostnames";

export type LinkQueueEvent = { type: "focus" };
export type LinkQueueRequest = never;

export interface LinkEditorEmbedding {
    adjustOpenLink(data: ILinkData): void;
    extraMenuItems(link: LinkItem): MenuItem[];
    imageRoute(): ImageRoute | null;
}

/**
 * HS1 host-slot shape — the five per-window UI selection fields ride
 * `host.editorSettings["link-view"]`. Survives Link↔Monaco switches AND
 * app restarts. Replaces today's `<host.id>:link-editor` cache file.
 */
interface LinkViewSettings {
    expandedPanel?: ExpandedPanel;
    selectedCategory?: string;
    selectedTag?: string;
    selectedHostname?: string;
}

export interface LinkEditorState extends EditorStateBase {
    // HS1 — ride host.editorSettings["link-view"]:
    expandedPanel: ExpandedPanel;
    selectedCategory: string;
    selectedTag: string;
    selectedHostname: string;
    // View-derived — present on state for reactivity, stripped from
    // getRestoreData. Recomputed from host content via loadData.
    data: LinkEditorData;
    error: string | undefined;
    categories: string[];
    categoriesSize: Record<string, number>;
    tags: string[];
    tagsSize: Record<string, number>;
    hostnames: string[];
    hostnamesSize: Record<string, number>;
    filteredLinks: LinkItem[];
    // Transient UI state — not persisted.
    searchText: string;
    selectedLinkId: string;
}

export const defaultLinkEditorState: LinkEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryView: undefined,
    expandedPanel: "categories",
    selectedCategory: "",
    selectedTag: "",
    selectedHostname: "",
    data: { links: [], state: {} },
    error: undefined,
    categories: [],
    categoriesSize: {},
    tags: [],
    tagsSize: {},
    hostnames: [],
    hostnamesSize: {},
    filteredLinks: [],
    searchText: "",
    selectedLinkId: "",
};

/** All link-editor sidebar panels — registered for the whole time the
 *  LinkEditor is on a page (always-on; the sidebar is mandatory-open while a
 *  Link editor is present). The set is binary: all three, or gone (self-evict
 *  on external navigation). */
const LINK_PANELS = ["link-category", "link-tags", "link-hostnames"];

export class LinkEditor
    extends TextHostEditorModel<LinkEditorState, LinkQueueEvent, LinkQueueRequest>
    implements ILinkSource
{
    readonly editorId = EditorId.linkView;
    protected readonly displayName = untranslated("Link");

    // LK4 — ref-equality marker.
    private lastSerializedData: LinkEditorData | null = null;
    private _collection: LinkCollection;
    private readonly importer = new LinkImporter();
    private embedding?: LinkEditorEmbedding;

    readonly treeProviderHost = new TreeProviderHost<LinkTreeProvider>({
        createProvider: () => this._host
            ? new LinkTreeProvider(this, this._host.state.get().filePath || "")
            : null,
    });

    get selectionState() {
        return this.treeProviderHost.selectionState;
    }

    get collection(): LinkCollection {
        return this._collection;
    }

    // View refs (set by view; not on state):
    gridModel: GridModelCapability | null = null;
    containerElement: HTMLElement | null = null;


    /**
     * Route fetches through the embedding page's session when its network is routed (for example, a browser bookmark editor on Tor or a proxied profile), so remote link images do not use a direct connection.
     * bookmarks editor on a Tor page or a proxied profile) so remote link images
     * are fetched through that page's session instead of leaking direct. A
     * function, not a value: `torStatus` and the profile's network change after
     * this editor is wired up, and this model outlives every blank tab in the page.
     * Left null for standalone `.links.json` editors and direct pages.
     */

    /** Current routing for remote images, read fresh at render time. */
    get imageProxy(): ImageRoute | null {
        return this.embedding?.imageRoute() ?? null;
    }

    /**
     * True when this editor is embedded in a Tor browser page. Gates anything
     * that would leave a trace on disk — e.g. arming a favicon download.
     */
    get isPrivatePage(): boolean {
        return !!this.imageProxy?.private;
    }

    // Save debounce — today's pattern:
    private onDataChangedDebounced = debounce(() => this.onDataChanged(), 300);

    constructor(state: TComponentState<LinkEditorState>) {
        super(state);
        this._collection = new LinkCollection(state.get().data);
        this.traits.add(TREE_PROVIDER_HOST_TRAIT, this.treeProviderHost);
    }

    publish(updateState?: (state: LinkEditorState) => void): void {
        const { data, index } = this.collection;
        this.state.update((s) => {
            s.data = data;
            s.categories = index.categories;
            s.categoriesSize = index.categoriesSize;
            s.tags = index.tags;
            s.tagsSize = index.tagsSize;
            s.hostnames = index.hostnames;
            s.hostnamesSize = index.hostnamesSize;
            updateState?.(s);
        });
        this.applyFilters();
    }

    setEmbedding(embedding: LinkEditorEmbedding): void {
        this.embedding = embedding;
    }

    extraMenuItems(link: LinkItem): MenuItem[] {
        return this.embedding?.extraMenuItems(link) ?? [];
    }

    /** The trait extracted the host (switch away) — drop the host-bound
     *  tree provider. */
    protected onHostExtracted(): void {
        this.treeProviderHost.reset();
    }

    protected untitledName(): string {
        return "untitled.link.json";
    }

    focus(): void {
        this.queue.send({ type: "focus" });
    }

    refocus(): void {
        this.containerElement?.focus();
    }

    // ── LK9 — Tree provider exposure ────────────────────────────────────

    get treeProvider(): LinkTreeProvider | null {
        return this.treeProviderHost.provider;
    }

    selectByHref = (href: string): void => {
        const link = this.state.get().data.links.find((l) => l.href === href);
        if (link?.id) this.selectLink(link.id);
    };

    // ── Host adoption ───────────────────────────────────────────────────

    adoptHost(host: TextFileModel): void {
        super.adoptHost(host);

        // Panels are a property of "the Link editor is on a page" — registered
        // once here, independent of the sidebar open flag (the sidebar is
        // mandatory-open per PageModel.sidebarMandatory). Constant for the
        // editor's life on the page; only the survival hooks clear it.
        // (Panels contribution now runs after the base host attach — accepted
        // micro-difference from the pre-base ordering.)
        this.secondaryView = LINK_PANELS;

        // LK4 + LK5 — re-parse on external content changes; the base's echo
        // guard prevents the loop from our own serialize-back writes.
        this.subscribeHostContent((content) => this.loadData(content));

        // HS1 — seed the 5 selection fields from host slot (sync, no flicker)
        // and mirror back. Slice-subscribe over a composite key so the mirror
        // fires on any of the 5 slot fields but NOT on data / derived /
        // transient mutations.
        this.mirrorHostSettings<LinkViewSettings>(
            (saved) => {
                this.state.update((s) => {
                    if (saved.expandedPanel !== undefined) s.expandedPanel = saved.expandedPanel;
                    if (saved.selectedCategory !== undefined) s.selectedCategory = saved.selectedCategory;
                    if (saved.selectedTag !== undefined) s.selectedTag = saved.selectedTag;
                    if (saved.selectedHostname !== undefined) s.selectedHostname = saved.selectedHostname;
                });
            },
            (s) => ({
                expandedPanel: s.expandedPanel,
                selectedCategory: s.selectedCategory,
                selectedTag: s.selectedTag,
                selectedHostname: s.selectedHostname,
            }),
            (s) =>
                `${s.expandedPanel}|${s.selectedCategory}|${s.selectedTag}|${s.selectedHostname}`,
        );

        // LK4 — state subscription → debounced serialize-back. Replaces
        // today's LinkViewModel.onInit subscription.
        this.registerHostSubscription(this.state.subscribe(
            () => this.onDataChangedDebounced(),
            (state) => ({ data: state.data, error: state.error }),
        ));
    }

    protected onHostAttached(host: TextFileModel): void {
        this.loadData(host.state.get().content ?? "");
    }

    // ── LK6 — Sidebar lifecycle hooks ───────────────────────────────────

    /** LK7 — Survive as a standalone-secondary view only when the user is
     *  navigating WITHIN our own links (matched via `sourceLink.sourceId`).
     *  External navigation (Explorer click, Tab switch, etc.) → unload so
     *  stale Categories/Tags/Hostnames panels don't leak into the new file's
     *  SecondaryViews. Mirrors `ArchiveEditorModel.beforeNavigateAway`. */
    beforeNavigateAway(newModel: EditorModel): void {
        // A modified editor survives any navigation so unsaved work is never
        // lost; an unmodified one survives only own-link navigation.
        if (this.modified || this._isOpenedFromMe(newModel)) {
            return;
        }
        this.secondaryView = undefined;
    }

    /** On demote, keep the full panel set without reshaping. Evicts
     *  only when the editor is unmodified AND the new main wasn't opened from
     *  us (external navigation). A modified editor always keeps its panels. */
    onMainEditorChanged(newMainEditor: EditorModel | null): void {
        if (newMainEditor === this) return;
        if (newMainEditor === null) return;
        if (!this.contributesPanels()) return;
        if (!this.modified && !this._isOpenedFromMe(newMainEditor)) {
            this.secondaryView = undefined;
            return;
        }
        this.secondaryView = LINK_PANELS;
    }

    /** A modified Link editor survives any navigation (its panels stay; unsaved
     *  work is preserved); an unmodified one survives own-link navigation. In
     *  both cases the editor is not released, so the navigation save-prompt is
     *  skipped. */
    survivesNavigation(sourceLink?: ILinkData): boolean {
        return this.modified || this.isOwnNavigationSourceId(sourceLink?.sourceId);
    }

    /** Sidebar active-panel changed to one we own → sync `expandedPanel` (drives the
     *  toolbar breadcrumb + the center-list filter). This lives on the model — not in
     *  the LinkBody view — because PageModel calls it on the owning editor regardless
     *  of whether the body is mounted. After navigating to a link the editor is demoted
     *  to a sidebar and LinkBody unmounts; handling the switch here keeps tag/category
     *  panel selection working in that state. Maps the sidebar panel id back to
     *  `expandedPanel`. */
    onPanelExpanded(panelId: string): void {
        const map: Record<string, ExpandedPanel> = {
            "link-category": "categories",
            "link-tags": "tags",
            "link-hostnames": "hostnames",
        };
        const expandedPanel = map[panelId];
        if (expandedPanel) this.setExpandedPanel(expandedPanel);
    }

    private _isOpenedFromMe(model: EditorModel): boolean {
        return this.isOwnNavigationSourceId(model.sourceLink?.sourceId);
    }

    /** True when a navigation `sourceId` originated from this LinkEditor's own
     *  UI — its own id, or a panel click (`link-category` / `link-tag` /
     *  `link-hostname`). Single source of truth for own-link detection,
     *  shared by `_isOpenedFromMe` (reads a model) and `survivesNavigation`
     *  (reads the incoming `sourceLink`). */
    private isOwnNavigationSourceId(sourceId?: string): boolean {
        if (!sourceId) return false;
        if (sourceId === this.id) return true;
        if (isBoardContextSourceId(sourceId)) {
            return sourceId !== "explorer";
        }
        return sourceId === "link-hostname";
    }

    // ────────────────────────────────────────────────────────────────────
    // ────────────────────────────────────────────────────────────────────

    // ── Serialization: state → file content ─────────────────

    private onDataChanged = () => {
        const { data, error } = this.state.get();
        if (error) return;
        if (!this._host) return;
        if (data !== this.lastSerializedData) {
            this.lastSerializedData = data;
            const content = this.collection.serialize();
            this.writeToHost(content, true);
        }
    };

    // ── Data loading ────────────────────────────────────────────────────

    loadData = (content: string): void => {
        try {
            this._collection = LinkCollection.parse(content);
            this.publish((s) => { s.error = undefined; });
            this.lastSerializedData = this.state.get().data;
        } catch (e: unknown) {
            const message = errMessage(e);
            this.state.update((s) => {
                s.error = message;
            });
        }
    };

    // ── Grid model ref ──────────────────────────────────────────────────

    setGridModel = (model: GridModelCapability | null): void => {
        this.gridModel = model;
    };

    // ── Selection ───────────────────────────────────────────────────────

    selectLink = (id: string): void => {
        this.state.update((s) => {
            s.selectedLinkId = id;
        });
    };

    // ── Left panel ──────────────────────────────────────────────────────

    setExpandedPanel = (panel: string): void => {
        this.state.update((s) => {
            s.expandedPanel = panel as ExpandedPanel;
        });
        this.applyFilters();
    };

    setSelectedCategory = (category: string): void => {
        this.state.update((s) => {
            s.selectedCategory = category;
            // Selecting a category folder is a fresh selection in the Collections
            // tree — drop any selected-link highlight so the category shows as the
            // selected node (last click wins). The category panel highlights
            // `selectedLinkId`'s link when set, else `selectedCategory`.
            s.selectedLinkId = "";
        });
        this.applyFilters();
    };

    setSelectedTag = (tag: string): void => {
        this.state.update((s) => {
            s.selectedTag = tag;
        });
        this.applyFilters();
    };

    setSelectedHostname = (hostname: string): void => {
        this.state.update((s) => {
            s.selectedHostname = hostname;
        });
        this.applyFilters();
    };

    setSearchText = (text: string): void => {
        this.state.update((s) => {
            s.searchText = text;
        });
        this.applyFilters();
    };

    clearSearch = (): void => {
        this.setSearchText("");
    };

    // ── Categories ──────────────────────────────────────────────────────

    getCategoryCount = (category: string): number => {
        return this.state.get().categoriesSize[category] ?? 0;
    };

    // ── Tags ────────────────────────────────────────────────────────────

    getTagCount = (tag: string): number => {
        return this.state.get().tagsSize[tag] ?? 0;
    };

    // ── Hostnames ───────────────────────────────────────────────────────

    getHostnameCount = (hostname: string): number => {
        return this.state.get().hostnamesSize[hostname] ?? 0;
    };

    // ── Filtering ───────────────────────────────────────────────────────

    applyFilters = (): void => {
        const {
            selectedCategory,
            selectedTag,
            selectedHostname,
            expandedPanel,
            searchText,
        } = this.state.get();
        const filtered = this.collection.filter({
            panel: expandedPanel,
            category: selectedCategory,
            tag: selectedTag,
            hostname: selectedHostname,
            search: searchText,
        } as LinkFilterCriteria);
        this.state.update((s) => {
            s.filteredLinks = filtered;
        });
    };

    // ── View Mode (per category / tag / hostname) ───────────────────────

    /**
     * View mode for the current category / tag / hostname.
     *
     */
    getViewMode = (snapshot?: LinkEditorState): LinkViewMode => {
        const { expandedPanel, selectedCategory, selectedTag, selectedHostname, data } =
            snapshot ?? this.state.get();
        const key = expandedPanel === "tags"
            ? selectedTag
            : expandedPanel === "hostnames" ? selectedHostname : selectedCategory;
        return this.collection.viewModeFor(expandedPanel, key, data);
    };

    setViewMode = (mode: LinkViewMode): void => {
        const { expandedPanel, selectedCategory, selectedTag, selectedHostname } =
            this.state.get();
        const key = expandedPanel === "tags"
            ? selectedTag
            : expandedPanel === "hostnames" ? selectedHostname : selectedCategory;
        this.collection.setViewMode(expandedPanel, key, mode);
        this.publish();
    };

    // ── CRUD ────────────────────────────────────────────────────────────

    addLink = (link?: Partial<LinkItem>): LinkItem => {
        const newLink = this.createLinkItem(link);
        this.collection.add(newLink);
        this.publish();
        return newLink;
    };

    private getLinkDefaults(): Partial<LinkItem> {
        const { expandedPanel, selectedCategory, selectedTag, searchText } = this.state.get();
        const defaults: Partial<LinkItem> = {};
        if (expandedPanel === "categories" && selectedCategory) defaults.category = selectedCategory;
        if (expandedPanel === "tags" && selectedTag) defaults.tags = [selectedTag];
        if (searchText.trim()) defaults.title = searchText.trim();
        return defaults;
    }

    private createLinkItem(link?: Partial<LinkItem>): LinkItem {
        const defaults = this.getLinkDefaults();
        const category = link?.category || defaults.category || "";
        const tags = link?.tags?.length ? link.tags : defaults.tags || [];
        const title = link?.title || defaults.title || "";
        return {
            id: crypto.randomUUID(),
            title,
            href: link?.href ?? "",
            category,
            tags,
            isDirectory: false,
            imgSrc: link?.imgSrc,
        };
    }

    /**
     * Import one or more ILink items into the collection.
     * Directories are scanned recursively; if the scan exceeds 100 files,
     * a confirmation dialog asks the user before proceeding.
     * Duplicate hrefs (already in collection) are skipped.
     */
    importLinks = async (
        items: ILink[],
        opts?: { moveExistingToCategory?: string },
    ): Promise<void> => {
        let movedCount = 0;
        const SCAN_LIMIT = 100;
        const onExistingMoved = (link: LinkItem, category: string): void => {
            const current = this.getLinkById(link.id);
            if (current && current.category !== category) {
                this.moveLinkToCategory(current.id, category);
                movedCount++;
            }
        };
        let prepared = await this.importer.prepare(
            items,
            this.state.get().data.links,
            opts?.moveExistingToCategory,
            onExistingMoved,
            SCAN_LIMIT,
        );

        if (prepared.limitReached) {
            const choice = await ui.confirm(
                t("links.importFolderLimit", { count: SCAN_LIMIT }),
                { title: t("links.importFolderTitle"), buttons: [IMPORT_ALL, DialogButton.cancel] },
            );
            if (choice !== IMPORT_ALL) return;
            prepared = await this.importer.prepare(
                items,
                this.state.get().data.links,
                opts?.moveExistingToCategory,
                onExistingMoved,
                0,
            );
        }

        const allLinks = prepared.links;

        if (!allLinks.length) {
            app.ui.notify(
                movedCount
                    ? t("links.movedLinks", { count: movedCount })
                    : t("links.allLinksAlreadyExist"),
                "info",
            );
            return;
        }

        this.collection.addMany(allLinks.map((link) => this.createLinkItem(link)));
        this.publish();

        if (allLinks.length > 1) {
            app.ui.notify(t("links.importedLinks", { count: allLinks.length }), "info");
        }
    };

    updateLink = (id: string, updates: Partial<Omit<LinkItem, "id">>): void => {
        this.collection.update(id, updates);
        this.publish();
    };

    deleteLink = async (id: string, skipConfirm = false): Promise<void> => {
        if (!skipConfirm) {
            const link = this.getLinkById(id);
            const label = link?.title || link?.href || t("links.thisLink");
            const bt = await ui.confirm(
                t("links.deleteLinkConfirmation", { label }),
                { title: t("links.deleteLinkTitle"), buttons: [DialogButton.delete, DialogButton.cancel] },
            );
            this.containerElement?.focus();
            if (bt !== DialogButton.delete) return;
        }
        this.collection.remove(id);
        this.publish();
    };

    getLinkById = (id: string): LinkItem | undefined => {
        return this.state.get().data.links.find((l) => l.id === id);
    };

    // ── Drag-and-drop ───────────────────────────────────────────────────

    moveLinkToCategory = (linkId: string, category: string): void => {
        if (!this.collection.moveToCategory(linkId, category)) return;
        this.publish();
    };

    moveCategory = async (fromCategory: string, toCategory: string): Promise<void> => {
        if (!fromCategory) return;
        if (fromCategory === toCategory) return;
        if (toCategory.startsWith(fromCategory + "/")) return;

        const leafName = fromCategory.split("/").pop() || "";
        const newCategory = toCategory ? `${toCategory}/${leafName}` : leafName;

        if (newCategory === fromCategory) return;

        const links = this.state.get().data.links;
        const count = links.filter(
            (l) => l.category === fromCategory || l.category.startsWith(fromCategory + "/"),
        ).length;

        const result = await ui.confirm(
            t("links.moveCategoryConfirmation", { count, ...{ fromCategory, toCategory: newCategory } }),
            { title: t("links.moveCategoryTitle"), buttons: [DialogButton.move, DialogButton.cancel] },
        );

        if (result !== DialogButton.move) return;

        this.collection.moveCategory(fromCategory, toCategory);
        this.publish((s) => {
            const sel = s.selectedCategory;
            if (sel === fromCategory) {
                s.selectedCategory = newCategory;
            } else if (sel.startsWith(fromCategory + "/")) {
                s.selectedCategory = newCategory + sel.slice(fromCategory.length);
            }
        });
    };

    // ── Pinned links ────────────────────────────────────────────────────

    isLinkPinned = (id: string): boolean => {
        return this.state.get().data.state.pinnedLinks?.includes(id) ?? false;
    };

    pinLink = (id: string): void => {
        this.collection.pin(id);
        this.publish();
    };

    unpinLink = (id: string): void => {
        this.collection.unpin(id);
        this.publish();
    };

    togglePinLink = (id: string): void => {
        if (this.isLinkPinned(id)) {
            this.unpinLink(id);
        } else {
            this.pinLink(id);
        }
    };

    reorderPinnedLink = (fromIndex: number, toIndex: number): void => {
        this.collection.reorderPinned(fromIndex, toIndex);
        this.publish();
    };

    getPinnedLinks = (): LinkItem[] => {
        const { data } = this.collection;
        const pinnedIds = data.state.pinnedLinks;
        if (!pinnedIds?.length) return [];
        const linkMap = new Map(data.links.map((l) => [l.id, l]));
        return pinnedIds.map((id) => linkMap.get(id)).filter(Boolean) as LinkItem[];
    };

    setPinnedPanelWidth = (width: number): void => {
        this.collection.setPinnedPanelWidth(width);
        this.publish();
    };

    // ── Edit Link dialog ────────────────────────────────────────────────

    showLinkDialog = async (linkId?: string): Promise<void> => {
        const state = this.state.get();
        const link = linkId ? state.data.links.find((l) => l.id === linkId) : undefined;

        const defaults: Partial<LinkItem> = link ? { ...link } : this.getLinkDefaults();

        const result = await showEditLinkDialog({
            title: link ? t("links.editLink") : t("links.addLink"),
            link: defaults,
            categories: state.categories,
            tags: state.tags,
            imageProxy: this.imageProxy,
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
                this.collection.add(newLink);
                this.publish();
            }
        }
    };

    toggleTag = (id: string, tag: string): void => {
        this.collection.toggleTag(id, tag);
        this.publish();
    };

    // ── Link opening ────────────────────────────────────────────────────

    /** Open a link clicked in a sidebar panel (Category tree / Tags-Hostnames
     *  bottom list). A single open path:
     *   - **Embedded (browser):** when an embedding is set (only the browser
     *     sets it), route through `openLink()` so the hook can force
     *     `target:"browser"` + `browserPageId` and navigate the empty tab (or a
     *     new tab when the current tab isn't blank / on Ctrl-click).
     *   - **Page:** dispatch `openRawLink` with the navigation metadata — opens
     *     the file in the page's main view and keeps the Link panels alive via
     *     `_isOpenedFromMe`. Matches the previous single-panel path. */
    openLinkFromPanel = (item: ILink, sourceId: string): void => {
        if (item.id) this.selectLink(item.id);
        if (this.embedding) {
            void this.openLink(item);
            return;
        }
        const navUrl = this.treeProvider?.getNavigationUrl(item) ?? item.href;
        const data = createLinkData(navUrl, {
            target: item.target || undefined,
            sourceId,
            category: item.category,
            // Seed the active tag filter so the player's Next/Random walks the
            // filtered list (e.g. only "pop" tracks). Without it the player reads
            // sourceLink.selectedTag === undefined and falls back to the full,
            // unfiltered link list. Mirrors navigateToTrack's re-propagation.
            ...(sourceId === "link-tag" ? { selectedTag: this.state.get().selectedTag } : undefined),
            ...(this.page ? { pageId: this.page.id, fallbackTarget: EditorId.monaco, title: item.title } : undefined),
        });
        void app.events.openRawLink.sendAsync(data);
    };

    openLink = async (link: ILink | { href: string; target?: string }): Promise<void> => {
        const url = link.href;
        if (!url) return;

        const linkData = createLinkData(url, { target: link.target || undefined });

        // Let owner (e.g., Browser) modify linkData before pipeline dispatch
        this.embedding?.adjustOpenLink(linkData);

        await app.events.openRawLink.sendAsync(linkData);
    };

    // ── Save / release / dispose ────────────────────────────────────────

    /** Delegate to host — same pattern as `confirmRelease` below. LinkEditor
     *  wraps a TextFileModel; edits flow through the host, so `host.modified`
     *  is the source of truth. Without this override, a demoted LinkEditor
     *  (sidebar-only, no main editor) would report `modified=false` and
     *  `page.close()` would skip the save prompt — the close loop reads
     *  `editor.modified` on each entry in `editors[]` and only the main-editor
     *  branch reads host-owned state through `contentHost`. */
    get modified(): boolean {
        return this._host ? this._host.modified : super.modified;
    }

    async saveState(): Promise<void> {
        // Flush pending debounced save before host's saveState
        this.onDataChanged();
        await super.saveState();
    }

    async dispose(): Promise<void> {
        // Flush pending debounced save (today's onDispose pattern)
        this.onDataChanged();

        this.treeProviderHost.dispose();
        this.containerElement = null;
        this.gridModel = null;
        await super.dispose();
    }
}
