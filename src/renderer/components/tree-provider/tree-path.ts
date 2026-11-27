/** Join a tree category and child name without duplicating a root separator. */
export function joinTreeChild(category: string, name: string): string {
    if (!category) return name;
    return /[\\/]$/.test(category) ? category + name : `${category}/${name}`;
}
