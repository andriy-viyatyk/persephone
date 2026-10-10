const accents: Record<string, string> = { a: "á", b: "ƀ", c: "ç", d: "ď", e: "é", f: "ƒ", g: "ğ", h: "ħ", i: "í", j: "ĵ", k: "ķ", l: "ľ", m: "ɱ", n: "ñ", o: "ó", p: "þ", q: "ǫ", r: "ř", s: "š", t: "ţ", u: "ú", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž" };

export function pseudoText(text: string): string {
    const protectedText: string[] = [];
    const withTokens = text.replace(/\{[\w.-]+\}/g, (token) => `\uE000${protectedText.push(token) - 1}\uE001`);
    const accented = [...withTokens].map((character) => accents[character.toLowerCase()] ?? character).join("");
    const restored = accented.replace(/\uE000(\d+)\uE001/g, (_token, index: string) => protectedText[Number(index)]);
    const padding = " ·".repeat(Math.ceil([...restored].length * 0.35));
    return `[${restored}${padding}]`;
}
