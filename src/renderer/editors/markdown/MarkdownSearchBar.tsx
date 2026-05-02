import { useEffect, useRef } from "react";
import { Panel, Input, IconButton, Text } from "../../uikit";
import { CloseIcon, ChevronUpIcon, ChevronDownIcon } from "../../theme/icons";

export interface MarkdownSearchBarProps {
    searchText: string;
    currentMatch: number;
    totalMatches: number;
    onSearchTextChange: (text: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
}

export function MarkdownSearchBar(props: MarkdownSearchBarProps) {
    const { searchText, currentMatch, totalMatches, onSearchTextChange, onNext, onPrev, onClose } = props;
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

    const matchLabel = searchText
        ? totalMatches > 0
            ? `${currentMatch + 1} of ${totalMatches}`
            : "No results"
        : "";

    return (
        <Panel
            position="absolute"
            top={4}
            right={20}
            zIndex={10}
            align="center"
            gap="xs"
            paddingY="xs"
            paddingX="sm"
            background="light"
            border
            borderColor="default"
            rounded="md"
            shadow
        >
            <Panel width={180}>
                <Input
                    ref={inputRef}
                    size="sm"
                    value={searchText}
                    onChange={onSearchTextChange}
                    onKeyDown={onKeyDown}
                    placeholder="Find..."
                />
            </Panel>
            <Panel minWidth={50} align="center" justify="center">
                <Text size="sm" color="light" nowrap>{matchLabel}</Text>
            </Panel>
            <IconButton
                size="sm"
                title="Previous Match (Shift+F3)"
                onClick={onPrev}
                icon={<ChevronUpIcon />}
            />
            <IconButton
                size="sm"
                title="Next Match (F3)"
                onClick={onNext}
                icon={<ChevronDownIcon />}
            />
            <IconButton
                size="sm"
                title="Close (Esc)"
                onClick={onClose}
                icon={<CloseIcon />}
            />
        </Panel>
    );
}
