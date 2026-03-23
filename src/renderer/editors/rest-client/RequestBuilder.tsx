import styled from "@emotion/styled";
import { useCallback, useMemo, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import { Button } from "../../components/basic/Button";
import { TextAreaField } from "../../components/basic/TextAreaField";
import { Splitter } from "../../components/layout/Splitter";
import { LanguageIcon } from "../../components/icons/LanguageIcon";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import type { MenuItem } from "../../components/overlay/PopupMenu";
import { CloseIcon, CopyIcon, FolderOpenIcon } from "../../theme/icons";
import { Checkbox } from "../../components/basic/Checkbox";
import { app } from "../../api/app";
import color from "../../theme/color";
import { RestClientViewModel, RestClientEditorState } from "./RestClientViewModel";
import { BodyType, RAW_LANGUAGES, RestRequest } from "./restClientTypes";
import { HTTP_METHODS, COMMON_HEADERS, METHOD_COLORS } from "./httpConstants";
import { KeyValueEditor } from "./KeyValueEditor";

// =============================================================================
// Constants
// =============================================================================

const BODY_TYPES: { type: BodyType; label: string }[] = [
    { type: "none", label: "none" },
    { type: "form-data", label: "form-data" },
    { type: "form-urlencoded", label: "x-www-form-urlencoded" },
    { type: "raw", label: "raw" },
    { type: "binary", label: "binary" },
];

const BODY_EDITOR_OPTIONS: any = {
    automaticLayout: true,
    minimap: { enabled: false },
    lineNumbers: "off",
    scrollBeyondLastLine: false,
    wordWrap: "on",
    folding: true,
    renderLineHighlight: "none",
    overviewRulerLanes: 0,
    padding: { top: 4, bottom: 4 },
    scrollbar: { alwaysConsumeMouseWheel: false },
};

// =============================================================================
// Styles
// =============================================================================

const RequestBuilderRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    flex: "1 1 auto",

    // ── URL bar (fixed at top) ──
    "& .url-bar": {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 4,
        padding: "4px 8px",
        backgroundColor: color.background.dark,
        flexShrink: 0,
    },
    "& .method-label": {
        flexShrink: 0,
        padding: "3px 8px",
        fontSize: 13,
        fontWeight: 700,
        fontFamily: "monospace",
        cursor: "pointer",
        borderRadius: 3,
        userSelect: "none",
        "&:hover": {
            backgroundColor: color.background.light,
        },
    },
    "& .url-input": {
        flex: "1 1 auto",
        minHeight: 24,
        maxHeight: 54,
        overflowY: "auto",
        padding: "2px 6px",
        fontSize: 13,
        fontFamily: "monospace",
        color: color.text.default,
        backgroundColor: color.background.dark,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        wordBreak: "break-all",
    },
    "& .send-button": {
        flexShrink: 0,
        height: 24,
        padding: "0 16px",
        fontSize: 13,
        fontWeight: 600,
    },

    // ── Split area (headers top / body bottom) ──
    "& .split-container": {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        "& > .splitter": {
            borderTop: "none",
        },
    },

    // ── Headers panel ──
    "& .headers-panel": {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        "& .section-header": {
            height: "auto",
            padding: "0 8px",
            background: "none",
        },
    },
    "& .section-header": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "4px 8px",
        gap: 4,
        flexShrink: 0,
        height: 29,
        boxSizing: "border-box",
        background: color.background.dark,
        cursor: "default",
        userSelect: "none",
    },
    "& .section-title": {
        fontSize: 12,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
    },
    "& .headers-scroll": {
        flex: "1 1 auto",
        overflow: "auto",
        padding: "4px 8px 8px 8px",
    },

    // ── Body panel ──
    "& .body-panel": {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },
    "& .body-type-tabs": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        marginLeft: 8,
        flex: "1 1 auto",
    },
    "& .body-type-tab": {
        padding: "2px 8px",
        fontSize: 11,
        color: color.text.light,
        cursor: "pointer",
        borderRadius: 3,
        "&:hover": {
            color: color.text.default,
        },
    },
    "& .body-type-tab.active": {
        color: color.text.default,
        backgroundColor: color.background.light,
    },
    "& .language-label": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        padding: "2px 8px",
        fontSize: 11,
        color: color.text.light,
        cursor: "pointer",
        borderRadius: 3,
        userSelect: "none",
        "&:hover": {
            color: color.text.default,
            backgroundColor: color.background.light,
        },
    },
    "& .body-content": {
        flex: "1 1 auto",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },
    "& .body-content-scroll": {
        flex: "1 1 auto",
        overflow: "auto",
        padding: "4px 8px 8px 8px",
    },
    "& .body-none-message": {
        padding: 12,
        fontSize: 13,
        color: color.text.light,
        fontStyle: "italic",
    },
    "& .binary-body": {
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    "& .binary-file-row": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    "& .binary-file-path": {
        flex: "1 1 auto",
        fontSize: 13,
        fontFamily: "monospace",
        color: color.text.default,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "& .binary-no-file": {
        color: color.text.light,
        fontStyle: "italic",
    },
    "& .form-data-row": {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 4,
        paddingTop: 2,
    },
    "& .form-data-type-toggle": {
        flexShrink: 0,
        fontSize: 11,
        padding: "3px 6px",
        cursor: "pointer",
        borderRadius: 3,
        color: color.text.light,
        userSelect: "none",
        "&:hover": {
            color: color.text.default,
            backgroundColor: color.background.light,
        },
    },
}, { label: "RequestBuilderRoot" });

// =============================================================================
// Component
// =============================================================================

interface RequestBuilderProps {
    vm: RestClientViewModel;
    request: RestRequest;
    state: RestClientEditorState;
}

export function RequestBuilder({ vm, request, state }: RequestBuilderProps) {
    const splitRef = useRef<HTMLDivElement>(null);
    const [bodyHeight, setBodyHeight] = useState<number | null>(null);

    const handleUrlChange = useCallback(
        (value: string) => {
            vm.updateRequest(request.id, { url: value });
        },
        [vm, request.id],
    );

    const methodMenuItems: MenuItem[] = useMemo(
        () => HTTP_METHODS.map((m) => ({
            label: m,
            selected: m === request.method,
            onClick: () => vm.updateRequest(request.id, { method: m }),
        })),
        [vm, request.id, request.method],
    );

    const handleUrlKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                vm.sendRequest();
            }
        },
        [vm],
    );

    const handleUrlPaste = useCallback(
        (e: React.ClipboardEvent) => {
            const text = e.clipboardData.getData("text");
            if (!text) return;
            const trimmed = text.trim();
            if (trimmed.startsWith("fetch(") || /^curl\s/i.test(trimmed)) {
                e.preventDefault();
                vm.pasteRequest(text);
            }
        },
        [vm],
    );

    // Body panel height management
    const getClampedBodyHeight = useCallback((h: number) => {
        const container = splitRef.current;
        if (!container) return h;
        const total = container.clientHeight;
        return Math.max(total * 0.1, Math.min(total * 0.9, h));
    }, []);

    const handleBodyHeightChange = useCallback((h: number) => {
        setBodyHeight(getClampedBodyHeight(h));
    }, [getClampedBodyHeight]);

    const toggleBodyHeight = useCallback((expandedRatio: number) => {
        const container = splitRef.current;
        if (!container) return;
        const total = container.clientHeight;
        const expanded = total * expandedRatio;
        const collapsed = total * (1 - expandedRatio);
        const current = bodyHeight ?? total * 0.4;
        const isExpanded = Math.abs(current - expanded) < total * 0.05;
        setBodyHeight(isExpanded ? collapsed : expanded);
    }, [bodyHeight]);

    const handleHeadersDblClick = useCallback(() => {
        toggleBodyHeight(0.3);
    }, [toggleBodyHeight]);

    const handleBodyDblClick = useCallback(() => {
        toggleBodyHeight(0.7);
    }, [toggleBodyHeight]);

    const getInitialBodyHeight = useMemo(() => {
        if (bodyHeight !== null) return bodyHeight;
        const container = splitRef.current;
        if (!container) return 150;
        return container.clientHeight * 0.4;
    }, [bodyHeight]);

    const currentBodyHeight = bodyHeight ?? getInitialBodyHeight;
    const headersFlex = bodyHeight !== null ? "1 1 auto" : "6 1 0";
    const bodyStyle = bodyHeight !== null
        ? { height: currentBodyHeight, flexShrink: 0, flexGrow: 0 }
        : { flex: "4 1 0", minHeight: 0 };

    // Body type tab click
    const handleBodyTypeChange = useCallback(
        (type: BodyType) => {
            vm.updateBodyType(request.id, type);
        },
        [vm, request.id],
    );

    // Raw body language menu items
    const languageMenuItems: MenuItem[] = useMemo(
        () => RAW_LANGUAGES.map((l) => ({
            label: l,
            icon: <LanguageIcon language={l} width={16} height={16} />,
            selected: l === request.bodyLanguage,
            onClick: () => vm.updateBodyLanguage(request.id, l),
        })),
        [vm, request.id, request.bodyLanguage],
    );

    // Monaco body change
    const handleMonacoBodyChange = useCallback(
        (value: string | undefined) => {
            vm.updateRequest(request.id, { body: value ?? "" });
        },
        [vm, request.id],
    );

    return (
        <RequestBuilderRoot>
            {/* URL Bar */}
            <div className="url-bar">
                <WithPopupMenu items={methodMenuItems}>
                    {(setOpen) => (
                        <div
                            className="method-label"
                            style={{ color: METHOD_COLORS[request.method] || color.text.default }}
                            onClick={(e) => setOpen(e.currentTarget)}
                        >
                            {request.method}
                        </div>
                    )}
                </WithPopupMenu>
                <TextAreaField
                    className="url-input"
                    value={request.url}
                    onChange={handleUrlChange}
                    onKeyDown={handleUrlKeyDown}
                    onPaste={handleUrlPaste}
                    placeholder="Enter URL or paste cURL/fetch..."
                />
                <Button
                    className="send-button"
                    onClick={vm.sendRequest}
                    disabled={state.executing || !request.url}
                >
                    {state.executing ? "Sending..." : "Send"}
                </Button>
            </div>

            {/* Split area: headers (top) / body (bottom) */}
            <div className="split-container" ref={splitRef}>
                {/* Headers panel */}
                <div className="headers-panel" style={{ flex: headersFlex, overflow: "hidden", minHeight: 0 }}>
                    <div className="section-header" onDoubleClick={handleHeadersDblClick}>
                        <span className="section-title">Headers</span>
                        <Button
                            size="small"
                            type="icon"
                            title="Copy headers as JSON"
                            style={{ opacity: 0.5 }}
                            onClick={async () => {
                                const obj: Record<string, string> = {};
                                for (const h of request.headers) {
                                    if (h.enabled && h.key.trim()) obj[h.key.trim()] = h.value;
                                }
                                navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
                                return new Promise((resolve) => setTimeout(resolve, 200));
                            }}
                        >
                            <CopyIcon />
                        </Button>
                    </div>
                    <div className="headers-scroll">
                        <KeyValueEditor
                            items={request.headers}
                            onUpdate={(i, changes) => vm.updateHeader(request.id, i, changes)}
                            onDelete={(i) => vm.deleteHeader(request.id, i)}
                            onToggle={(i) => vm.toggleHeader(request.id, i)}
                            keyOptions={COMMON_HEADERS}
                            keyPlaceholder="Header name"
                            valuePlaceholder="Value"
                        />
                    </div>
                </div>

                {/* Body panel */}
                <Splitter
                    type="horizontal"
                    initialHeight={currentBodyHeight}
                    onChangeHeight={handleBodyHeightChange}
                />
                <div className="body-panel" style={bodyStyle as any}>
                    <div className="section-header" onDoubleClick={handleBodyDblClick}>
                        <span className="section-title">Body</span>
                        <div className="body-type-tabs">
                            {BODY_TYPES.map(({ type, label }) => (
                                <div
                                    key={type}
                                    className={`body-type-tab ${request.bodyType === type ? "active" : ""}`}
                                    onClick={() => handleBodyTypeChange(type)}
                                >
                                    {label}
                                </div>
                            ))}
                        </div>
                        {request.bodyType === "raw" && (
                            <WithPopupMenu items={languageMenuItems}>
                                {(setOpen) => (
                                    <div
                                        className="language-label"
                                        title="Change body language"
                                        onClick={(e) => setOpen(e.currentTarget)}
                                    >
                                        <LanguageIcon language={request.bodyLanguage} width={16} height={16} />
                                        {request.bodyLanguage}
                                    </div>
                                )}
                            </WithPopupMenu>
                        )}
                    </div>
                    <BodyContent
                        vm={vm}
                        request={request}
                        onMonacoChange={handleMonacoBodyChange}
                    />
                </div>
            </div>
        </RequestBuilderRoot>
    );
}

// =============================================================================
// BodyContent sub-component
// =============================================================================

function BodyContent({ vm, request, onMonacoChange }: {
    vm: RestClientViewModel;
    request: RestRequest;
    onMonacoChange: (value: string | undefined) => void;
}) {
    const handleSelectFile = useCallback(async () => {
        const result = await app.fs.showOpenDialog();
        if (result?.[0]) {
            vm.updateRequest(request.id, { binaryFilePath: result[0] });
        }
    }, [vm, request.id]);

    if (request.bodyType === "none") {
        return (
            <div className="body-content">
                <div className="body-none-message">This request has no body.</div>
            </div>
        );
    }

    if (request.bodyType === "binary") {
        return (
            <div className="body-content">
                <div className="binary-body">
                    <div className="binary-file-row">
                        <Button size="small" title="Select file" onClick={handleSelectFile}>
                            <FolderOpenIcon /> Select File
                        </Button>
                        <span className={`binary-file-path ${!request.binaryFilePath ? "binary-no-file" : ""}`}>
                            {request.binaryFilePath || "No file selected"}
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    if (request.bodyType === "form-data") {
        return (
            <div className="body-content">
                <div className="body-content-scroll">
                    <FormDataEditor vm={vm} request={request} />
                </div>
            </div>
        );
    }

    if (request.bodyType === "form-urlencoded") {
        return (
            <div className="body-content">
                <div className="body-content-scroll">
                    <KeyValueEditor
                        items={request.formData}
                        onUpdate={(i, changes) => vm.updateFormData(request.id, i, changes)}
                        onDelete={(i) => vm.deleteFormData(request.id, i)}
                        onToggle={(i) => vm.toggleFormData(request.id, i)}
                        keyPlaceholder="Key"
                        valuePlaceholder="Value"
                    />
                </div>
            </div>
        );
    }

    // raw
    return (
        <div className="body-content">
            <Editor
                value={request.body}
                language={request.bodyLanguage}
                theme="custom-dark"
                options={BODY_EDITOR_OPTIONS}
                onChange={onMonacoChange}
            />
        </div>
    );
}

// =============================================================================
// FormDataEditor sub-component (multipart/form-data)
// =============================================================================

function FormDataEditor({ vm, request }: { vm: RestClientViewModel; request: RestRequest }) {
    const handleBrowse = useCallback(async (index: number) => {
        const result = await app.fs.showOpenDialog();
        if (result?.[0]) {
            vm.updateFormDataEntry(request.id, index, { value: result[0] });
        }
    }, [vm, request.id]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {request.formDataEntries.map((entry, index) => {
                const isEmpty = !entry.key && !entry.value;
                const isLast = index === request.formDataEntries.length - 1;
                return (
                    <div key={index} className={`form-data-row ${!entry.enabled ? "kv-row-disabled" : ""}`}
                        style={{ opacity: entry.enabled ? 1 : 0.5 }}
                    >
                        <Checkbox
                            className="kv-checkbox"
                            checked={entry.enabled}
                            onChange={() => vm.toggleFormDataEntry(request.id, index)}
                        />
                        <span
                            className="form-data-type-toggle"
                            title="Toggle text/file"
                            onClick={() => vm.updateFormDataEntry(request.id, index, {
                                type: entry.type === "text" ? "file" : "text",
                                value: "",
                            })}
                        >
                            {entry.type === "file" ? "File" : "Text"}
                        </span>
                        <TextAreaField
                            style={{ width: "30%", minWidth: 80, flexShrink: 0, minHeight: 24, padding: "2px 6px", fontSize: 14, fontFamily: "monospace" }}
                            value={entry.key}
                            onChange={(v) => vm.updateFormDataEntry(request.id, index, { key: v || "" })}
                            placeholder="Key"
                            singleLine
                        />
                        {entry.type === "file" ? (
                            <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                                <Button size="small" type="icon" title="Browse" onClick={() => handleBrowse(index)}>
                                    <FolderOpenIcon />
                                </Button>
                                <span style={{
                                    fontSize: 13, fontFamily: "monospace", color: entry.value ? color.text.default : color.text.light,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: entry.value ? "normal" : "italic",
                                }}>
                                    {entry.value || "No file selected"}
                                </span>
                            </div>
                        ) : (
                            <TextAreaField
                                style={{ flex: "1 1 auto", minHeight: 24, minWidth: 0, padding: "2px 6px", fontSize: 14, fontFamily: "monospace" }}
                                value={entry.value}
                                onChange={(v) => vm.updateFormDataEntry(request.id, index, { value: v || "" })}
                                placeholder="Value"
                                singleLine
                            />
                        )}
                        {isLast && isEmpty ? (
                            <Button size="small" type="icon" style={{ visibility: "hidden" }}>
                                <CloseIcon />
                            </Button>
                        ) : (
                            <Button
                                size="small"
                                type="icon"
                                style={{ opacity: 0.5 }}
                                title="Delete"
                                onClick={() => vm.deleteFormDataEntry(request.id, index)}
                            >
                                <CloseIcon />
                            </Button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
