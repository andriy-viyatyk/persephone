import styled from "@emotion/styled";
import { useCallback } from "react";
import { Button } from "../../components/basic/Button";
import { Checkbox } from "../../components/basic/Checkbox";
import { TextAreaField } from "../../components/basic/TextAreaField";
import { ComboSelect } from "../../components/form/ComboSelect";
import color from "../../theme/color";
import { CloseIcon } from "../../theme/icons";
import { RestHeader } from "./restClientTypes";

// =============================================================================
// Styles
// =============================================================================

const KeyValueEditorRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    gap: 4,

    "& .kv-row": {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 4,
        paddingTop: 2,
    },
    "& .kv-row-disabled": {
        opacity: 0.5,
    },
    "& .kv-checkbox": {
        flexShrink: 0,
        marginTop: 4,
    },
    "& .kv-key": {
        width: "35%",
        minWidth: 100,
        flexShrink: 0,
        "& input": {
            backgroundColor: color.background.default,
        },
    },
    "& .kv-key-text": {
        minHeight: 24,
        minWidth: 0,
        padding: "2px 6px",
        fontSize: 14,
        fontFamily: "monospace",
        color: color.text.default,
        backgroundColor: color.background.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        wordBreak: "break-all",
    },
    "& .kv-value": {
        flex: "1 1 auto",
        minHeight: 24,
        minWidth: 0,
        padding: "2px 6px",
        fontSize: 14,
        fontFamily: "monospace",
        color: color.text.default,
        backgroundColor: color.background.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        wordBreak: "break-all",
    },
    "& .kv-delete": {
        flexShrink: 0,
        opacity: 0.5,
        "&:hover": {
            opacity: 1,
        },
    },
}, { label: "KeyValueEditorRoot" });

// =============================================================================
// Component
// =============================================================================

interface KeyValueEditorProps {
    items: RestHeader[];
    onUpdate: (index: number, changes: Partial<RestHeader>) => void;
    onDelete: (index: number) => void;
    onToggle: (index: number) => void;
    keyOptions?: string[];
    keyPlaceholder?: string;
    valuePlaceholder?: string;
}

export function KeyValueEditor({
    items,
    onUpdate,
    onDelete,
    onToggle,
    keyOptions,
    keyPlaceholder = "Key",
    valuePlaceholder = "Value",
}: KeyValueEditorProps) {
    return (
        <KeyValueEditorRoot>
            {items.map((item, index) => (
                <KeyValueRow
                    key={index}
                    item={item}
                    index={index}
                    isLast={index === items.length - 1}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    onToggle={onToggle}
                    keyOptions={keyOptions}
                    keyPlaceholder={keyPlaceholder}
                    valuePlaceholder={valuePlaceholder}
                />
            ))}
        </KeyValueEditorRoot>
    );
}

// =============================================================================
// Row sub-component
// =============================================================================

interface KeyValueRowProps {
    item: RestHeader;
    index: number;
    isLast: boolean;
    onUpdate: (index: number, changes: Partial<RestHeader>) => void;
    onDelete: (index: number) => void;
    onToggle: (index: number) => void;
    keyOptions?: string[];
    keyPlaceholder: string;
    valuePlaceholder: string;
}

function KeyValueRow({
    item,
    index,
    isLast,
    onUpdate,
    onDelete,
    onToggle,
    keyOptions,
    keyPlaceholder,
    valuePlaceholder,
}: KeyValueRowProps) {
    const isEmpty = !item.key && !item.value;

    const handleKeyChange = useCallback(
        (value?: string) => {
            onUpdate(index, { key: value || "" });
        },
        [onUpdate, index],
    );

    const handleValueChange = useCallback(
        (value: string) => {
            onUpdate(index, { value });
        },
        [onUpdate, index],
    );

    const handleToggle = useCallback(
        () => onToggle(index),
        [onToggle, index],
    );

    const handleDelete = useCallback(
        () => onDelete(index),
        [onDelete, index],
    );

    return (
        <div className={`kv-row ${!item.enabled ? "kv-row-disabled" : ""}`}>
            <Checkbox
                className="kv-checkbox"
                checked={item.enabled}
                onChange={handleToggle}
            />
            {keyOptions ? (
                <div className="kv-key">
                    <ComboSelect
                        selectFrom={keyOptions}
                        value={item.key}
                        onChange={handleKeyChange}
                        getLabel={(h: any) => h}
                        freeText
                    />
                </div>
            ) : (
                <TextAreaField
                    className="kv-key kv-key-text"
                    value={item.key}
                    onChange={handleKeyChange}
                    placeholder={keyPlaceholder}
                    singleLine
                />
            )}
            <TextAreaField
                className="kv-value"
                value={item.value}
                onChange={handleValueChange}
                placeholder={valuePlaceholder}
                singleLine
            />
            {isLast && isEmpty ? (
                <Button
                    size="small"
                    type="icon"
                    className="kv-delete"
                    style={{ visibility: "hidden" }}
                >
                    <CloseIcon />
                </Button>
            ) : (
                <Button
                    size="small"
                    type="icon"
                    className="kv-delete"
                    title="Delete"
                    onClick={handleDelete}
                >
                    <CloseIcon />
                </Button>
            )}
        </div>
    );
}
