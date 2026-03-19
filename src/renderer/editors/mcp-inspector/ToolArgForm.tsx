import { useCallback, useMemo } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Editor } from "@monaco-editor/react";
import { TextField } from "../../components/basic/TextField";
import { TextAreaField } from "../../components/basic/TextAreaField";
import { McpToolInfo } from "./McpInspectorModel";

// ============================================================================
// Styles
// ============================================================================

const ToolArgFormRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    gap: 12,

    "& .arg-field": {
        display: "flex",
        flexDirection: "column",
        gap: 3,
    },

    // Override InputBase styles for TextField inputs in this editor
    "& .text-field input": {
        backgroundColor: color.background.default,
        borderColor: color.border.default,
    },

    "& .arg-label": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 14,
        color: color.text.default,
    },

    "& .arg-type": {
        fontSize: 11,
        color: color.text.light,
        background: color.background.light,
        padding: "1px 5px",
        borderRadius: 2,
    },

    "& .arg-required": {
        fontSize: 11,
        color: color.error.text,
    },

    "& .arg-description": {
        fontSize: 13,
        color: color.text.light,
        marginTop: 1,
    },

    "& .arg-editor-wrapper": {
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        overflow: "hidden",
        "&:focus-within": {
            borderColor: color.border.active,
        },
    },

    "& .arg-checkbox": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
    },

    "& .arg-select": {
        background: color.background.default,
        color: color.text.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        padding: "4px 8px",
        fontSize: 12,
        "&:focus": {
            outline: "none",
            borderColor: color.border.active,
        },
    },
});

// ============================================================================
// Helpers
// ============================================================================

/** Names that suggest code-like content needing Monaco. */
const CODE_FIELD_PATTERNS = /^(script|code|content|body|query|json|yaml|xml|source|template|expression|command)$/i;

function isCodeLikeField(name: string): boolean {
    return CODE_FIELD_PATTERNS.test(name);
}

function getSchemaType(schema: any): string {
    if (!schema) return "string";
    if (schema.type) return schema.type;
    if (schema.enum) return "enum";
    return "string";
}

// ============================================================================
// Component
// ============================================================================

interface ToolArgFormProps {
    schema: McpToolInfo["inputSchema"];
    args: Record<string, string>;
    onArgChange: (name: string, value: string) => void;
    disabled?: boolean;
}

export function ToolArgForm({ schema, args, onArgChange, disabled }: ToolArgFormProps) {
    const properties = schema.properties || {};
    const requiredFields = useMemo(() => new Set(schema.required || []), [schema.required]);
    const propEntries = useMemo(() => Object.entries(properties), [properties]);

    if (propEntries.length === 0) {
        return <div style={{ fontSize: 13, color: color.text.light, fontStyle: "italic" }}>No arguments</div>;
    }

    return (
        <ToolArgFormRoot>
            {propEntries.map(([name, propSchema]) => (
                <ArgField
                    key={name}
                    name={name}
                    propSchema={propSchema as any}
                    required={requiredFields.has(name)}
                    value={args[name] || ""}
                    onChange={onArgChange}
                    disabled={disabled}
                />
            ))}
        </ToolArgFormRoot>
    );
}

// ============================================================================
// ArgField
// ============================================================================

interface ArgFieldProps {
    name: string;
    propSchema: any;
    required: boolean;
    value: string;
    onChange: (name: string, value: string) => void;
    disabled?: boolean;
}

function ArgField({ name, propSchema, required, value, onChange, disabled }: ArgFieldProps) {
    const type = getSchemaType(propSchema);
    const description = propSchema?.description;

    const handleChange = useCallback(
        (v: string) => onChange(name, v),
        [name, onChange],
    );

    const handleEditorChange = useCallback(
        (v: string | undefined) => onChange(name, v || ""),
        [name, onChange],
    );

    const handleCheckboxChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => onChange(name, String(e.target.checked)),
        [name, onChange],
    );

    const handleSelectChange = useCallback(
        (e: React.ChangeEvent<HTMLSelectElement>) => onChange(name, e.target.value),
        [name, onChange],
    );

    // Determine which input to render
    let input: React.ReactNode;

    if (type === "boolean") {
        input = (
            <label className="arg-checkbox">
                <input
                    type="checkbox"
                    checked={value === "true"}
                    onChange={handleCheckboxChange}
                    disabled={disabled}
                />
                {name}
            </label>
        );
    } else if (propSchema?.enum) {
        input = (
            <select
                className="arg-select"
                value={value}
                onChange={handleSelectChange}
                disabled={disabled}
            >
                <option value="">— select —</option>
                {(propSchema.enum as string[]).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                ))}
            </select>
        );
    } else if (type === "number" || type === "integer") {
        input = (
            <TextField
                value={value}
                onChange={handleChange}
                placeholder={propSchema?.default !== undefined ? String(propSchema.default) : ""}
                disabled={disabled}
            />
        );
    } else if (type === "object" || type === "array" || isCodeLikeField(name)) {
        // Monaco editor for complex types and code-like fields
        const lang = (type === "object" || type === "array") ? "json" : "plaintext";
        const height = (type === "object" || type === "array") ? 120 : 80;
        input = (
            <div className="arg-editor-wrapper" style={{ height }}>
                <Editor
                    value={value}
                    language={lang}
                    theme="custom-dark"
                    onChange={handleEditorChange}
                    options={{
                        automaticLayout: true,
                        minimap: { enabled: false },
                        lineNumbers: "off",
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        folding: false,
                        renderLineHighlight: "none",
                        padding: { top: 4, bottom: 4 },
                        readOnly: disabled,
                        domReadOnly: disabled,
                        overviewRulerLanes: 0,
                        scrollbar: { alwaysConsumeMouseWheel: false },
                    }}
                />
            </div>
        );
    } else {
        // Simple string — use TextAreaField
        input = (
            <TextAreaField
                value={value}
                onChange={handleChange}
                placeholder={propSchema?.default !== undefined ? String(propSchema.default) : ""}
                readonly={disabled}
            />
        );
    }

    return (
        <div className="arg-field">
            {type !== "boolean" && (
                <div className="arg-label">
                    <span>{name}</span>
                    <span className="arg-type">{type}</span>
                    {required && <span className="arg-required">required</span>}
                </div>
            )}
            {input}
            {description && <div className="arg-description">{description}</div>}
        </div>
    );
}
