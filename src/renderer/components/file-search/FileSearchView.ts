import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { InputView } from "../../uikit/Input/InputView";
import { PooledRowHost } from "../../uikit/shared/pooled-row-host";
import type { RowAdapter } from "../../uikit/shared/pooled-row-host";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { Cleanup } from "../../core/utils/DisposableStore";
import { t } from "../../../shared/i18n/t";
import { subscribeFileIconElements } from "../icons/icon-elements";
import type { FileSearchProps } from "./FileSearch";
import { FileSearchRowView } from "./FileSearchRowView";
import {
    FileSearchModel,
    type FileSearchInternalState,
    type SearchResultRow,
} from "./FileSearchModel";
import "./FileSearch.css";

const ROW_HEIGHT = 22;
const FULL_WIDTH = () => "100%" as `${number}%`;

type ChromeState = Pick<
    FileSearchInternalState,
    | "query"
    | "includePattern"
    | "excludePattern"
    | "showFilters"
    | "isSearching"
    | "filesSearched"
    | "totalMatches"
    | "totalFiles"
    | "truncated"
>;

interface ResultsProjection {
    resultsVersion: number;
    firstChangedRow: number;
}

/** Native owner for the file-search shell and its pooled result rows. */
export class FileSearchView extends VanillaView<FileSearchProps> {
    private readonly model: FileSearchModel;
    private readonly inputArea = document.createElement("div");
    private readonly queryRow = document.createElement("div");
    private readonly statusHost = document.createElement("div");
    private readonly resultsHost = document.createElement("div");
    private readonly gridHost = document.createElement("div");
    private readonly emptyHost = document.createElement("div");
    private readonly queryInput: InputView;
    private readonly includeInput: InputView;
    private readonly excludeInput: InputView;
    private readonly filterButton: IconButtonView;
    private filtered: SearchResultRow[] = [];
    private pooledRows: PooledRowHost<"row", FileSearchRowView> | undefined;
    private queryField: HTMLInputElement | undefined;
    private focusFrame: Cleanup | undefined;
    private iconSubscription: (() => void) | undefined;

    public constructor(props: FileSearchProps) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "file-search";

        this.model = new FileSearchModel(props.folder, props.state, props.onStateChange);
        this.iconSubscription = subscribeFileIconElements(() => {
            // The shared file-icon projection is globally invalidated, and this view has no
            // per-path dirty set for the visible results.
            this.pooledRows?.repaint({ all: true });
        });
        this.own(() => this.iconSubscription?.());
        this.own(() => this.pooledRows?.dispose());
        this.own(() => this.model.dispose());

        const state = this.model.state.get();
        this.queryInput = this.child(new InputView({
            value: state.query,
            placeholder: t("menus.searchPlaceholder"),
            onChange: this.model.setQuery,
            onKeyDown: this.onQueryKeyDown,
            tone: "accent",
        }));
        this.includeInput = this.child(new InputView({
            value: state.includePattern,
            placeholder: t("menus.includeExtensionsPlaceholder"),
            onChange: this.model.setIncludePattern,
        }));
        this.excludeInput = this.child(new InputView({
            value: state.excludePattern,
            // node_modules and .git come from the search-exclude setting, so naming one here
            // would imply the field is what excludes it.
            placeholder: t("menus.excludePatternsPlaceholder"),
            onChange: this.model.setExcludePattern,
        }));
        this.filterButton = this.child(new IconButtonView({
            size: "sm",
            title: t("menus.toggleFilters"),
            onClick: this.model.toggleFilters,
            icon: state.showFilters ? "filter-arrow-up" : "filter-arrow-down",
        }));

        this.gridHost.style.display = "contents";
        this.emptyHost.className = "fs-empty";
        this.emptyHost.textContent = t("menus.noResultsFound");
        this.statusHost.className = "fs-status";
        this.resultsHost.className = "fs-results";
        this.inputArea.className = "fs-input-area";
        this.queryRow.className = "fs-query-row";
        this.includeInput.root.classList.add("fs-filter-input");
        this.excludeInput.root.classList.add("fs-filter-input");
    }

    protected onMount(): void {
        this.queryRow.append(this.queryInput.root, this.filterButton.root);
        this.inputArea.append(this.queryRow, this.includeInput.root, this.excludeInput.root);
        this.resultsHost.append(this.gridHost, this.emptyHost);
        this.root.append(this.inputArea, this.statusHost, this.resultsHost);

        this.pooledRows = new PooledRowHost(this, this.gridHost, this.rowAdapter(), {
            grid: {
                columnCount: 1,
                rowHeight: ROW_HEIGHT,
                columnWidth: FULL_WIDTH,
                fitToWidth: true,
            },
            hostParent: this.resultsHost,
            hostBefore: this.emptyHost,
        });

        this.queryInput.mount();
        this.queryField = this.queryInput.inputElement;
        this.includeInput.mount();
        this.excludeInput.mount();
        this.filterButton.mount();

        this.bind(this.model.state, (state) => ({
            query: state.query,
            includePattern: state.includePattern,
            excludePattern: state.excludePattern,
            showFilters: state.showFilters,
            isSearching: state.isSearching,
            filesSearched: state.filesSearched,
            totalMatches: state.totalMatches,
            totalFiles: state.totalFiles,
            truncated: state.truncated,
        }), this.applyChrome);
        this.bind(this.model.state, (state): ResultsProjection => ({
            resultsVersion: state.resultsVersion,
            firstChangedRow: state.firstChangedRow,
        }), (projection) => {
            const previousRowCount = this.filtered.length;
            this.filtered = this.model.getFilteredResults();
            this.applyArm(this.model.state.get());
            const rows = Array.from(
                { length: Math.max(0, this.filtered.length - projection.firstChangedRow) },
                (_, offset) => projection.firstChangedRow + offset,
            );
            if (import.meta.env.DEV && previousRowCount === this.filtered.length && rows.length === 0) {
                console.warn("FileSearch resultsVersion changed without a published changed row");
            }
            this.pooledRows?.repaint({ rows });
        });

        this.focusFrame = this.schedule.raf(() => {
            this.focusFrame = undefined;
            this.queryField?.focus();
        });
        this.own(() => {
            this.focusFrame?.();
            this.focusFrame = undefined;
        });
    }

    /** Props are lifetime inputs; unrelated parent renders must not touch the grid. */
    protected onUpdate(_props: FileSearchProps): void {}

    protected onDispose(): void {
    }

    private readonly onQueryKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Enter") {
            event.preventDefault();
            this.model.triggerSearch();
        } else if (event.key === "Escape") {
            event.preventDefault();
            const query = this.model.state.get().query;
            if (query) this.model.setQuery("");
            else this.queryField?.blur();
        }
    };

    private readonly applyChrome = (state: ChromeState): void => {
        this.queryInput.update({
            value: state.query,
            placeholder: t("menus.searchPlaceholder"),
            onChange: this.model.setQuery,
            onKeyDown: this.onQueryKeyDown,
            tone: "accent",
        });
        this.includeInput.update({
            value: state.includePattern,
            placeholder: t("menus.includeExtensionsPlaceholder"),
            onChange: this.model.setIncludePattern,
        });
        this.excludeInput.update({
            value: state.excludePattern,
            placeholder: t("menus.excludePatternsPlaceholder"),
            onChange: this.model.setExcludePattern,
        });
        this.includeInput.root.toggleAttribute("data-hidden", !state.showFilters);
        this.excludeInput.root.toggleAttribute("data-hidden", !state.showFilters);
        this.filterButton.update({
            size: "sm",
            title: t("menus.toggleFilters"),
            onClick: this.model.toggleFilters,
            icon: state.showFilters ? "filter-arrow-up" : "filter-arrow-down",
        });

        const status = this.statusText(state);
        this.statusHost.textContent = status;
        this.statusHost.toggleAttribute("data-empty", !status);
        this.applyArm(state);
    };

    private statusText(state: ChromeState): string {
        if (state.isSearching) return t("menus.searchingFiles", { count: state.filesSearched });
        if (!state.query.trim()) return "";
        if (state.totalFiles === 0) return t("menus.noResults");
        const text = state.truncated
            ? t("menus.truncatedResultSummary", {
                matches: state.totalMatches,
                count: state.totalFiles,
            } as never)
            : t("menus.resultSummary", { matches: state.totalMatches, count: state.totalFiles } as never);
        return text;
    }

    private applyArm(state: Pick<FileSearchInternalState, "query" | "isSearching">): void {
        if (this.filtered.length > 0) {
            this.pooledRows?.enter();
        } else {
            this.pooledRows?.leave();
        }

        const showEmpty = Boolean(this.filtered.length === 0 && state.query.trim() && !state.isSearching);
        this.emptyHost.toggleAttribute("data-hidden", !showEmpty);
    }

    private rowAdapter(): RowAdapter<"row", FileSearchRowView> {
        return {
            events: ["click"],
            rowCount: () => this.filtered.length,
            kindFor: (row) => this.filtered[row] ? "row" : undefined,
            create: (_kind, row, _col, wrapper) => {
                const result = this.filtered[row];
                if (!result) throw new Error(`FileSearch row ${row} is missing`);
                return new FileSearchRowView(wrapper, {
                    row: result,
                    onToggleExpanded: this.model.toggleFileExpanded,
                });
            },
            update: (view, row) => {
                const result = this.filtered[row];
                if (result) view.update({ row: result, onToggleExpanded: this.model.toggleFileExpanded });
            },
            onRowEvent: (_type, row) => {
                const result = this.filtered[row];
                if (!result) return;
                if (result.type === "file") this.props.onResultClick?.(result.filePath);
                else this.props.onResultClick?.(result.filePath, result.lineNumber);
            },
        };
    }
}
