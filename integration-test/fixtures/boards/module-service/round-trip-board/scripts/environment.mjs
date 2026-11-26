const keys = [
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
    "CLAUDE_CONFIG_DIR", "CODEX_HOME", "PATH", "PATHEXT", "SystemRoot",
];
const environment = Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]));
environment.pathLookups = [process.env.PATH, process.env.Path, process.env.path];
console.log(`@@RESULT@@${JSON.stringify(environment)}`);
