import { useState, useCallback, useMemo } from "react";
import { Input, Panel, Select } from "../../uikit";
import type { IListBoxItem } from "../../uikit";
import { GraphViewModel } from "./GraphViewModel";
import { nodeLabel } from "./types";
import color from "../../theme/color";

interface GraphExpansionSettingsProps {
    vm: GraphViewModel;
}

/** Sentinel value representing "auto" root selection (no explicit rootNode). */
const AUTO_ROOT = "__auto__";

const labelStyle: React.CSSProperties = {
    width: 72,
    flexShrink: 0,
    fontSize: 11,
    color: color.graph.labelText,
    opacity: 0.8,
};

const noteStyle: React.CSSProperties = {
    fontSize: 10,
    fontStyle: "italic",
    paddingTop: 2,
    color: color.warning.text,
};

function GraphExpansionSettings({ vm }: GraphExpansionSettingsProps) {
    const opts = vm.getExpansionOptions();

    const [rootNode, setRootNode] = useState(opts.rootNode ?? "");
    const [expandDepthStr, setExpandDepthStr] = useState(opts.expandDepth !== undefined ? String(opts.expandDepth) : "");
    const [maxVisibleStr, setMaxVisibleStr] = useState(opts.maxVisible !== undefined ? String(opts.maxVisible) : "");

    const items = useMemo<IListBoxItem[]>(() => {
        const nodes = vm.getAllNodes();
        const sorted = [...nodes].sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));
        return [
            { value: AUTO_ROOT, label: "(auto — lowest level)" },
            ...sorted.map((n) => ({ value: n.id, label: nodeLabel(n) })),
        ];
    }, [vm]);

    const selectedValue = rootNode || AUTO_ROOT;
    const selectedItem = items.find((i) => i.value === selectedValue) ?? null;

    const onRootChange = useCallback((item: IListBoxItem) => {
        const value = String(item.value);
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
        <Panel name="graph-expansion-settings" direction="column" gap="md" paddingX="md" paddingY="sm">
            <Panel direction="row" align="center" gap="md">
                <span style={labelStyle}>Root Node</span>
                <Select
                    name="graph-expansion-root"
                    size="sm"
                    items={items}
                    value={selectedItem}
                    onChange={onRootChange}
                    filterMode="contains"
                />
            </Panel>
            <Panel direction="row" align="center" gap="md">
                <span style={labelStyle}>Expand Depth</span>
                <Input
                    name="graph-expansion-depth"
                    size="sm"
                    placeholder="∞ (unlimited)"
                    value={expandDepthStr}
                    onChange={setExpandDepthStr}
                    onBlur={commitExpandDepth}
                    onKeyDown={(e) => onKeyDown(e, commitExpandDepth)}
                />
            </Panel>
            <Panel direction="row" align="center" gap="md">
                <span style={labelStyle}>Max Visible</span>
                <Input
                    name="graph-expansion-max"
                    size="sm"
                    placeholder="500 (default)"
                    value={maxVisibleStr}
                    onChange={setMaxVisibleStr}
                    onBlur={commitMaxVisible}
                    onKeyDown={(e) => onKeyDown(e, commitMaxVisible)}
                />
            </Panel>
            <span style={noteStyle}>Depth and max visible apply when file is reopened</span>
        </Panel>
    );
}

export { GraphExpansionSettings };
