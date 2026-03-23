import React, { useCallback, useMemo, useState } from "react";
import styled from "@emotion/styled";
import { Editor } from "@monaco-editor/react";
import { LanguageIcon } from "../../components/icons/LanguageIcon";
import { Button } from "../../components/basic/Button";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import type { MenuItem } from "../../components/overlay/PopupMenu";
import { CopyIcon, NewWindowIcon, SaveIcon } from "../../theme/icons";
import { app } from "../../api/app";
import { pagesModel } from "../../api/pages";
import color from "../../theme/color";
import { RestResponse } from "./restClientTypes";

const RESPONSE_LANGUAGES = [
    "json",
    "html",
    "xml",
    "javascript",
    "css",
    "yaml",
    "plaintext",
];

// =============================================================================
// Styles
// =============================================================================

const ResponseViewerRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    overflow: "hidden",
    minHeight: 0,

    "& .response-tabs": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        flexShrink: 0,
    },
    "& .response-tab": {
        padding: "4px 12px",
        fontSize: 12,
        color: color.text.light,
        cursor: "pointer",
        userSelect: "none",
        borderBottom: "2px solid transparent",
        "&:hover": {
            color: color.text.default,
        },
    },
    "& .response-tab.active": {
        color: color.text.default,
        borderBottomColor: color.border.active,
    },
    "& .tab-bar-spacer": {
        flex: "1 1 auto",
    },
    "& .tab-bar-button": {
        flexShrink: 0,
        opacity: 0.5,
        "&:hover": {
            opacity: 1,
        },
    },
    "& .language-label": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        padding: "2px 8px",
        fontSize: 12,
        color: color.text.light,
        cursor: "pointer",
        borderRadius: 3,
        userSelect: "none",
        "&:hover": {
            color: color.text.default,
            backgroundColor: color.background.light,
        },
    },
    "& .view-toggle": {
        fontSize: 11,
        color: color.text.light,
        cursor: "pointer",
        padding: "1px 6px",
        borderRadius: 3,
        userSelect: "none",
        "&:hover": {
            color: color.text.default,
        },
    },
    "& .view-toggle.active": {
        color: color.text.default,
        backgroundColor: color.background.light,
    },
    "& .response-tab-body": {
        flex: "1 1 auto",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },
    "& .response-headers-list": {
        overflow: "auto",
        flex: "1 1 auto",
        minHeight: 0,
    },
    "& .headers-table": {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 13,
        fontFamily: "monospace",
    },
    "& .headers-table td": {
        padding: "3px 8px",
        verticalAlign: "top",
        borderBottom: `1px solid ${color.border.default}`,
    },
    "& .headers-table .header-key-cell": {
        color: color.text.light,
        whiteSpace: "nowrap",
        width: 1,
        fontWeight: 500,
    },
    "& .headers-table .header-value-cell": {
        color: color.text.default,
        wordBreak: "break-all",
    },
    "& .sending-message": {
        padding: 12,
        fontSize: 13,
        color: color.text.light,
        fontStyle: "italic",
    },
    "& .binary-response": {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 16,
        overflow: "auto",
    },
    "& .binary-info": {
        fontSize: 13,
        color: color.text.light,
        textAlign: "center",
        fontStyle: "italic",
    },
    "& .binary-actions": {
        display: "flex",
        flexDirection: "row",
        gap: 8,
    },
    "& .binary-image-preview": {
        maxWidth: "100%",
        maxHeight: 300,
        objectFit: "contain",
        borderRadius: 4,
        border: `1px solid ${color.border.default}`,
    },
}, { label: "ResponseViewerRoot" });

// =============================================================================
// Helpers
// =============================================================================

const EDITOR_OPTIONS: any = {
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

function detectLanguageFromHeaders(headers: { key: string; value: string }[]): string {
    const ct = headers.find((h) => h.key.toLowerCase() === "content-type")?.value || "";
    if (ct.includes("json")) return "json";
    if (ct.includes("html")) return "html";
    if (ct.includes("xml")) return "xml";
    if (ct.includes("css")) return "css";
    if (ct.includes("javascript")) return "javascript";
    return "plaintext";
}

function formatBody(body: string, language: string): string {
    if (language === "json") {
        try {
            return JSON.stringify(JSON.parse(body), null, 2);
        } catch {
            // not valid JSON
        }
    }
    return body;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtensionFromContentType(ct: string): string {
    const map: Record<string, string> = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "application/pdf": ".pdf",
        "application/zip": ".zip",
        "application/gzip": ".gz",
        "application/octet-stream": ".bin",
    };
    for (const [key, ext] of Object.entries(map)) {
        if (ct.includes(key)) return ext;
    }
    return ".bin";
}

// =============================================================================
// Component
// =============================================================================

type ResponseTab = "body" | "headers";

interface ResponseViewerProps {
    response: RestResponse | null;
    responseTime: number;
    executing: boolean;
}

export function ResponseViewer({ response, responseTime, executing }: ResponseViewerProps) {
    const [activeTab, setActiveTab] = useState<ResponseTab>("body");
    const [languageOverride, setLanguageOverride] = useState<string | null>(null);
    const [headersView, setHeadersView] = useState<"table" | "json">("table");

    const headersAsJson = useMemo(() => {
        if (!response) return "";
        const obj: Record<string, string> = {};
        for (const h of response.headers) obj[h.key] = h.value;
        return JSON.stringify(obj, null, 2);
    }, [response]);

    const detectedLanguage = useMemo(() => {
        setLanguageOverride(null);
        return response ? detectLanguageFromHeaders(response.headers) : "plaintext";
    }, [response]);

    const language = languageOverride ?? detectedLanguage;

    const formattedBody = useMemo(
        () => response ? formatBody(response.body, language) : "",
        [response, language],
    );

    const bodySize = useMemo(() => {
        if (!response) return "";
        if (response.isBinary) {
            // base64 string → actual binary size
            return formatSize(Math.floor(response.body.length * 3 / 4));
        }
        return formatSize(new Blob([response.body]).size);
    }, [response]);

    const handleSaveBinary = useCallback(async () => {
        if (!response?.isBinary) return;
        const ext = getExtensionFromContentType(response.contentType || "");
        const savePath = await app.fs.showSaveDialog({
            defaultPath: `response${ext}`,
        });
        if (savePath) {
            const buf = Buffer.from(response.body, "base64");
            await app.fs.writeBinary(savePath, buf);
        }
    }, [response]);

    const handleOpenImage = useCallback(() => {
        if (!response?.isBinary) return;
        const buf = Buffer.from(response.body, "base64");
        const blob = new Blob([buf], { type: response.contentType || "image/png" });
        const url = URL.createObjectURL(blob);
        pagesModel.openImageInNewTab(url);
    }, [response]);

    const isImage = response?.isBinary && (response.contentType || "").startsWith("image/");

    const blobUrl = useMemo(() => {
        if (!isImage || !response?.isBinary) return "";
        const buf = Buffer.from(response.body, "base64");
        const blob = new Blob([buf], { type: response.contentType || "image/png" });
        return URL.createObjectURL(blob);
    }, [isImage, response]);

    const languageMenuItems: MenuItem[] = useMemo(
        () => RESPONSE_LANGUAGES.map((l) => ({
            label: l,
            icon: <LanguageIcon language={l} width={16} height={16} />,
            selected: l === language,
            onClick: () => setLanguageOverride(l),
        })),
        [language],
    );

    const handleOpenInTab = useCallback(() => {
        if (!response) return;
        const body = formatBody(response.body, language);
        app.pages.addEditorPage("monaco", language, "Response", body);
    }, [response, language]);

    const handleCopyHeaders = useCallback(async () => {
        if (!response) return;
        const obj: Record<string, string> = {};
        for (const h of response.headers) obj[h.key] = h.value;
        navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
        return new Promise((resolve) => setTimeout(resolve, 200));
    }, [response]);

    if (executing) {
        return (
            <ResponseViewerRoot>
                <div className="sending-message">Sending request...</div>
            </ResponseViewerRoot>
        );
    }

    if (!response) {
        return (
            <ResponseViewerRoot>
                <div className="sending-message">Send a request to see the response.</div>
            </ResponseViewerRoot>
        );
    }

    return (
        <ResponseViewerRoot>
            <div className="response-tabs">
                <div
                    className={`response-tab ${activeTab === "body" ? "active" : ""}`}
                    onClick={() => setActiveTab("body")}
                >
                    Body {bodySize && `(${bodySize})`}
                </div>
                <div
                    className={`response-tab ${activeTab === "headers" ? "active" : ""}`}
                    onClick={() => setActiveTab("headers")}
                >
                    Headers ({response.headers.length})
                </div>
                <div className="tab-bar-spacer" />
                {activeTab === "body" && !response.isBinary && (
                    <>
                        <Button
                            size="small"
                            type="icon"
                            className="tab-bar-button"
                            title="Open in new tab"
                            onClick={handleOpenInTab}
                        >
                            <NewWindowIcon />
                        </Button>
                        <WithPopupMenu items={languageMenuItems}>
                            {(setOpen) => (
                                <div
                                    className="language-label"
                                    title="Change response language"
                                    onClick={(e) => setOpen(e.currentTarget)}
                                >
                                    <LanguageIcon language={language} width={16} height={16} />
                                    {language}
                                </div>
                            )}
                        </WithPopupMenu>
                    </>
                )}
                {activeTab === "headers" && (
                    <>
                        <span
                            className={`view-toggle ${headersView === "table" ? "active" : ""}`}
                            onClick={() => setHeadersView("table")}
                        >Table</span>
                        <span
                            className={`view-toggle ${headersView === "json" ? "active" : ""}`}
                            style={{ marginRight: 32 }}
                            onClick={() => setHeadersView("json")}
                        >JSON</span>
                        <Button
                            size="small"
                            type="icon"
                            className="tab-bar-button"
                            title="Copy headers as JSON"
                            onClick={handleCopyHeaders}
                        >
                            <CopyIcon />
                        </Button>
                    </>
                )}
            </div>
            <div className="response-tab-body">
                {activeTab === "body" ? (
                    response.isBinary ? (
                        <div className="binary-response">
                            <div className="binary-info">
                                Binary response — {response.contentType || "unknown type"} ({bodySize})
                            </div>
                            {isImage && blobUrl && (
                                <img className="binary-image-preview" src={blobUrl} alt="Response" />
                            )}
                            <div className="binary-actions">
                                <Button onClick={handleSaveBinary}>
                                    <SaveIcon /> Save to File
                                </Button>
                                {isImage && (
                                    <Button onClick={handleOpenImage}>
                                        <NewWindowIcon /> Open in Image Viewer
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <Editor
                            value={formattedBody}
                            language={language}
                            theme="custom-dark"
                            options={EDITOR_OPTIONS}
                        />
                    )
                ) : headersView === "table" ? (
                    <div className="response-headers-list">
                        <table className="headers-table">
                            <tbody>
                                {response.headers.map((h, i) => (
                                    <tr key={i}>
                                        <td className="header-key-cell">{h.key}</td>
                                        <td className="header-value-cell">{h.value}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <Editor
                        value={headersAsJson}
                        language="json"
                        theme="custom-dark"
                        options={{ ...EDITOR_OPTIONS, readOnly: true }}
                    />
                )}
            </div>
        </ResponseViewerRoot>
    );
}

/** Get response body size string for display in parent panel header. */
export function getResponseSize(response: RestResponse | null): string {
    if (!response) return "";
    return formatSize(new Blob([response.body]).size);
}
