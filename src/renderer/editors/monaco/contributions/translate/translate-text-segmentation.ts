import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

// Request and segmentation limits come from the text.translate@1 consumer contract.
const TRANSLATION_LIMITS = {
    maxItems: 32,
    maxCodePoints: 64_000,
    maxDetectionCodePoints: 4_096,
    maxItemCodePoints: 64_000,
    sentenceLocale: "und",
} as const;

export interface TranslationSpan { key: string; start: number; end: number; text: string }
export interface TranslationBatchItem { key: string; text: string }

interface SourcePosition { start: { offset?: number }; end: { offset?: number } }
interface MarkdownNode { type: string; position?: SourcePosition; children?: MarkdownNode[] }

function codePointLength(value: string): number { return Array.from(value).length; }

function sentenceChunks(text: string, maxCodePoints: number): string[] {
    if (codePointLength(text) <= maxCodePoints) return [text];
    const boundaries = typeof Intl.Segmenter === "function"
        ? [...new Intl.Segmenter(TRANSLATION_LIMITS.sentenceLocale, { granularity: "sentence" }).segment(text)].map((part) => part.segment)
        : [text];
    const chunks: string[] = [];
    let current = "";
    for (const sentence of boundaries) {
        if (current && codePointLength(current) + codePointLength(sentence) > maxCodePoints) {
            chunks.push(current);
            current = "";
        }
        if (codePointLength(sentence) <= maxCodePoints) {
            current += sentence;
            continue;
        }
        const points = Array.from(sentence);
        while (points.length) {
            const room = maxCodePoints - codePointLength(current);
            if (!room) { chunks.push(current); current = ""; continue; }
            current += points.splice(0, room).join("");
            if (points.length) { chunks.push(current); current = ""; }
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function splitLongSpans(source: string, spans: TranslationSpan[]): TranslationSpan[] {
    const result: TranslationSpan[] = [];
    let sequence = 0;
    for (const span of spans) {
        const chunks = sentenceChunks(span.text, TRANSLATION_LIMITS.maxItemCodePoints);
        let offset = span.start;
        for (const text of chunks) {
            const end = offset + text.length;
            result.push({ key: `text-${sequence++}`, start: offset, end, text: source.slice(offset, end) });
            offset = end;
        }
    }
    return result;
}

function isEligibleNode(type: string): boolean { return type === "text"; }

function markdownSpans(source: string): TranslationSpan[] {
    const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as unknown as MarkdownNode;
    const frontMatter = /^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)|^\uFEFF?\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+\s*(?:\r?\n|$)/.exec(source);
    const protectedEnd = frontMatter?.[0].length ?? 0;
    const spans: TranslationSpan[] = [];
    const visit = (node: MarkdownNode, protectedNode = false): void => {
        const skip = protectedNode || node.type === "code" || node.type === "inlineCode" || node.type === "html" || node.type === "definition";
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (!skip && isEligibleNode(node.type) && start !== undefined && end !== undefined && end > protectedEnd) {
            const from = Math.max(start, protectedEnd);
            const text = source.slice(from, end);
            if (text.trim()) spans.push({ key: `text-${spans.length}`, start: from, end, text });
        }
        for (const child of node.children ?? []) visit(child, skip);
    };
    visit(tree);
    return spans;
}

function plainTextSpans(source: string): TranslationSpan[] {
    const spans: TranslationSpan[] = [];
    let offset = 0;
    for (const line of source.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
        const value = line[0];
        if (!value) continue;
        const newlineLength = value.endsWith("\r\n") ? 2 : /[\r\n]$/.test(value) ? 1 : 0;
        const content = value.slice(0, value.length - newlineLength);
        const marker = /^(\s*(?:(?:[-*+]\s+)|(?:\d+[.)]\s+))?)/.exec(content)?.[0].length ?? 0;
        const eligible = content.slice(marker);
        if (eligible.trim()) spans.push({ key: `text-${spans.length}`, start: offset + marker, end: offset + content.length, text: eligible });
        offset += value.length;
    }
    return spans;
}

export function createTranslationSpans(source: string, language: string): TranslationSpan[] {
    const spans = language === "markdown" ? markdownSpans(source) : plainTextSpans(source);
    return splitLongSpans(source, spans);
}

export function selectTranslationSpans(spans: TranslationSpan[], start: number, end: number): TranslationSpan[] {
    return spans.flatMap((span, index) => {
        const from = Math.max(start, span.start);
        const to = Math.min(end, span.end);
        return to > from && span.text.slice(from - span.start, to - span.start).trim()
            ? [{ key: `selected-${index}`, start: from, end: to, text: span.text.slice(from - span.start, to - span.start) }]
            : [];
    });
}

export function buildTranslationBatches(spans: TranslationSpan[]): TranslationBatchItem[][] {
    const batches: TranslationBatchItem[][] = [];
    let batch: TranslationBatchItem[] = [];
    let total = 0;
    for (const span of spans) {
        const size = codePointLength(span.text);
        if (batch.length && (batch.length >= TRANSLATION_LIMITS.maxItems || total + size > TRANSLATION_LIMITS.maxCodePoints)) {
            batches.push(batch);
            batch = [];
            total = 0;
        }
        batch.push({ key: span.key, text: span.text });
        total += size;
    }
    if (batch.length) batches.push(batch);
    return batches;
}

export function createDetectionSample(spans: TranslationSpan[]): string {
    const text = spans.map((span) => span.text).join(" ");
    return Array.from(text).slice(0, TRANSLATION_LIMITS.maxDetectionCodePoints).join("");
}

export function reconstructTranslation(source: string, spans: TranslationSpan[], translated: Map<string, string>): string {
    let result = source;
    for (const span of [...spans].sort((left, right) => right.start - left.start)) {
        const replacement = translated.get(span.key);
        if (replacement !== undefined) result = `${result.slice(0, span.start)}${replacement}${result.slice(span.end)}`;
    }
    return result;
}

export const translationLimits = TRANSLATION_LIMITS;
