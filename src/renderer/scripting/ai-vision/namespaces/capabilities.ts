import type { IAiChild, IAiMember, IAiVisionDescriptor } from "ai-vision";
import type { CapabilityClientOptions, CapabilityProvider } from "../../../../ipc/capability-bus-channels";
import { api } from "../../../../ipc/renderer/api";
import { createCapabilityProxy } from "../../../../shared/capability-client";
import { codedError } from "../../../../shared/coded-error";

const CAPABILITIES_MEMBERS: readonly IAiMember[] = [
    { name: "list", kind: "method", signature: "list()", summary: "List capability registrations using the legacy discovery view." },
    { name: "handlers", kind: "method", signature: "handlers(id: string, filter?: { mime?: string })", summary: "List legacy candidates for one capability id." },
];

function unwrap<T>(result: import("../../../../ipc/capability-bus-channels").CapabilityClientResult<T>): T {
    if ("error" in result) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
}

function providerLabel(provider: CapabilityProvider): string {
    return `${provider.name}${provider.title ? ` (${provider.title})` : ""}`;
}

function agentProvider(provider: CapabilityProvider): CapabilityProvider {
    return { ...provider, methods: Object.fromEntries(Object.entries(provider.methods).filter(([, method]) => method.agent)) };
}

function agentMethodList(provider: CapabilityProvider): string {
    const names = Object.entries(provider.methods).filter(([, method]) => method.agent && method.kind !== "channel").map(([name]) => name);
    return names.length ? names.join(", ") : "channels only (not callable by agents)";
}

function methodSignature(name: string, method: CapabilityProvider["methods"][string]): string {
    return `${name}(${method.args.map((argument) => `${argument.name}${argument.optional ? "?" : ""}: ${argument.type}`).join(", ")})`;
}

function methodHelp(name: string, method: CapabilityProvider["methods"][string]): string {
    const description = `${methodSignature(name, method)} — ${method.summary}`;
    if (method.kind === "channel") return `${description}\n  channel (not callable by agents)`;
    return `${description}${method.returns ? `\n  Returns: ${method.returns}` : ""}\n  Timeout: ${method.timeoutMs} ms`;
}

class CapabilityProvidersNode {
    constructor(private readonly id: string, private readonly providers: readonly CapabilityProvider[]) {}

    async index(key: string | number): Promise<CapabilityNode | undefined> {
        if (typeof key !== "string") return undefined;
        const match = this.providers.find((provider) => provider.provider === key || provider.name === key);
        if (!match) {
            const known = this.providers.map((provider) => provider.name || provider.provider).join(", ");
            throw codedError("no-handler", `No agent-visible provider "${key}" for ${this.id}. Providers: ${known || "none"}.`);
        }
        const selected = unwrap(await api.capabilityGet(this.id, { provider: key, asAgent: true }));
        return selected ? new CapabilityNode(this.id, [match], agentProvider(selected), key) : undefined;
    }

    children(): readonly IAiChild[] {
        return this.providers.map((provider) => ({
            segment: `[${JSON.stringify(provider.name)}]`,
            kind: "CapabilityProvider",
            summary: `${provider.name} — key ${provider.provider}, v${provider.version}${provider.title ? ` (${provider.title})` : ""}`,
        }));
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "CapabilityProviders",
            summary: `Agent-visible providers for ${this.id}.`,
            members: [],
            children: () => this.children(),
            index: (key) => this.index(key),
            help: "Select an exact provider key or name for one invocation. This does not change provider preferences.",
            summarize: () => ({ id: this.id, providers: this.providers.map(({ provider, name, title, version }) => ({ provider, name, title, version })) }),
        };
    }
}

class CapabilityNode {
    constructor(
        private readonly id: string,
        private readonly eligible: readonly CapabilityProvider[],
        private readonly selected: CapabilityProvider,
        private readonly pinnedProvider?: string,
    ) {}

    private options(): CapabilityClientOptions {
        return { asAgent: true, ...(this.pinnedProvider ? { provider: this.pinnedProvider } : {}) };
    }

    private async invoke(method: string, args: unknown[]): Promise<unknown> {
        const resolvedProvider = unwrap(await api.capabilityGet(this.id, this.options()));
        if (!resolvedProvider || !resolvedProvider.methods[method]) throw codedError("no-handler", `Capability method "${this.id}.${method}" has no agent-visible handler.`);
        if (!resolvedProvider.methods[method].agent) throw codedError("permission-denied", `Capability permission denied for hidden agent method "${this.id}.${method}".`);
        const provider = agentProvider(resolvedProvider);
        if (provider.methods[method].kind === "channel") {
            throw codedError("permission-denied", `Capability method "${this.id}.${method}" is a channel and cannot be called by agents; open a channel through its supported client API.`);
        }
        const key = { id: provider.id, version: provider.version, provider: provider.provider, handlerKey: provider.handlerKey };
        const proxy = createCapabilityProxy(provider, async (name, positionalArgs) => unwrap(await api.capabilityInvoke({
            requestId: crypto.randomUUID(), key, method: name, args: positionalArgs, asAgent: true,
        })));
        const callable = proxy[method];
        if (typeof callable !== "function") throw codedError("no-handler", `Capability method "${this.id}.${method}" is unavailable.`);
        return callable(...args);
    }

    private methodMembers(): IAiMember[] {
        return Object.entries(this.selected.methods).map(([name, method]) => ({
            name,
            kind: "method" as const,
            signature: methodSignature(name, method),
            summary: method.kind === "channel" ? `${method.summary} Channel is discovery-only for agents.` : method.summary,
        }));
    }

    private children(): readonly IAiChild[] {
        return [
            ...this.methodMembers().map((method) => ({ segment: `.${method.name}`, kind: method.kind === "method" ? "CapabilityMethod" : "CapabilityProperty", summary: method.summary })),
            { segment: ".providers", kind: "CapabilityProviders", summary: "Pin one eligible provider for an invocation without changing preferences." },
        ];
    }

    private help(): string {
        const provider = this.selected;
        const entries = this.eligible.map((candidate) => `${candidate.name} — key ${candidate.provider} (${candidate.title ?? candidate.name}, v${candidate.version})`);
        return [
            `${this.id} v${provider.version} — selected: ${providerLabel(provider)}`,
            `Providers: ${entries.join("; ") || "(none)"}`,
            ...Object.entries(provider.methods).map(([name, method]) => methodHelp(name, method)),
        ].join("\n");
    }

    provide(name: string): { value: unknown } | undefined {
        if (!this.selected.methods[name]) return undefined;
        return { value: (...args: unknown[]) => this.invoke(name, args) };
    }

    get providers(): CapabilityProvidersNode {
        return new CapabilityProvidersNode(this.id, this.eligible);
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Capability",
            summary: `${this.id} v${this.selected.version}, selected ${providerLabel(this.selected)}.`,
            members: this.methodMembers().concat({ name: "providers", kind: "property", node: true, summary: "Pin an eligible provider for an invocation without changing preferences." }),
            children: () => this.children(),
            provide: (name) => this.provide(name),
            help: (): string => this.help(),
            summarize: () => ({ id: this.id, version: this.selected.version, selectedProvider: this.selected.name, methods: Object.keys(this.selected.methods) }),
        };
    }
}

class AgentCapabilitiesNode {
    private snapshot: CapabilityProvider[] = [];
    private selected = new Map<string, CapabilityProvider>();

    constructor() {
        api.onCapabilityIndexChanged(() => { void this.refresh().catch((): void => undefined); });
    }

    async refresh(): Promise<void> {
        this.snapshot = unwrap(await api.capabilityList(true)).map(agentProvider);
        const ids = [...new Set(this.snapshot.map((provider) => provider.id))];
        const resolved = await Promise.all(ids.map(async (id) => [id, unwrap(await api.capabilityGet(id, { asAgent: true }))] as const));
        this.selected = new Map(resolved.flatMap(([id, provider]) => provider ? [[id, provider] as const] : []));
    }

    async index(key: string | number): Promise<CapabilityNode | undefined> {
        if (typeof key !== "string") return undefined;
        const providers = unwrap(await api.capabilityProviders(key, true));
        if (!providers.length) {
            throw codedError("no-handler", `No agent-visible capability "${key}". Call capabilities.$help for the list.`);
        }
        const selected = unwrap(await api.capabilityGet(key, { asAgent: true }));
        return selected ? new CapabilityNode(key, providers, agentProvider(selected)) : undefined;
    }

    async children(): Promise<readonly IAiChild[]> {
        await this.refresh();
        return [...new Set(this.snapshot.map((provider) => provider.id))].map((id) => {
            const provider = this.selected.get(id);
            return {
                segment: `[${JSON.stringify(id)}]`,
                kind: "Capability",
                summary: `${id}${provider ? ` v${provider.version} — ${provider.name}: ${agentMethodList(provider)}` : ""}`,
            };
        });
    }

    private help(): string {
        const entries = [...new Set(this.snapshot.map((provider) => provider.id))].map((id) => {
            const provider = this.selected.get(id);
            return provider ? `  ${id} v${provider.version}${provider.title ? ` — ${provider.title}` : ""} (${provider.name}): ${agentMethodList(provider)}` : undefined;
        }).filter((entry): entry is string => !!entry);
        return [
            'capabilities — registered capabilities; open one with capabilities["<id>"].$help',
            ...entries,
            "list() — list registrations; handlers(id) — list candidates for an id",
            "Other surfaces: tools (registered scripts); pages[i].editor.app (open board models)",
        ].join("\n");
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Capabilities",
            summary: "Live capabilities visible to an agent; list() and handlers(id) retain the legacy discovery view.",
            members: CAPABILITIES_MEMBERS,
            children: () => this.children(),
            index: (key) => this.index(key),
            help: (): string => this.help(),
            summarize: () => ({ kind: "Capabilities", ids: [...new Set(this.snapshot.map((provider) => provider.id))] }),
        };
    }
}

const agentCapabilitiesNode = new AgentCapabilitiesNode();
void agentCapabilitiesNode.refresh().catch((): void => undefined);

export function describeCapabilities(_instance: unknown): IAiVisionDescriptor {
    return {
        ...agentCapabilitiesNode.aiVision,
        summary: "Live agent-visible capability registry; list() and handlers(id) retain their legacy discovery behavior.",
    };
}
