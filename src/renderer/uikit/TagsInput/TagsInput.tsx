import React, { useCallback, useState } from "react";
import styled from "@emotion/styled";
import { spacing } from "../tokens";
import { Tag } from "../Tag";
import { PathInput } from "../PathInput";

// --- Types ---

export interface TagsInputProps
    extends Omit<
        React.HTMLAttributes<HTMLDivElement>,
        "style" | "className" | "onChange"
    > {
    /** Current tags (the primary value). */
    value: string[];
    /** Called with the next tags array after add or remove. */
    onChange: (tags: string[]) => void;
    /** Available tags fed to the autocomplete (PathInput `paths`). Default: []. */
    items?: string[];
    /** Path separator for autocomplete + trimmed from typed values. Default: ":". */
    separator?: string;
    /** Max depth for autocomplete suggestions. Default: 1. */
    maxDepth?: number;
    /** Placeholder for the add-tag input. Default: "Type + Enter to add". */
    placeholder?: string;
    /** Tag visual variant. Default: "filled". */
    tagVariant?: "filled" | "outlined";
    /** Size — applied to both rendered tags and the inline input. Default: "md". */
    size?: "sm" | "md";
    /** Disabled state — input and remove buttons inert. Default: false. */
    disabled?: boolean;
    /** Read-only — show tags without remove buttons; hide the add-tag input. Default: false. */
    readOnly?: boolean;
    "aria-label"?: string;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: spacing.sm,
        minHeight: 28,
        minWidth: 0,
        "&[data-disabled]": { opacity: 0.5, pointerEvents: "none" },
    },
    { label: "TagsInput" },
);

const InputSlot = styled.div({
    flex: "1 1 100px",
    minWidth: 100,
});

// --- Component ---

export function TagsInput({
    value,
    onChange,
    items,
    separator = ":",
    maxDepth = 1,
    placeholder = "Type + Enter to add",
    tagVariant = "filled",
    size = "md",
    disabled = false,
    readOnly = false,
    "aria-label": ariaLabel,
    ...rest
}: TagsInputProps) {
    const [newTag, setNewTag] = useState("");

    const handleRemove = useCallback(
        (tag: string) => onChange(value.filter((t) => t !== tag)),
        [value, onChange],
    );

    const handleAddBlur = useCallback(
        (finalValue?: string) => {
            if (finalValue === undefined) {
                setNewTag("");
                return;
            }
            const trimmed = finalValue.trim();
            const cleaned = trimmed.endsWith(separator) ? trimmed.slice(0, -1) : trimmed;
            if (cleaned && !value.includes(cleaned)) {
                onChange([...value, cleaned]);
            }
            setNewTag("");
        },
        [value, onChange, separator],
    );

    return (
        <Root
            data-type="tags-input"
            data-disabled={disabled || undefined}
            data-readonly={readOnly || undefined}
            aria-label={ariaLabel}
            {...rest}
        >
            {value.map((tag) => (
                <Tag
                    key={tag}
                    label={tag}
                    variant={tagVariant}
                    size={size}
                    disabled={disabled}
                    onRemove={readOnly ? undefined : () => handleRemove(tag)}
                />
            ))}
            {!readOnly && (
                <InputSlot>
                    <PathInput
                        value={newTag}
                        onChange={setNewTag}
                        onBlur={handleAddBlur}
                        paths={items ?? []}
                        separator={separator}
                        maxDepth={maxDepth}
                        placeholder={placeholder}
                        disabled={disabled}
                        size={size}
                    />
                </InputSlot>
            )}
        </Root>
    );
}
