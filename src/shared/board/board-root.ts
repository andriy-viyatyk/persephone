export interface BoardRootDigestInputs {
    /** sha256 input of the board storage key and capability provider id. Keeps the trailing slash of a root. */
    readonly storage: string;
    /** sha256 input of the board:// host. */
    readonly host: string;
    /** sha256 input of the window key and window dedupe. */
    readonly window: string;
}

const DRIVE_ROOT = /^([A-Za-z]:)[\\/]+/;
const UNC_ROOT = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/;
const POSIX_ROOT = /^\/(?!\/)/;

export class BoardRoot {
    /** Resolved absolute path, preserving the caller's case and native separators. */
    readonly path: string;
    /** Comparison key: slash-separated and case-folded for Windows-shaped paths. */
    readonly key: string;
    readonly digestInputs: BoardRootDigestInputs;

    private constructor(path: string, key: string, digestInputs: BoardRootDigestInputs) {
        this.path = path;
        this.key = key;
        this.digestInputs = digestInputs;
        Object.freeze(this.digestInputs);
        Object.freeze(this);
    }

    /** Throws when input is not a supported absolute path. */
    static from(input: string): BoardRoot {
        const root = BoardRoot.tryFrom(input);
        if (!root) throw new TypeError("A board root must be an absolute path.");
        return root;
    }

    /** Returns undefined for an invalid or unsupported path. */
    static tryFrom(input: unknown): BoardRoot | undefined {
        if (typeof input !== "string" || input.length === 0) return undefined;

        let prefix: string;
        let rest: string;
        let windows: boolean;
        let match = UNC_ROOT.exec(input);
        if (match) {
            const host = match[1];
            const share = match[2];
            if (host === "." || host === "?" || host.includes(":")) return undefined;
            prefix = `\\\\${host}\\${share}\\`;
            rest = input.slice(match[0].length);
            windows = true;
        } else {
            match = DRIVE_ROOT.exec(input);
            if (match) {
                prefix = `${match[1]}\\`;
                rest = input.slice(match[0].length);
                windows = true;
            } else if (POSIX_ROOT.test(input)) {
                prefix = "/";
                rest = input.slice(1);
                windows = false;
            } else {
                return undefined;
            }
        }

        const segments: string[] = [];
        for (const segment of rest.split(windows ? /[\\/]/ : /\//)) {
            if (!segment || segment === ".") continue;
            if (segment === "..") segments.pop();
            else segments.push(segment);
        }

        if (windows) {
            const path = segments.length ? prefix + segments.join("\\") : prefix;
            const slashed = path.replace(/\\/g, "/").toLowerCase();
            const foldedPath = path.toLowerCase();
            return new BoardRoot(path, slashed.replace(/\/+$/, ""), {
                storage: slashed,
                host: foldedPath,
                window: foldedPath,
            });
        }

        const path = prefix + segments.join("/");
        return new BoardRoot(path, path.replace(/\/+$/, ""), {
            storage: path,
            host: path,
            window: path.toLowerCase(),
        });
    }

    /** Exact-key comparison. Invalid string operands are not equal. */
    equals(other: BoardRoot | string | null | undefined): boolean {
        const root = other instanceof BoardRoot ? other : BoardRoot.tryFrom(other);
        return root !== undefined && this.key === root.key;
    }

    /** Returns this root's name when it is a direct child of the given boards folder. */
    bundledId(boardsFolder: BoardRoot): string | undefined {
        if (this.key === boardsFolder.key || !this.key.startsWith(boardsFolder.key + "/")) return undefined;
        const rest = this.path.slice(boardsFolder.path.length).replace(/^[\\/]+/, "");
        return rest.length > 0 && !/[\\/]/.test(rest) ? rest : undefined;
    }
}
