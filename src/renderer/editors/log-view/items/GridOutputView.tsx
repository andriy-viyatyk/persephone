import { useMemo, useCallback, SetStateAction } from "react";
import styled from "@emotion/styled";
import { GridOutputEntry } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogHeader } from "./DialogHeader";
import { getGridDataWithColumns, getRowKey } from "../../grid/utils/grid-utils";
import type { GridColumn } from "../../grid/utils/grid-utils";
import { Column, CellFocus } from "../../../components/data-grid/AVGrid/avGridTypes";
import AVGrid from "../../../components/data-grid/AVGrid/AVGrid";
import { Button } from "../../../components/basic/Button";
import { OpenLinkIcon } from "../../../theme/icons";
import { pagesModel } from "../../../api/pages";
import { isTextFileModel } from "../../text/TextPageModel";
import { DIALOG_CONTENT_MAX_HEIGHT } from "../logConstants";
import { resolveState } from "../../../core/utils/utils";
import color from "../../../theme/color";

// =============================================================================
// Helpers
// =============================================================================

function normalizeColumns(columns?: (string | GridColumn)[]): GridColumn[] | undefined {
    if (!columns || columns.length === 0) return undefined;
    return columns.map(c => typeof c === "string" ? { key: c } : c);
}

/** Merge saved column state (widths, order) with detected columns. */
function mergeColumnsWithSaved(detected: Column[], saved?: any[]): Column[] {
    if (!saved || saved.length === 0) return detected;

    // Build a map of saved column data by key
    const savedMap = new Map<string, any>();
    for (const sc of saved) {
        if (sc && sc.key) savedMap.set(sc.key as string, sc);
    }

    // Reorder: put saved columns first (in saved order), then any new detected ones
    const result: Column[] = [];
    for (const sc of saved) {
        const det = detected.find(c => c.key === sc.key);
        if (det) {
            result.push({ ...det, width: sc.width ?? det.width });
        }
    }
    for (const det of detected) {
        if (!savedMap.has(det.key as string)) {
            result.push(det);
        }
    }
    return result;
}

// =============================================================================
// Styled Components
// =============================================================================

const GridOutputRoot = styled.div({
    position: "relative",
    border: "1px solid",
    borderColor: color.border.default,
    borderRadius: 4,
    margin: "2px 0",
    overflow: "hidden",
    width: "fit-content",
    maxWidth: "100%",

    "& .grid-hover-actions": {
        position: "absolute",
        top: 4,
        right: 4,
        opacity: 0,
        transition: "opacity 0.15s",
        zIndex: 1,
    },

    "&:hover .grid-hover-actions": {
        opacity: 1,
    },
});

// =============================================================================
// Component
// =============================================================================

interface GridOutputViewProps {
    entry: GridOutputEntry;
}

export function GridOutputView({ entry }: GridOutputViewProps) {
    const vm = useLogViewModel();
    const itemState = vm.state.use(s => s.itemsState[entry.id] ?? {});

    // Detect columns from data + entry.columns overrides
    const baseGridData = useMemo(
        () => getGridDataWithColumns(entry.data, normalizeColumns(entry.columns)),
        [entry.data, entry.columns],
    );

    // Merge with saved column state (widths, order)
    const columns = useMemo(
        () => mergeColumnsWithSaved(baseGridData.columns, itemState.columns),
        [baseGridData.columns, itemState.columns],
    );

    const focus = itemState.focus as CellFocus | undefined;

    const setColumns = useCallback(
        (value: SetStateAction<Column[]>) => {
            const newColumns = resolveState(value, () => columns);
            const toSave = newColumns.map(c => ({ key: c.key, width: c.width }));
            vm.setItemState(entry.id, { columns: toSave });
        },
        [vm, entry.id, columns],
    );

    const setFocus = useCallback(
        (value: SetStateAction<CellFocus | undefined>) => {
            const newFocus = resolveState(value, () => focus);
            vm.setItemState(entry.id, { focus: newFocus });
        },
        [vm, entry.id, focus],
    );

    const handleOpenInGrid = useCallback(() => {
        const title = typeof entry.title === "string" ? entry.title : "Grid Data";
        const page = pagesModel.addEditorPage("grid-json", "json", title);
        if (isTextFileModel(page)) {
            page.changeContent(JSON.stringify(entry.data, null, 2));
        }
    }, [entry.data, entry.title]);

    return (
        <GridOutputRoot>
            <DialogHeader title={entry.title} />
            <AVGrid
                columns={columns}
                setColumns={setColumns}
                rows={baseGridData.rows}
                getRowKey={getRowKey}
                focus={focus}
                setFocus={setFocus}
                growToHeight={DIALOG_CONTENT_MAX_HEIGHT}
                growToWidth="100%"
                readonly
                disableFiltering
            />
            <div className="grid-hover-actions">
                <Button size="small" type="icon" onClick={handleOpenInGrid} title="Open in Grid editor">
                    <OpenLinkIcon />
                </Button>
            </div>
        </GridOutputRoot>
    );
}
