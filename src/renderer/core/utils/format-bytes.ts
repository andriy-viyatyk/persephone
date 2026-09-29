/** Human-readable byte size for download-size / file-size labels. */
export function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    if (n < 1024) return `${Math.round(n)} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let size = n / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}
