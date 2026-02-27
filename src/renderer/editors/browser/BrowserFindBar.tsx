import styled from "@emotion/styled";
import { useEffect, useRef } from "react";
import color from "../../theme/color";
import { CloseIcon, ChevronUpIcon, ChevronDownIcon } from "../../theme/icons";

const FindBarRoot = styled.div({
    position: "absolute",
    top: 4,
    right: 20,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: "3px 4px",
    backgroundColor: color.background.light,
    border: `1px solid ${color.border.default}`,
    borderRadius: 4,
    boxShadow: `0 2px 6px ${color.shadow.default}`,
    "& input": {
        width: 180,
        height: 22,
        padding: "0 6px",
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        backgroundColor: color.background.default,
        color: color.text.default,
        fontSize: 13,
        outline: "none",
        "&:focus": {
            borderColor: color.border.active,
        },
    },
    "& .match-count": {
        fontSize: 12,
        color: color.text.light,
        whiteSpace: "nowrap",
        minWidth: 50,
        textAlign: "center",
    },
    "& .find-btn": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        padding: 0,
        border: "none",
        borderRadius: 3,
        backgroundColor: "transparent",
        color: color.icon.light,
        cursor: "pointer",
        "&:hover": {
            backgroundColor: color.background.default,
            color: color.icon.default,
        },
    },
});

export interface BrowserFindBarProps {
    findText: string;
    activeMatch: number;
    totalMatches: number;
    onFindTextChange: (text: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
}

export function BrowserFindBar(props: BrowserFindBarProps) {
    const { findText, activeMatch, totalMatches, onFindTextChange, onNext, onPrev, onClose } = props;
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            onPrev();
        } else if (e.key === "Enter") {
            e.preventDefault();
            onNext();
        } else if (e.key === "F3" && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            onPrev();
        } else if (e.key === "F3") {
            e.preventDefault();
            e.stopPropagation();
            onNext();
        }
    };

    const matchLabel = findText
        ? totalMatches > 0
            ? `${activeMatch + 1} of ${totalMatches}`
            : "No results"
        : "";

    return (
        <FindBarRoot>
            <input
                ref={inputRef}
                value={findText}
                onChange={(e) => onFindTextChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Find in page..."
            />
            <span className="match-count">{matchLabel}</span>
            <button className="find-btn" onClick={onPrev} title="Previous Match (Shift+F3)">
                <ChevronUpIcon />
            </button>
            <button className="find-btn" onClick={onNext} title="Next Match (F3)">
                <ChevronDownIcon />
            </button>
            <button className="find-btn" onClick={onClose} title="Close (Esc)">
                <CloseIcon width={14} height={14} />
            </button>
        </FindBarRoot>
    );
}
