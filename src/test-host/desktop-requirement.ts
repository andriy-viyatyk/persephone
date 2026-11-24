import type { McpClient } from "./client.js";
import type { TestWindowOwner } from "./test-window.js";

const LOCKED_SKIP_REASON = "needs a visible desktop (screen locked)";
const HIDDEN_SKIP_REASON = "needs a visible desktop (test window hidden, minimized, or on another virtual desktop)";

export async function desktopRequirementReason(client: McpClient, testWindow: TestWindowOwner): Promise<string | undefined> {
    const locked = await client.call("main.session.locked");
    if (typeof locked !== "boolean") throw new Error("main.session.locked did not return a boolean.");
    if (locked) return LOCKED_SKIP_REASON;

    const index = testWindow.index;
    if (index === undefined) throw new Error("The selected test window has no index for the desktop requirement check.");
    const desktopVisible = await client.call(`windows[${index}].desktopVisible`);
    if (typeof desktopVisible !== "boolean") throw new Error(`windows[${index}].desktopVisible did not return a boolean.`);
    return desktopVisible ? undefined : HIDDEN_SKIP_REASON;
}
