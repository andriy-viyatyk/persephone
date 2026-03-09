import { SetStateAction } from "react";
import { debounce } from "../../../shared/utils";
import { parseObject } from "../../core/utils/parse-utils";
import { CellFocus, Column, TFilter } from "../../components/data-grid/AVGrid/avGridTypes";
import { AVGridModel } from "../../components/data-grid/AVGrid/model/AVGridModel";
import { pagesModel } from "../../api/pages";
import { resolveState } from "../../core/utils/utils";
import {
    createIdColumn,
    getGridDataWithColumns,
    getRowKey,
    idColumnKey,
    nextColumnKeys,
    removeIdColumn,
} from "./utils/grid-utils";
import { csvToRecords } from "../../core/utils/csv-utils";
import {
    defaultCompare,
    filterRows,
    rowsToCsvText,
} from "../../components/data-grid/AVGrid/avGridUtils";
import { TOnGetFilterOptions } from "../../components/data-grid/AVGrid/filters/useFilters";
import { ContentViewModel } from "../base/ContentViewModel";
import type { IContentHost } from "../base/IContentHost";

export const defaultGridViewState = {
    columns: [] as Column[],
    rows: [] as any[],
    focus: undefined as CellFocus | undefined,
    search: "",
    filters: [] as TFilter[],
    csvDelimiter: ",",
    csvWithColumns: false,
    error: undefined as string | undefined,
};

export type GridViewState = typeof defaultGridViewState;

export class GridViewModel extends ContentViewModel<GridViewState> {
    private name = "grid-page";
    gridRef: AVGridModel<any> | undefined = undefined;
    maxRowId = 0;
    private loaded = false;
    private changedContent = "";

    constructor(host: IContentHost) {
        super(host, defaultGridViewState);
    }

    protected onInit(): void {
        // Debounced save on any state change
        this.addSubscription(this.state.subscribe(() => {
            this.saveStateDebounced();
        }));

        // Page focus → restore scroll
        const sub = pagesModel.onFocus.subscribe(this.pageFocused);
        this.addSubscription(() => sub.unsubscribe());

        // Watch own CSV options → reload on change
        let lastDelimiter = this.state.get().csvDelimiter;
        let lastWithColumns = this.state.get().csvWithColumns;
        this.addSubscription(this.state.subscribe(() => {
            const { csvDelimiter, csvWithColumns } = this.state.get();
            if (csvDelimiter !== lastDelimiter || csvWithColumns !== lastWithColumns) {
                lastDelimiter = csvDelimiter;
                lastWithColumns = csvWithColumns;
                this.reload();
            }
        }));

        // Initial content load (parse with defaults first)
        const content = this.host.state.get().content || "";
        this.detectCsvDelimiter(content);
        this.loadGridData(content);
        this.loaded = true;

        // Restore merges on top asynchronously (Option A)
        this.restoreState();
    }

    protected onContentChanged(content: string): void {
        if (this.changedContent !== content) {
            this.updateGridDataFromContent(content);
            this.changedContent = content;
        }
    }

    protected onDispose(): void {
        // Flush any pending save
        this.saveState();
    }

    // ── Grid ref ────────────────────────────────────────

    setGridRef = (ref: AVGridModel<any> | null) => {
        this.gridRef = ref ?? undefined;
    };

    // ── State methods ───────────────────────────────────

    setFocus = (focus?: SetStateAction<CellFocus | undefined>) => {
        this.state.update((s) => {
            s.focus = focus ? resolveState(focus, () => s.focus) : undefined;
        });
    };

    setSearch = (search: string) => {
        this.state.update((s) => {
            s.search = search;
        });
    };

    clearSearch = () => {
        this.state.update((s) => {
            s.search = "";
        });
    };

    setFilters = (value: SetStateAction<TFilter[]>) => {
        this.state.update((s) => {
            s.filters = resolveState(value, () => this.state.get().filters);
        });
    };

    // ── Content parsing ─────────────────────────────────

    private detectCsvDelimiter = (content: string) => {
        if (this.host.state.get().editor !== "grid-csv") {
            return;
        }

        const firstLine: string =
            content.split("\n").slice(0, 5).join("") || "";
        const delimiters: string[] = [",", ";", "\t", "|"];
        let maxCount = 0;
        let detectedDelimiter = ",";

        for (const delim of delimiters) {
            const count: number = (
                firstLine.match(new RegExp("\\" + delim, "g")) || []
            ).length;
            if (count > maxCount) {
                maxCount = count;
                detectedDelimiter = delim;
            }
        }

        this.state.update((s) => {
            s.csvDelimiter = detectedDelimiter;
        });
    };

    reload = () => {
        const content = this.host.state.get().content || "";
        this.loadGridData(content);
    };

    private initEmptyPage = () => {
        const rows = createIdColumn([{}]);
        const columns: Column[] = [
            {
                key: "a",
                name: "a",
                dataType: "string",
                width: 100,
                resizible: true,
                filterType: "options",
            },
        ];
        this.maxRowId = rows.length;
        this.state.update((s) => {
            s.rows = rows;
            s.columns = columns;
        });
        Promise.resolve().then(() => {
            this.gridRef?.models.focus.focusCell(0, 0);
        });
    };

    loadGridData = (content: string) => {
        let rows: any[] = [];
        let columns: Column[] = [];
        if (content) {
            const parsed = this.parseContent(content);
            if (parsed) {
                const data = getGridDataWithColumns(parsed);
                rows = data.rows;
                columns = data.columns;
                this.maxRowId = data.rows.length;
            }
            this.state.update((s) => {
                s.rows = rows;
                s.columns = columns;
            });
            Promise.resolve().then(() => {
                this.gridRef?.models.focus.validateFocus();
            });
        } else {
            this.initEmptyPage();
        }
    };

    private updateGridDataFromContent = (content: string) => {
        let rows = this.parseContent(content ?? "[]");
        if (rows && Array.isArray(rows)) {
            rows = createIdColumn(rows);
            if (this.gridRef) {
                this.gridRef.models.focus.focusFromIndex = true;
            }
            this.state.update((s) => {
                s.rows = rows;
            });
        }
    };

    private parseContent = (content: string) => {
        let err: any = undefined;
        let res: any = undefined;
        const editor = this.host.state.get().editor;
        if (editor === "grid-csv") {
            const { csvDelimiter, csvWithColumns } = this.state.get();
            let rows = csvToRecords(
                content,
                csvWithColumns,
                csvDelimiter,
                (e) => (err = e),
            );
            if (Array.isArray(rows) && !csvWithColumns) {
                rows = rows.map((r) => ({ ...r }));
            }
            res = rows;
        } else if (editor === "grid-jsonl") {
            res = parseJsonl(content, (e) => (err = e));
        } else {
            res = parseObject(content, (e) => (err = e));
        }
        this.state.update((s) => {
            s.error = err ? err.message + "\n" + err.stack : undefined;
        });
        return res;
    };

    // ── Data mutation ───────────────────────────────────

    editRow = (columnKey: string, rowKey: string, value: any) => {
        this.state.update((s) => {
            const row = s.rows.find((r) => getRowKey(r) === rowKey);
            if (row) {
                (row as any)[columnKey] = value;
            }
        });
    };

    onAddRows = (count: number, insertIndex?: number) => {
        const newRows = Array.from({ length: count }, () => ({
            [idColumnKey]: (this.maxRowId++).toString(),
        }));
        this.state.update((s) => {
            if (insertIndex !== undefined) {
                s.rows.splice(insertIndex, 0, ...newRows);
            } else {
                s.rows.push(...newRows);
            }
        });
        return newRows;
    };

    onDeleteRows = (rowKeys: string[]) => {
        this.state.update((s) => {
            s.rows = s.rows.filter((r) => !rowKeys.includes(getRowKey(r)));
        });
    };

    setColumns = (columns: SetStateAction<Column[]>) => {
        const newColumns = resolveState(
            columns,
            () => this.state.get().columns,
        );
        this.state.update((s) => {
            s.columns = newColumns;
        });
    };

    onAddColumns = (count: number, insertBeforeKey?: string) => {
        const currentColumns = this.state.get().columns;
        const newColumns: Column[] = nextColumnKeys(currentColumns, count).map(
            (key) => ({
                key,
                name: key,
                dataType: "string",
                width: 100,
                resizible: true,
                filterType: "options",
            }),
        );
        let index = currentColumns.length;
        if (insertBeforeKey) {
            const foundIndex = currentColumns.findIndex(
                (c) => c.key === insertBeforeKey,
            );
            if (foundIndex >= 0) {
                index = foundIndex;
            }
        }
        this.state.update((s) => {
            s.columns.splice(index, 0, ...newColumns);
        });
        return newColumns;
    };

    onDeleteColumns = (columnKeys: (keyof any | string)[]) => {
        this.onUpdateRows((rows) => {
            return rows.map((row) => {
                const newRow = { ...row };
                for (const key of columnKeys) {
                    delete newRow[key];
                }
                return newRow;
            });
        });
        this.state.update((s) => {
            s.columns = s.columns.filter((c) => !columnKeys.includes(c.key));
        });
    };

    // ── Serialization ───────────────────────────────────

    private getJsonContent = () => {
        const { rows } = this.state.get();
        return JSON.stringify(removeIdColumn(rows), null, 4);
    };

    private getCsvContent = () => {
        const { rows, csvDelimiter, csvWithColumns } = this.state.get();
        const columns = this.state.get().columns;
        return rowsToCsvText(rows, columns, csvWithColumns, csvDelimiter);
    };

    private getJsonlContent = () => {
        const { rows } = this.state.get();
        return removeIdColumn(rows)
            .map((row) => JSON.stringify(row))
            .join("\n");
    };

    private getContentToSave = () => {
        const editor = this.host.state.get().editor;
        switch (editor) {
            case "grid-csv":
                return this.getCsvContent();
            case "grid-jsonl":
                return this.getJsonlContent();
            case "grid-json":
            default:
                return this.getJsonContent();
        }
    };

    onDataChanged = () => {
        const content = this.getContentToSave();
        this.changedContent = content;
        this.host.changeContent(content, true);
    };

    // ── Filter options ──────────────────────────────────

    onGetOptions: TOnGetFilterOptions = (
        columns: Column[],
        filters: TFilter[],
        columnKey: string,
        search?: string,
    ) => {
        const uniqueValues = new Set<any>();
        filterRows(
            this.state.get().rows,
            columns,
            search,
            filters?.filter((f) => f.columnKey !== columnKey),
        ).forEach((i) => uniqueValues.add(i[columnKey]));
        const options = Array.from(uniqueValues);
        options.sort(defaultCompare());
        return options.map((i) => ({
            value: i,
            label:
                i === undefined
                    ? "(undefined)"
                    : i === null
                      ? "(null)"
                      : i?.toString(),
            italic: i === undefined || i === null,
        }));
    };

    onUpdateRows = (updateFunc: (rows: any[]) => any[]) => {
        const rows = this.state.get().rows;
        const updatedRows = updateFunc(rows);
        if (updatedRows !== rows) {
            this.state.update((s) => {
                s.rows = updatedRows;
            });
            this.onDataChanged();
        }
    };

    get recordsCount() {
        const rows = this.state.get().rows.length;
        const visibleRows = this.gridRef?.data.rows.length ?? rows;
        return visibleRows === rows
            ? `${rows} rows`
            : `${visibleRows} of ${rows} rows`;
    }

    // ── CSV options ─────────────────────────────────────

    setDelimiter = (delimiter: string) => {
        this.state.update((s) => {
            s.csvDelimiter = delimiter;
        });
    };

    toggleWithColumns = () => {
        this.state.update((s) => {
            s.csvWithColumns = !s.csvWithColumns;
        });
    };

    // ── Page focus ──────────────────────────────────────

    pageFocused = (page?: any) => {
        if (
            page === this.host ||
            pagesModel.activePage === (this.host as any)
        ) {
            Promise.resolve().then(() => {
                this.gridRef?.renderModel?.restoreScroll();
            });
        }
    };

    // ── State persistence ───────────────────────────────

    saveState = async () => {
        const storage = this.host.stateStorage;
        if (!storage) return;

        const state = this.state.get();
        const columns = state.columns;
        const stateToSave = {
            columns: columns.map((c) => ({
                key: c.key,
                name: c.name,
                width: c.width,
                dataType: c.dataType,
                hidden: c.hidden,
            })),
            focus: {
                rowIndex: state.focus?.selection?.rowEnd,
                colIndex: state.focus?.selection?.colEnd,
            },
            search: state.search,
            filters: state.filters,
            sortColumn: this.gridRef?.state.get().sortColumn,
            csvDelimiter: state.csvDelimiter,
            csvWithColumns: state.csvWithColumns,
        };
        await storage.setState(this.host.id, this.name, JSON.stringify(stateToSave));
    };

    saveStateDebounced = debounce(this.saveState, 300);

    restoreState = async () => {
        const storage = this.host.stateStorage;
        if (!storage) return;

        const data = await storage.getState(this.host.id, this.name);
        const savedState = parseObject(data) || {};
        if (Array.isArray(savedState.columns)) {
            this.state.update((s) => {
                const existing = s.columns.filter((c) =>
                    savedState.columns.some((sc: any) => sc.key === c.key),
                );
                const savedColumns = savedState.columns.filter((sc: any) =>
                    existing.some((c) => c.key === sc.key),
                );
                const other = s.columns.filter(
                    (c) =>
                        !savedState.columns.some((sc: any) => sc.key === c.key),
                );
                const newColumns = [
                    ...savedColumns.map((c: any) => {
                        const existingColumn = existing.find(
                            (sc: any) => sc.key === c.key,
                        );
                        return {
                            ...existingColumn,
                            width: c.width,
                            dataType: c.dataType,
                            hidden: c.hidden,
                        };
                    }),
                    ...other,
                ];
                s.columns = newColumns;
            });
        }
        if (
            savedState.focus &&
            typeof savedState.focus.rowIndex === "number" &&
            typeof savedState.focus.colIndex === "number" &&
            this.gridRef
        ) {
            setTimeout(() => {
                this.gridRef?.models.focus.focusCell(
                    savedState.focus.rowIndex,
                    savedState.focus.colIndex,
                    true,
                );
            }, 0);
        }
        if (typeof savedState.search === "string") {
            this.state.update((s) => {
                s.search = savedState.search;
            });
        }
        if (Array.isArray(savedState.filters)) {
            this.state.update((s) => {
                s.filters = savedState.filters;
            });
        }
        if (savedState.sortColumn && this.gridRef) {
            this.gridRef.state.update((s) => {
                s.sortColumn = savedState.sortColumn;
            });
        }
        if (typeof savedState.csvDelimiter === "string") {
            this.state.update((s) => {
                s.csvDelimiter = savedState.csvDelimiter;
            });
        }
        if (typeof savedState.csvWithColumns === "boolean") {
            this.state.update((s) => {
                s.csvWithColumns = savedState.csvWithColumns;
            });
        }
    };
}

export function createGridViewModel(host: IContentHost): GridViewModel {
    return new GridViewModel(host);
}

function parseJsonl(content: string, onError: (e: Error) => void): any[] {
    const lines = content.split("\n");
    const result: any[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
            const parsed = JSON.parse(line);
            result.push(
                typeof parsed === "object" && parsed !== null
                    ? parsed
                    : { value: parsed },
            );
        } catch (e) {
            onError(new Error(`Line ${i + 1}: ${(e as Error).message}`));
            return result;
        }
    }
    return result;
}
