import { isTestInstance } from "./instance-options";

export const TEST_PUBLISHED_BOARDS_CATALOG_URL_ENV = "PERSEPHONE_TEST_BOARDS_CATALOG_URL";

export type PublishedBoardsCatalogBase =
    | { mode: "app" }
    | { mode: "test"; url?: string };

/** Select the catalog trust boundary and validate the test-only loopback override. */
export function getPublishedBoardsCatalogBase(): PublishedBoardsCatalogBase {
    if (!isTestInstance()) return { mode: "app" };

    const value = process.env[TEST_PUBLISHED_BOARDS_CATALOG_URL_ENV];
    if (!value) return { mode: "test" };

    const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})(\/[^?#]*)?$/.exec(value);
    if (!match) return { mode: "test" };

    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { mode: "test" };

    try {
        const parsed = new URL(value);
        if (
            parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" ||
            parsed.username || parsed.password ||
            parsed.search || parsed.hash
        ) {
            return { mode: "test" };
        }
        return { mode: "test", url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}` };
    } catch {
        return { mode: "test" };
    }
}
