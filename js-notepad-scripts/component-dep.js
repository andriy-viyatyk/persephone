// React Components Graph
// Parses TSX files to find React components and their rendering relationships.
// Run inside js-notepad ScriptRunner.

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
const checker = program.getTypeChecker();

// Only analyze .tsx files (contain JSX)
const tsxFiles = program.getSourceFiles().filter(
    (sf) => !sf.fileName.includes("node_modules") && sf.fileName.endsWith(".tsx"),
);

progress.label = `Found ${tsxFiles.length} TSX files. Analyzing components...`;
progress.value = 20;

// ── Step 1: Collect all component definitions ──────────────────────────

// Map: componentId -> { file, name }
const components = new Map();
// Map: filePath -> Map<localName, componentId>  (imports from other files)
const fileImports = new Map();
// Map: filePath -> Set<localName>  (components defined in this file)
const fileDefinitions = new Map();
// Map: filePath -> Map<styledName, wrappedComponentName>  (styled(Component) aliases)
const styledAliases = new Map();

function fileId(filePath) {
    return path.relative(projectRoot, filePath).replace(/\\/g, "/");
}

function isComponentName(name) {
    // React components start with uppercase
    return name && /^[A-Z]/.test(name);
}

// Check if a function/arrow returns JSX (simplified: check if body contains JsxElement/JsxFragment)
function returnsJsx(node) {
    let found = false;
    function visit(n) {
        if (found) return;
        if (
            n.kind === ts.SyntaxKind.JsxElement ||
            n.kind === ts.SyntaxKind.JsxSelfClosingElement ||
            n.kind === ts.SyntaxKind.JsxFragment
        ) {
            found = true;
            return;
        }
        ts.forEachChild(n, visit);
    }
    visit(node);
    return found;
}

let step1Count = 0;
for (const sourceFile of tsxFiles) {
    const fId = fileId(sourceFile.fileName);
    const defs = new Set();
    fileDefinitions.set(sourceFile.fileName, defs);

    ts.forEachChild(sourceFile, (node) => {
        // function ComponentName(...) { ... }
        if (ts.isFunctionDeclaration(node) && node.name && isComponentName(node.name.text)) {
            if (returnsJsx(node)) {
                const name = node.name.text;
                const id = `${fId}::${name}`;
                components.set(id, { file: fId, name });
                defs.add(name);
            }
        }

        // const ComponentName = (...) => { ... }  or  const ComponentName = function(...) { ... }
        // const ComponentName = React.memo((...) => { ... })
        // const StyledName = styled(Component)(...)  — track as alias
        if (ts.isVariableStatement(node)) {
            const aliases = styledAliases.get(sourceFile.fileName) || new Map();
            styledAliases.set(sourceFile.fileName, aliases);

            for (const decl of node.declarationList.declarations) {
                if (decl.name && ts.isIdentifier(decl.name) && isComponentName(decl.name.text) && decl.initializer) {
                    const varName = decl.name.text;
                    let init = decl.initializer;

                    // Detect styled(Component)(...) — e.g. const Foo = styled(Bar)({...})
                    if (ts.isCallExpression(init) && ts.isCallExpression(init.expression)) {
                        const innerCall = init.expression;
                        const calleeText = innerCall.expression.getText(sourceFile);
                        if (calleeText === "styled" && innerCall.arguments.length > 0) {
                            const arg = innerCall.arguments[0];
                            if (ts.isIdentifier(arg) && isComponentName(arg.text)) {
                                aliases.set(varName, arg.text);
                            }
                        }
                    }

                    // Unwrap React.memo(...), React.forwardRef(...), observer(...)
                    while (ts.isCallExpression(init) && init.arguments.length > 0) {
                        const callText = init.expression.getText(sourceFile);
                        if (/^(React\.)?(memo|forwardRef)$/.test(callText) || callText === "observer") {
                            init = init.arguments[0];
                        } else {
                            break;
                        }
                    }

                    if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && returnsJsx(init)) {
                        const id = `${fId}::${varName}`;
                        components.set(id, { file: fId, name: varName });
                        defs.add(varName);
                    }
                }
            }
        }

        // export default function ComponentName(...) { ... }
        if (ts.isExportAssignment(node) && node.expression) {
            // export default <expression> — less common for named components, skip
        }
    });

    if (++step1Count % 10 === 0) {
        progress.label = `Scanning components... (${step1Count}/${tsxFiles.length} files)`;
        progress.value = Math.round(step1Count / tsxFiles.length * 20);
        await ui();
    }
}

progress.label = `Found ${components.size} components. Resolving imports...`;
progress.value = 40;

// ── Step 2: Build import maps (which components are imported into each file) ──

// For each TSX file, track what component names are available via imports
let step2Count = 0;
for (const sourceFile of tsxFiles) {
    const imports = new Map(); // localName -> componentId
    fileImports.set(sourceFile.fileName, imports);

    // Add local definitions
    const defs = fileDefinitions.get(sourceFile.fileName);
    if (defs) {
        const fId = fileId(sourceFile.fileName);
        for (const name of defs) {
            imports.set(name, `${fId}::${name}`);
        }
    }

    // Process import declarations
    ts.forEachChild(sourceFile, (node) => {
        if (!ts.isImportDeclaration(node) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;
        if (!node.importClause) return;

        const moduleName = node.moduleSpecifier.text;
        // Skip external modules
        if (!moduleName.startsWith(".") && !moduleName.startsWith("/")) return;

        const resolved = ts.resolveModuleName(moduleName, sourceFile.fileName, parsedConfig.options, ts.sys);
        if (!resolved.resolvedModule || resolved.resolvedModule.isExternalLibraryImport) return;

        const targetFile = resolved.resolvedModule.resolvedFileName;
        const targetFId = fileId(targetFile);
        const targetDefs = fileDefinitions.get(targetFile);
        if (!targetDefs) return;

        // Default import: import Foo from "./Foo"
        if (node.importClause.name && isComponentName(node.importClause.name.text)) {
            const localName = node.importClause.name.text;
            // Try to match to a component in the target file
            for (const defName of targetDefs) {
                imports.set(localName, `${targetFId}::${defName}`);
                break; // default export = first/only component
            }
        }

        // Named imports: import { Foo, Bar } from "./components"
        if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
            for (const spec of node.importClause.namedBindings.elements) {
                const originalName = (spec.propertyName || spec.name).text;
                const localName = spec.name.text;
                const id = `${targetFId}::${originalName}`;
                if (components.has(id)) {
                    imports.set(localName, id);
                }
            }
        }
    });

    if (++step2Count % 10 === 0) {
        progress.label = `Resolving imports... (${step2Count}/${tsxFiles.length} files)`;
        progress.value = 40 + Math.round(step2Count / tsxFiles.length * 20);
        await ui();
    }
}

progress.label = `Analyzing JSX usage...`;
progress.value = 60;

// ── Step 3: Find which components render which other components ──

const renderLinks = new Set(); // "sourceId|||targetId"

let step3Count = 0;
for (const sourceFile of tsxFiles) {
    const imports = fileImports.get(sourceFile.fileName);
    if (!imports) continue;

    const fId = fileId(sourceFile.fileName);
    const defs = fileDefinitions.get(sourceFile.fileName);
    if (!defs || defs.size === 0) continue;

    const aliases = styledAliases.get(sourceFile.fileName) || new Map();

    // Collect all component references used in this file
    const componentRefsUsed = new Set();

    function visitJsx(node) {
        // <ComponentName ... /> or <ComponentName>...</ComponentName>
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const tagName = node.tagName;
            if (ts.isIdentifier(tagName) && isComponentName(tagName.text)) {
                componentRefsUsed.add(tagName.text);

                // Also check if this JSX tag is a styled(Component) alias
                if (aliases.has(tagName.text)) {
                    componentRefsUsed.add(aliases.get(tagName.text));
                }
            }

            // Check JSX attributes for component-as-prop: prop={ComponentName}
            const attrs = node.attributes;
            if (attrs) {
                for (const attr of attrs.properties) {
                    if (ts.isJsxAttribute(attr) && attr.initializer) {
                        if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
                            const expr = attr.initializer.expression;
                            if (ts.isIdentifier(expr) && isComponentName(expr.text)) {
                                componentRefsUsed.add(expr.text);
                            }
                        }
                    }
                }
            }
        }

        // Also detect component references in object literals: { key: ComponentName }
        // and with type casts: { key: ComponentName as any }
        if (ts.isPropertyAssignment(node) && node.initializer) {
            let expr = node.initializer;
            // Unwrap "as X" type assertions
            while (ts.isAsExpression(expr) || ts.isTypeAssertionExpression?.(expr)) {
                expr = expr.expression;
            }
            if (ts.isIdentifier(expr) && isComponentName(expr.text)) {
                componentRefsUsed.add(expr.text);
            }
        }

        ts.forEachChild(node, visitJsx);
    }
    visitJsx(sourceFile);

    // For each component reference, find which component it resolves to
    for (const refName of componentRefsUsed) {
        const targetId = imports.get(refName);
        if (!targetId) continue;

        // Link from each component defined in this file to the used component
        for (const defName of defs) {
            const sourceId = `${fId}::${defName}`;
            if (sourceId !== targetId) {
                renderLinks.add(`${sourceId}|||${targetId}`);
            }
        }
    }

    if (++step3Count % 10 === 0) {
        progress.label = `Analyzing JSX... (${step3Count}/${tsxFiles.length} files)`;
        progress.value = 60 + Math.round(step3Count / tsxFiles.length * 20);
        await ui();
    }
}

progress.label = `Building graph...`;
progress.value = 80;

// ── Step 4: Build the graph ──

const nodes = [];
const links = [];

// Count in-degree (how many components render this one)
const inDegree = new Map();
for (const link of renderLinks) {
    const [, target] = link.split("|||");
    inDegree.set(target, (inDegree.get(target) || 0) + 1);
}

function getLevel(id) {
    const degree = inDegree.get(id) || 0;
    if (degree >= 15) return 1;
    if (degree >= 8) return 2;
    if (degree >= 4) return 3;
    if (degree >= 2) return 4;
    return 5;
}

// Only include components that have at least one link (rendered or renders)
const linkedComponents = new Set();
for (const link of renderLinks) {
    const [source, target] = link.split("|||");
    linkedComponents.add(source);
    linkedComponents.add(target);
}

for (const [id, { file, name }] of components) {
    if (!linkedComponents.has(id)) continue;
    const folder = path.dirname(file);
    const absPath = path.resolve(projectRoot, file).replace(/\\/g, "/");

    nodes.push({
        id,
        title: name,
        level: getLevel(id),
        file,
        folder: folder === "." ? "(root)" : folder,
        path: `[${absPath}](${absPath})`,
        renderedBy: inDegree.get(id) || 0,
    });
}

for (const link of renderLinks) {
    const [source, target] = link.split("|||");
    if (linkedComponents.has(source) && linkedComponents.has(target)) {
        links.push({ source, target });
    }
}

// Build folder group hierarchy
const folderSet = new Set();
for (const node of nodes) {
    if (node.folder && node.folder !== "(root)") {
        let dir = node.folder;
        while (dir && dir !== ".") {
            folderSet.add(dir);
            dir = path.dirname(dir);
        }
    }
}

// Skip common root folder(s) that contain ALL file nodes
const fileNodes = nodes.filter((n) => !n.isGroup);
const topLevelFolders = [...folderSet].filter((f) => !folderSet.has(path.dirname(f)) || path.dirname(f) === ".");
if (topLevelFolders.length === 1) {
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

const sortedFolders = [...folderSet].sort();

// Create group nodes for each folder
for (const folder of sortedFolders) {
    nodes.push({
        id: folder,
        title: path.basename(folder),
        isGroup: true,
    });
}

// Create membership links: folder → component nodes
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

nodes.sort((a, b) => (b.renderedBy || 0) - (a.renderedBy || 0));

const projectName = path.basename(projectRoot);

const graphData = {
    type: "force-graph",
    nodes,
    links,
    options: {
        charge: -60,
        linkDistance: 40,
        collide: 0.6,
        maxVisible: 500,
        legend: {
            levels: {
                "1": "15+ parents",
                "2": "8–14 parents",
                "3": "4–7 parents",
                "4": "2–3 parents",
                "5": "0–1 parents",
            },
            shapes: {
                circle: "React components",
                group: "component folders",
            },
        },
    },
};

const graphPage = app.pages.addEditorPage("graph-view", "json", `${projectName} — Components.fg.json`);
graphPage.content = JSON.stringify(graphData, null, 2);

progress.value = 100;
progress.completed = true;
progress.label = "Done!";

ui.success(`Graph created: ${nodes.length} components, ${links.length} render links`);
ui.info(`(${components.size - linkedComponents.size} isolated components excluded)`);
ui.log(`Top 10 most rendered components:`);
nodes.slice(0, 10).forEach((n, i) => {
    ui.log(`  ${i + 1}. ${n.title} [${n.file}] (rendered by ${n.renderedBy})`);
});
