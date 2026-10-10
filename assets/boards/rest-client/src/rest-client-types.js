import { t } from "./i18n.js";

/** @typedef {{ key: string, value: string, enabled: boolean }} RestHeader */
/** @typedef {"none" | "form-urlencoded" | "raw" | "binary" | "form-data"} BodyType */
/** @typedef {"plaintext" | "json" | "javascript" | "html" | "xml"} RawLanguage */
/** @typedef {{ key: string, value: string, type: "text" | "file", enabled: boolean }} FormDataEntry */
/** @typedef {{ id: string, name: string, collection: string, method: string, url: string, headers: RestHeader[], body: string, bodyType: BodyType, bodyLanguage: RawLanguage, formData: RestHeader[], binaryFilePath: string, formDataEntries: FormDataEntry[] }} RestRequest */
/** @typedef {{ type: "rest-client", requests: RestRequest[] }} RestClientData */
/** @typedef {{ status: number, statusText: string, headers: RestHeader[], body: string, isBinary?: boolean, contentType?: string }} RestResponse */
/** @typedef {{ response: RestResponse, responseTime: number }} CachedResponse */

export const RAW_LANGUAGES = Object.freeze(["plaintext", "json", "javascript", "html", "xml"]);

/** @param {string} [name] @param {string} [collection] @returns {RestRequest} */
export function createDefaultRequest(name, collection) {
    return {
        id: crypto.randomUUID(),
        name: name || t("request.default.name"),
        collection: collection || "",
        method: "GET",
        url: "",
        headers: [],
        body: "",
        bodyType: "none",
        bodyLanguage: "plaintext",
        formData: [],
        binaryFilePath: "",
        formDataEntries: [],
    };
}
