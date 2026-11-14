/** Compute the Electron session partition string for a browser page. */
export function getPartitionString(
    profileName: string,
    isIncognito: boolean,
    incognitoId?: string,
    isTor?: boolean,
    torId?: string,
): string {
    if (isTor) {
        return `browser-tor-${torId || crypto.randomUUID()}`;
    }
    if (isIncognito) {
        return `browser-incognito-${incognitoId || crypto.randomUUID()}`;
    }
    return `persist:browser-${profileName || "default"}`;
}
