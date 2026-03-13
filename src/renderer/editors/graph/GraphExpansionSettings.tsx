import { useState, useCallback, useMemo } from "react";
import styled from "@emotion/styled";
import { GraphViewModel } from "./GraphViewModel";
import { nodeLabel } from "./types";
import { ComboSelect } from "../../components/form/ComboSelect";
import color from "../../theme/color";

interface GraphExpansionSettingsProps {
    vm: GraphViewModel;
}

/** Sentinel value representing "auto" root selection (no explicit rootNode). */
const AUTO_ROOT = "__auto__";

const GraphExpansionSettingsRoot = styled.div({
    padding: "6px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 11,
    "& .expansion-row": {
        display: "flex",
        alignItems: "center",
        gap: 6,
    },
    "& .expansion-label": {
        width: 72,
        flexShrink: 0,
        color: color.graph.labelText,
        opacity: 0.8,
    },
    "& .expansion-input": {
        flex: 1,
        minWidth: 0,
    },
    "& .expansion-number": {
        width: "100%",
        boxSizing: "border-box" as const,
        padding: "2px 6px",
        fontSize: 11,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        backgroundColor: color.graph.background,
        color: color.graph.labelText,
        outline: "none",
        "&:focus": {
            borderColor: color.graph.nodeHighlight,
        },
        "&::placeholder": {
            color: color.border.default,
        },
    },
    "& .expansion-note": {
        fontSize: 10,
        opacity: 0.5,
        fontStyle: "italic",
        paddingTop: 2,
    },
});

function GraphExpansionSettings({ vm }: GraphExpansionSettingsProps) {
    const opts = vm.getExpansionOptions();

    const [rootNode, setRootNode] = useState(opts.rootNode ?? "");
    const [expandDepthStr, setExpandDepthStr] = useState(opts.expandDepth !== undefined ? String(opts.expandDepth) : "");
    const [maxVisibleStr, setMaxVisibleStr] = useState(opts.maxVisible !== undefined ? String(opts.maxVisible) : "");

    // Build sorted node list for ComboSelect
    const nodeOptions = useMemo(() => {
        const nodes = vm.getAllNodes();
        const sorted = [...nodes].sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));
        // Prepend auto option
        return [AUTO_ROOT, ...sorted.map((n) => n.id)];
    }, [vm]);

    const getNodeLabel = useCallback((value: string) => {
        if (value === AUTO_ROOT) return "(auto — lowest level)";
        const node = vm.getAllNodes().find((n) => n.id === value);
        return node ? nodeLabel(node) : value;
    }, [vm]);

    const onRootChange = useCallback((value?: string) => {
        const nodeId = value === AUTO_ROOT ? undefined : value;
        setRootNode(nodeId ?? "");
        vm.setRootNode(nodeId);
    }, [vm]);

    const commitExpandDepth = useCallback(() => {
        const trimmed = expandDepthStr.trim();
        if (!trimmed) {
            vm.updateExpansionOptions({ expandDepth: undefined });
        } else {
            const num = parseInt(trimmed, 10);
            if (!isNaN(num) && num >= 1) {
                setExpandDepthStr(String(num));
                vm.updateExpansionOptions({ expandDepth: num });
            } else {
                setExpandDepthStr(opts.expandDepth !== undefined ? String(opts.expandDepth) : "");
            }
        }
    }, [vm, expandDepthStr, opts.expandDepth]);

    const commitMaxVisible = useCallback(() => {
        const trimmed = maxVisibleStr.trim();
        if (!trimmed) {
            vm.updateExpansionOptions({ maxVisible: undefined });
        } else {
            const num = parseInt(trimmed, 10);
            if (!isNaN(num) && num >= 10) {
                setMaxVisibleStr(String(num));
                vm.updateExpansionOptions({ maxVisible: num });
            } else {
                setMaxVisibleStr(opts.maxVisible !== undefined ? String(opts.maxVisible) : "");
            }
        }
    }, [vm, maxVisibleStr, opts.maxVisible]);

    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, commit: () => void) => {
        if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
        }
    }, []);

    return (
        <GraphExpansionSettingsRoot>
            <div className="expansion-row">
                <span className="expansion-label">Root Node</span>
                <div className="expansion-input">
                    <ComboSelect
                        selectFrom={nodeOptions}
                        getLabel={getNodeLabel}
                        value={rootNode || AUTO_ROOT}
                        onChange={onRootChange}
                    />
                </div>
            </div>
            <div className="expansion-row">
                <span className="expansion-label">Expand Depth</span>
                <div className="expansion-input">
                    <input
                        className="expansion-number"
                        type="text"
                        placeholder="∞ (unlimited)"
                        value={expandDepthStr}
                        onChange={(e) => setExpandDepthStr(e.target.value)}
                        onBlur={commitExpandDepth}
                        onKeyDown={(e) => onKeyDown(e, commitExpandDepth)}
                    />
                </div>
            </div>
            <div className="expansion-row">
                <span className="expansion-label">Max Visible</span>
                <div className="expansion-input">
                    <input
                        className="expansion-number"
                        type="text"
                        placeholder="500 (default)"
                        value={maxVisibleStr}
                        onChange={(e) => setMaxVisibleStr(e.target.value)}
                        onBlur={commitMaxVisible}
                        onKeyDown={(e) => onKeyDown(e, commitMaxVisible)}
                    />
                </div>
            </div>
            <div className="expansion-note">
                Depth and max visible apply when file is reopened
            </div>
        </GraphExpansionSettingsRoot>
    );
}

export { GraphExpansionSettings };
