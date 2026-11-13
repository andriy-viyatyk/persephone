export const PAGE_ZOOM_MIN = 50;
export const PAGE_ZOOM_MAX = 200;
export const PAGE_ZOOM_STEP = 5;
export const PAGE_ZOOM_DEFAULT = 100;

export function clampPageZoom(value: number): number {
    return Math.max(PAGE_ZOOM_MIN, Math.min(PAGE_ZOOM_MAX, value));
}

export function isValidPageZoom(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
        && value >= PAGE_ZOOM_MIN && value <= PAGE_ZOOM_MAX;
}
