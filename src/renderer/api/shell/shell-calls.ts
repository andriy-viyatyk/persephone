const { shell: electronShell } = require("electron");

export function openExternal(url: string): Promise<void> {
    return electronShell.openExternal(url);
}
