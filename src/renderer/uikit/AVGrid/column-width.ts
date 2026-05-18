/**
 * Shared column width detection utility.
 * Used by grid editor (grid-utils.ts) and graph editor (LinksTab).
 *
 * Scans row data and computes optimal column widths based on content length.
 */

export interface ColumnWidthOptions {
    /** Approximate width of one character in pixels. Default: 8 (for ~14px font). */
    charWidth?: number;
    /** Padding added to content-based width. Default: 20. */
    padding?: number;
    /** Minimum column width. Default: 60. */
    minWidth?: number;
    /** Maximum column width. Default: 300. */
    maxWidth?: number;
}

const DEFAULTS: Required<ColumnWidthOptions> = {
    charWidth: 8,
    padding: 20,
    minWidth: 60,
    maxWidth: 300,
};

/**
 * Compute optimal width for a single column by scanning row values.
 * Takes the header name into account as well.
 */
export function detectColumnWidth(
    rows: Record<string, unknown>[],
    key: string,
    headerName: string,
    options?: ColumnWidthOptions,
): number {
    const { charWidth, padding, minWidth, maxWidth } = { ...DEFAULTS, ...options };

    // Start with header width
    let width = headerName.length * charWidth + padding;

    for (const row of rows) {
        const value = row[key];
        if (value !== null && value !== undefined) {
            const w = String(value).length * charWidth + padding;
            if (w > width) width = w;
        }
    }

    return Math.max(minWidth, Math.min(width, maxWidth));
}
