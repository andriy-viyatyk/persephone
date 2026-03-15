import type { NodeShape } from "./types";
import { starPoints, hexagonPoints, compassPoints, diamondPoints, trianglePoints, pointsToSvgString } from "./shapeGeometry";

/**
 * Shared SVG icon components for shape and level visualization.
 * Used by GraphDetailPanel (size=16) and GraphLegendPanel (size=14).
 */

interface ShapeIconProps {
    shape: NodeShape | "root";
    size?: number;
}

export function ShapeIcon({ shape, size = 16 }: ShapeIconProps) {
    const c = size / 2;
    const r = size * 0.375; // 6/16 = 0.375, scales proportionally

    if (shape === "root") {
        return (
            <svg className="legend-shape-icon" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <polygon points={pointsToSvgString(compassPoints(c, c, r * 1.1, r * 0.35))} fill="currentColor" />
            </svg>
        );
    }

    return (
        <svg className="legend-shape-icon" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {shape === "circle" && <circle cx={c} cy={c} r={r} fill="currentColor" />}
            {shape === "square" && <rect x={c - r} y={c - r} width={r * 2} height={r * 2} fill="currentColor" />}
            {shape === "diamond" && (
                <polygon points={pointsToSvgString(diamondPoints(c, c, r))} fill="currentColor" />
            )}
            {shape === "triangle" && (
                <polygon points={pointsToSvgString(trianglePoints(c, c, r))} fill="currentColor" />
            )}
            {shape === "star" && (
                <polygon points={pointsToSvgString(starPoints(c, c, r * 1.1, r * 0.5, 5))} fill="currentColor" />
            )}
            {shape === "hexagon" && (
                <polygon points={pointsToSvgString(hexagonPoints(c, c, r))} fill="currentColor" />
            )}
        </svg>
    );
}

interface LevelIconProps {
    level: number | "root";
    size?: number;
}

export function LevelIcon({ level, size = 16 }: LevelIconProps) {
    const c = size / 2;

    if (level === "root") {
        const r = size * 0.375;
        return (
            <svg className="legend-shape-icon" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <polygon points={pointsToSvgString(compassPoints(c, c, r * 1.1, r * 0.35))} fill="currentColor" />
            </svg>
        );
    }

    // Scale radius proportionally: for size=16 → 8-level (7,6,5,4,3), for size=14 → 7-level (6,5,4,3,2)
    const r = (size / 2) - level;
    return (
        <svg className="legend-shape-icon" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={c} cy={c} r={r} fill="currentColor" />
        </svg>
    );
}
