import { fpJoin } from "../../core/utils/file-path";
import { registeredTools } from "./registered-tools";
import { isToolsetFolder, readToolsManifest } from "./tools-manifest";
import { toolsTrust } from "./tools-trust";
import { errMessage } from "../../../shared/utils";

// Agent-facing validation lives in ai-vision/namespaces/tools.ts; these functions throw plain errors.
export interface RefreshToolsetsResult {
    refreshed: true;
    toolsetCount: number;
    toolCount: number;
    toolsets: {
        name: string;
        root: string;
        valid: boolean;
        shadowed: boolean;
        toolCount: number;
        errors: string[];
    }[];
}

export type CreateToolsetResult =
    | { created: false; registered: true; toolsetRoot: string; message: string }
    | { created: boolean; registered: false; toolsetRoot: string; message: string }
    | { created: boolean; registered: true; toolsetRoot: string; toolsetName: string; tools: { id: string; description: string }[] };

/** Refresh the entire registered-tool registry and return its summary. */
export async function refreshToolsets(): Promise<RefreshToolsetsResult> {
    await registeredTools.ensureInitialized();
    await registeredTools.refresh();
    const toolsets = registeredTools.toolsets.map((toolset) => ({
        name: toolset.name,
        root: toolset.root,
        valid: toolset.valid,
        shadowed: toolset.shadowed,
        toolCount: toolset.manifest?.tools?.length ?? 0,
        errors: toolset.errors,
    }));
    return {
        refreshed: true,
        toolsetCount: toolsets.length,
        toolCount: registeredTools.tools.length,
        toolsets,
    };
}

/** Scaffold a toolset and offer registration through the user's confirmation dialog. */
export async function createToolsetWithConsent(name: unknown, dir: unknown): Promise<CreateToolsetResult> {
    if (typeof name !== "string" || !name) throw new Error("Missing or invalid 'name' parameter");
    if (typeof dir !== "string" || !dir) throw new Error("Missing or invalid 'dir' parameter");

    const toolsetRoot = fpJoin(dir, name);
    await registeredTools.ensureInitialized();
    let created = false;

    if (await isToolsetFolder(toolsetRoot)) {
        if (toolsTrust.isTrusted(toolsetRoot)) {
            return { created: false, registered: true, toolsetRoot, message: "Toolset is already registered." };
        }
    } else {
        try {
            const { createToolset: scaffoldToolset } = await import("./tool-scaffold");
            await scaffoldToolset(name, dir);
            created = true;
        } catch (err) {
            throw new Error(errMessage(err));
        }
    }

    const manifest = await readToolsManifest(toolsetRoot);
    const tools = (manifest?.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description }));
    const { showRegisterToolsetDialog } = await import("../../ui/dialogs/RegisterToolsetDialog");
    const allowed = await showRegisterToolsetDialog({
        toolsetName: manifest?.name ?? name,
        toolsetRoot,
        tools,
    });
    if (!allowed) {
        return {
            created,
            registered: false,
            toolsetRoot,
            message: `Toolset is at "${toolsetRoot}" but its tools are not runnable yet because registration was declined. If the user asks to enable it, call tools.createToolset again with the same name and dir to re-show the confirmation prompt.`,
        };
    }

    await toolsTrust.trust(toolsetRoot);
    await registeredTools.refresh();
    return {
        created,
        registered: true,
        toolsetRoot,
        toolsetName: manifest?.name ?? name,
        tools: registeredTools.tools
            .filter((tool) => tool.toolsetRoot === toolsetRoot)
            .map((tool) => ({ id: tool.id, description: tool.tool.description })),
    };
}
