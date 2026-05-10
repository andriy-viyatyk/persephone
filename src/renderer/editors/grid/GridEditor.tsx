import { getRowKey } from "./utils/grid-utils";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import AVGrid from "../../components/data-grid/AVGrid/AVGrid";
import { FiltersProvider } from "../../components/data-grid/AVGrid/filters/useFilters";
import { FilterBar } from "../../components/data-grid/AVGrid/filters/FilterBar";
import { createPortal } from "react-dom";
import { Panel } from "../../uikit/Panel";
import { Input } from "../../uikit/Input";
import { IconButton } from "../../uikit/IconButton";
import { Button } from "../../uikit/Button";
import { CloseIcon, ColumnsIcon } from "../../theme/icons";
import { showColumnsOptions } from "./components/ColumnsOptions";
import { GridViewModel, defaultGridViewState, GridViewState } from "./GridViewModel";
import { showCsvOptions } from "./components/CsvOptions";
import { useEditorConfig } from "../base";
import { EditorError } from "../base/EditorError";
import { useContentViewModel } from "../base/useContentViewModel";
import { TextFileModel } from "../text";
import type { EditorView } from "../../../shared/types";

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultGridViewState;

interface GridEditorProps {
    model: TextFileModel;
}

export function GridEditor({ model }: GridEditorProps) {
    const editorId = model.state.get().editor as EditorView;
    const vm = useContentViewModel<GridViewModel>(model, editorId);
    const editorConfig = useEditorConfig();
    const [, setRefresh] = useState(0);

    // Auto-focus grid after mount (unless disabled by editor config)
    useEffect(() => {
        if (vm && !editorConfig.disableAutoFocus) {
            vm.gridRef?.focusGrid();
        }
    }, [vm]);

    const onVisibleRowsChanged = useCallback(() => {
        Promise.resolve().then(() => {
            setRefresh(new Date().getTime());
        });
    }, []);

    // Always call hooks unconditionally (Rules of Hooks).
    // When vm is null (loading), subscribe to a no-op and return defaults.
    const gridState: GridViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    if (!vm) return null;

    if (gridState.error) {
        return <EditorError>{gridState.error}</EditorError>;
    }

    return (
        <>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <Input
                        size="sm"
                        value={gridState.search}
                        onChange={vm.setSearch}
                        placeholder="Search..."
                        endSlot={
                            gridState.search ? (
                                <IconButton
                                    size="sm"
                                    title="Clear Search"
                                    icon={<CloseIcon />}
                                    onClick={vm.clearSearch}
                                />
                            ) : undefined
                        }
                    />,
                    model.editorToolbarRefLast
                )}
            {Boolean(model.editorToolbarRefFirst) &&
                createPortal(
                    <>
                        <IconButton
                            size="sm"
                            title="Edit Columns"
                            icon={<ColumnsIcon />}
                            onClick={(e) => {
                                if (vm.gridRef) {
                                    showColumnsOptions(
                                        e.currentTarget,
                                        vm.gridRef,
                                        editorId === "grid-csv",
                                        vm.onUpdateRows
                                    );
                                }
                            }}
                        />
                        {editorId === "grid-csv" && (
                            <Button
                                size="sm"
                                variant="ghost"
                                title="Csv Options"
                                onClick={(e) => showCsvOptions(e.currentTarget, vm)}
                            >
                                ⚒-csv
                            </Button>
                        )}
                    </>,
                    model.editorToolbarRefFirst
                )}
            <Panel
                direction="column"
                flex={1}
                position="relative"
                height={editorConfig.maxEditorHeight !== undefined ? "fit-content" : 200}
            >
                <FiltersProvider
                    filters={gridState.filters}
                    setFilters={vm.setFilters}
                    onGetOptions={vm.onGetOptions}
                >
                    <FilterBar
                        className="filter-bar"
                        gridModel={vm.gridRef}
                    />
                    <AVGrid
                        ref={vm.setGridRef}
                        columns={gridState.columns}
                        rows={gridState.rows}
                        getRowKey={getRowKey}
                        focus={gridState.focus}
                        setFocus={vm.setFocus}
                        searchString={gridState.search}
                        highlightString={editorConfig.highlightText}
                        filters={gridState.filters}
                        onVisibleRowsChanged={onVisibleRowsChanged}
                        editRow={vm.editRow}
                        onAddRows={vm.onAddRows}
                        setColumns={vm.setColumns}
                        onAddColumns={vm.onAddColumns}
                        onDeleteRows={vm.onDeleteRows}
                        onDeleteColumns={vm.onDeleteColumns}
                        onDataChanged={vm.onDataChanged}
                        growToHeight={editorConfig.maxEditorHeight}
                    />
                </FiltersProvider>
            </Panel>
            {Boolean(model.editorFooterRefLast) &&
                createPortal(
                    <span className="records-count">
                        {vm.recordsCount}
                    </span>,
                    model.editorFooterRefLast
                )}
        </>
    );
}

const moduleExport = {
    Editor: GridEditor,
};

export default moduleExport;

// Re-export with old name for backward compatibility
export { GridEditor as GridPage };
