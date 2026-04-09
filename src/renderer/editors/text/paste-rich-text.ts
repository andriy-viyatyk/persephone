import type TurndownService from "turndown";

let turndownInstance: TurndownService | null = null;

async function getTurndown(): Promise<TurndownService> {
    if (!turndownInstance) {
        const { default: Turndown } = await import("turndown");
        turndownInstance = new Turndown({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
            bulletListMarker: "-",
        });
    }
    return turndownInstance;
}

export interface RichPasteFormats {
    plain: string;
    markdown: string;
    html: string;
}

export function hasRichContent(clipboardData: DataTransfer): boolean {
    const html = clipboardData.getData("text/html");
    return Boolean(html && html.trim());
}

export async function extractRichPasteFormats(
    clipboardData: DataTransfer,
): Promise<RichPasteFormats | null> {
    const html = clipboardData.getData("text/html");
    const plain = clipboardData.getData("text/plain");

    if (!html || !html.trim()) return null;

    const turndown = await getTurndown();
    return {
        plain,
        markdown: turndown.turndown(html),
        html,
    };
}

export async function convertHtmlToMarkdown(html: string): Promise<string> {
    const turndown = await getTurndown();
    return turndown.turndown(html);
}

/** Read HTML from system clipboard. Returns empty string if unavailable. */
export async function readClipboardHtml(): Promise<string> {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            if (item.types.includes("text/html")) {
                const blob = await item.getType("text/html");
                return await blob.text();
            }
        }
    } catch {
        // Clipboard API may fail if not focused or permission denied
    }
    return "";
}
