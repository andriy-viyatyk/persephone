// Package Dependencies Graph
// Scans node_modules and builds a force-graph of package dependencies.
// Run inside persephone ScriptRunner.

// Use original fs to avoid Electron's .asar patching that crashes on some packages
const originalFs = require("original-fs");
const path = require("path");

// Ask user to select a package.json file
const selected = await app.fs.showOpenDialog({
    title: "Select package.json of the project to analyze",
    filters: [{ name: "package.json", extensions: ["json"] }],
});

if (!selected || selected.length === 0) {
    ui.warn("No file selected. Cancelled.");
    return;
}

const rootPkgPath = selected[0];
const projectRoot = path.dirname(rootPkgPath);
const nodeModulesDir = path.join(projectRoot, "node_modules");

if (!originalFs.existsSync(nodeModulesDir)) {
    ui.error(`node_modules not found at ${nodeModulesDir}. Run npm install first.`);
    return;
}

ui.info(`Scanning ${nodeModulesDir}...`);
const progress = ui.show.progress({ label: "Reading packages...", value: 0 });
await ui();

// Read all top-level packages (skip hidden dirs and @scoped dirs are handled separately)
const entries = originalFs.readdirSync(nodeModulesDir);

const packages = new Map(); // name -> { deps: string[] }

function isDir(fullPath) {
    try { return originalFs.statSync(fullPath).isDirectory(); } catch { return false; }
}

let scanned = 0;
for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const fullPath = path.join(nodeModulesDir, entry);
    if (!isDir(fullPath)) continue;

    if (entry.startsWith("@")) {
        // Scoped packages: read sub-entries
        const scopeEntries = originalFs.readdirSync(fullPath);
        for (const sub of scopeEntries) {
            if (sub.startsWith(".")) continue;
            const subPath = path.join(fullPath, sub);
            if (!isDir(subPath)) continue;
            readPackage(subPath, `${entry}/${sub}`);
        }
    } else {
        readPackage(fullPath, entry);
    }

    if (++scanned % 50 === 0) {
        progress.label = `Reading packages... (${packages.size} found)`;
        progress.value = Math.min(45, Math.round(scanned / entries.length * 45));
        await ui();
    }
}

function readPackage(pkgDir, name) {
    const pkgJsonPath = path.join(pkgDir, "package.json");
    try {
        if (!originalFs.existsSync(pkgJsonPath)) return;
        const pkg = JSON.parse(originalFs.readFileSync(pkgJsonPath, "utf-8"));
        const deps = Object.keys(pkg.dependencies || {});
        packages.set(name, { deps });
    } catch {
        // skip unreadable packages
    }
}

// Read the root project's package.json
const rootPkg = JSON.parse(originalFs.readFileSync(rootPkgPath, "utf-8"));
const rootName = rootPkg.name || path.basename(projectRoot);
const rootDeps = [
    ...Object.keys(rootPkg.dependencies || {}),
    ...Object.keys(rootPkg.devDependencies || {}),
];
packages.set(rootName, { deps: rootDeps });

progress.label = `Found ${packages.size} packages. Building graph...`;
progress.value = 50;

// Build graph: only include packages that exist in our node_modules
const nodes = [];
const links = [];
const packageNames = new Set(packages.keys());

// Count how many packages depend on each package (popularity)
const inDegree = new Map();
for (const [name, { deps }] of packages) {
    for (const dep of deps) {
        if (packageNames.has(dep)) {
            inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
        }
    }
}

// Assign levels based on in-degree (more dependents = more important)
function getLevel(name) {
    const degree = inDegree.get(name) || 0;
    if (degree >= 20) return 1;
    if (degree >= 10) return 2;
    if (degree >= 5) return 3;
    if (degree >= 2) return 4;
    return 5;
}

for (const [name, { deps }] of packages) {
    const isRoot = name === rootName;
    nodes.push({
        id: name,
        level: isRoot ? 1 : getLevel(name),
        shape: isRoot ? "star" : undefined,
        dependents: inDegree.get(name) || 0,
        dependencies: deps.length,
    });

    for (const dep of deps) {
        if (packageNames.has(dep)) {
            links.push({ source: name, target: dep });
        }
    }
}

// Sort nodes by dependents descending for info
nodes.sort((a, b) => b.dependents - a.dependents);

const graphData = {
    type: "force-graph",
    nodes,
    links,
    options: {
        rootNode: rootName,
        charge: -50,
        linkDistance: 35,
        collide: 0.6,
        maxVisible: 500,
        legend: {
            levels: {
                root: "project root",
                "1": "20+ dependents",
                "2": "10–19 dependents",
                "3": "5–9 dependents",
                "4": "2–4 dependents",
                "5": "0–1 dependents",
            },
            shapes: {
                star: "project root",
                circle: "npm packages",
            },
        },
    },
};

// Open in a new graph-view page
const graphPage = app.pages.addEditorPage("graph-view", "json", `${rootName} — Dependencies.fg.json`);
graphPage.content = JSON.stringify(graphData, null, 2);

progress.value = 100;
progress.completed = true;
progress.label = "Done!";

ui.success(`Graph created: ${nodes.length} packages, ${links.length} dependency links`);
ui.log(`Top 10 most depended-on packages:`);
nodes.slice(0, 10).forEach((n, i) => {
    ui.log(`  ${i + 1}. ${n.id} (${n.dependents} dependents)`);
});
