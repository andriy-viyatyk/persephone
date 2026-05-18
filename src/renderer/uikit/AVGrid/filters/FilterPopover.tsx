import { useCallback, useEffect, useState } from "react";
import styled from "@emotion/styled";

import { TOnGetFilterOptions, useFilters } from "./useFilters";
import { TFilter, TOptionsFilter } from "../avGridTypes";
import { useAVGridContext } from "../useAVGridContext";
import { OptionsFilterContent } from "./OptionsFilterContent";
import { Popover } from "../../Popover";

const ContentRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
});

const minWidth = 184;

interface FilterContentProps {
    filter: TFilter;
    onApplyFilter: (filter: TFilter) => void;
    onGetOptions: TOnGetFilterOptions;
    width?: number;
    resized?: boolean;
}

function FilterContent(props: FilterContentProps) {
    const { filter, onApplyFilter, onGetOptions, width, resized } = props;
    const model = useAVGridContext();
    const filterType =
        model.data.columns.find((c) => c.key === filter.columnKey)?.filterType ??
        filter.type;

    switch (filterType) {
        case "options":
            return (
                <OptionsFilterContent
                    filter={filter as TOptionsFilter}
                    onApplyFilter={onApplyFilter}
                    onGetOptions={onGetOptions}
                    width={width}
                    columnFilterType={filterType}
                    resized={resized}
                />
            );
        default:
            return null;
    }
}

export function FilterPopover() {
    const { poperData, onGetOptions } = useFilters();
    const [resized, setResized] = useState(false);

    useEffect(() => {
        setResized(false);
    }, [poperData]);

    const onApplyFilter = useCallback(
        (filter: TFilter) => {
            poperData?.onApplyFilter(filter);
            poperData?.closeFilterPoper();
        },
        [poperData]
    );

    if (!poperData) {
        return null;
    }
    const { filter, position, anchorEl, adjustPosition, closeFilterPoper } =
        poperData;

    return (
        <Popover
            name="avgrid-filter-popover"
            open
            elementRef={anchorEl}
            x={position?.x}
            y={position?.y}
            placement="bottom-start"
            onClose={closeFilterPoper}
            offset={
                adjustPosition
                    ? [adjustPosition.x, adjustPosition.y]
                    : undefined
            }
            resizable
            onResize={() => {
                setResized(true);
            }}
        >
            <ContentRoot>
                <FilterContent
                    filter={filter}
                    onApplyFilter={onApplyFilter}
                    onGetOptions={onGetOptions}
                    width={Math.max(minWidth, anchorEl?.clientWidth ?? 0)}
                    resized={resized}
                />
            </ContentRoot>
        </Popover>
    );
}
