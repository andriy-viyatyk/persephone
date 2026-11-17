import { t } from "../../../shared/i18n/t";
import { api } from "../../../ipc/renderer/api";
import { pages } from "../../api/pages";
import { appWindow } from "../../api/window";
import type { IEditorState, WindowPages } from "../../../shared/types";
import type { PageModel } from "../../api/pages/PageModel";
import type { EditorModelInstance as EditorModel } from "../../editors/base";
import { createFileTypeIconElement } from "../../components/icons/icon-elements";
import { ListBoxView } from "../../uikit/ListBox/ListBoxView";
import type { IListBoxItem, ListBoxProps } from "../../uikit/ListBox/types";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { displayPageTitle } from "../../editors/tab-title-registry";
import { boardIdentity } from "../../editors/board/board-identity";

export interface OpenTabsListProps {
    onClose?: () => void;
    open?: boolean;
}

interface OpenTabsListItem extends IListBoxItem {
    windowIndex: number;
    page?: Partial<IEditorState> & { boardRoot?: string; folderPath?: string };
}

/** The state fields a row renders. Selecting them keeps typing (content changes) from re-rendering the list. */
function selectRowFields(state: Partial<IEditorState> & { boardRoot?: string; folderPath?: string; props?: unknown }) {
    return {
        title: state.title,
        filePath: state.filePath,
        folderPath: state.folderPath,
        boardRoot: state.boardRoot,
        language: state.language,
        editor: state.editor,
        props: state.props,
    };
}

export class OpenTabsListView extends VanillaView<OpenTabsListProps> {
    private readonly list: ListBoxView<OpenTabsListItem>;
    private readonly onListChange = (item: OpenTabsListItem): void => this.onClick(item);
    private readonly onListActiveChange = (index: number): void => {
        this.activeIndex = index;
        this.updateList();
    };
    private readonly isListItemSelected = (item: OpenTabsListItem): boolean =>
        item.page?.id === pages.query.activePage?.id;
    private readonly getListItemTooltip = (item: OpenTabsListItem): string | undefined =>
        item.page?.filePath;
    private listProps: ListBoxProps<OpenTabsListItem> = {
        name: "sidebar-open-tabs",
        items: [],
        rowHeight: 22,
        activeIndex: null,
        onChange: this.onListChange,
        onActiveChange: this.onListActiveChange,
        isSelected: this.isListItemSelected,
        getTooltip: this.getListItemTooltip,
        emptyMessage: t("shell.noTabs"),
        variant: "browse",
    };
    private allWindowsPages: WindowPages[] = [];
    private activeIndex: number | null = null;
    private loadId = 0;
    private duplicateTimer: number | undefined;
    private previousOpen: boolean | undefined;
    private live = true;
    private readonly pageSubscriptions = new Map<PageModel, {
        editor: EditorModel | null;
        host: EditorModel["contentHost"];
        unsubscribe: () => void;
    }>();

    public constructor(props: OpenTabsListProps) {
        const list = new ListBoxView<OpenTabsListItem>({
            name: "sidebar-open-tabs",
            items: [],
            rowHeight: 22,
            emptyMessage: t("shell.noTabs"),
            variant: "browse",
        });
        super(props, list.root);
        this.list = list;
        this.list.update(this.listProps);
    }

    protected onMount(): void {
        this.child(this.list).mount();
        this.bind(pages.state, (state) => state.pages, () => {
            this.syncPageSubscriptions();
            this.updateList();
        });
        this.own(boardIdentity.onChanged((event) => {
            if (event.kind === "text") this.updateList();
        }));
        this.previousOpen = this.props.open;
        void this.loadWindowPages();
        this.updateList();
        this.syncPageSubscriptions();
        this.own(() => {
            this.live = false;
            for (const subscription of this.pageSubscriptions.values()) subscription.unsubscribe();
            this.pageSubscriptions.clear();
            if (this.duplicateTimer !== undefined) window.clearTimeout(this.duplicateTimer);
        });
    }

    protected onUpdate(props: OpenTabsListProps): void {
        if (props.open !== this.previousOpen) {
            this.previousOpen = props.open;
            void this.loadWindowPages();
        }
        this.updateList();
    }

    private async loadWindowPages(): Promise<void> {
        const loadId = ++this.loadId;
        const windowsPages = await api.getWindowPages();
        if (!this.live || loadId !== this.loadId) return;
        this.allWindowsPages = windowsPages;
        this.updateList();
    }

    private updateList(): void {
        const currentWindowIndex = appWindow.windowIndex;
        const state = pages.state.get();
        const currentPages: OpenTabsListItem[] = state.pages.map((page) => {
            const editor = page.mainEditor;
            const hostState = editor?.contentHost?.state.get();
            const pageState = {
                ...editor?.state.get(),
                ...hostState,
                title: page.title,
            };
            const pageData = { ...pageState, id: page.id } as Partial<IEditorState> & { boardRoot?: string; folderPath?: string };
            return this.item(currentWindowIndex, pageData);
        });

        const items: OpenTabsListItem[] = [this.section(currentWindowIndex), ...currentPages];
        const otherWindowsPages = this.allWindowsPages.filter(
            (windowPages) => windowPages.windowIndex !== currentWindowIndex,
        );
        for (const windowPages of otherWindowsPages) {
            items.push(this.section(windowPages.windowIndex));
            items.push(...windowPages.pages.map((descriptor) => {
                const main = descriptor.editors.find((editor) => editor.id === descriptor.mainEditorId);
                const pageState = (main?.state ?? {}) as Partial<IEditorState>;
                return this.item(windowPages.windowIndex, { ...pageState, id: descriptor.id });
            }));
        }

        const pageIds = items.flatMap((item) => item.page?.id ? [item.page.id] : []);
        if (new Set(pageIds).size !== pageIds.length) {
            if (this.duplicateTimer !== undefined) window.clearTimeout(this.duplicateTimer);
            this.duplicateTimer = window.setTimeout(() => {
                this.duplicateTimer = undefined;
                void this.loadWindowPages();
            }, 50);
        }

        if (this.listProps.items === items && this.listProps.activeIndex === this.activeIndex) return;
        // A new props object each time: ListBox finds what changed by comparing the previous props
        // object with the next one, so a mutated object looks unchanged and the rows go stale.
        this.listProps = { ...this.listProps, items, activeIndex: this.activeIndex };
        this.list.update(this.listProps);
    }

    private syncPageSubscriptions(): void {
        const currentPages = new Set(pages.state.get().pages);
        for (const [page, subscription] of this.pageSubscriptions) {
            if (currentPages.has(page)) continue;
            subscription.unsubscribe();
            this.pageSubscriptions.delete(page);
        }
        for (const page of currentPages) {
            const editor = page.mainEditor;
            const host = editor?.contentHost ?? null;
            const existing = this.pageSubscriptions.get(page);
            if (existing && editor === existing.editor && host === existing.host) continue;
            existing?.unsubscribe();
            const update = (): void => {
                this.syncPageSubscriptions();
                this.updateList();
            };
            const pageUnsubscribe = page.state.subscribe(() => {
                this.syncPageSubscriptions();
                this.updateList();
            }, (state) => state.mainEditorId);
            const editorUnsubscribe = editor?.state.subscribe(update, selectRowFields);
            const hostUnsubscribe = host?.state.subscribe(update, selectRowFields);
            const unsubscribe = (): void => {
                pageUnsubscribe();
                editorUnsubscribe?.();
                hostUnsubscribe?.();
            };
            this.pageSubscriptions.set(page, { editor, host, unsubscribe });
        }
    }

    private section(windowIndex: number): OpenTabsListItem {
        return {
            value: `window-${windowIndex}`,
            label: t("shell.windowSectionLabel", { window: windowIndex }),
            windowIndex,
            section: true,
        };
    }

    private item(windowIndex: number, page: Partial<IEditorState> & { boardRoot?: string; folderPath?: string }): OpenTabsListItem {
        return {
            value: page.id ?? `window-${windowIndex}`,
            label: displayPageTitle(page, { context: "sidebar" }),
            iconElement: createFileTypeIconElement({ language: page.language, width: 16, height: 16 }),
            windowIndex,
            page,
        };
    }

    private onClick(item: OpenTabsListItem): void {
        if (!item.page?.id) return;
        if (item.windowIndex === appWindow.windowIndex) {
            pages.navigation.showPage(item.page.id);
            return;
        }
        void api.showWindowPage(item.windowIndex, item.page.id);
        this.props.onClose?.();
    }
}
