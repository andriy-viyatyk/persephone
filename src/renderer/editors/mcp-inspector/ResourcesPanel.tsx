import { useCallback, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Button } from "../../components/basic/Button";
import { Splitter } from "../../components/layout/Splitter";
import { McpInspectorModel } from "./McpInspectorModel";
import { ResourceContentView } from "./ResourceContentView";

// ============================================================================
// Styles
// ============================================================================

const ResourcesPanelRoot = styled.div({
    display: "flex",
    flex: "1 1 auto",
    overflow: "hidden",

    "& .res-sidebar": {
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
        fontSize: 10,
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

    "& .res-name": {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: color.text.default,
    },

    "& .res-uri": {
        fontSize: 11,
        color: color.misc.blue,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        marginTop: 1,
    },

    "& .section-label": {
        padding: "6px 12px",
        fontSize: 10,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        background: color.background.dark,
        borderBottom: `1px solid ${color.border.light}`,
    },

    "& .res-detail": {
        flex: "1 1 auto",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },

    "& .res-detail-top": {
        flexShrink: 0,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },

    "& .res-detail-content": {
        flex: "1 1 auto",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px 16px",
        minHeight: 80,
    },

    "& .detail-name": {
        fontSize: 16,
        fontWeight: 500,
        color: color.text.strong,
    },

    "& .detail-uri": {
        fontSize: 12,
        color: color.misc.blue,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        wordBreak: "break-all",
    },

    "& .detail-description": {
        fontSize: 12,
        color: color.text.light,
        lineHeight: 1.5,
    },

    "& .detail-mime": {
        display: "inline-block",
        fontSize: 10,
        color: color.text.light,
        background: color.background.light,
        padding: "2px 6px",
        borderRadius: 2,
    },

    "& .error-text": {
        fontSize: 12,
        color: color.error.text,
    },

    "& .empty-detail": {
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: color.text.light,
        fontSize: 13,
    },
});

// ============================================================================
// Component
// ============================================================================

interface ResourcesPanelProps {
    model: McpInspectorModel;
}

export function ResourcesPanel({ model }: ResourcesPanelProps) {
    const rs = model.resourcesState.use();
    const [sidebarWidth, setSidebarWidth] = useState(260);

    const selectedRes = rs.resources.find((r) => r.uri === rs.selectedUri) || null;

    const handleRead = useCallback(() => {
        model.readResource();
    }, [model]);

    const totalCount = rs.resources.length + rs.templates.length;

    return (
        <ResourcesPanelRoot>
            {/* Sidebar */}
            <div className="res-sidebar" style={{ width: sidebarWidth }}>
                <div className="sidebar-header">
                    <span>Resources</span>
                    <span className="sidebar-count">{totalCount}</span>
                </div>
                <div className="sidebar-list">
                    {rs.resources.map((r) => (
                        <div
                            key={r.uri}
                            className={`sidebar-item${r.uri === rs.selectedUri ? " active" : ""}`}
                            title={r.uri}
                            onClick={() => model.selectResource(r.uri)}
                        >
                            <span className="res-name">{r.name}</span>
                            <span className="res-uri">{r.uri}</span>
                        </div>
                    ))}
                    {rs.templates.length > 0 && (
                        <>
                            <div className="section-label">Templates</div>
                            {rs.templates.map((t) => (
                                <div
                                    key={t.uriTemplate}
                                    className="sidebar-item"
                                    title={t.uriTemplate}
                                >
                                    <span className="res-name">{t.name}</span>
                                    <span className="res-uri">{t.uriTemplate}</span>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </div>

            <Splitter
                type="vertical"
                initialWidth={sidebarWidth}
                onChangeWidth={setSidebarWidth}
                borderSized="right"
            />

            {/* Detail */}
            {selectedRes ? (
                <div className="res-detail">
                    <div className="res-detail-top">
                        <div className="detail-name">{selectedRes.name}</div>
                        <div className="detail-uri">{selectedRes.uri}</div>
                        {selectedRes.description && (
                            <div className="detail-description">{selectedRes.description}</div>
                        )}
                        {selectedRes.mimeType && (
                            <span className="detail-mime">{selectedRes.mimeType}</span>
                        )}
                        <div>
                            <Button
                                type="flat"
                                size="small"
                                onClick={handleRead}
                                disabled={rs.readLoading}
                            >
                                {rs.readLoading ? "Reading…" : "Read Resource"}
                            </Button>
                        </div>
                        {rs.readError && (
                            <div className="error-text">{rs.readError}</div>
                        )}
                    </div>

                    {rs.readContent && (
                        <div className="res-detail-content">
                            <ResourceContentView content={rs.readContent} />
                        </div>
                    )}
                </div>
            ) : (
                <div className="empty-detail">
                    {totalCount === 0
                        ? "No resources available on this server."
                        : "Select a resource from the sidebar."}
                </div>
            )}
        </ResourcesPanelRoot>
    );
}
