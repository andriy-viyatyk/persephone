import type { ITreeProvider } from "../../api/types/io.tree";
import { ArchiveTreeProvider } from "./ArchiveTreeProvider";
import { FileTreeProvider } from "./FileTreeProvider";
import { MnemeTreeProvider } from "./MnemeTreeProvider";

/** Data needed to construct a tree provider. `url` identifies the source; `rootPath` is its root. */
export interface TreeProviderDescriptor {
    type: string;
    rootPath: string;
    url?: string;
    config?: unknown;
}

type TreeProviderCreator = (descriptor: TreeProviderDescriptor) => ITreeProvider;

const exactTypeCreators = new Map<string, TreeProviderCreator>();
const matcherCreators: { matcher: (type: string) => boolean; creator: TreeProviderCreator }[] = [];

/** Register a creator for one exact provider type or an ordered type matcher. */
export function registerTreeProvider(
    typeOrMatcher: string | ((type: string) => boolean),
    creator: TreeProviderCreator,
): void {
    if (typeof typeOrMatcher === "string") {
        if (exactTypeCreators.has(typeOrMatcher)) {
            throw new Error(`A tree provider is already registered for type "${typeOrMatcher}".`);
        }
        exactTypeCreators.set(typeOrMatcher, creator);
        return;
    }

    matcherCreators.push({ matcher: typeOrMatcher, creator });
}

/** Create the registered provider for a descriptor, preferring exact types over matchers. */
export function createTreeProvider(descriptor: TreeProviderDescriptor & { type: "file" }): FileTreeProvider;
export function createTreeProvider(descriptor: TreeProviderDescriptor & { type: "archive" }): ArchiveTreeProvider;
export function createTreeProvider(descriptor: TreeProviderDescriptor & { type: "mneme" }): MnemeTreeProvider;
export function createTreeProvider(descriptor: TreeProviderDescriptor): ITreeProvider;
export function createTreeProvider(descriptor: TreeProviderDescriptor): ITreeProvider {
    const exactCreator = exactTypeCreators.get(descriptor.type);
    if (exactCreator) return exactCreator(descriptor);

    const matcherCreator = matcherCreators.find(({ matcher }) => matcher(descriptor.type))?.creator;
    if (matcherCreator) return matcherCreator(descriptor);

    throw new Error(`No tree provider is registered for type "${descriptor.type}".`);
}

registerTreeProvider("file", ({ rootPath }) => {
    if (typeof rootPath !== "string") {
        throw new Error("File tree provider requires a root path.");
    }
    return new FileTreeProvider(rootPath);
});

registerTreeProvider("archive", ({ url }) => {
    if (typeof url !== "string" || !url) {
        throw new Error("Archive tree provider requires a source URL.");
    }
    return new ArchiveTreeProvider(url);
});

registerTreeProvider("mneme", ({ rootPath }) => {
    if (typeof rootPath !== "string") {
        throw new Error("Mneme tree provider requires a root path.");
    }
    return new MnemeTreeProvider(rootPath);
});
