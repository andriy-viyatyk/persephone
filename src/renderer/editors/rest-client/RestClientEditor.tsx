import styled from "@emotion/styled";
import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Splitter } from "../../components/layout/Splitter";
import { TreeView, TreeItem } from "../../components/TreeView";
import { TextAreaField } from "../../components/basic/TextAreaField";
import color from "../../theme/color";
import { CopyIcon, DeleteIcon, PlusIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import type { MenuItem } from "../../components/overlay/PopupMenu";
import { app } from "../../api/app";
import { EditorError } from "../base/EditorError";
import { useContentViewModel } from "../base/useContentViewModel";
import { RestClientViewModel, RestClientEditorState, defaultRestClientEditorState } from "./RestClientViewModel";
import { RestClientData, RestRequest } from "./restClientTypes";
import { RequestBuilder } from "./RequestBuilder";
import { ResponseViewer, getResponseSize } from "./ResponseViewer";
import { METHOD_COLORS } from "./httpConstants";
import { IContentHost } from "../base/IContentHost";

// =============================================================================
// Tree item type
// =============================================================================

const REST_REQUEST_DRAG = "rest-request-drag";

interface RequestTreeItem extends TreeItem {
    id: string;
    request?: RestRequest;
    isRoot?: boolean;
    isCollection?: boolean;
    collectionName?: string;
}

const EMPTY_LABEL = "(empty)";

function buildGroupedTree(requests: RestRequest[]): RequestTreeItem[] {
    const collectionOrder: string[] = [];
    const groups = new Map<string, RequestTreeItem[]>();

    for (const r of requests) {
        const col = r.collection || "";
        if (!groups.has(col)) {
            collectionOrder.push(col);
            groups.set(col, []);
        }
        groups.get(col)!.push({ id: r.id, request: r });
    }

    return collectionOrder.map((col) => ({
        id: `__col__${col}`,
        isCollection: true,
        collectionName: col,
        items: groups.get(col)!,
    }));
}

// =============================================================================
// Styles
// =============================================================================

const RestClientRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",

    // ── Left panel ──
    "& .left-panel": {
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: color.background.default,
        minWidth: 150,
        maxWidth: "80%",
        flexShrink: 0,
    },
    "& .left-panel-header": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        padding: "4px 8px",
        gap: 4,
        borderBottom: `1px solid ${color.border.default}`,
    },
    "& .left-panel-title": {
        flex: "1 1 auto",
        fontSize: 12,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
    },
    "& .left-panel-tree": {
        flex: "1 1 auto",
        overflow: "auto",
    },
    "& .method-badge": {
        display: "inline-block",
        fontSize: 9,
        fontWeight: 700,
        fontFamily: "monospace",
        padding: "1px 4px",
        borderRadius: 2,
        marginRight: 6,
        minWidth: 32,
        textAlign: "center",
    },
    "& .request-name": {
        fontSize: 13,
        color: color.text.default,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "& .collection-name": {
        fontSize: 13,
        fontWeight: 600,
        color: color.text.default,
    },
    "& .empty-label": {
        fontStyle: "italic",
        color: color.text.light,
    },

    // ── Right panel (detail area with top/bottom split) ──
    "& .right-panel": {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        "& .splitter": {
            borderTop: "none",
        },
    },
    "& .empty-message": {
        color: color.text.light,
        fontSize: 13,
        textAlign: "center",
        padding: 24,
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },

    // ── Split panel headers (double-click to toggle) ──
    "& .panel-header": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        fontSize: 12,
        fontWeight: 600,
        color: color.text.light,
        background: color.background.dark,
        borderBottom: `1px solid ${color.border.default}`,
        flexShrink: 0,
        cursor: "default",
        userSelect: "none",
        letterSpacing: "0.5px",
    },
    "& .panel-header-spacer": {
        flex: "1 1 auto",
    },
    "& .request-header-input": {
        minHeight: 18,
        padding: "1px 4px",
        fontSize: 12,
        fontFamily: "monospace",
        color: color.text.default,
        backgroundColor: "transparent",
        border: `1px solid transparent`,
        borderRadius: 3,
        "&:focus[contenteditable='plaintext-only']": {
            backgroundColor: color.background.default,
            borderColor: color.border.default,
        },
    },
    "& .request-header-collection": {
        maxWidth: "40%",
        flexShrink: 1,
    },
    "& .request-header-name": {
        flex: "1 1 auto",
        minWidth: 50,
    },
    "& .request-header-separator": {
        fontSize: 12,
        color: color.text.light,
        flexShrink: 0,
    },
    "& .delete-button": {
        flexShrink: 0,
        opacity: 0.5,
        "&:hover": {
            opacity: 1,
        },
    },

    // ── Top panel (request) ──
    "& .request-panel": {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        "& .panel-header": {
            borderBottom: "none",
        },
    },
    "& .request-panel-body": {
        flex: "1 1 auto",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
    },

    // ── Bottom panel (response) ──
    "& .response-panel": {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        "& .panel-header": {
            borderBottom: "none",
            borderTop: `1px solid ${color.border.default}`,
        },
    },
    "& .response-panel-body": {
        flex: "1 1 auto",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },
    "& .response-status": {
        fontWeight: 600,
        fontFamily: "monospace",
        fontSize: 12,
        marginRight: 4,
    },
    "& .response-time": {
        fontSize: 11,
        color: color.text.light,
        marginRight: 4,
    },
    "& .response-body": {
        flex: "1 1 auto",
        padding: 8,
        fontSize: 13,
        fontFamily: "monospace",
        color: color.text.default,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
    },
    "& .sending-message": {
        padding: 12,
        fontSize: 13,
        color: color.text.light,
    },
}, { label: "RestClientRoot" });

// =============================================================================
// Component
// =============================================================================

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultRestClientEditorState;

export function RestClientEditor({ model }: { model: IContentHost }) {
    const vm = useContentViewModel<RestClientViewModel>(model, "rest-client");

    const state: RestClientEditorState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    const [leftPanelWidth, setLeftPanelWidth] = useState(state.leftPanelWidth);
    const handleLeftPanelWidthChange = useMemo(() => (width: number) => {
        const clamped = Math.max(150, Math.min(500, width));
        setLeftPanelWidth(clamped);
        vm?.setLeftPanelWidth(clamped);
    }, [vm]);

    if (!vm) return null;

    if (state.error) {
        return (
            <RestClientRoot>
                <EditorError>{state.error}</EditorError>
            </RestClientRoot>
        );
    }

    const selectedRequest = vm.selectedRequest;

    const rootItem: RequestTreeItem = {
        id: "__root__",
        isRoot: true,
        items: buildGroupedTree(state.data.requests),
    };

    return (
        <RestClientRoot>
            <div className="left-panel" style={{ width: leftPanelWidth }}>
                <div className="left-panel-header">
                    <span className="left-panel-title">Requests</span>
                    <Button
                        size="small"
                        type="icon"
                        title="Add request"
                        onClick={() => vm.addRequest()}
                    >
                        <PlusIcon />
                    </Button>
                </div>
                <div className="left-panel-tree">
                    <RequestTree vm={vm} root={rootItem} selectedId={state.selectedRequestId} />
                </div>
            </div>
            <Splitter
                type="vertical"
                initialWidth={leftPanelWidth}
                onChangeWidth={handleLeftPanelWidthChange}
                borderSized="right"
            />
            <div className="right-panel">
                {selectedRequest ? (
                    <SplitDetailPanel vm={vm} request={selectedRequest} state={state} />
                ) : (
                    <div className="empty-message">
                        {state.data.requests.length === 0
                            ? "No requests yet. Click + to add one."
                            : "Select a request from the list."
                        }
                    </div>
                )}
            </div>
        </RestClientRoot>
    );
}

// =============================================================================
// SplitDetailPanel — request (top) + response (bottom)
// =============================================================================

function SplitDetailPanel({ vm, request, state }: {
    vm: RestClientViewModel;
    request: RestRequest;
    state: RestClientEditorState;
}) {
    const detailRef = useRef<HTMLDivElement>(null);
    const [resultHeight, setResultHeight] = useState<number | null>(null);

    const getClampedHeight = useCallback((h: number) => {
        const container = detailRef.current;
        if (!container) return h;
        const total = container.clientHeight;
        return Math.max(total * 0.1, Math.min(total * 0.9, h));
    }, []);

    const handleResultHeightChange = useCallback((h: number) => {
        setResultHeight(getClampedHeight(h));
    }, [getClampedHeight]);

    const togglePanelHeight = useCallback((expandedRatio: number) => {
        const container = detailRef.current;
        if (!container) return;
        const total = container.clientHeight;
        const expanded = total * expandedRatio;
        const collapsed = total * (1 - expandedRatio);
        const current = resultHeight ?? total * 0.3;
        const isExpanded = Math.abs(current - expanded) < total * 0.05;
        setResultHeight(isExpanded ? collapsed : expanded);
    }, [resultHeight]);

    const handleTopHeaderDblClick = useCallback(() => {
        togglePanelHeight(0.3);
    }, [togglePanelHeight]);

    const handleBottomHeaderDblClick = useCallback(() => {
        togglePanelHeight(0.7);
    }, [togglePanelHeight]);

    const getInitialResultHeight = useCallback(() => {
        if (resultHeight !== null) return resultHeight;
        const container = detailRef.current;
        if (!container) return 200;
        return container.clientHeight * 0.3;
    }, [resultHeight]);

    const currentResultHeight = resultHeight ?? getInitialResultHeight();
    const topFlex = resultHeight !== null ? "1 1 auto" : "7 1 0";
    const bottomStyle = resultHeight !== null
        ? { height: currentResultHeight, flexShrink: 0, flexGrow: 0 }
        : { flex: "3 1 0", minHeight: 0 };

    const handleCollectionChange = useCallback(
        (value: string) => vm.updateRequestCollection(request.id, value),
        [vm, request.id],
    );

    const handleNameChange = useCallback(
        (value: string) => vm.renameRequest(request.id, value),
        [vm, request.id],
    );

    const handleDelete = useCallback(async () => {
        const name = request.name || EMPTY_LABEL;
        const result = await app.ui.confirm(`Delete "${name}"?`);
        if (result) vm.deleteRequest(request.id);
    }, [vm, request.id, request.name]);

    const copyMenuItems: MenuItem[] = useMemo(() => [
        {
            label: "Copy as cURL (bash)",
            onClick: async () => {
                const { serializeAsCurlBash } = await import("./serializeRequest");
                navigator.clipboard.writeText(serializeAsCurlBash(request));
            },
        },
        {
            label: "Copy as cURL (cmd)",
            onClick: async () => {
                const { serializeAsCurlCmd } = await import("./serializeRequest");
                navigator.clipboard.writeText(serializeAsCurlCmd(request));
            },
        },
        {
            label: "Copy as fetch",
            onClick: async () => {
                const { serializeAsFetch } = await import("./serializeRequest");
                navigator.clipboard.writeText(serializeAsFetch(request));
            },
        },
        {
            label: "Copy as fetch (Node.js)",
            onClick: async () => {
                const { serializeAsFetchNodeJs } = await import("./serializeRequest");
                navigator.clipboard.writeText(serializeAsFetchNodeJs(request));
            },
        },
    ], [request]);

    return (
        <div ref={detailRef} style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", overflow: "hidden" }}>
            {/* Top: Request */}
            <div className="request-panel" style={{ flex: topFlex, overflow: "hidden", minHeight: 0 }}>
                <div className="panel-header" onDoubleClick={handleTopHeaderDblClick}>
                    <TextAreaField
                        className="request-header-input request-header-collection"
                        value={request.collection}
                        onChange={handleCollectionChange}
                        placeholder="Collection"
                        singleLine
                    />
                    <span className="request-header-separator">/</span>
                    <TextAreaField
                        className="request-header-input request-header-name"
                        value={request.name}
                        onChange={handleNameChange}
                        placeholder="Request name"
                        singleLine
                    />
                    <div className="panel-header-spacer" />
                    <WithPopupMenu items={copyMenuItems}>
                        {(setOpen) => (
                            <Button
                                size="small"
                                type="icon"
                                className="delete-button"
                                title="Copy request as..."
                                onClick={(e) => setOpen(e.currentTarget)}
                            >
                                <CopyIcon />
                            </Button>
                        )}
                    </WithPopupMenu>
                    <Button
                        size="small"
                        type="icon"
                        className="delete-button"
                        title="Delete request"
                        onClick={handleDelete}
                    >
                        <DeleteIcon />
                    </Button>
                </div>
                <div className="request-panel-body">
                    <RequestBuilder vm={vm} request={request} state={state} />
                </div>
            </div>

            {/* Horizontal splitter */}
            <Splitter
                type="horizontal"
                initialHeight={currentResultHeight}
                onChangeHeight={handleResultHeightChange}
                borderSized="top"
            />

            {/* Bottom: Response */}
            <div className="response-panel" style={bottomStyle as any}>
                <div className="panel-header" onDoubleClick={handleBottomHeaderDblClick}>
                    <span>Response</span>
                    <div className="panel-header-spacer" />
                    {state.response && (
                        <>
                            <span className="response-status" style={{ color: getStatusColor(state.response.status) }}>
                                {state.response.status === 0 ? "Error" : `${state.response.status} ${state.response.statusText}`}
                            </span>
                            <span className="response-time">{state.responseTime}ms</span>
                            <span className="response-time">{getResponseSize(state.response)}</span>
                        </>
                    )}
                </div>
                <div className="response-panel-body">
                    <ResponseViewer response={state.response} responseTime={state.responseTime} executing={state.executing} />
                </div>
            </div>
        </div>
    );
}

// =============================================================================
// Helpers
// =============================================================================

function getStatusColor(status: number): string {
    if (status === 0) return "#f93e3e";
    if (status < 300) return "#49cc90";
    if (status < 400) return "#61affe";
    if (status < 500) return "#fca130";
    return "#f93e3e";
}

// =============================================================================
// RequestTree sub-component
// =============================================================================

function RequestTree({ vm, root, selectedId }: {
    vm: RestClientViewModel;
    root: RequestTreeItem;
    selectedId: string;
}) {
    const getLabel = useCallback((item: RequestTreeItem) => {
        if (item.isRoot) return "Collection";
        if (item.isCollection) {
            const name = item.collectionName;
            return (
                <span className={`collection-name ${!name ? "empty-label" : ""}`}>
                    {name || EMPTY_LABEL}
                </span>
            );
        }
        const req = item.request!;
        const badgeColor = METHOD_COLORS[req.method] || color.text.light;
        return (
            <>
                <span className="method-badge" style={{ color: badgeColor }}>
                    {req.method}
                </span>
                <span className={`request-name ${!req.name ? "empty-label" : ""}`}>
                    {req.name || EMPTY_LABEL}
                </span>
            </>
        );
    }, []);

    const getId = useCallback((item: RequestTreeItem) => item.id, []);

    const getSelected = useCallback(
        (item: RequestTreeItem) => item.id === selectedId,
        [selectedId],
    );

    const onItemClick = useCallback(
        (item: RequestTreeItem) => {
            if (item.request) vm.selectRequest(item.id);
        },
        [vm],
    );

    const onItemContextMenu = useCallback(
        (item: RequestTreeItem, e: React.MouseEvent) => {
            if (item.isRoot) return;
            e.preventDefault();

            if (item.isCollection) {
                const colName = item.collectionName ?? "";
                const menuItems: MenuItem[] = [
                    {
                        label: "Add Request",
                        onClick: () => vm.addRequest(undefined, colName),
                    },
                    {
                        label: "Open in New Editor",
                        onClick: () => {
                            const requests = vm.state.get().data.requests
                                .filter((r) => r.collection === colName)
                                .map((r) => ({ ...r }));
                            const data: RestClientData = { type: "rest-client", requests };
                            const title = colName || EMPTY_LABEL;
                            app.pages.addEditorPage("rest-client", "json", `${title}.rest.json`, JSON.stringify(data, null, 4));
                        },
                    },
                    {
                        label: "Delete Collection",
                        startGroup: true,
                        onClick: async () => {
                            const label = colName || EMPTY_LABEL;
                            const result = await app.ui.confirm(`Delete all requests in "${label}"?`);
                            if (result) vm.deleteCollection(colName);
                        },
                    },
                ];
                showContextMenu(e, menuItems);
                return;
            }

            const req = item.request!;
            const menuItems: MenuItem[] = [
                {
                    label: "Duplicate",
                    onClick: () => {
                        const newReq = vm.addRequest(`${req.name} (copy)`, req.collection);
                        vm.updateRequest(newReq.id, {
                            method: req.method,
                            url: req.url,
                            headers: [...req.headers],
                            body: req.body,
                            bodyType: req.bodyType,
                            bodyLanguage: req.bodyLanguage,
                            formData: [...req.formData],
                        });
                    },
                },
                {
                    label: "Open in New Editor",
                    onClick: () => {
                        const data: RestClientData = {
                            type: "rest-client",
                            requests: [{ ...req }],
                        };
                        app.pages.addEditorPage("rest-client", "json", `${req.name || "Request"}.rest.json`, JSON.stringify(data, null, 4));
                    },
                },
                {
                    label: "Delete",
                    startGroup: true,
                    onClick: async () => {
                        const name = req.name || EMPTY_LABEL;
                        const result = await app.ui.confirm(`Delete "${name}"?`);
                        if (result) vm.deleteRequest(item.id);
                    },
                },
            ];
            showContextMenu(e, menuItems);
        },
        [vm],
    );

    const getDragItem = useCallback(
        (item: RequestTreeItem) => {
            if (item.isRoot || item.isCollection) return null;
            return { type: REST_REQUEST_DRAG, id: item.id };
        },
        [],
    );

    const onDrop = useCallback(
        (dropItem: RequestTreeItem, dragItem: { type: string; id: string }) => {
            if (dropItem.isRoot) return;
            if (dropItem.isCollection) {
                // Drop on collection → move to end of that collection
                vm.moveRequest(dragItem.id, dropItem.id, dropItem.collectionName ?? "");
            } else {
                // Drop on request → adopt target's collection
                vm.moveRequest(dragItem.id, dropItem.id, dropItem.request?.collection);
            }
        },
        [vm],
    );

    return (
        <TreeView<RequestTreeItem>
            root={root}
            getLabel={getLabel}
            getId={getId}
            getSelected={getSelected}
            onItemClick={onItemClick}
            onItemContextMenu={onItemContextMenu}
            dragType={REST_REQUEST_DRAG}
            getDragItem={getDragItem}
            dropTypes={[REST_REQUEST_DRAG]}
            onDrop={onDrop}
            defaultExpandAll
            refreshKey={selectedId}
        />
    );
}

/** Show context menu using showAppPopupMenu (lazy import to avoid circular deps). */
async function showContextMenu(e: React.MouseEvent, items: MenuItem[]) {
    const { showAppPopupMenu } = await import("../../ui/dialogs/poppers/showPopupMenu");
    showAppPopupMenu(e.clientX, e.clientY, items);
}
