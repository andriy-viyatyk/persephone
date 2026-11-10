const BOARD_PAGE_STATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}(?![\s\S])/;
const BOARD_PAGE_STATE_MAX_BYTES = 10 * 1024 * 1024;

export function validateBoardPageStateKey(key: unknown): asserts key is string {
    if (typeof key !== "string" || !BOARD_PAGE_STATE_KEY_PATTERN.test(key)) {
        throw new TypeError("Board page-state keys must be 1–32 ASCII characters matching [A-Za-z0-9][A-Za-z0-9._-]*.");
    }
}

export function validateBoardPageStateValue(value: unknown): asserts value is string {
    if (typeof value !== "string") throw new TypeError("Board page-state values must be strings.");
    if (new TextEncoder().encode(value).byteLength > BOARD_PAGE_STATE_MAX_BYTES) {
        throw new RangeError("Board page-state values cannot exceed 10 MiB in UTF-8.");
    }
}

