import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GraphViewModel } from "./GraphViewModel";
import { NodeShape } from "./types";
import { ShapeIcon, LevelIcon } from "./GraphIcons";

// =============================================================================
// Constants
// =============================================================================

const ALL_SHAPES: NodeShape[] = ["circle", "square", "diamond", "triangle", "star", "hexagon"];
type LegendTab = "level" | "shape" | "selection";
type SelectionFilter = "" | "selected" | "not-selected" | "selected-with-children";

// =============================================================================
// Component
// =============================================================================

interface GraphLegendPanelProps {
    vm: GraphViewModel;
}

export function GraphLegendPanel({ vm }: GraphLegendPanelProps) {
    const [expanded, setExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState<LegendTab>("selection");
    const [checkedLevels, setCheckedLevels] = useState<Set<string>>(new Set());
    const [checkedShapes, setCheckedShapes] = useState<Set<string>>(new Set());
    const [selectionFilter, setSelectionFilter] = useState<SelectionFilter>("");
    const [descriptions, setDescriptions] = useState<Record<string, Record<string, string>>>({ levels: {}, shapes: {} });
    // Track selected node IDs to reactively update the Selection tab highlight
    const selectedKey = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get().selectedNodes.map((n) => n.id).join(","),
    );
    const searchQuery = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get().searchQuery,
    );
    const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Register callback for "Highlight" action from selection menu
    useEffect(() => {
        vm.onHighlightSelection = () => {
            setExpanded(true);
            setActiveTab("selection");
            setSelectionFilter("selected");
        };
        return () => { vm.onHighlightSelection = null; };
    }, [vm]);

    // Load descriptions from VM on mount and when data changes
    useEffect(() => {
        const legend = vm.getLegendDescriptions();
        setDescriptions({
            levels: { ...legend.levels },
            shapes: { ...legend.shapes },
        });
    }, [vm]);

    // Compute which levels/shapes are present
    const { presentLevels, presentShapes, hasRoot, hasGroup } = useMemo(() => {
        const info = vm.getPresentLevelsAndShapes();
        return {
            presentLevels: [...info.levels].sort((a, b) => a - b),
            presentShapes: ALL_SHAPES.filter((s) => info.shapes.has(s)),
            hasRoot: info.hasRoot,
            hasGroup: info.hasGroup,
        };
    }, [vm]);

    // Update highlighting when checkboxes change or panel expands/collapses
    useEffect(() => {
        if (!expanded) {
            vm.setLegendHighlight(null);
            return;
        }

        if (activeTab === "selection") {
            if (!selectionFilter) {
                vm.setLegendHighlight(null);
                return;
            }
            const selectedIds = vm.renderer.selectedIds;
            if (selectedIds.size === 0) {
                vm.setLegendHighlight(null);
                return;
            }
            if (selectionFilter === "selected") {
                vm.setLegendHighlight(new Set(selectedIds));
            } else if (selectionFilter === "selected-with-children") {
                const ids = new Set(selectedIds);
                const cm = vm.connectivityModel;
                for (const nodeId of selectedIds) {
                    for (const id of cm.getProcessedNeighborIds(nodeId)) ids.add(id);
                    for (const id of cm.getRealNeighborIds(nodeId)) ids.add(id);
                }
                vm.setLegendHighlight(ids);
            } else {
                const allIds = new Set(vm.renderer.getNodes().map((n) => n.id));
                for (const id of selectedIds) allIds.delete(id);
                vm.setLegendHighlight(allIds.size > 0 ? allIds : new Set());
            }
            return;
        }

        const checked = activeTab === "level" ? checkedLevels : checkedShapes;
        if (checked.size === 0) {
            vm.setLegendHighlight(null);
            return;
        }

        if (activeTab === "level") {
            const levelNums = new Set<number>();
            let includeRoot = false;
            let includeGroup = false;
            for (const key of checked) {
                if (key === "root") includeRoot = true;
                else if (key === "group") includeGroup = true;
                else levelNums.add(Number(key));
            }
            const ids = vm.getNodeIdsByLegendFilter({ levels: levelNums.size > 0 ? levelNums : undefined, includeRoot, includeGroup });
            vm.setLegendHighlight(ids.size > 0 ? ids : new Set());
        } else {
            const shapeNames = new Set<string>();
            let includeRoot = false;
            let includeGroup = false;
            for (const key of checked) {
                if (key === "root") includeRoot = true;
                else if (key === "group") includeGroup = true;
                else shapeNames.add(key);
            }
            const ids = vm.getNodeIdsByLegendFilter({ shapes: shapeNames.size > 0 ? shapeNames : undefined, includeRoot, includeGroup });
            vm.setLegendHighlight(ids.size > 0 ? ids : new Set());
        }
    }, [vm, expanded, activeTab, checkedLevels, checkedShapes, selectionFilter, selectedKey]);

    const toggleCheck = useCallback((tab: LegendTab, key: string) => {
        const setter = tab === "level" ? setCheckedLevels : setCheckedShapes;
        setter((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const handleDescriptionChange = useCallback((tab: "levels" | "shapes", key: string, value: string) => {
        // Update local state immediately
        setDescriptions((prev) => ({
            ...prev,
            [tab]: { ...prev[tab], [key]: value },
            // Sync root across tabs
            ...(key === "root" ? { [tab === "levels" ? "shapes" : "levels"]: { ...prev[tab === "levels" ? "shapes" : "levels"], root: value } } : {}),
        }));

        // Debounce persistence
        const timerKey = `${tab}:${key}`;
        const existing = debounceTimers.current.get(timerKey);
        if (existing) clearTimeout(existing);
        debounceTimers.current.set(timerKey, setTimeout(() => {
            vm.setLegendDescription(tab, key, value);
            debounceTimers.current.delete(timerKey);
        }, 300));
    }, [vm]);

    // Cleanup timers
    useEffect(() => () => {
        for (const timer of debounceTimers.current.values()) clearTimeout(timer);
    }, []);

    const toggleExpanded = useCallback(() => {
        setExpanded((prev) => !prev);
    }, []);

    // Nothing to show if no levels/shapes present
    if (presentLevels.length === 0 && presentShapes.length === 0 && !hasRoot && !hasGroup) return null;

    return (
        <div className={`graph-legend${expanded ? " expanded" : ""}`}>
            <div className="legend-header" onClick={toggleExpanded}>
                <span className="legend-title">Legend</span>
                <span className={`legend-chevron${expanded ? " expanded" : ""}`}>{expanded ? "\u25BC" : "\u25B2"}</span>
            </div>
            {expanded && (
                <>
                    {searchQuery ? (
                        <div className="legend-search-notice">
                            <span>Search highlighting is active</span>
                            <button className="legend-clear-search" onClick={() => vm.setSearchQuery("")}>Clear search</button>
                        </div>
                    ) : (
                    <>
                    <div className="legend-tabs">
                        <button
                            className={`legend-tab${activeTab === "selection" ? " active" : ""}`}
                            onClick={() => setActiveTab("selection")}
                        >
                            Selection
                        </button>
                        <button
                            className={`legend-tab${activeTab === "level" ? " active" : ""}`}
                            onClick={() => setActiveTab("level")}
                        >
                            Level
                        </button>
                        <button
                            className={`legend-tab${activeTab === "shape" ? " active" : ""}`}
                            onClick={() => setActiveTab("shape")}
                        >
                            Shape
                        </button>
                    </div>
                    <div className="legend-content">
                        {activeTab === "level" && (
                            <>
                                {hasRoot && (
                                    <LegendRow
                                        key="root"

                                        label="Root"
                                        icon={<LevelIcon level="root" size={14} />}
                                        checked={checkedLevels.has("root")}
                                        description={descriptions.levels?.root ?? ""}
                                        onToggle={() => toggleCheck("level", "root")}
                                        onDescriptionChange={(v) => handleDescriptionChange("levels", "root", v)}
                                    />
                                )}
                                {hasGroup && (
                                    <LegendRow
                                        key="group"

                                        label="Group"
                                        icon={<ShapeIcon shape="group" size={14} />}
                                        checked={checkedLevels.has("group")}
                                        description={descriptions.levels?.group ?? ""}
                                        onToggle={() => toggleCheck("level", "group")}
                                        onDescriptionChange={(v) => handleDescriptionChange("levels", "group", v)}
                                    />
                                )}
                                {presentLevels.map((level) => (
                                    <LegendRow
                                        key={level}

                                        label={`Level ${level}`}
                                        icon={<LevelIcon level={level} size={14} />}
                                        checked={checkedLevels.has(String(level))}
                                        description={descriptions.levels?.[String(level)] ?? ""}
                                        onToggle={() => toggleCheck("level", String(level))}
                                        onDescriptionChange={(v) => handleDescriptionChange("levels", String(level), v)}
                                    />
                                ))}
                            </>
                        )}
                        {activeTab === "shape" && (
                            <>
                                {hasRoot && (
                                    <LegendRow
                                        key="root"

                                        label="Root"
                                        icon={<ShapeIcon shape="root" size={14} />}
                                        checked={checkedShapes.has("root")}
                                        description={descriptions.shapes?.root ?? ""}
                                        onToggle={() => toggleCheck("shape", "root")}
                                        onDescriptionChange={(v) => handleDescriptionChange("shapes", "root", v)}
                                    />
                                )}
                                {hasGroup && (
                                    <LegendRow
                                        key="group"

                                        label="Group"
                                        icon={<ShapeIcon shape="group" size={14} />}
                                        checked={checkedShapes.has("group")}
                                        description={descriptions.shapes?.group ?? ""}
                                        onToggle={() => toggleCheck("shape", "group")}
                                        onDescriptionChange={(v) => handleDescriptionChange("shapes", "group", v)}
                                    />
                                )}
                                {presentShapes.map((shape) => (
                                    <LegendRow
                                        key={shape}

                                        label={shape.charAt(0).toUpperCase() + shape.slice(1)}
                                        icon={<ShapeIcon shape={shape} size={14} />}
                                        checked={checkedShapes.has(shape)}
                                        description={descriptions.shapes?.[shape] ?? ""}
                                        onToggle={() => toggleCheck("shape", shape)}
                                        onDescriptionChange={(v) => handleDescriptionChange("shapes", shape, v)}
                                    />
                                ))}
                            </>
                        )}
                        {activeTab === "selection" && (
                            <>
                                <SelectionRadioRow
                                    label="Selected"
                                    checked={selectionFilter === "selected"}
                                    onToggle={() => setSelectionFilter((prev) => prev === "selected" ? "" : "selected")}
                                />
                                <SelectionRadioRow
                                    label="Selected with children"
                                    checked={selectionFilter === "selected-with-children"}
                                    onToggle={() => setSelectionFilter((prev) => prev === "selected-with-children" ? "" : "selected-with-children")}
                                />
                                <SelectionRadioRow
                                    label="Not selected"
                                    checked={selectionFilter === "not-selected"}
                                    onToggle={() => setSelectionFilter((prev) => prev === "not-selected" ? "" : "not-selected")}
                                />
                            </>
                        )}
                    </div>
                    </>
                    )}
                </>
            )}
        </div>
    );
}

// =============================================================================
// LegendRow
// =============================================================================

interface LegendRowProps {
    label: string;
    icon: React.ReactNode;
    checked: boolean;
    description: string;
    onToggle: () => void;
    onDescriptionChange: (value: string) => void;
}

function LegendRow({ label, icon, checked, description, onToggle, onDescriptionChange }: LegendRowProps) {
    return (
        <div className="legend-row">
            <input
                type="checkbox"
                className="legend-checkbox"
                checked={checked}
                onChange={onToggle}
            />
            <span className="legend-icon">{icon}</span>
            <span className="legend-label">{label}</span>
            <input
                type="text"
                className="legend-description"
                placeholder="Description..."
                value={description}
                onChange={(e) => onDescriptionChange(e.target.value)}
            />
        </div>
    );
}

// =============================================================================
// SelectionRadioRow
// =============================================================================

interface SelectionRadioRowProps {
    label: string;
    checked: boolean;
    onToggle: () => void;
}

function SelectionRadioRow({ label, checked, onToggle }: SelectionRadioRowProps) {
    return (
        <div className="legend-row">
            <input
                type="radio"
                className="legend-checkbox"
                checked={checked}
                onChange={onToggle}
            />
            <span className="legend-label">{label}</span>
        </div>
    );
}
