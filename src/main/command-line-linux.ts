/** Parse the documented Windows-compatible quoting subset for Linux direct spawns. */
export function parseLinuxDirectCommand(commandLine: string): string[] {
    const words: string[] = [];
    let word = "";
    let inQuotes = false;
    let hasWord = false;

    for (let index = 0; index < commandLine.length;) {
        const character = commandLine[index];
        if (character === "\\") {
            let end = index;
            while (commandLine[end] === "\\") end++;
            const backslashes = end - index;
            if (commandLine[end] === '"') {
                word += "\\".repeat(Math.floor(backslashes / 2));
                if (backslashes % 2 === 0) inQuotes = !inQuotes;
                else word += '"';
                hasWord = true;
                index = end + 1;
            } else {
                word += "\\".repeat(backslashes);
                hasWord = true;
                index = end;
            }
            continue;
        }
        if (character === '"') {
            inQuotes = !inQuotes;
            hasWord = true;
            index++;
            continue;
        }
        if ((character === " " || character === "\t") && !inQuotes) {
            if (hasWord) {
                words.push(word);
                word = "";
                hasWord = false;
            }
            index++;
            continue;
        }
        word += character;
        hasWord = true;
        index++;
    }

    if (inQuotes) throw new Error("Unmatched double quote in Linux direct command line.");
    if (hasWord) words.push(word);
    if (!words[0]) throw new Error("Linux direct command line must include a non-empty executable.");
    return words;
}
