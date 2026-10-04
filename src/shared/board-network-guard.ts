export interface BoardNetworkAddress {
    address: string;
    family: number;
}

export interface PinnedLookupOptions {
    family?: number;
    all?: boolean;
}

type PinnedLookupCallback = (
    error: (Error & { code?: string }) | null,
    addressOrAddresses?: string | BoardNetworkAddress[],
    family?: number,
) => void;

/** Address ranges that are not globally routable internet destinations. */
export function isPrivateAddress(address: string, isIP: (address: string) => number): boolean {
    const value = address.toLowerCase().split("%", 1)[0];
    const family = isIP(value);
    if (family === 4) {
        const [first, second] = value.split(".").map(Number);
        return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127)
            || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31)
            || (first === 192 && second === 168) || first >= 224;
    }
    if (family === 6) {
        if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7), isIP);
        return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")
            || /^fe[89ab]/.test(value);
    }
    return true;
}

/** Create a DNS lookup callback that can return only addresses already checked by the caller. */
export function pinnedLookup(addresses: BoardNetworkAddress[]) {
    return (
        _hostname: string,
        options: PinnedLookupOptions | number,
        callback: PinnedLookupCallback,
    ): void => {
        const normalizedOptions = typeof options === "number" ? { family: options } : options;
        const matches = normalizedOptions.family === 4 || normalizedOptions.family === 6
            ? addresses.filter((entry) => entry.family === normalizedOptions.family)
            : addresses;
        if (matches.length === 0) {
            const error = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
            callback(error);
            return;
        }
        if (normalizedOptions.all) {
            callback(null, matches);
            return;
        }
        callback(null, matches[0].address, matches[0].family);
    };
}
