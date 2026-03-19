import { useCallback, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Button } from "../../components/basic/Button";
import { Splitter } from "../../components/layout/Splitter";
import { TextAreaField } from "../../components/basic/TextAreaField";
import { McpInspectorModel, McpPromptMessage } from "./McpInspectorModel";

// ============================================================================
// Styles
// ============================================================================

const PromptsPanelRoot = styled.div({
    display: "flex",
    flex: "1 1 auto",
    overflow: "hidden",

    "& .prompts-sidebar": {
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
    },

    "& .sidebar-header": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        fontSize: 11,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        borderBottom: `1px solid ${color.border.light}`,
        flexShrink: 0,
    },

    "& .sidebar-count": {
        fontSize: 11,
        fontWeight: 400,
        color: color.text.light,
        background: color.background.light,
        padding: "1px 6px",
        borderRadius: 8,
    },

    "& .sidebar-list": {
        flex: "1 1 auto",
        overflowY: "auto",
        overflowX: "hidden",
    },

    "& .sidebar-item": {
        display: "flex",
        flexDirection: "column",
        padding: "6px 12px",
        fontSize: 12,
        cursor: "pointer",
        color: color.text.light,
        borderBottom: `1px solid ${color.border.light}`,
        overflow: "hidden",
        "&:hover": {
            background: color.background.light,
            color: color.text.default,
        },
    },

    "& .sidebar-item.active": {
        background: color.background.light,
        color: color.text.default,
        borderLeft: `2px solid ${color.border.active}`,
        paddingLeft: 10,
    },

    "& .prompt-name": {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: color.text.default,
    },

    "& .prompt-desc-preview": {
        fontSize: 11,
        color: color.text.light,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        marginTop: 1,
    },

    "& .prompt-detail": {
        flex: "1 1 auto",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },

    "& .prompt-detail-top": {
        flexShrink: 0,
        overflow: "auto",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },

    "& .prompt-detail-messages": {
        flex: "1 1 auto",
        overflow: "auto",
        padding: "0 16px 16px",
        minHeight: 80,
    },

    "& .detail-name": {
        fontSize: 16,
        fontWeight: 500,
        color: color.text.strong,
    },

    "& .detail-description": {
        fontSize: 12,
        color: color.text.light,
        lineHeight: 1.5,
    },

    "& .section-title": {
        fontSize: 11,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        paddingBottom: 4,
        borderBottom: `1px solid ${color.border.light}`,
    },

    "& .arg-field": {
        display: "flex",
        flexDirection: "column",
        gap: 3,
    },

    "& .arg-label": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: color.text.default,
    },

    "& .arg-required": {
        fontSize: 11,
        color: color.error.text,
    },

    "& .arg-desc": {
        fontSize: 11,
        color: color.text.light,
    },

    "& .error-text": {
        fontSize: 12,
        color: color.error.text,
    },

    // Messages
    "& .message": {
        padding: "10px 0",
        borderBottom: `1px solid ${color.border.light}`,
        "&:last-child": {
            borderBottom: "none",
        },
    },

    "& .message-role": {
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        padding: "2px 6px",
        borderRadius: 3,
        marginBottom: 6,
    },

    "& .message-role.user": {
        background: color.background.light,
        color: color.misc.blue,
    },

    "& .message-role.assistant": {
        background: color.background.light,
        color: color.misc.green,
    },

    "& .message-text": {
        fontSize: 12,
        color: color.text.default,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    },

    "& .message-image": {
        maxWidth: "100%",
        borderRadius: 4,
        border: `1px solid ${color.border.default}`,
        marginTop: 4,
    },

    "& .message-resource-uri": {
        fontSize: 11,
        color: color.misc.blue,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
    },

    "& .empty-detail": {
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: color.text.light,
        fontSize: 13,
    },

    "& .no-args": {
        fontSize: 12,
        color: color.text.light,
        fontStyle: "italic",
    },
});

// ============================================================================
// Component
// ============================================================================

interface PromptsPanelProps {
    model: McpInspectorModel;
}

export function PromptsPanel({ model }: PromptsPanelProps) {
    const ps = model.promptsState.use();
    const [sidebarWidth, setSidebarWidth] = useState(220);

    const selectedPrompt = ps.prompts.find((p) => p.name === ps.selectedPromptName) || null;

    const handleGetPrompt = useCallback(() => {
        model.getPrompt();
    }, [model]);

    return (
        <PromptsPanelRoot>
            {/* Sidebar */}
            <div className="prompts-sidebar" style={{ width: sidebarWidth }}>
                <div className="sidebar-header">
                    <span>Prompts</span>
                    <span className="sidebar-count">{ps.prompts.length}</span>
                </div>
                <div className="sidebar-list">
                    {ps.prompts.map((p) => (
                        <div
                            key={p.name}
                            className={`sidebar-item${p.name === ps.selectedPromptName ? " active" : ""}`}
                            title={p.name}
                            onClick={() => model.selectPrompt(p.name)}
                        >
                            <span className="prompt-name">{p.name}</span>
                            {p.description && (
                                <span className="prompt-desc-preview">{p.description}</span>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <Splitter
                type="vertical"
                initialWidth={sidebarWidth}
                onChangeWidth={setSidebarWidth}
                borderSized="right"
            />

            {/* Detail */}
            {selectedPrompt ? (
                <div className="prompt-detail">
                    <div className="prompt-detail-top">
                        <div className="detail-name">{selectedPrompt.name}</div>
                        {selectedPrompt.description && (
                            <div className="detail-description">{selectedPrompt.description}</div>
                        )}

                        {/* Arguments */}
                        <div className="section-title">Arguments</div>
                        {selectedPrompt.arguments.length === 0 ? (
                            <div className="no-args">No arguments</div>
                        ) : (
                            selectedPrompt.arguments.map((arg) => (
                                <div className="arg-field" key={arg.name}>
                                    <div className="arg-label">
                                        <span>{arg.name}</span>
                                        {arg.required && <span className="arg-required">required</span>}
                                    </div>
                                    <TextAreaField
                                        value={ps.promptArgs[arg.name] || ""}
                                        onChange={(v) => model.setPromptArg(arg.name, v)}
                                        placeholder={arg.description || ""}
                                        readonly={ps.getPromptLoading}
                                    />
                                    {arg.description && <div className="arg-desc">{arg.description}</div>}
                                </div>
                            ))
                        )}

                        <div>
                            <Button
                                type="flat"
                                size="small"
                                onClick={handleGetPrompt}
                                disabled={ps.getPromptLoading}
                            >
                                {ps.getPromptLoading ? "Loading…" : "Get Prompt"}
                            </Button>
                        </div>

                        {ps.promptError && (
                            <div className="error-text">{ps.promptError}</div>
                        )}
                    </div>

                    {/* Messages */}
                    {ps.promptMessages && ps.promptMessages.length > 0 && (
                        <div className="prompt-detail-messages">
                            <div className="section-title" style={{ marginBottom: 8 }}>Messages</div>
                            {ps.promptMessages.map((msg, i) => (
                                <MessageView key={i} message={msg} />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="empty-detail">
                    {ps.prompts.length === 0
                        ? "No prompts available on this server."
                        : "Select a prompt from the sidebar."}
                </div>
            )}
        </PromptsPanelRoot>
    );
}

// ============================================================================
// MessageView
// ============================================================================

function MessageView({ message }: { message: McpPromptMessage }) {
    return (
        <div className="message">
            <div className={`message-role ${message.role}`}>{message.role}</div>
            {message.content.map((block, i) => (
                <MessageContentBlock key={i} block={block} />
            ))}
        </div>
    );
}

function MessageContentBlock({ block }: { block: McpPromptMessage["content"][number] }) {
    if (block.type === "text") {
        return <div className="message-text">{block.text}</div>;
    }
    if (block.type === "image") {
        return (
            <img
                className="message-image"
                src={`data:${block.mimeType};base64,${block.data}`}
                alt="Prompt content"
            />
        );
    }
    if (block.type === "resource") {
        return (
            <>
                <div className="message-resource-uri">{block.resource.uri}</div>
                {block.resource.text && <div className="message-text">{block.resource.text}</div>}
            </>
        );
    }
    if (block.type === "resource_link") {
        return <div className="message-resource-uri">{block.name || block.uri}</div>;
    }
    return null;
}
