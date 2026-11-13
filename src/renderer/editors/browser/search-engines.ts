import { untranslated } from "../../../shared/i18n/t";

// Search Engines
// ============================================================================

export interface SearchEngine {
    id: string;
    label: string;
    /** URL template — `%s` is replaced with the encoded search query. */
    searchUrl: string;
    /** Hostname(s) that identify this engine in the URL bar. */
    hosts: string[];
    /** URL search param that contains the query (e.g. "q" for Google). */
    queryParam: string;
    /** Optional path prefix to detect this engine even when query param is missing
     *  (e.g. Perplexity redirects `/search?q=foo` to `/search/foo-<hash>`). */
    searchPathPrefix?: string;
}

export const SEARCH_ENGINES: SearchEngine[] = [
    {
        id: "google",
        label: untranslated("Google"),
        searchUrl: "https://www.google.com/search?q=%s",
        hosts: ["www.google.com", "google.com"],
        queryParam: "q",
    },
    {
        id: "bing",
        label: untranslated("Bing"),
        searchUrl: "https://www.bing.com/search?q=%s",
        hosts: ["www.bing.com", "bing.com"],
        queryParam: "q",
    },
    {
        id: "duckduckgo",
        label: untranslated("DuckDuckGo"),
        searchUrl: "https://duckduckgo.com/?q=%s",
        hosts: ["duckduckgo.com", "www.duckduckgo.com"],
        queryParam: "q",
    },
    {
        id: "yahoo",
        label: untranslated("Yahoo"),
        searchUrl: "https://search.yahoo.com/search?p=%s",
        hosts: ["search.yahoo.com"],
        queryParam: "p",
    },
    {
        id: "ecosia",
        label: untranslated("Ecosia"),
        searchUrl: "https://www.ecosia.org/search?q=%s",
        hosts: ["www.ecosia.org", "ecosia.org"],
        queryParam: "q",
    },
    {
        id: "brave",
        label: untranslated("Brave"),
        searchUrl: "https://search.brave.com/search?q=%s",
        hosts: ["search.brave.com"],
        queryParam: "q",
    },
    {
        id: "startpage",
        label: untranslated("Startpage"),
        searchUrl: "https://www.startpage.com/sp/search?query=%s",
        hosts: ["www.startpage.com", "startpage.com"],
        queryParam: "query",
    },
    {
        id: "qwant",
        label: untranslated("Qwant"),
        searchUrl: "https://www.qwant.com/?q=%s",
        hosts: ["www.qwant.com", "qwant.com"],
        queryParam: "q",
    },
    {
        id: "baidu",
        label: untranslated("Baidu"),
        searchUrl: "https://www.baidu.com/s?wd=%s",
        hosts: ["www.baidu.com", "baidu.com"],
        queryParam: "wd",
    },
    {
        id: "perplexity",
        label: untranslated("Perplexity"),
        searchUrl: "https://www.perplexity.ai/search?q=%s",
        hosts: ["www.perplexity.ai", "perplexity.ai"],
        queryParam: "q",
        searchPathPrefix: "/search",
    },
    {
        id: "gibiru",
        label: untranslated("Gibiru"),
        searchUrl: "https://gibiru.com/results.html?q=%s",
        hosts: ["gibiru.com", "www.gibiru.com"],
        queryParam: "q",
    },
];

/** Try to detect a search engine from a URL and extract the query string. */
export function detectSearchEngine(url: string): { engine: SearchEngine; query: string } | null {
    try {
        const parsed = new URL(url);
        for (const engine of SEARCH_ENGINES) {
            if (engine.hosts.includes(parsed.hostname)) {
                const query = parsed.searchParams.get(engine.queryParam);
                if (query) {
                    return { engine, query };
                }
                // Fallback: some engines redirect to a path-based URL (e.g. Perplexity
                // rewrites /search?q=foo → /search/foo-<hash>). Detect by path prefix.
                if (engine.searchPathPrefix && parsed.pathname.startsWith(engine.searchPathPrefix)) {
                    return { engine, query: "" };
                }
            }
        }
    } catch {
        // Invalid URL
    }
    return null;
}
