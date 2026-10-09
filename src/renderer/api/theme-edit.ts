import type { ThemeEditPayload } from "./types/capabilities";

/** Validate the platform-owned theme.edit@1 payload before resolving any handler. */
export function validateThemeEditPayload(payload: unknown): asserts payload is ThemeEditPayload {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("theme.edit expects an object payload.");
    }

    const values = payload as Record<string, unknown>;
    if (values.mode === "edit") {
        if (typeof values.themeId !== "string" || !values.themeId.trim()) {
            throw new TypeError("theme.edit edit mode expects a non-empty themeId.");
        }
        return;
    }

    if (values.mode === "new") {
        if (Object.prototype.hasOwnProperty.call(values, "themeId")) {
            throw new TypeError("theme.edit new mode must not include themeId.");
        }
        return;
    }

    throw new TypeError('theme.edit expects mode "edit" or "new".');
}
