import { boardInstallRegistry } from "../../api/boards/board-install-registry";
import { t, untranslated } from "../../../shared/i18n/t";
import { publishedBoards, type PublishedBoardEntry } from "../../api/boards/published-boards";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { InputView } from "../../uikit/Input/InputView";
import { TagView } from "../../uikit/Tag/TagView";
import { claimViewOwnership, VanillaView, type IOwnedView } from "../../uikit/shared/vanilla-view";
import { KeyedList } from "../../uikit/shared/keyed-list";
import { openBoardInfoPage } from "../board-info/open-board-info";
import { BoardScreenshotView } from "../board-info/BoardScreenshotView";
import type { BoardUsageGroup } from "../../../shared/board/board-manifest-queries";
import { formatBytes } from "../../core/utils/format-bytes";
import "../../uikit/Button/Button.css";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/Input/Input.css";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Tag/Tag.css";
import "../../uikit/Text/Text.css";

const GROUP_ORDER: BoardUsageGroup[] = ["file-viewer", "file-editor", "tool"];
function groupLabel(group: BoardUsageGroup): string {
    if (group === "file-viewer") return t("tools.boardGroupViewers");
    if (group === "file-editor") return t("tools.boardGroupEditors");
    return t("tools.boardGroupTools");
}

interface BoardCardProps {
    entry: PublishedBoardEntry;
}

interface BoardGroupProps {
    group: BoardUsageGroup;
    entries: PublishedBoardEntry[];
    createCard: (props: BoardCardProps) => BoardCardView;
    releaseCard: (id: string, card: BoardCardView) => void;
}

type BoardGroupRoot = HTMLElement & { view?: BoardGroupView };

export class SearchBoardsTabView extends VanillaView<Record<string, never>> {
    private entries: PublishedBoardEntry[] = [];
    private query = "";
    private refreshing = false;
    private alive = false;

    private input: InputView | undefined;
    private refreshButton: IconButtonView | undefined;
    private content: HTMLDivElement | undefined;
    private groupsHost: HTMLDivElement | undefined;
    private emptyMessage: HTMLSpanElement | undefined;
    private groups: KeyedList<BoardGroupItem, BoardUsageGroup, HTMLElement> | undefined;
    private readonly cards = new Map<string, BoardCardView>();

    public constructor(props: Record<string, never>) {
        const root = createPanelElement({
            name: "search-boards-tab",
            direction: "column",
            flex: 1,
            minHeight: 0,
        });
        root.dataset.type = "search-boards-tab";
        super(props, root);
    }

    protected onMount(): void {
        this.alive = true;
        const toolbar = createPanelElement({
            direction: "row",
            align: "center",
            gap: "sm",
            paddingX: "lg",
            paddingBottom: "md",
            shrink: false,
        });
        this.input = this.child(new InputView(this.inputProps()));
        this.refreshButton = this.child(new IconButtonView(this.refreshButtonProps()));
        toolbar.append(this.input.root, this.refreshButton.root);

        this.content = createPanelElement({
            direction: "column",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            gap: "lg",
            paddingX: "lg",
            paddingBottom: "lg",
        });
        this.groupsHost = createPanelElement({ direction: "column", gap: "lg" });
        this.emptyMessage = createTextElement("", { size: "sm", color: "light" });
        this.emptyMessage.hidden = true;
        this.content.append(this.groupsHost, this.emptyMessage);
        this.root.append(toolbar, this.content);
        this.groups = new KeyedList<BoardGroupItem, BoardUsageGroup, HTMLElement>(this.groupsHost, {
            keyOf: (item) => item.group,
            create: (item) => this.createGroup(item),
            update: (element, item) => this.updateGroup(element, item),
            remove: (element) => this.removeGroup(element),
        });
        this.own(() => this.groups?.dispose());
        this.input.mount();
        this.refreshButton.mount();

        this.own(publishedBoards.subscribeCatalog(() => {
            if (this.alive) this.syncSources();
        }));
        this.own(boardInstallRegistry.subscribeInstalled(() => {
            if (this.alive) this.syncSources();
        }));
        this.syncSources();
        void Promise.all([publishedBoards.load(), boardInstallRegistry.load()]).then(() => {
            if (this.alive) this.syncSources();
        });
    }

    protected onDispose(): void {
        this.alive = false;
        this.cards.clear();
        this.content?.replaceChildren();
        this.groups = undefined;
        this.groupsHost = undefined;
        this.emptyMessage = undefined;
    }

    private inputProps() {
        return {
            name: "search-boards-filter",
            size: "sm" as const,
            value: this.query,
            onChange: (value: string) => this.setQuery(value),
            placeholder: t("tools.searchBoardsPlaceholder"),
            tone: this.query ? "accent" as const : "default" as const,
            maxWidth: 360,
        };
    }

    private refreshButtonProps() {
        return {
            name: "search-boards-refresh",
            size: "sm" as const,
            icon: "refresh" as const,
            title: t("tools.refreshCatalog"),
            disabled: this.refreshing,
            onClick: () => { void this.refresh(); },
        };
    }

    private setQuery(query: string): void {
        this.query = query;
        this.syncSources();
    }

    private async refresh(): Promise<void> {
        this.refreshing = true;
        this.refreshButton?.update(this.refreshButtonProps());
        try {
            await publishedBoards.refresh();
        } finally {
            if (this.alive) {
                this.refreshing = false;
                this.refreshButton?.update(this.refreshButtonProps());
            }
        }
    }

    private syncSources(): void {
        this.entries = publishedBoards.listEntries();
        this.input?.update(this.inputProps());
        this.renderCards();
    }

    private filteredEntries(): PublishedBoardEntry[] {
        const query = this.query.trim().toLowerCase();
        if (!query) return this.entries;
        return this.entries.filter(({ board, display }) => {
            const haystack = [
                display.name,
                display.description ?? "",
                board.name,
                board.description ?? "",
                ...(board.fileMasks ?? []),
            ].join(" ").toLowerCase();
            return haystack.includes(query);
        });
    }

    private groupEntries(entries: PublishedBoardEntry[]): Map<BoardUsageGroup, PublishedBoardEntry[]> {
        const groups = new Map<BoardUsageGroup, PublishedBoardEntry[]>();
        for (const entry of entries) {
            let groupEntries = groups.get(entry.usageGroup);
            if (!groupEntries) {
                groupEntries = [];
                groups.set(entry.usageGroup, groupEntries);
            }
            groupEntries.push(entry);
        }
        return groups;
    }

    private renderCards(): void {
        const groupsList = this.groups;
        const emptyMessage = this.emptyMessage;
        if (!groupsList || !emptyMessage) return;
        const filtered = this.filteredEntries();
        const groups = this.groupEntries(filtered);
        if (this.entries.length === 0) {
            groupsList.update([]);
            emptyMessage.textContent = t("tools.noPublishedBoards");
            emptyMessage.hidden = false;
            return;
        }
        if (filtered.length === 0) {
            groupsList.update([]);
            emptyMessage.textContent = t("tools.noBoardsMatch", { query: this.query });
            emptyMessage.hidden = false;
            return;
        }

        emptyMessage.hidden = true;
        groupsList.update(GROUP_ORDER.flatMap((group) => {
            const groupBoards = groups.get(group);
            return groupBoards ? [{ group, entries: groupBoards }] : [];
        }));
    }

    private createGroup(item: BoardGroupItem): HTMLElement {
        const view = new BoardGroupView(this.groupProps(item));
        claimViewOwnership(view);
        (view.root as BoardGroupRoot).view = view;
        view.mount();
        return view.root;
    }

    private updateGroup(element: HTMLElement, item: BoardGroupItem): void {
        (element as BoardGroupRoot).view?.update(this.groupProps(item));
    }

    private removeGroup(element: HTMLElement): void {
        const root = element as BoardGroupRoot;
        root.view?.dispose();
        delete root.view;
    }

    private groupProps(item: BoardGroupItem): BoardGroupProps {
        return {
            group: item.group,
            entries: item.entries,
            createCard: (props) => this.createCard(props),
            releaseCard: (id, card) => this.releaseCard(id, card),
        };
    }

    private createCard(props: BoardCardProps): BoardCardView {
        const card = this.child(new BoardCardView(props));
        this.cards.set(props.entry.board.id, card);
        card.mount();
        return card;
    }

    private releaseCard(id: string, card: BoardCardView): void {
        this.releaseChild(card);
        if (this.cards.get(id) === card) this.cards.delete(id);
    }
}

interface BoardGroupItem {
    group: BoardUsageGroup;
    entries: PublishedBoardEntry[];
}

class BoardGroupView extends VanillaView<BoardGroupProps> {
    private cards: KeyedList<PublishedBoardEntry, string, HTMLElement> | undefined;
    private readonly cardViews = new Map<HTMLElement, BoardCardView>();

    protected onMount(): void {
        const heading = createTextElement(groupLabel(this.props.group), { size: "sm", color: "light", bold: true });
        const cardsHost = createPanelElement({ direction: "column", gap: "sm" });
        this.root.append(heading, cardsHost);
        this.cards = new KeyedList<PublishedBoardEntry, string, HTMLElement>(cardsHost, {
            keyOf: (entry) => entry.board.id,
            create: (entry) => this.createCard(entry),
            update: (element, entry) => this.updateCard(element, entry),
            remove: (element, entry) => this.removeCard(element, entry),
        });
        this.own(() => this.cards?.dispose());
        this.sync(this.props);
    }

    protected onUpdate(props: BoardGroupProps): void {
        this.sync(props);
    }

    protected onDispose(): void {
        this.cardViews.clear();
        this.cards = undefined;
    }

    private sync(props: BoardGroupProps): void {
        this.cards?.update(props.entries);
    }

    private createCard(entry: PublishedBoardEntry): HTMLElement {
        const view = this.props.createCard({ entry });
        this.cardViews.set(view.root, view);
        return view.root;
    }

    private updateCard(element: HTMLElement, entry: PublishedBoardEntry): void {
        this.cardViews.get(element)?.update({ entry });
    }

    private removeCard(element: HTMLElement, entry: PublishedBoardEntry): void {
        const view = this.cardViews.get(element);
        if (view) this.props.releaseCard(entry.board.id, view);
        this.cardViews.delete(element);
    }
}

export class BoardCardView extends VanillaView<BoardCardProps> {
    private readonly screenshot: BoardScreenshotView;
    private details: HTMLDivElement | undefined;
    private detailsKey: string | undefined;
    private readonly conditionalChildren: IOwnedView[] = [];

    public constructor(props: BoardCardProps) {
        const root = createPanelElement({
            direction: "row",
            align: "start",
            gap: "md",
            padding: "md",
            border: true,
            rounded: "md",
        });
        root.dataset.type = "board-card";
        super(props, root);
        this.screenshot = new BoardScreenshotView({ url: props.entry.board.screenshotUrl });
    }

    protected onMount(): void {
        this.details = createPanelElement({ direction: "column", gap: "sm", flex: 1, minWidth: 0, align: "stretch" });
        this.child(this.screenshot);
        this.root.append(this.screenshot.root, this.details);
        this.screenshot.mount();
        this.sync(this.props);
    }

    protected onUpdate(props: BoardCardProps): void {
        this.sync(props);
    }

    protected onDispose(): void {
        this.conditionalChildren.length = 0;
        this.details?.replaceChildren();
    }

    private sync(props: BoardCardProps): void {
        const { entry } = props;
        const { board } = entry;
        this.screenshot.update({ url: board.screenshotUrl });
        const details = this.details;
        if (!details) return;
        const { display, installed, update, compatible } = entry;
        const { id, version, fileMasks, minAppVersion, archive: { size } } = board;
        if (this.detailsKey === entry.detailsKey) return;
        this.detailsKey = entry.detailsKey;
        this.clearConditionalChildren();
        details.replaceChildren();
        const header = createPanelElement({ direction: "row", align: "center", gap: "sm" });
        header.append(
            createTextElement(display.name, { bold: true }),
            createTextElement(untranslated(`v${version}`), { size: "sm", color: "light" }),
            createTextElement(formatBytes(size), { size: "sm", color: "light" }),
            createPanelElement({ flex: 1, minWidth: 0 }),
        );
        if (installed && update) {
            this.addChild(header, new TagView({
                label: t("tools.updateAvailable"),
                size: "sm",
                title: t("tools.updateToVersion", { version: update.latestVersion }),
            }));
        } else if (installed) {
            this.addChild(header, new TagView({
                label: t("tools.installedVersion", { version: installed.version }),
                size: "sm",
                variant: "outlined",
            }));
        }
        details.append(header);

        if (display.description) {
            details.append(createTextElement(display.description, { size: "sm" }));
        }

        if (fileMasks && fileMasks.length > 0) {
            const masks = createPanelElement({ direction: "row", wrap: true, gap: "xs", align: "center" });
            masks.append(createTextElement(t("tools.boardFiles"), { size: "sm", color: "light" }));
            for (const mask of fileMasks) {
                this.addChild(masks, new TagView({ label: mask, size: "sm", variant: "outlined" }));
            }
            details.append(masks);
        }

        if (!compatible) {
            details.append(createTextElement(t("tools.requiresPersephone", { product: untranslated("Persephone"), version: minAppVersion }), {
                size: "sm",
                color: "warning",
            }));
        }

        const actions = createPanelElement({ direction: "row", gap: "sm", align: "center" });
        if (!installed) {
            this.addChild(actions, new ButtonView({
                size: "sm",
                disabled: !compatible,
                onClick: () => this.openInstall(id),
                children: t("tools.install"),
            }));
        } else {
            if (update) {
                this.addChild(actions, new ButtonView({
                    size: "sm",
                        onClick: () => this.openProperties(installed.root),
                    children: t("tools.update"),
                }));
            }
            this.addChild(actions, new ButtonView({
                size: "sm",
                variant: "ghost",
                onClick: () => this.openProperties(installed.root),
                children: t("tools.properties"),
            }));
        }
        details.append(actions);
    }

    private addChild<T extends IOwnedView & { mount(): HTMLElement }>(parent: HTMLElement, view: T): T {
        const child = this.child(view);
        this.conditionalChildren.push(child);
        parent.append(child.root);
        child.mount();
        return child;
    }

    private clearConditionalChildren(): void {
        for (const child of this.conditionalChildren.splice(0)) this.releaseChild(child);
    }

    private openInstall(catalogId: string): void {
        void openBoardInfoPage({ catalogId });
    }

    private openProperties(boardRoot: string): void {
        void openBoardInfoPage({ boardRoot });
    }
}
