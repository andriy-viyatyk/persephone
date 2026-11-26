export const REQUIREMENT_TAGS = Object.freeze(["network", "mic", "tor", "git", "mneme", "launch", "desktop", "virtual-desktop", "published-board-checkout", "windows"]);

export function validateRequirements(value, label = "test descriptor") {
    const requirements = value === undefined ? [] : value;
    if (!Array.isArray(requirements) || requirements.some((tag) => typeof tag !== "string" || !tag.trim() || !REQUIREMENT_TAGS.includes(tag))) {
        throw new TypeError(`${label} requires must be non-empty suite tags from: ${REQUIREMENT_TAGS.join(", ")}.`);
    }
    if (new Set(requirements).size !== requirements.length) throw new TypeError(`${label} requires contains duplicate tags.`);
    return [...requirements];
}

export function test(name, run, options = {}) {
    if (typeof name !== "string" || !name.trim() || typeof run !== "function") throw new TypeError("test(name, async ctx => {}) requires a name and function.");
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => key !== "requires")) {
        throw new TypeError("test options must be an object containing only requires.");
    }
    return { name, run, requires: validateRequirements(options.requires, `Test '${name}'`) };
}
