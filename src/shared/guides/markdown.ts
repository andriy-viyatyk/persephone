import type { GuideSearchMatchKind } from "./index";

export interface MarkdownSearchCandidate {
    readonly matchKind: GuideSearchMatchKind;
    readonly passage: string;
    readonly heading?: string;
    readonly sourceLine: number;
}

interface AtxHeading {
    readonly level: number;
    readonly passage: string;
    readonly text: string;
}

interface ListMarker {
    readonly indent: number;
}

export function extractMarkdownCandidates(content: string): readonly MarkdownSearchCandidate[] {
    const lines = content.split("\n").map(line => line.endsWith("\r") ? line.slice(0, -1) : line);
    const candidates: MarkdownSearchCandidate[] = [];
    let heading: string | undefined;

    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (line.trim() === "") {
            index++;
            continue;
        }

        const fence = fenceMarker(line);
        if (fence) {
            const end = fencedBlockEnd(lines, index, fence);
            addCandidate(candidates, {
                matchKind: "body",
                passage: lines.slice(index, end + 1).join("\n").trim(),
                heading,
                sourceLine: index,
            });
            index = end + 1;
            continue;
        }

        const atxHeading = parseAtxHeading(line);
        if (atxHeading) {
            addCandidate(candidates, {
                matchKind: "heading",
                passage: atxHeading.passage,
                heading: atxHeading.passage,
                sourceLine: index,
            });
            heading = atxHeading.passage;
            index++;
            continue;
        }

        if (isTableStart(lines, index)) {
            const end = tableEnd(lines, index);
            for (let rowIndex = index; rowIndex < end; rowIndex++) {
                if (!isTableSeparator(lines[rowIndex])) {
                    addCandidate(candidates, {
                        matchKind: "table-row",
                        passage: lines[rowIndex].trim(),
                        heading,
                        sourceLine: rowIndex,
                    });
                }
            }
            index = end;
            continue;
        }

        const listMarker = parseListMarker(line);
        if (listMarker) {
            const end = listEnd(lines, index, listMarker.indent);
            addCandidate(candidates, {
                matchKind: "body",
                passage: lines.slice(index, end).join("\n").trim(),
                heading,
                sourceLine: index,
            });
            index = end;
            continue;
        }

        const end = bodyBlockEnd(lines, index);
        addCandidate(candidates, {
            matchKind: "body",
            passage: lines.slice(index, end).join("\n").trim(),
            heading,
            sourceLine: index,
        });
        index = end;
    }

    return candidates;
}

export function extractLayout(content: string): string | undefined {
    const lines = content.split("\n").map(line => line.endsWith("\r") ? line.slice(0, -1) : line);
    let index = 0;
    while (index < lines.length) {
        const fence = fenceMarker(lines[index]);
        if (fence) {
            index = fencedBlockEnd(lines, index, fence) + 1;
            continue;
        }

        const heading = parseAtxHeading(lines[index]);
        if (heading?.level === 2 && heading.text === "Layout") {
            const body: string[] = [];
            let bodyIndex = index + 1;
            while (bodyIndex < lines.length) {
                const bodyFence = fenceMarker(lines[bodyIndex]);
                if (bodyFence) {
                    const end = fencedBlockEnd(lines, bodyIndex, bodyFence);
                    body.push(...lines.slice(bodyIndex, end + 1));
                    bodyIndex = end + 1;
                    continue;
                }

                const nextHeading = parseAtxHeading(lines[bodyIndex]);
                if (nextHeading && nextHeading.level <= 2) break;
                body.push(lines[bodyIndex]);
                bodyIndex++;
            }
            return body.join("\n").trim();
        }
        index++;
    }
    return undefined;
}

function addCandidate(candidates: MarkdownSearchCandidate[], candidate: MarkdownSearchCandidate): void {
    if (candidate.passage) candidates.push(candidate);
}

function bodyBlockEnd(lines: readonly string[], start: number): number {
    let index = start;
    while (index < lines.length && lines[index].trim() !== "") {
        if (index > start && (fenceMarker(lines[index]) || parseAtxHeading(lines[index]) || isTableStart(lines, index) || parseListMarker(lines[index]))) {
            break;
        }
        index++;
    }
    return index;
}

function listEnd(lines: readonly string[], start: number, indent: number): number {
    let index = start + 1;
    while (index < lines.length && lines[index].trim() !== "") {
        if (fenceMarker(lines[index]) || parseAtxHeading(lines[index]) || isTableStart(lines, index)) break;
        const marker = parseListMarker(lines[index]);
        if (marker && marker.indent <= indent) break;
        index++;
    }
    return index;
}

function tableEnd(lines: readonly string[], start: number): number {
    let index = start;
    while (index < lines.length && (isTableRow(lines[index]) || isTableSeparator(lines[index]))) index++;
    return index;
}

function isTableStart(lines: readonly string[], index: number): boolean {
    if (!isTableRow(lines[index]) || isTableSeparator(lines[index])) return false;
    return isTableSeparator(lines[index - 1]) || isTableSeparator(lines[index + 1]);
}

function isTableRow(line: string | undefined): boolean {
    return line !== undefined && line.trim().includes("|");
}

function isTableSeparator(line: string | undefined): boolean {
    if (!isTableRow(line)) return false;
    const cells = line!.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
    return cells.length >= 2 && cells.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function parseListMarker(line: string | undefined): ListMarker | undefined {
    if (line === undefined) return undefined;
    const match = line.match(/^([ \t]*)(?:[-+*]|\d+[.)])(?:[ \t]+|$)/);
    return match ? { indent: match[1].length } : undefined;
}

function parseAtxHeading(line: string | undefined): AtxHeading | undefined {
    if (line === undefined) return undefined;
    const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)\s*|[ \t]*)$/);
    if (!match) return undefined;
    const passage = line.trim();
    const text = (match[2] ?? "").trim().replace(/[ \t]+#+[ \t]*$/, "").trim();
    return { level: match[1].length, passage, text };
}

function fenceMarker(line: string | undefined): string | undefined {
    if (line === undefined) return undefined;
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    return match?.[1];
}

function fencedBlockEnd(lines: readonly string[], start: number, marker: string): number {
    const character = marker[0];
    for (let index = start + 1; index < lines.length; index++) {
        if (new RegExp(`^ {0,3}${character}{${marker.length},}[ \t]*$`).test(lines[index])) return index;
    }
    return lines.length - 1;
}
