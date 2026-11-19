const keys = [
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "CLAUDE_CONFIG_DIR", "CODEX_HOME", "PATH", "PATHEXT", "SystemRoot",
];
const environment = Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]));
environment.pathLookups = [process.env.PATH, process.env.Path, process.env.path];
console.log(`@@RESULT@@${JSON.stringify(environment)}`);
