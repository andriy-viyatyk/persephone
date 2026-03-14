// Module Dependencies Graph
// Parses TypeScript/JavaScript imports and builds a force-graph of module dependencies.
// Run inside js-notepad ScriptRunner.

const originalFs = require("original-fs");
const path = require("path");

// Use js-notepad's own TypeScript installation
const typescriptModule = path.join(process.cwd(), "node_modules", "typescript");
const ts = require(typescriptModule);

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

let processed = 0;
for (const sourceFile of sourceFiles) {
    const id = fileId(sourceFile.fileName);
    if (!modules.has(id)) modules.set(id, new Set());

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
    nodes.push({
        id,
        title: path.basename(id),
        level: getLevel(id),
        shape: getShape(id),
        folder: getFolder(id),
        importedBy: inDegree.get(id) || 0,
        imports: deps.size,
    });

    for (const dep of deps) {
        if (allIds.has(dep)) {
            links.push({ source: id, target: dep });
        }
    }
}

// Sort by importedBy for the summary
nodes.sort((a, b) => b.importedBy - a.importedBy);

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
