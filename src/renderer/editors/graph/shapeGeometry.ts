import type { NodeShape } from "./types";

/**
 * Pure shape point generation functions.
 * Shared between canvas rendering (ForceGraphRenderer.drawShape) and SVG icons (GraphIcons.tsx).
 */

export function starPoints(cx: number, cy: number, outerR: number, innerR: number, spikes: number): [number, number][] {
    const pts: [number, number][] = [];
    for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    return pts;
}

export function compassPoints(cx: number, cy: number, outerR: number, innerR: number): [number, number][] {
    return starPoints(cx, cy, outerR, innerR, 4);
}

export function hexagonPoints(cx: number, cy: number, r: number): [number, number][] {
    const pts: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 6;
        pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    return pts;
}

export function diamondPoints(cx: number, cy: number, r: number): [number, number][] {
    const dy = r * 1.2;
    return [
        [cx, cy - dy],
        [cx + r, cy],
        [cx, cy + dy],
        [cx - r, cy],
    ];
}

export function trianglePoints(cx: number, cy: number, r: number): [number, number][] {
    const h = r * 1.15;
    return [
        [cx, cy - h],
        [cx + r, cy + h * 0.6],
        [cx - r, cy + h * 0.6],
    ];
}

/**
 * Get polygon points for a given shape. Returns null for circle (use arc instead).
 * The returned array of [x, y] pairs can be used for both canvas and SVG rendering.
 */
export function getShapePoints(shape: NodeShape | "compass" | "group" | undefined, cx: number, cy: number, r: number): [number, number][] | null {
    switch (shape) {
        case "square":
            return [
                [cx - r, cy - r],
                [cx + r, cy - r],
                [cx + r, cy + r],
                [cx - r, cy + r],
            ];
        case "diamond":
            return diamondPoints(cx, cy, r);
        case "triangle":
            return trianglePoints(cx, cy, r);
        case "star":
            return starPoints(cx, cy, r * 1.1, r * 0.5, 5);
        case "compass":
            return compassPoints(cx, cy, r * 1.2, r * 0.4);
        case "hexagon":
            return hexagonPoints(cx, cy, r);
        case "group": // double circle — inner circle drawn via arc, like "circle"
            return null;
        default: // "circle" or undefined
            return null;
    }
}

/** Convert point array to SVG polygon points string. */
export function pointsToSvgString(pts: [number, number][]): string {
    return pts.map(([x, y]) => `${x},${y}`).join(" ");
}
