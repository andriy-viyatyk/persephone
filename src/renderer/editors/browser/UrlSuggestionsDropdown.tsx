import React, { useEffect, useMemo, useRef } from "react";
import { Popover, Panel, Text, Button, Spacer, ListBox } from "../../uikit";
import type { IListBoxItem, ListBoxRef } from "../../uikit";

export type SuggestionsMode = "search" | "navigation";

export interface UrlSuggestionsDropdownProps {
    anchorEl: Element | null;
    open: boolean;
    items: string[];
    mode: SuggestionsMode;
    searchText?: string;
    hoveredIndex: number;
    onHoveredIndexChange: (index: number) => void;
    onSelect: (value: string) => void;
    onClearVisible?: () => void;
}

export function UrlSuggestionsDropdown({
    anchorEl,
    open,
    items,
    mode,
    searchText,
    hoveredIndex,
    onHoveredIndexChange,
    onSelect,
    onClearVisible,
}: UrlSuggestionsDropdownProps) {
    const listBoxRef = useRef<ListBoxRef | null>(null);

    const listItems = useMemo<IListBoxItem[]>(
        () => items.map((s) => ({ value: s, label: s })),
        [items],
    );

    useEffect(() => {
        if (hoveredIndex < 0) return;
        listBoxRef.current?.scrollToIndex(hoveredIndex);
    }, [hoveredIndex]);

    const isOpen = open && anchorEl != null && items.length > 0;
    const showClear = mode === "search" && onClearVisible != null;
    const headerLabel = mode === "search" ? "Search History" : "Navigation History";

    return (
        <Popover
            open={isOpen}
            elementRef={anchorEl}
            placement="bottom-start"
            offset={[0, 2]}
            matchAnchorWidth
            onMouseDown={(e) => e.preventDefault()}
        >
            <Panel direction="row" align="center" paddingY="sm" paddingX="md">
                <Text size="xs" color="light">{headerLabel}</Text>
                <Spacer />
                {showClear && (
                    <Button size="sm" variant="ghost" onClick={onClearVisible}>
                        Clear
                    </Button>
                )}
            </Panel>
            <ListBox
                ref={listBoxRef}
                items={listItems}
                activeIndex={hoveredIndex}
                onActiveChange={onHoveredIndexChange}
                onChange={(value) => onSelect(value as string)}
                searchText={mode === "search" ? searchText : undefined}
                keyboardNav={false}
                growToHeight={400}
            />
        </Popover>
    );
}
