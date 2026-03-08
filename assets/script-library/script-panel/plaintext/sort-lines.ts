// Sort lines alphabetically (case-insensitive)

const lines: string[] = page.content.split("\n");
lines.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
return lines.join("\n");
