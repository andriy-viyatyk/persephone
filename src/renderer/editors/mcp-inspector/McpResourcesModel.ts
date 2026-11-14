import { TOneState } from "../../core/state/state";
import { errMessage } from "../../../shared/utils";
import { McpSession } from "./McpSession";

export interface McpResourceInfo { uri: string; name: string; description: string; mimeType: string; }
export interface McpResourceTemplateInfo { uriTemplate: string; name: string; description: string; mimeType: string; }
export interface McpResourceContent { uri: string; mimeType: string; text?: string; blob?: string; }

export interface McpResourcesPanelState {
    resources: McpResourceInfo[];
    templates: McpResourceTemplateInfo[];
    selectedUri: string;
    readLoading: boolean;
    readContent: McpResourceContent | null;
    readError: string;
    selectedTemplateUri: string;
    templateArgs: Record<string, string>;
    templateReadLoading: boolean;
    templateReadContent: McpResourceContent | null;
    templateReadError: string;
}

export const getDefaultResourcesPanelState = (): McpResourcesPanelState => ({
    resources: [], templates: [], selectedUri: "", readLoading: false, readContent: null, readError: "",
    selectedTemplateUri: "", templateArgs: {}, templateReadLoading: false,
    templateReadContent: null, templateReadError: "",
});

export class McpResourcesModel {
    readonly state = new TOneState<McpResourcesPanelState>(getDefaultResourcesPanelState());
    private _resourceSelectionGeneration = 0;
    private _templateSelectionGeneration = 0;

    constructor(private readonly session: McpSession) {}

    loadResources = async (): Promise<void> => {
        const ctx = this.session.begin();
        if (!ctx) return;
        await this.session.request(ctx, "resources/list", null, async (client) => {
            // `never[]` fallbacks are assignable to the SDK's typed Resource arrays without `any`.
            const [resResult, tmplResult] = await Promise.all([
                client.listResources().catch(() => ({ resources: [] as never[] })),
                client.listResourceTemplates().catch(() => ({ resourceTemplates: [] as never[] })),
            ]);
            return { resources: resResult, templates: tmplResult };
        }, {
            onSuccess: (result) => {
                const resources: McpResourceInfo[] = (result.resources.resources || []).map((r) => ({
                    uri: r.uri,
                    name: r.name || r.uri,
                    description: r.description || "",
                    mimeType: r.mimeType || "",
                }));
                const templates: McpResourceTemplateInfo[] = (result.templates.resourceTemplates || []).map((t) => ({
                    uriTemplate: t.uriTemplate,
                    name: t.name || t.uriTemplate,
                    description: t.description || "",
                    mimeType: t.mimeType || "",
                }));
                this.state.update((s) => {
                    s.resources = resources;
                    s.templates = templates;
                    s.selectedUri = resources.length > 0 ? resources[0].uri : "";
                    s.readContent = null;
                    s.readError = "";
                });
            },
        });
    };

    selectResource = (uri: string): void => {
        this._resourceSelectionGeneration += 1;
        this.state.update((s) => {
            s.selectedUri = uri;
            s.readLoading = false;
            s.readContent = null;
            s.readError = "";
            s.selectedTemplateUri = "";
            s.templateReadLoading = false;
            s.templateArgs = {};
            s.templateReadContent = null;
            s.templateReadError = "";
        });
    };

    selectTemplate = (uriTemplate: string): void => {
        this._templateSelectionGeneration += 1;
        this.state.update((s) => {
            s.selectedTemplateUri = uriTemplate;
            s.templateReadLoading = false;
            s.templateArgs = {};
            s.templateReadContent = null;
            s.templateReadError = "";
            s.selectedUri = "";
            s.readLoading = false;
            s.readContent = null;
            s.readError = "";
        });
    };

    setTemplateArg = (name: string, value: string): void => {
        this.state.update((s) => { s.templateArgs = { ...s.templateArgs, [name]: value }; });
    };

    readResource = async (target: "static" | "template"): Promise<void> => {
        const ctx = this.session.begin();
        if (!ctx) return;
        const state = this.state.get();
        const selectedUri = target === "static" ? state.selectedUri : state.selectedTemplateUri;
        if (!selectedUri) return;
        const selectionGeneration = target === "static"
            ? this._resourceSelectionGeneration : this._templateSelectionGeneration;
        const requestedUri = target === "static"
            ? selectedUri : expandUriTemplate(selectedUri, state.templateArgs);
        const readParams = { uri: requestedUri };
        if (target === "static") {
            this.state.update((s) => { s.readLoading = true; s.readContent = null; s.readError = ""; });
        } else {
            this.state.update((s) => {
                s.templateReadLoading = true;
                s.templateReadContent = null;
                s.templateReadError = "";
            });
        }
        await this.session.request(ctx, "resources/read", readParams,
            (client) => client.readResource(readParams), {
                guard: () => target === "static"
                    ? selectionGeneration === this._resourceSelectionGeneration
                        && this.state.get().selectedUri === selectedUri
                    : selectionGeneration === this._templateSelectionGeneration
                        && this.state.get().selectedTemplateUri === selectedUri,
                onSuccess: (result) => {
                    const first = result.contents?.[0];
                    if (target === "static") {
                        if (first) {
                            this.state.update((s) => {
                                s.readLoading = false;
                                s.readContent = {
                                    uri: first.uri || requestedUri,
                                    mimeType: first.mimeType || "",
                                    text: "text" in first ? first.text : undefined,
                                    blob: "blob" in first ? first.blob : undefined,
                                };
                            });
                        } else {
                            this.state.update((s) => { s.readLoading = false; s.readError = "No content returned."; });
                        }
                    } else if (first) {
                        this.state.update((s) => {
                            s.templateReadLoading = false;
                            s.templateReadContent = {
                                uri: first.uri || requestedUri,
                                mimeType: first.mimeType || "",
                                text: "text" in first ? first.text : undefined,
                                blob: "blob" in first ? first.blob : undefined,
                            };
                        });
                    } else {
                        this.state.update((s) => {
                            s.templateReadLoading = false;
                            s.templateReadError = "No content returned.";
                        });
                    }
                },
                onError: (err) => {
                    if (target === "static") {
                        this.state.update((s) => { s.readLoading = false; s.readError = errMessage(err); });
                    } else {
                        this.state.update((s) => { s.templateReadLoading = false; s.templateReadError = errMessage(err); });
                    }
                },
            });
    };
}

/** Extract simple `{param}` names from a URI template. */
export function extractTemplateParams(uriTemplate: string): string[] {
    const params: string[] = [];
    const re = /\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(uriTemplate)) !== null) params.push(match[1]);
    return params;
}

/** Replace `{param}` placeholders in a URI template with values from args. */
export function expandUriTemplate(uriTemplate: string, args: Record<string, string>): string {
    return uriTemplate.replace(/\{([^}]+)\}/g, (_, name) => args[name] ?? "");
}
