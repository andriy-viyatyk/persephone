export interface ApplicationProfileArguments { name?: string; remainingArgs: string[] }

export function parseApplicationProfile(args: string[]): ApplicationProfileArguments {
    let name: string | undefined;
    const remainingArgs: string[] = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--profile" || arg.startsWith("--profile=")) {
            if (name !== undefined) throw new Error("Duplicate profile option.");
            const value = arg === "--profile" ? args[++index] : arg.slice(10);
            const normalized = value?.toLowerCase();
            if (!normalized || !/^[a-z0-9-]{1,32}$/.test(normalized) || normalized === "default") throw new Error("Invalid profile name.");
            name = normalized;
        } else remainingArgs.push(arg);
    }
    return { name, remainingArgs };
}

export function applicationProfileName(): string | undefined {
    return parseApplicationProfile(process.argv.slice(1)).name;
}
