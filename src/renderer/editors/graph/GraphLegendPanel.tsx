import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraphViewModel } from "./GraphViewModel";
import { NodeShape } from "./types";

// =============================================================================
// Constants
// =============================================================================

const ALL_SHAPES: NodeShape[] = ["circle", "square", "diamond", "triangle", "star", "hexagon"];
type LegendTab = "level" | "shape";

// SVG icon helpers (shared with GraphDetailPanel pattern)
const S = 14;
const C = S / 2;
const R = 5;

function starPoints(cx: number, cy: number, outerR: number, innerR: number, spikes: number): string {
    const pts: string[] = [];
    for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
    }
    return pts.join(" ");
}

function hexPoints(cx: number, cy: number, r: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 6;
        pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
    }
    return pts.join(" ");
}

function compassPoints(cx: number, cy: number, outerR: number, innerR: number): string {
    const spikes = 4;
    const pts: string[] = [];
    for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const rad = i % 2 === 0 ? outerR : innerR;
        pts.push(`${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`);
    }
    return pts.join(" ");
}

function ShapeIcon({ shape }: { shape: NodeShape | "root" }) {
    if (shape === "root") {
        return (
            <svg className="legend-shape-icon" width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
                <polygon points={compassPoints(C, C, R * 1.1, R * 0.35)} fill="currentColor" />
            </svg>
        );
    }
    return (
        <svg className="legend-shape-icon" width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
            {shape === "circle" && <circle cx={C} cy={C} r={R} fill="currentColor" />}
            {shape === "square" && <rect x={C - R} y={C - R} width={R * 2} height={R * 2} fill="currentColor" />}
            {shape === "diamond" && (
                <polygon points={`${C},${C - R * 1.2} ${C + R},${C} ${C},${C + R * 1.2} ${C - R},${C}`} fill="currentColor" />
            )}
            {shape === "triangle" && (
                <polygon points={`${C},${C - R * 1.15} ${C + R},${C + R * 0.7} ${C - R},${C + R * 0.7}`} fill="currentColor" />
            )}
            {shape === "star" && <polygon points={starPoints(C, C, R * 1.1, R * 0.5, 5)} fill="currentColor" />}
            {shape === "hexagon" && <polygon points={hexPoints(C, C, R)} fill="currentColor" />}
        </svg>
    );
}

function LevelIcon({ level }: { level: number | "root" }) {
    if (level === "root") {
        return (
            <svg className="legend-shape-icon" width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
                <polygon points={compassPoints(C, C, R * 1.1, R * 0.35)} fill="currentColor" />
            </svg>
        );
    }
    const r = 7 - level; // 6, 5, 4, 3, 2
    return (
        <svg className="legend-shape-icon" width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
            <circle cx={C} cy={C} r={r} fill="currentColor" />
        </svg>
    );
}

// =============================================================================
// Component
// =============================================================================

interface GraphLegendPanelProps {
    vm: GraphViewModel;
}

export function GraphLegendPanel({ vm }: GraphLegendPanelProps) {
    const [expanded, setExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState<LegendTab>("level");
    const [checkedLevels, setCheckedLevels] = useState<Set<string>>(new Set());
    const [checkedShapes, setCheckedShapes] = useState<Set<string>>(new Set());
    const [descriptions, setDescriptions] = useState<Record<string, Record<string, string>>>({ levels: {}, shapes: {} });
    const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Load descriptions from VM on mount and when data changes
    useEffect(() => {
        const legend = vm.getLegendDescriptions();
        setDescriptions({
            levels: { ...legend.levels },
            shapes: { ...legend.shapes },
        });
    }, [vm]);

    // Compute which levels/shapes are present
    const { presentLevels, presentShapes, hasRoot } = useMemo(() => {
        const info = vm.getPresentLevelsAndShapes();
        return {
            presentLevels: [...info.levels].sort((a, b) => a - b),
            presentShapes: ALL_SHAPES.filter((s) => info.shapes.has(s)),
            hasRoot: info.hasRoot,
        };
    }, [vm]);

    // Update highlighting when checkboxes change or panel expands/collapses
    useEffect(() => {
        if (!expanded) {
            vm.setLegendHighlight(null);
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
            for (const key of checked) {
                if (key === "root") includeRoot = true;
                else levelNums.add(Number(key));
            }
            const ids = vm.getNodeIdsByLegendFilter({ levels: levelNums.size > 0 ? levelNums : undefined, includeRoot });
            vm.setLegendHighlight(ids.size > 0 ? ids : new Set());
        } else {
            const shapeNames = new Set<string>();
            let includeRoot = false;
            for (const key of checked) {
                if (key === "root") includeRoot = true;
                else shapeNames.add(key);
            }
            const ids = vm.getNodeIdsByLegendFilter({ shapes: shapeNames.size > 0 ? shapeNames : undefined, includeRoot });
            vm.setLegendHighlight(ids.size > 0 ? ids : new Set());
        }
    }, [vm, expanded, activeTab, checkedLevels, checkedShapes]);

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
    if (presentLevels.length === 0 && presentShapes.length === 0 && !hasRoot) return null;

    return (
        <div className={`graph-legend${expanded ? " expanded" : ""}`}>
            <div className="legend-header" onClick={toggleExpanded}>
                <span className="legend-title">Legend</span>
                <span className="legend-chevron">{expanded ? "\u25BC" : "\u25B2"}</span>
            </div>
            {expanded && (
                <>
                    <div className="legend-tabs">
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
                                        icon={<LevelIcon level="root" />}
                                        checked={checkedLevels.has("root")}
                                        description={descriptions.levels?.root ?? ""}
                                        onToggle={() => toggleCheck("level", "root")}
                                        onDescriptionChange={(v) => handleDescriptionChange("levels", "root", v)}
                                    />
                                )}
                                {presentLevels.map((level) => (
                                    <LegendRow
                                        key={level}

                                        label={`Level ${level}`}
                                        icon={<LevelIcon level={level} />}
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
                                        icon={<ShapeIcon shape="root" />}
                                        checked={checkedShapes.has("root")}
                                        description={descriptions.shapes?.root ?? ""}
                                        onToggle={() => toggleCheck("shape", "root")}
                                        onDescriptionChange={(v) => handleDescriptionChange("shapes", "root", v)}
                                    />
                                )}
                                {presentShapes.map((shape) => (
                                    <LegendRow
                                        key={shape}

                                        label={shape.charAt(0).toUpperCase() + shape.slice(1)}
                                        icon={<ShapeIcon shape={shape} />}
                                        checked={checkedShapes.has(shape)}
                                        description={descriptions.shapes?.[shape] ?? ""}
                                        onToggle={() => toggleCheck("shape", shape)}
                                        onDescriptionChange={(v) => handleDescriptionChange("shapes", shape, v)}
                                    />
                                ))}
                            </>
                        )}
                    </div>
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
