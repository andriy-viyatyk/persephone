import path from "node:path";
import { HTTP_FIXTURE_URL } from "./lib/config.mjs";

export default function setup({ test, getClient }) {
    const workRoot = path.resolve(test.profileDirectory, "work");
    return {
        fixture(relativePath) {
            if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) throw new Error("Fixture path must be relative.");
            const result = path.resolve(workRoot, relativePath);
            const child = path.relative(workRoot, result);
            if (child === ".." || child.startsWith(`..${path.sep}`) || path.isAbsolute(child)) throw new Error("Fixture path escaped the fixture directory.");
            return result;
        },
        httpUrl(value) {
            if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) {
                throw new Error("HTTP fixture path must be a local absolute path beginning with one '/'.");
            }
            let decoded;
            try { decoded = decodeURIComponent(value); }
            catch { throw new Error("HTTP fixture path contains malformed encoding."); }
            if (decoded.startsWith("//") || decoded.includes("\\") || decoded.split(/[?#]/, 1)[0].split("/").some((part) => part === "." || part === "..")) {
                throw new Error("HTTP fixture path cannot escape the local fixture server.");
            }
            return new URL(value, `${HTTP_FIXTURE_URL}/`).href;
        },
        _getClient() {
            const current = getClient();
            return { client: { listTools: () => current.listTools() }, rawCall: (apiPath, args, options) => current.rawCall(apiPath, args, options) };
        },
    };
}
