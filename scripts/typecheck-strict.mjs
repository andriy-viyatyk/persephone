// This script is the single owner of the strict folder list.
// Add a folder only after it reports zero strictNullChecks errors.
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const strictDirectories = [
    "src/shared", "src/renderer/core", "src/renderer/content",
    "src/board-shim", "src/node-script-host", "src/preload-webview",
    "src/renderer/guides", "src/renderer/i18n", "src/renderer/theme",
    "src/renderer/types", "src/renderer/components", "src/renderer/audio",
    "src/renderer/automation",
    "src/renderer/api", "src/ipc", "src/module-service-host",
    "src/renderer/scripting", "src/renderer/ui",
].map((directory) => path.resolve(root, directory));
const strictFiles = ["src/board-shim.ts", "src/preload-webview.ts"]
    .map((file) => path.resolve(root, file));
const canonical = (filePath) => ts.sys.useCaseSensitiveFileNames ? filePath : filePath.toLowerCase();
const isInside = (filePath, directory) => {
    const relativePath = path.relative(canonical(directory), canonical(filePath));
    return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativePath);
};
const isStrict = (fileName) => {
    const filePath = path.resolve(root, fileName);
    return strictFiles.some((strictFile) => canonical(strictFile) === canonical(filePath))
        || strictDirectories.some((directory) => isInside(filePath, directory));
};
const host = {
    getCanonicalFileName: (fileName) => canonical(fileName),
    getCurrentDirectory: () => root,
    getNewLine: () => ts.sys.newLine,
};
const report = (diagnostics) => {
    if (diagnostics.length) process.stderr.write(ts.formatDiagnostics(diagnostics, host));
    if (diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
        process.exitCode = 1;
    }
};

const configPath = path.join(root, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) {
    report([config.error]);
} else {
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
    if (parsed.errors.length) {
        report(parsed.errors);
    } else {
        const program = ts.createProgram(parsed.fileNames, {
            ...parsed.options,
            noEmit: true,
            strictNullChecks: true,
        });
        report(ts.getPreEmitDiagnostics(program).filter((diagnostic) => !diagnostic.file || isStrict(diagnostic.file.fileName)));
        if (!process.exitCode) {
            console.log(`strictNullChecks: ${strictDirectories.length} folders, 0 errors`);
        }
    }
}
