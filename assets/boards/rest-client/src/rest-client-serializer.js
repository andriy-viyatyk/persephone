/** @typedef {import("./rest-client-types.js").RestClientData} RestClientData */

/** @param {RestClientData} data @returns {RestClientData} */
export function cleanRestClientData(data) {
    return {
        ...data,
        requests: data.requests.map((request) => ({
            ...request,
            headers: request.headers.filter((header) => header.key || header.value),
            formData: request.formData.filter((field) => field.key || field.value),
            formDataEntries: request.formDataEntries.filter((field) => field.key || field.value),
        })),
    };
}

/** @param {RestClientData} data @returns {string} */
export function serializeRestClientData(data) {
    return JSON.stringify(cleanRestClientData(data), null, 4);
}
