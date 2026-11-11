import { AI_VISION_SCHEMA_VERSION, expose } from "ai-vision/remote";
import { createElements as createDomElements, highlightElement } from "ai-vision/dom";
import type { IAiElementDeclaration, IAiHostSignal, IAiRemoteRequest, IAiRemoteResponse, IAiVisionShape } from "ai-vision";
import type { IAiVisionRemote } from "ai-vision/remote";
import { NO_REPLY } from "../ipc/board-bridge/frame-protocol";
import type { HostFrameChannel } from "./board-host-frame-channel";
import { errMessage } from "../shared/utils";

type BoardElementDeclaration = IAiElementDeclaration & { readonly view?: string };
type BoardElementProvider = (name: string) => { value: unknown } | undefined;
interface BoardElementsRegistry {
    readonly declarations: readonly BoardElementDeclaration[];
    readonly provide: BoardElementProvider;
}

export function createAiVisionApi(deps: { hostFrame: HostFrameChannel; view: string }) {
    const { hostFrame, view } = deps;
    let aiVisionRemote: IAiVisionRemote | null = null;
    let aiVisionGeneration = 0;
    let boardElementsRegistry: BoardElementsRegistry | undefined;

    function registerFrameElements(declarations: readonly BoardElementDeclaration[], provide: BoardElementProvider): void {
        const names = new Set<string>();
        for (const declaration of declarations) {
            if (names.has(declaration.name)) throw new Error(`Duplicate AiVision element name ${JSON.stringify(declaration.name)}.`);
            names.add(declaration.name);
        }
        if (boardElementsRegistry) throw new Error("Only one complete AiVision element declaration set may be registered per frame.");
        boardElementsRegistry = { declarations: declarations.map((declaration) => ({ ...declaration })), provide };
    }

    function decorateAiVisionShape(shape: IAiVisionShape): IAiVisionShape {
        const registry = boardElementsRegistry;
        if (!registry) return shape;
        const viewByName = new Map(registry.declarations.map((declaration) => [declaration.name, declaration.view]));
        const decorateNode = (node: IAiVisionShape["root"]): IAiVisionShape["root"] => ({
            ...node,
            ...(node.elements ? { elements: node.elements.map((element) => {
                const elementView = viewByName.get(element.name);
                return elementView === undefined ? element : { ...element, view: elementView };
            }) } : {}),
            members: node.members.map((member) => ({
                ...member,
                ...(member.node ? { node: decorateNode(member.node) } : {}),
                ...(member.item ? { item: decorateNode(member.item) } : {}),
            })),
            ...(node.item ? { item: decorateNode(node.item) } : {}),
        });
        return { ...shape, root: decorateNode(shape.root) };
    }

    function createBoardElements(declarations: readonly BoardElementDeclaration[]) {
        const result = createDomElements(declarations, highlightElement);
        registerFrameElements(declarations, result.provide);
        return result;
    }

    function handleLocalAiVisionRequest(request: IAiRemoteRequest): Promise<IAiRemoteResponse> {
        const registry = boardElementsRegistry;
        if (!registry || request.path !== "") return Promise.resolve({ ok: false, error: "The board has no unambiguous root element provider." });
        try {
            if (request.action === "ai:elements") {
                const provided = registry.provide("elements");
                if (!provided) throw new Error("AiVision elements are not available on the board root.");
                return Promise.resolve({ ok: true, result: provided.value });
            }
            if (request.action === "ai:highlight") {
                const provided = registry.provide("highlight");
                if (!provided || typeof provided.value !== "function") throw new Error("AiVision highlight is not available on the board root.");
                return Promise.resolve(provided.value(request.name ?? "", request.message)).then((result) => ({ ok: true, result }));
            }
            return Promise.resolve({ ok: false, error: `Unsupported local AiVision action ${request.action}.` });
        } catch (error) { return Promise.reject(error); }
    }

    hostFrame.handle("aiVision.request", async ({ request }) => {
        const remote = aiVisionRemote;
        const generation = aiVisionGeneration;
        const isLocalElementAction = view !== "main" && (request.action === "ai:elements" || request.action === "ai:highlight");
        try {
            const response = isLocalElementAction ? await handleLocalAiVisionRequest(request)
                : remote ? await remote.handle(request)
                    : { ok: false as const, error: "The board has not exposed an AiVision root." };
            if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return NO_REPLY;
            return response;
        } catch (error: unknown) {
            if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return NO_REPLY;
            return { ok: false, error: errMessage(error, "The AiVision request failed.") };
        }
    });

    function postAiVisionRegistration(remote: IAiVisionRemote, reason: "register" | "refresh" = "register"): void {
        if (view !== "main") return;
        try { hostFrame.emit("aiVision.register", { schemaVersion: remote.schemaVersion, shape: decorateAiVisionShape(remote.describe()), reason }); }
        catch { /* The host frame may have gone away while the board is being replaced. */ }
    }

    function exposeAiVision(root: object): IAiVisionRemote {
        aiVisionRemote?.dispose();
        const generation = ++aiVisionGeneration;
        const remote = expose(root, {
            publish: false,
            onWarning: (message) => console.warn("[persephone.aiVision]", message),
            onHostSignal: (signal: IAiHostSignal) => {
                if (signal.type !== "notify" || view !== "main" || aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
                try { hostFrame.emit("aiVision.notify", { text: signal.text }); }
                catch { /* The host frame may have gone away while the board is being replaced. */ }
            },
        });
        aiVisionRemote = remote;
        postAiVisionRegistration(remote);
        return {
            schemaVersion: remote.schemaVersion,
            get version(): number { return remote.version; },
            describe: () => decorateAiVisionShape(remote.describe()),
            handle: async (request): Promise<IAiRemoteResponse> => {
                const response = await remote.handle(request);
                return aiVisionRemote === remote && aiVisionGeneration === generation
                    ? response : { ok: false, error: "The AiVision remote has been replaced." };
            },
            refresh: () => {
                if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
                remote.refresh();
                postAiVisionRegistration(remote, "refresh");
            },
            notify: (text: string): void => {
                if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
                remote.notify(text);
            },
            dispose: () => {
                if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
                remote.dispose();
                aiVisionRemote = null;
                aiVisionGeneration++;
            },
        };
    }

    return { api: { aiVision: { schemaVersion: AI_VISION_SCHEMA_VERSION, expose: exposeAiVision, createElements: createBoardElements } } };
}
