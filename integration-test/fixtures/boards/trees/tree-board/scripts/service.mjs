const TYPE = "test/tree";
const MAX_ITEMS = 5000;
const FAIL_MESSAGE = "tree-test-read-only: writes are disabled for this connection";
const connections = new Map();
const failedNestedLists = new Set();
const stagedWrites = new Set();

function hrefFor(connection, path) {
    const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
    return `testtree://${encodeURIComponent(connection)}${encodedPath}`;
}

function pathFromUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "testtree:") throw new Error("tree-test-invalid-href");
    const connection = decodeURIComponent(url.hostname);
    const path = url.pathname.split("/").map((part) => decodeURIComponent(part)).join("/") || "/";
    return { connection, path };
}

function createSeed() {
    const tree = new Map();
    const addDirectory = (path) => tree.set(path, { isDirectory: true });
    const addFile = (path, content) => tree.set(path, { isDirectory: false, content: new TextEncoder().encode(content) });
    addDirectory("/");
    addDirectory("/docs");
    addDirectory("/docs/nested");
    addFile("/docs/nested/guide.txt", "Original guide bytes.\n");
    addDirectory("/data");
    addFile("/data/sample.json", '{"source":"tree-fixture"}\n');
    addDirectory("/café 📚");
    addFile("/café 📚/über.txt", "Unicode tree content.\n");
    addFile("/Readme.md", "Uppercase sibling.\n");
    addFile("/readme.md", "Lowercase sibling.\n");
    addDirectory("/_test");
    addDirectory("/_test/slow");
    addDirectory("/_test/fail");
    addDirectory("/_test/fail/nested");
    addFile("/_test/fail/nested/retry.txt", "The second nested listing succeeds.\n");
    addDirectory("/_test/truncated");
    return tree;
}

function treeFor(connection) {
    if (connection === "ro" || connection === "b" || connection === "a") {
        if (!connections.has(connection)) connections.set(connection, createSeed());
        return connections.get(connection);
    }
    throw new Error("tree-test-unknown-connection");
}

function assertWritable(config) {
    if (config.conn === "ro") {
        const error = new Error(FAIL_MESSAGE);
        error.code = "provider-read-only";
        throw error;
    }
}

function parentPath(path) {
    if (path === "/") return null;
    const parent = path.slice(0, path.lastIndexOf("/"));
    return parent || "/";
}

function directChildren(tree, path) {
    const prefix = path === "/" ? "/" : `${path}/`;
    return [...tree.entries()]
        .filter(([candidate]) => candidate !== path && candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"));
}

function treeItems(config, path, entries) {
    return entries.map(([itemPath, item]) => {
        const name = itemPath.slice(itemPath.lastIndexOf("/") + 1);
        return {
            name,
            path: itemPath,
            href: hrefFor(config.conn, itemPath),
            isDirectory: item.isDirectory,
            ...(!item.isDirectory ? { size: item.content.byteLength } : {}),
        };
    });
}

for (const connection of ["a", "b", "ro"]) connections.set(connection, createSeed());

persephone.providers.register(TYPE, {
    writable: true,
    readBinary(config) {
        const { connection, path } = pathFromUrl(config.url);
        const item = treeFor(connection).get(path);
        if (!item || item.isDirectory) throw new Error("tree-test-file-not-found");
        return item.content;
    },
    writeBinary(config, data) {
        const { connection, path } = pathFromUrl(config.url);
        assertWritable({ conn: connection });
        const tree = treeFor(connection);
        const parent = parentPath(path);
        if (!parent || !tree.get(parent)?.isDirectory || tree.get(path)?.isDirectory) throw new Error("tree-test-invalid-file-target");
        tree.set(path, { isDirectory: false, content: new Uint8Array(data) });
    },
    readRange(config, range) {
        if (range.end - range.start + 1 > 1024 * 1024) throw new Error("tree-test-range-too-large");
        const { connection, path } = pathFromUrl(config.url);
        const item = treeFor(connection).get(path);
        if (!item || item.isDirectory) throw new Error("tree-test-file-not-found");
        return item.content.slice(range.start, range.end + 1);
    },
    writeBegin(config, { signal }) {
        if (signal.aborted) throw new Error("tree-test-request-cancelled");
        const { connection, path } = pathFromUrl(config.url);
        assertWritable({ conn: connection });
        const tree = treeFor(connection);
        const parent = parentPath(path);
        if (!parent || !tree.get(parent)?.isDirectory || tree.get(path)?.isDirectory) throw new Error("tree-test-invalid-file-target");
        const handle = { connection, path, chunks: [], closed: false };
        stagedWrites.add(handle);
        return handle;
    },
    writeChunk(handle, data, { signal }) {
        if (signal.aborted || !stagedWrites.has(handle) || handle.closed) throw new Error("tree-test-write-closed");
        handle.chunks.push(new Uint8Array(data));
    },
    writeCommit(handle, { signal }) {
        if (signal.aborted || !stagedWrites.has(handle) || handle.closed) throw new Error("tree-test-write-closed");
        assertWritable({ conn: handle.connection });
        const tree = treeFor(handle.connection);
        const parent = parentPath(handle.path);
        if (!parent || !tree.get(parent)?.isDirectory || tree.get(handle.path)?.isDirectory) throw new Error("tree-test-invalid-file-target");
        const length = handle.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        const content = new Uint8Array(length);
        let offset = 0;
        for (const chunk of handle.chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
        tree.set(handle.path, { isDirectory: false, content });
        handle.closed = true;
        handle.chunks.length = 0;
        stagedWrites.delete(handle);
    },
    writeAbort(handle) {
        if (!stagedWrites.has(handle)) return;
        handle.closed = true;
        handle.chunks.length = 0;
        stagedWrites.delete(handle);
    },
    stat(config) {
        const { connection, path } = pathFromUrl(config.url);
        const item = treeFor(connection).get(path);
        return { exists: Boolean(item), ...(item ? { size: item.isDirectory ? 0 : item.content.byteLength } : {}) };
    },
});

persephone.treeProviders.register(TYPE, {
    async list(config, path, { signal }) {
        if (signal.aborted) throw new Error("tree-test-request-cancelled");
        if (path === "/_test/slow") await new Promise((resolve) => setTimeout(resolve, 1200));
        if (path === "/_test/fail/nested") {
            const key = `${config.conn}:${path}`;
            if (!failedNestedLists.has(key)) {
                failedNestedLists.add(key);
                throw new Error("tree-test-nested-list-failed-once");
            }
        }
        if (path === "/_test/truncated") {
            const items = Array.from({ length: MAX_ITEMS + 1 }, (_, index) => {
                const name = `entry-${String(index).padStart(4, "0")}.txt`;
                const itemPath = `${path}/${name}`;
                return { name, path: itemPath, href: hrefFor(config.conn, itemPath), isDirectory: false, size: 0 };
            });
            return { items: items.slice(0, MAX_ITEMS), truncated: true };
        }
        const tree = treeFor(config.conn);
        const entries = directChildren(tree, path);
        return { items: treeItems(config, path, entries.slice(0, MAX_ITEMS)), truncated: entries.length > MAX_ITEMS };
    },
    stat(config, path) {
        const item = treeFor(config.conn).get(path);
        const isDirectory = item?.isDirectory ?? false;
        return {
            exists: Boolean(item),
            isDirectory,
            href: hrefFor(config.conn, path),
            ...(item ? { linkKind: isDirectory ? "directory" : "file" } : {}),
            ...(item && isDirectory ? { deleteMode: "empty-only" } : {}),
            ...(item && !isDirectory ? { size: item.content.byteLength } : {}),
        };
    },
    mkdir(config, path) {
        assertWritable(config);
        const tree = treeFor(config.conn);
        const parent = parentPath(path);
        if (!parent || !tree.get(parent)?.isDirectory || tree.has(path)) throw new Error("tree-test-invalid-mkdir");
        tree.set(path, { isDirectory: true });
    },
    rename(config, oldPath, newPath) {
        assertWritable(config);
        const tree = treeFor(config.conn);
        const item = tree.get(oldPath);
        const parent = parentPath(newPath);
        if (!item || !parent || !tree.get(parent)?.isDirectory || tree.has(newPath)) throw new Error("tree-test-invalid-rename");
        const descendants = [...tree.entries()].filter(([path]) => path === oldPath || path.startsWith(`${oldPath}/`));
        for (const [path] of descendants) tree.delete(path);
        for (const [path, value] of descendants) tree.set(`${newPath}${path.slice(oldPath.length)}`, value);
    },
    delete(config, path) {
        assertWritable(config);
        const tree = treeFor(config.conn);
        if (!tree.has(path) || directChildren(tree, path).length) throw new Error("tree-test-invalid-delete");
        tree.delete(path);
    },
});
