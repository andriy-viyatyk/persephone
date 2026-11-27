persephone.treeProviders.register("test/foreign-tree", {
    list(_config, path) {
        return {
            items: path === "/" ? [{ name: "foreign.txt", path: "/foreign.txt", href: "othertree://fixture/foreign.txt", isDirectory: false }] : [],
            truncated: false,
        };
    },
    stat(_config, path) {
        return { exists: path === "/" || path === "/foreign.txt", isDirectory: path === "/" };
    },
});
