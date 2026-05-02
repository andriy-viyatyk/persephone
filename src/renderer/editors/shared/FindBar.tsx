import { useEffect, useRef } from "react";
import { Panel, Input, IconButton, Text } from "../../uikit";
import { CloseIcon, ChevronUpIcon, ChevronDownIcon } from "../../theme/icons";

export interface FindBarProps {
    text: string;
    currentMatch: number;
    totalMatches: number;
    onTextChange: (text: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
    placeholder?: string;
}

export function FindBar(props: FindBarProps) {
    const {
        text,
        currentMatch,
        totalMatches,
        onTextChange,
        onNext,
        onPrev,
        onClose,
        placeholder = "Find...",
    } = props;
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

    const matchLabel = text
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
                    value={text}
                    onChange={onTextChange}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
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
