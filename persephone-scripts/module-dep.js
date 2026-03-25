// Module Dependencies Graph
// Parses TypeScript/JavaScript imports and builds a force-graph of module dependencies.
// Run inside persephone ScriptRunner.

const originalFs = require("original-fs");
const path = require("path");

// Ask user to select tsconfig.json
const selected = await app.fs.showOpenDialog({
    title: "Select tsconfig.json of the project to analyze",
    filters: [{ name: "tsconfig.json", extensions: ["json"] }],
});

if (!selected || selected.length === 0) {
    ui.warn("No file selected. Cancelled.");
    return;
}

const tsconfigPath = selected[0];
const projectRoot = path.dirname(tsconfigPath);

// Use the project's own TypeScript installation
const typescriptModule = path.join(projectRoot, "node_modules", "typescript");
if (!originalFs.existsSync(typescriptModule)) {
    ui.error(`TypeScript not found at: ${typescriptModule}\nRun "npm install" in the project first.`);
    return;
}
const ts = require(typescriptModule);

ui.info(`Parsing ${tsconfigPath}...`);
const progress = ui.show.progress({ label: "Loading TypeScript program...", value: 0 });
await ui();

// Parse tsconfig and create a TypeScript program
const configFile = ts.readConfigFile(tsconfigPath, (p) => originalFs.readFileSync(p, "utf-8"));
if (configFile.error) {
    ui.error(`Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`);
    return;
}

const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const sourceFiles = program.getSourceFiles().filter((sf) => !sf.fileName.includes("node_modules"));

progress.label = `Found ${sourceFiles.length} source files. Resolving imports...`;
progress.value = 30;

// Normalize file path to a short relative id
function fileId(filePath) {
    const rel = path.relative(projectRoot, filePath).replace(/\\/g, "/");
    return rel;
}

// Collect all modules and their imports
const modules = new Map(); // fileId -> Set<fileId>
const declarations = new Map(); // fileId -> { functions: string[], classes: string[], types: string[] }

let processed = 0;
for (const sourceFile of sourceFiles) {
    const id = fileId(sourceFile.fileName);
    if (!modules.has(id)) modules.set(id, new Set());
    if (!declarations.has(id)) declarations.set(id, { functions: [], classes: [], types: [] });
    const decl = declarations.get(id);

    ts.forEachChild(sourceFile, (node) => {
        // import ... from "..."
        if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            resolveAndAdd(id, node.moduleSpecifier.text, sourceFile.fileName);
        }
        // export ... from "..."
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            resolveAndAdd(id, node.moduleSpecifier.text, sourceFile.fileName);
        }
        // import("...")  — dynamic imports at top level
        if (ts.isExpressionStatement(node) || ts.isVariableStatement(node)) {
            findDynamicImports(node, id, sourceFile.fileName);
        }

        // Collect top-level declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
            decl.functions.push(node.name.text);
        }
        if (ts.isClassDeclaration(node) && node.name) {
            decl.classes.push(node.name.text);
        }
        if (ts.isInterfaceDeclaration(node) && node.name) {
            decl.types.push(node.name.text);
        }
        if (ts.isTypeAliasDeclaration(node) && node.name) {
            decl.types.push(node.name.text);
        }
        if (ts.isEnumDeclaration(node) && node.name) {
            decl.types.push(node.name.text);
        }
        // Top-level const/let/var — extract variable names
        if (ts.isVariableStatement(node)) {
            for (const d of node.declarationList.declarations) {
                if (ts.isIdentifier(d.name)) {
                    // Heuristic: UPPER_CASE → likely a constant, skip; PascalCase with arrow/function → function
                    const name = d.name.text;
                    if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
                        decl.functions.push(name);
                    }
                }
            }
        }
    });

    if (++processed % 20 === 0) {
        progress.label = `Resolving imports... (${processed}/${sourceFiles.length} files)`;
        progress.value = 30 + Math.round(processed / sourceFiles.length * 30);
        await ui();
    }
}

function resolveAndAdd(fromId, moduleName, containingFile) {
    // Skip external modules (node_modules, node builtins)
    if (!moduleName.startsWith(".") && !moduleName.startsWith("/")) return;

    const resolved = ts.resolveModuleName(moduleName, containingFile, parsedConfig.options, ts.sys);
    if (resolved.resolvedModule && !resolved.resolvedModule.isExternalLibraryImport) {
        const targetId = fileId(resolved.resolvedModule.resolvedFileName);
        if (modules.has(fromId)) {
            modules.get(fromId).add(targetId);
        }
    }
}

function findDynamicImports(node, fromId, containingFile) {
    // Walk the AST looking for import("...") call expressions
    function visit(n) {
        if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
            if (n.arguments.length > 0 && ts.isStringLiteral(n.arguments[0])) {
                resolveAndAdd(fromId, n.arguments[0].text, containingFile);
            }
        }
        ts.forEachChild(n, visit);
    }
    visit(node);
}

progress.label = `Resolved ${modules.size} modules. Building graph...`;
progress.value = 60;

// Build graph
const nodes = [];
const links = [];
const allIds = new Set(modules.keys());

// Count in-degree (how many modules import this one)
const inDegree = new Map();
for (const [fromId, deps] of modules) {
    for (const dep of deps) {
        if (allIds.has(dep)) {
            inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
        }
    }
}

// Assign levels based on in-degree
function getLevel(id) {
    const degree = inDegree.get(id) || 0;
    if (degree >= 20) return 1;
    if (degree >= 10) return 2;
    if (degree >= 5) return 3;
    if (degree >= 2) return 4;
    return 5;
}

// Assign shape based on file type/role
function getShape(id) {
    if (id.endsWith(".tsx")) return "diamond";   // React components
    if (id.endsWith(".ts")) return "circle";     // TypeScript modules
    if (id.endsWith(".js")) return "square";     // JavaScript
    return "circle";
}

// Extract folder for grouping info
function getFolder(id) {
    const dir = path.dirname(id);
    return dir === "." ? "(root)" : dir;
}

for (const [id, deps] of modules) {
    const absPath = path.resolve(projectRoot, id).replace(/\\/g, "/");
    const nodeObj = {
        id,
        title: path.basename(id),
        level: getLevel(id),
        shape: getShape(id),
        folder: getFolder(id),
        path: `[${absPath}](${absPath})`,
        importedBy: inDegree.get(id) || 0,
        imports: deps.size,
    };

    // Add numbered declaration properties for search
    const decl = declarations.get(id);
    if (decl) {
        let ci = 1, fi = 1, ti = 1;
        for (const name of decl.classes) nodeObj[`class#${ci++}`] = name;
        for (const name of decl.functions) nodeObj[`function#${fi++}`] = name;
        for (const name of decl.types) nodeObj[`type#${ti++}`] = name;
    }

    nodes.push(nodeObj);

    for (const dep of deps) {
        if (allIds.has(dep)) {
            links.push({ source: id, target: dep });
        }
    }
}

// Build folder group hierarchy
const folderSet = new Set();
for (const node of nodes) {
    if (node.folder && node.folder !== "(root)") {
        // Add this folder and all parent folders
        let dir = node.folder;
        while (dir && dir !== ".") {
            folderSet.add(dir);
            dir = path.dirname(dir);
        }
    }
}

// Find common root folder(s) that contain ALL file nodes — skip them
// (e.g., if every file is under "src/", don't create a "src" group)
const fileNodes = nodes.filter((n) => !n.isGroup);
const topLevelFolders = [...folderSet].filter((f) => !folderSet.has(path.dirname(f)) || path.dirname(f) === ".");
if (topLevelFolders.length === 1) {
    // Single root folder — remove it and any single-child chain
    let root = topLevelFolders[0];
    while (root) {
        const children = [...folderSet].filter((f) => path.dirname(f) === root);
        const directFiles = fileNodes.filter((n) => n.folder === root);
        if (children.length <= 1 && directFiles.length === 0) {
            folderSet.delete(root);
            root = children.length === 1 ? children[0] : null;
        } else {
            break;
        }
    }
}

// Sort folders so parents come before children
const sortedFolders = [...folderSet].sort();

// Create group nodes for each folder
for (const folder of sortedFolders) {
    nodes.push({
        id: folder,
        title: path.basename(folder),
        isGroup: true,
    });
}

// Create membership links: folder → file nodes
for (const node of nodes) {
    if (node.isGroup) continue;
    if (node.folder && node.folder !== "(root)" && folderSet.has(node.folder)) {
        links.push({ source: node.folder, target: node.id });
    }
}

// Create nesting links: parent folder → child folder
for (const folder of sortedFolders) {
    const parent = path.dirname(folder);
    if (parent !== "." && folderSet.has(parent)) {
        links.push({ source: parent, target: folder });
    }
}

// Sort by importedBy for the summary
nodes.sort((a, b) => (b.importedBy || 0) - (a.importedBy || 0));

const projectName = path.basename(projectRoot);

const graphData = {
    type: "force-graph",
    nodes,
    links,
    options: {
        charge: -40,
        linkDistance: 30,
        collide: 0.5,
        maxVisible: 500,
        legend: {
            levels: {
                "1": "20+ dependents",
                "2": "10–19 dependents",
                "3": "5–9 dependents",
                "4": "2–4 dependents",
                "5": "0–1 dependents",
            },
            shapes: {
                diamond: ".tsx modules",
                circle: ".ts modules",
                square: ".js modules",
                group: "module folders",
            },
        },
    },
};

// Open in a new graph-view page
const graphPage = app.pages.addEditorPage("graph-view", "json", `${projectName} — Modules.fg.json`);
graphPage.content = JSON.stringify(graphData, null, 2);

progress.value = 100;
progress.completed = true;
progress.label = "Done!";

ui.success(`Graph created: ${nodes.length} modules, ${links.length} import links`);
ui.log(`Top 10 most imported modules:`);
nodes.slice(0, 10).forEach((n, i) => {
    ui.log(`  ${i + 1}. ${n.id} (imported by ${n.importedBy})`);
});
