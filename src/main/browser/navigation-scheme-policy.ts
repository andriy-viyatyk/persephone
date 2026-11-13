const BLOCKED_PROTOCOLS = ["file:", "app-asset:"];
const CHROMIUM_NAVIGATION_PROTOCOLS = ["http:", "https:", "about:", "blob:", "mailto:", "tel:"];

export const USER_ACTIVATION_WINDOW_MS = 5000;

export type NavigationScheme = "blocked" | "chromium" | "external" | "invalid";

export function getNavigationScheme(url: string): NavigationScheme {
    try {
        const protocol = new URL(url).protocol;
        if (BLOCKED_PROTOCOLS.includes(protocol)) return "blocked";
        if (CHROMIUM_NAVIGATION_PROTOCOLS.includes(protocol)) return "chromium";
        return "external";
    } catch {
        return "invalid";
    }
}
