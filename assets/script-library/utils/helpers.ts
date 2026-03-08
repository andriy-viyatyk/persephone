// Example shared library module
// Import in scripts: const { capitalize, truncate } = require("library/utils/helpers");

export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + "...";
}

export function unique<T>(arr: T[]): T[] {
    return [...new Set(arr)];
}
