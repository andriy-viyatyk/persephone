import styled from "@emotion/styled";
import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import {
    useFloating,
    offset,
    flip,
    size,
    autoUpdate,
    useMergeRefs,
} from "@floating-ui/react";
import clsx from "clsx";
import color from "../../theme/color";
import { highlightText } from "../../components/basic/useHighlightedText";

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

const DropdownRoot = styled.div({
    backgroundColor: color.background.default,
    border: `1px solid ${color.border.default}`,
    borderRadius: 6,
    boxShadow: color.shadow.default,
    overflowY: "auto",
    zIndex: 1000,

    "& .suggestions-header": {
        display: "flex",
        alignItems: "center",
        padding: "4px 8px",
        fontSize: 11,
        color: color.text.light,
        userSelect: "none",
        "& .header-label": {
            flex: 1,
        },
        "& .clear-btn": {
            cursor: "pointer",
            padding: "0 4px",
            borderRadius: 3,
            "&:hover": {
                color: color.text.default,
                backgroundColor: color.background.light,
            },
        },
    },

    "& .suggestion-item": {
        padding: "4px 8px",
        cursor: "pointer",
        fontSize: 13,
        lineHeight: "20px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        "&.hovered": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },
        "& .highlighted-text": {
            fontWeight: 600,
        },
    },
});

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
    const scrollRef = useRef<HTMLDivElement>(null);

    const { refs, floatingStyles } = useFloating({
        open: open && items.length > 0,
        placement: "bottom-start",
        strategy: "fixed",
        middleware: [
            offset(2),
            flip(),
            size({
                apply({
                    availableHeight,
                    elements,
                    rects,
                }: {
                    availableHeight: number;
                    elements: { floating: HTMLElement };
                    rects: { reference: { width: number } };
                }) {
                    Object.assign(elements.floating.style, {
                        maxHeight: `${Math.min(400, Math.max(100, availableHeight - 10))}px`,
                        width: `${rects.reference.width}px`,
                    });
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });

    const mergedRef = useMergeRefs([refs.setFloating, scrollRef]);

    useEffect(() => {
        refs.setReference(anchorEl);
    }, [anchorEl, refs]);

    // Scroll hovered item into view
    useEffect(() => {
        if (hoveredIndex >= 0 && scrollRef.current) {
            const itemEls = scrollRef.current.querySelectorAll(".suggestion-item");
            itemEls[hoveredIndex]?.scrollIntoView({ block: "nearest" });
        }
    }, [hoveredIndex]);

    if (!open || !anchorEl || items.length === 0) {
        return null;
    }

    return ReactDOM.createPortal(
        <DropdownRoot
            ref={mergedRef}
            style={floatingStyles}
            onMouseDown={(e) => e.preventDefault()}
        >
            <div className="suggestions-header">
                <span className="header-label">
                    {mode === "search" ? "Search History" : "Navigation History"}
                </span>
                {mode === "search" && onClearVisible && (
                    <span
                        className="clear-btn"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onClearVisible();
                        }}
                    >
                        Clear
                    </span>
                )}
            </div>
            {items.map((item, index) => (
                <div
                    key={item}
                    className={clsx("suggestion-item", { hovered: index === hoveredIndex })}
                    onClick={() => onSelect(item)}
                    onMouseEnter={() => onHoveredIndexChange(index)}
                >
                    {mode === "search" && searchText
                        ? highlightText(searchText, item)
                        : item}
                </div>
            ))}
        </DropdownRoot>,
        document.body,
    );
}
