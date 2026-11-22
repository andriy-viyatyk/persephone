import { parsePath } from "ai-vision";
import { UNBOUNDED_CALL_MAX_LENGTH } from "../shared/ai-vision-call-limits.js";

/** The runner's programmatic model reads default to unbounded, as they do for scripts and boards. */
export function modelCallMaxLength(path: string | undefined, explicitMaxLength: number | undefined): number | undefined {
    if (explicitMaxLength !== undefined || !path) return explicitMaxLength;
    try {
        const segments = parsePath(path);
        let index = 0;
        if (segments[0]?.type === "member" && segments[0].name === "windows") {
            if (segments[1]?.type !== "index") return undefined;
            index = 2;
        }
        if (!isMember(segments[index], "pages")
            || segments[index + 1]?.type !== "index"
            || !isMember(segments[index + 2], "editor")
            || !isMember(segments[index + 3], "app")) return undefined;
        return UNBOUNDED_CALL_MAX_LENGTH;
    } catch {
        return undefined;
    }
}

function isMember(segment: ReturnType<typeof parsePath>[number] | undefined, name: string): boolean {
    return segment?.type === "member" && segment.name === name;
}
