import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const API_WRAPPER = "src/renderer/scripting/api-wrapper";
const FACADE_FILES = [
    "AboutEditorFacade.ts",
    "ArchiveEditorFacade.ts",
    "BoardEditorFacade.ts",
    "BoardInfoEditorFacade.ts",
    "BrowserEditorFacade.ts",
    "EnvVarsEditorFacade.ts",
    "FileDiffEditorFacade.ts",
    "FolderViewEditorFacade.ts",
    "GenericEditorFacade.ts",
    "GitTreeEditorFacade.ts",
    "GridEditorFacade.ts",
    "HtmlEditorFacade.ts",
    "ImageEditorFacade.ts",
    "LinkEditorFacade.ts",
    "LogViewEditorFacade.ts",
    "MarkdownEditorFacade.ts",
    "McpInspectorFacade.ts",
    "MermaidEditorFacade.ts",
    "MnemeConfigEditorFacade.ts",
    "MnemeRootEditorFacade.ts",
    "SvgEditorFacade.ts",
    "TextEditorFacade.ts",
    "ToolsetEditorFacade.ts",
    "ToolsHubEditorFacade.ts",
    "VideoEditorFacade.ts",
];
const BOARDS_FILE = "src/renderer/scripting/ai-vision/namespaces/boards.ts";
const BROWSER_MEMBERS_FILE = "src/renderer/scripting/ai-vision/browser-automation-members.ts";
const BROWSER_PLAYWRIGHT_ALIASES_FILE = "src/renderer/scripting/ai-vision/browser-playwright-aliases.ts";
const BOARD_FACADE_DEFINITIONS_FILE = "src/renderer/scripting/api-wrapper/board-editor-facade-definitions.ts";
const BOARDS_TYPES_FILE = "src/renderer/api/types/boards.d.ts";

const METHOD_ALLOWLIST = {
    // Add intentional omissions as `"ClassName.method": "one-line reason"` entries.
};

const diagnostics = [];
const sourceCache = new Map();

function source(file) {
    const fullPath = resolve(ROOT, file);
    if (!sourceCache.has(fullPath)) {
        const text = readFileSync(fullPath, "utf8");
        sourceCache.set(fullPath, ts.createSourceFile(fullPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
    }
    return sourceCache.get(fullPath);
}

function propertyName(node) {
    if (!node) return undefined;
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    return undefined;
}

function property(node, name) {
    if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
    return node.properties.find((item) => propertyName(item.name) === name);
}

function initializer(node) {
    return node && (ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node)) ? node.initializer : undefined;
}

function declarationsByName(file) {
    const map = new Map();
    for (const statement of source(file).statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) map.set(declaration.name.text, declaration.initializer);
            }
        }
    }
    return map;
}

function importedSource(file, name) {
    for (const statement of source(file).statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue;
        const bindings = statement.importClause.namedBindings;
        if (!ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
            if ((element.name.text === name || element.propertyName?.text === name) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
                const specifier = statement.moduleSpecifier.text;
                if (specifier.endsWith("/browser-automation-members")) return BROWSER_MEMBERS_FILE;
                if (specifier.endsWith("/browser-playwright-aliases")) return BROWSER_PLAYWRIGHT_ALIASES_FILE;
                if (specifier.endsWith("/board-editor-facade-definitions")) return BOARD_FACADE_DEFINITIONS_FILE;
            }
        }
    }
    return undefined;
}

function collectMembers(expression, file, label, output, active = new Set()) {
    if (!expression) {
        diagnostics.push(`${file}: ${label}: missing static member array`);
        return;
    }
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
        collectMembers(expression.expression, file, label, output, active);
        return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
        for (const element of expression.elements) {
            if (ts.isSpreadElement(element)) {
                const spread = element.expression;
                if (ts.isPropertyAccessExpression(spread) && spread.name.text === "members" && spread.expression.getText() === "elements") continue;
                collectMembers(spread, file, label, output, active);
            } else if (ts.isObjectLiteralExpression(element)) {
                const name = propertyName(property(element, "name")?.initializer);
                const kind = propertyName(property(element, "kind")?.initializer);
                if (name && kind === "method") output.add(name);
                else if (!name || !kind) diagnostics.push(`${file}: ${label}: dynamic member entry ${element.getText().slice(0, 80)}`);
            } else if (ts.isCallExpression(element) && ts.isIdentifier(element.expression)
                && (element.expression.text === "method" || element.expression.text === "property")
                && element.arguments[0] && ts.isStringLiteral(element.arguments[0])) {
                if (element.expression.text === "method") output.add(element.arguments[0].text);
            } else if (ts.isConditionalExpression(element)) {
                collectMembers(element.whenTrue, file, label, output, active);
                collectMembers(element.whenFalse, file, label, output, active);
            } else if (ts.isIdentifier(element) && element.text === "APP_MEMBER") {
                continue;
            } else {
                diagnostics.push(`${file}: ${label}: dynamic member entry ${element.getText().slice(0, 80)}`);
            }
        }
        return;
    }
    if (ts.isConditionalExpression(expression)) {
        collectMembers(expression.whenTrue, file, label, output, active);
        collectMembers(expression.whenFalse, file, label, output, active);
        return;
    }
    if (ts.isIdentifier(expression)) {
        if (expression.text === "APP_MEMBER") return;
        const key = `${file}:${expression.text}`;
        if (active.has(key)) {
            diagnostics.push(`${file}: ${label}: cyclic member definition ${expression.text}`);
            return;
        }
        active.add(key);
        const local = declarationsByName(file).get(expression.text);
        if (local) {
            if (ts.isArrayLiteralExpression(local)) {
                collectMembers(local, file, label, output, active);
            } else if (ts.isObjectLiteralExpression(local)) {
                const name = propertyName(property(local, "name")?.initializer);
                const kind = propertyName(property(local, "kind")?.initializer);
                if (name && kind === "method") output.add(name);
                else if (!name || !kind) diagnostics.push(`${file}: ${label}: dynamic member entry ${expression.text}`);
            } else {
                diagnostics.push(`${file}: ${label}: dynamic member array ${expression.text}`);
            }
            active.delete(key);
            return;
        }
        const imported = importedSource(file, expression.text);
        if (imported) {
            const importedDeclaration = declarationsByName(imported).get(expression.text);
            if (ts.isObjectLiteralExpression(importedDeclaration)) {
                const name = propertyName(property(importedDeclaration, "name")?.initializer);
                const kind = propertyName(property(importedDeclaration, "kind")?.initializer);
                if (name && kind === "method") output.add(name);
                else if (!name || !kind) diagnostics.push(`${imported}: ${label}: dynamic member entry ${expression.text}`);
            } else {
                collectMembers(importedDeclaration, imported, label, output, active);
            }
            active.delete(key);
            return;
        }
        diagnostics.push(`${file}: ${label}: dynamic member array ${expression.text}`);
        active.delete(key);
        return;
    }
    diagnostics.push(`${file}: ${label}: dynamic member entry ${expression.getText().slice(0, 80)}`);
}

function findDescriptorMembers(classDeclaration, file) {
    for (const member of classDeclaration.members) {
        if (!ts.isGetAccessorDeclaration(member) || propertyName(member.name) !== "aiVision" || !member.body) continue;
        let memberExpression;
        function visit(node) {
            if (ts.isPropertyAssignment(node) && propertyName(node.name) === "members") {
                memberExpression = node.initializer;
            }
            ts.forEachChild(node, visit);
        }
        visit(member.body);
        if (!memberExpression) return undefined;
        const methods = new Set();
        collectMembers(memberExpression, file, classDeclaration.name?.text ?? "facade", methods);
        return methods;
    }
    return undefined;
}

function classMethods(classDeclaration) {
    const methods = new Set();
    for (const member of classDeclaration.members) {
        if (!ts.isMethodDeclaration(member) || !member.name || member.modifiers?.some((modifier) =>
            modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword || modifier.kind === ts.SyntaxKind.StaticKeyword,
        )) continue;
        const name = propertyName(member.name);
        if (name && name !== "aiVision") methods.add(name);
    }
    return methods;
}

for (const name of FACADE_FILES) {
    const file = `${API_WRAPPER}/${name}`;
    const classDeclaration = source(file).statements.find((statement) => ts.isClassDeclaration(statement)
        && (statement.heritageClauses ?? []).some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
            && clause.types.some((type) => type.expression.getText() === "EditorFacadeBase")));
    const genericClass = source(file).statements.find((statement) => ts.isClassDeclaration(statement)
        && statement.name?.text === "GenericEditorFacade");
    const targetClass = classDeclaration ?? genericClass;
    if (!targetClass) {
        diagnostics.push(`${file}: facade: expected EditorFacadeBase subclass or GenericEditorFacade`);
        continue;
    }
    const described = findDescriptorMembers(targetClass, file);
    if (!described) {
        diagnostics.push(`${file}: ${targetClass.name?.text ?? "facade"}: no static describe member list`);
        continue;
    }
    for (const method of classMethods(targetClass)) {
        const key = `${targetClass.name.text}.${method}`;
        if (!described.has(method) && !METHOD_ALLOWLIST[key]) {
            diagnostics.push(`${file}: ${key}: public method missing from AiVision describe table`);
        }
    }
}

const boardMethods = new Set();
collectMembers(declarationsByName(BOARDS_FILE).get("BOARDS_MEMBERS"), BOARDS_FILE, "IBoards", boardMethods);
const interfaceMethods = new Set();
for (const statement of source(BOARDS_TYPES_FILE).statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== "IBoards") continue;
    for (const member of statement.members) {
        if (!ts.isMethodSignature(member)) continue;
        const name = propertyName(member.name);
        if (name) interfaceMethods.add(name);
    }
}
for (const method of interfaceMethods) {
    if (!boardMethods.has(method)) diagnostics.push(`${BOARDS_FILE}: IBoards.${method}: method missing from BOARDS_MEMBERS`);
}
for (const method of boardMethods) {
    if (!interfaceMethods.has(method)) diagnostics.push(`${BOARDS_FILE}: BOARDS_MEMBERS.${method}: method missing from IBoards`);
}

if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) console.error(diagnostic);
    process.exitCode = 1;
} else {
    console.log("Describe tables match facade and IBoards methods.");
}
