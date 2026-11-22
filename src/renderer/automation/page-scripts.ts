/** Shared snippets evaluated inside the inspected page. Keep this module independent of callers. */
export { VISIBLE_FN } from "../../shared/automation-page-primitives";
import { VISIBLE_FN } from "../../shared/automation-page-primitives";

export const FRAME_OFFSETS_FN = `const frameOffsets = [];
for (let frame = window.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) {
    const frameRect = frame.getBoundingClientRect();
    frameOffsets.push({ x: frameRect.left + frame.clientLeft, y: frameRect.top + frame.clientTop });
}`;

/** Parser and engine resolver shared by preflight and all selector consumers. */
function selectorParserSource(): string {
    return String.raw`function parseSelector(selector) {
        if (typeof selector !== 'string' || !selector.trim()) throw new Error('Selector cannot be empty.');
        const rawSteps = [];
        let start = 0, quote = '', escaped = false, regex = false, regexClass = false, square = 0, round = 0;
        for (let index = 0; index < selector.length; index++) {
            const char = selector[index];
            if (escaped) { escaped = false; continue; }
            if (char === '\\') { escaped = true; continue; }
            if (regex) { if (char === '[') regexClass = true; else if (char === ']') regexClass = false; else if (char === '/' && !regexClass) regex = false; continue; }
            if (quote) { if (char === quote) quote = ''; continue; }
            if (char === '"' || char === "'") { quote = char; continue; }
            if (char === '/' && square > 0 && /=\s*$/.test(selector.slice(start, index))) { regex = true; continue; }
            if (char === '[') square++;
            else if (char === ']') { if (--square < 0) throw new Error('Malformed selector string: unexpected ].'); }
            else if (char === '(') round++;
            else if (char === ')') { if (--round < 0) throw new Error('Malformed selector string: unexpected ).'); }
            else if (char === '>' && selector[index + 1] === '>' && square === 0 && round === 0) {
                rawSteps.push(selector.slice(start, index)); start = index + 2; index++;
            }
        }
        if (escaped || quote || regex || square !== 0 || round !== 0) throw new Error('Malformed selector string: unclosed quote, bracket, parenthesis, or regex.');
        rawSteps.push(selector.slice(start));
        const steps = rawSteps.map((raw, index) => parseStep(raw.trim(), index));
        if (steps.some(step => step.engine === 'ref' && indexOfStep(steps, step) !== 0)) throw new Error('ref= is scope-independent and must be the first selector step.');
        return steps;
    }
    function indexOfStep(steps, target) { return steps.indexOf(target); }
    function parseStep(source, index) {
        if (!source) throw new Error('Selector chain contains an empty step.');
        const nth = /^nth=(.*)$/.exec(source);
        if (nth) {
            if (index === 0) throw new Error('nth= requires a preceding selector step.');
            if (!/^-?\d+$/.test(nth[1])) throw new Error('nth= must be a signed safe integer.');
            const value = Number(nth[1]);
            if (!Number.isSafeInteger(value)) throw new Error('nth= must be a signed safe integer.');
            return { engine: 'nth', value };
        }
        if (source.startsWith('nth=')) throw new Error('Malformed nth= step; expected nth=<signed integer>.');
        const engines = ['role=', 'label=', 'placeholder=', 'testid=', 'title=', 'alt=', 'text=', 'ref='];
        const engine = engines.find(prefix => source.startsWith(prefix));
        if (engine === 'ref=' && !source.slice(engine.length)) throw new Error('ref= requires a ref value.');
        const step = { engine: engine ? engine.slice(0, -1) : 'css', source: engine ? source.slice(engine.length) : source };
        if (step.engine === 'css') Object.assign(step, parseCssSuffixes(step.source));
        return step;
    }
    function parseCssSuffixes(source) {
        let quote = '', escaped = false, square = 0, round = 0, suffixStart = -1;
        for (let index = 0; index < source.length; index++) {
            const char = source[index];
            if (escaped) { escaped = false; continue; }
            if (char === '\\') { escaped = true; continue; }
            if (quote) { if (char === quote) quote = ''; continue; }
            if (char === '"' || char === "'") { quote = char; continue; }
            if (char === '[') square++;
            else if (char === ']') square--;
            else if (char === '(') {
                if (square === 0 && (source.startsWith(':has-text(', index) || source.startsWith(':visible(', index))) {
                    const pseudo = source.startsWith(':has-text(', index) ? ':has-text' : ':visible';
                    throw new Error(pseudo + ' must be a CSS-step suffix with a valid argument.');
                }
                round++;
            } else if (char === ')') round--;
            if (square === 0 && !quote && (source.startsWith(':has-text(', index) || /^:visible(?![\w-])/.test(source.slice(index)))) {
                const pseudo = source.startsWith(':has-text(', index) ? ':has-text' : ':visible';
                if (round > 0) throw new Error(pseudo + ' must be a CSS-step suffix, outside :is(...) and other functions.');
                suffixStart = index; break;
            }
        }
        if (suffixStart < 0) return { css: source, filters: [], sameElement: false };
        const css = source.slice(0, suffixStart).trim();
        const filters = [];
        let index = suffixStart;
        while (index < source.length) {
            if (source.startsWith(':visible', index)) { filters.push({ type: 'visible' }); index += 8; continue; }
            if (source.startsWith(':has-text(', index)) {
                const start = index + 10; let end = start, quoted = false, slash = false;
                for (; end < source.length; end++) {
                    const char = source[end];
                    if (slash) { slash = false; continue; }
                    if (char === '\\') { slash = true; continue; }
                    if (char === '"') quoted = !quoted;
                    else if (char === ')' && !quoted) break;
                }
                if (end >= source.length) throw new Error(':has-text requires a JSON double-quoted string.');
                let value;
                try { value = JSON.parse(source.slice(start, end).trim()); } catch { throw new Error(':has-text requires a JSON double-quoted string.'); }
                if (typeof value !== 'string') throw new Error(':has-text requires a JSON double-quoted string.');
                filters.push({ type: 'has-text', value }); index = end + 1; continue;
            }
            const unsupported = /:(has-text|visible)\b/.exec(source.slice(index));
            const pseudo = unsupported?.[1] || filters[filters.length - 1]?.type;
            if (pseudo) throw new Error(':' + pseudo + ' must be a CSS-step suffix, after the complete CSS selector.');
            throw new Error('Only :has-text("...") and :visible are supported as CSS-step suffixes.');
        }
        const sameElement = css === ':scope';
        if (/[>+~,]\s*$/.test(css)) {
            const pseudo = filters[filters.length - 1]?.type;
            throw new Error(':' + (pseudo || 'visible') + ' must be a CSS-step suffix after a complete CSS selector.');
        }
        if (!css && source.slice(0, suffixStart).trim() !== ':scope') throw new Error('CSS suffix filters require a CSS selector before the suffix.');
        return { css: css || '*', filters, sameElement };
    }
    function parseValue(source, allowRegex = true) {
        const value = source.trim();
        if (allowRegex && value.startsWith('/')) {
            let escaped = false, inClass = false, end = -1;
            for (let index = 1; index < value.length; index++) {
                const char = value[index];
                if (escaped) { escaped = false; continue; }
                if (char === '\\') { escaped = true; continue; }
                if (char === '[') inClass = true; else if (char === ']') inClass = false;
                else if (char === '/' && !inClass) { end = index; break; }
            }
            if (end < 0) throw new Error('Malformed regular expression selector.');
            const flags = value.slice(end + 1);
            if (/[^dgimsuvy]/.test(flags) || new Set(flags).size !== flags.length) throw new Error('Invalid regular expression flags.');
            try { return { kind: 'regex', value: new RegExp(value.slice(1, end), flags) }; }
            catch { throw new Error('Invalid regular expression selector.'); }
        }
        if (value.startsWith('"')) {
            let end = -1, escaped = false;
            for (let index = 1; index < value.length; index++) {
                if (escaped) { escaped = false; continue; }
                if (value[index] === '\\') { escaped = true; continue; }
                if (value[index] === '"') { end = index; break; }
            }
            if (end < 0) throw new Error('Malformed quoted selector value.');
            let decoded;
            try { decoded = JSON.parse(value.slice(0, end + 1)); } catch { throw new Error('Malformed quoted selector value.'); }
            const suffix = value.slice(end + 1).trim();
            if (suffix && suffix !== 's' && suffix !== 'i') throw new Error('Unsupported selector value flag.');
            return { kind: suffix === 's' ? 'exact' : 'substring', value: decoded, sensitive: suffix === 's' };
        }
        if (!value) throw new Error('Selector value cannot be empty.');
        return { kind: 'substring', value, sensitive: false };
    }
    function normalize(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
    function matchesValue(actual, matcher) {
        const value = normalize(actual), wanted = normalize(matcher.value);
        if (matcher.kind === 'regex') { matcher.value.lastIndex = 0; return matcher.value.test(value); }
        if (matcher.kind === 'exact') return value === wanted;
        return matcher.sensitive ? value.includes(wanted) : value.toLocaleLowerCase().includes(wanted.toLocaleLowerCase());
    }
    function parseRole(source) {
        const match = /^([\w-]+)\s*(.*)$/.exec(source.trim());
        if (!match) throw new Error('Malformed role selector.');
        const attributes = Object.create(null), rest = match[2];
        let index = 0;
        while (index < rest.length) {
            while (/\s/.test(rest[index] || '')) index++;
            if (index === rest.length) break;
            if (rest[index] !== '[') throw new Error('Malformed role selector attribute.');
            let end = index + 1, quote = '', escaped = false, regex = false, regexClass = false;
            for (; end < rest.length; end++) {
                const char = rest[end];
                if (escaped) { escaped = false; continue; }
                if (char === '\\') { escaped = true; continue; }
                if (regex) {
                    if (char === '[') regexClass = true;
                    else if (char === ']') regexClass = false;
                    else if (char === '/' && !regexClass) regex = false;
                    continue;
                }
                if (quote) { if (char === quote) quote = ''; continue; }
                if (char === '"') { quote = char; continue; }
                if (char === '/' && /=\s*$/.test(rest.slice(index + 1, end))) { regex = true; continue; }
                if (char === ']') break;
            }
            if (end >= rest.length || quote || escaped || regex) throw new Error('Malformed role selector attribute.');
            const content = rest.slice(index + 1, end).trim();
            const attribute = /^(name|checked|disabled|expanded|level|pressed|selected|include-hidden)(?:\s*(=|!=|~=|\^=|\$=|\*=|>|<)\s*(.*))?$/.exec(content);
            if (!attribute) throw new Error('Unknown or malformed role selector attribute: ' + content);
            const [, key, operator, raw] = attribute;
            if (Object.prototype.hasOwnProperty.call(attributes, key)) throw new Error('Duplicate role selector attribute: ' + key);
            if (operator && operator !== '=') throw new Error('Unsupported operator for role selector attribute: ' + key);
            if (key === 'name') {
                if (!operator) throw new Error('The name attribute requires a value.');
                attributes.name = parseValue(raw);
            } else if (key === 'level') {
                if (!operator || !/^[1-9]\d*$/.test(raw)) throw new Error('Role level must be a positive integer.');
                attributes.level = Number(raw);
            } else if (key === 'checked' || key === 'pressed') {
                if (!operator) attributes[key] = true;
                else if (/^(true|false|mixed)$/.test(raw)) attributes[key] = raw === 'mixed' ? 'mixed' : raw === 'true';
                else throw new Error(key + ' must be true, false, or mixed.');
            } else {
                if (!operator) attributes[key] = true;
                else if (raw === 'true' || raw === 'false') attributes[key] = raw === 'true';
                else throw new Error(key + ' must be true or false.');
            }
            index = end + 1;
        }
        return { role: match[1], attributes };
    }
    function selectorHostFacts(selector) {
        const steps = parseSelector(selector);
        return { roles: steps.filter(step => step.engine === 'role').map(step => parseRole(step.source).role), refs: steps.filter(step => step.engine === 'ref').map(step => step.source) };
    }`;
}

/** Lightweight preflight used by the host to discover requested Chromium AX roles. */
export function selectorPreflightSource(): string {
    return `(() => { ${selectorParserSource()} return selectorHostFacts(${"__SELECTOR__"}); })()`;
}

/** Existing query/action selector semantics shared by all page-side locator snippets. */
export function resolveCandidatesSource(): string {
    return String.raw`function resolveCandidates(selector, mode, options = {}, axFacts = [], scope = document) {
        ${VISIBLE_FN}
        ${selectorParserSource()}
        const steps = parseSelector(selector);
        let candidates = [scope];
        let finalTextSingle = steps.length === 1 && steps[0].engine === 'text';
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
            const step = steps[stepIndex];
            if (step.engine === 'nth') {
                const index = step.value < 0 ? candidates.length + step.value : step.value;
                candidates = index < 0 || index >= candidates.length ? [] : [candidates[index]];
                continue;
            }
            if (step.engine === 'ref') {
                candidates = options.refs?.[step.source] ? [options.refs[step.source]] : [];
                continue;
            }
            const intermediate = stepIndex < steps.length - 1;
            const prior = stepIndex === 0 ? [scope] : candidates;
            const perScope = [];
            for (const parent of prior) perScope.push(...evaluateStep(step, parent, intermediate));
            candidates = uniqueInDocumentOrder(perScope);
        }
        if (mode === 'action' && !finalTextSingle) candidates = selectActionCandidates(candidates, options);
        if (finalTextSingle && mode !== 'intermediate') candidates = selectTextCandidates(candidates, mode, options);
        if (options.visibleOnly) candidates = candidates.filter(visible);
        return options.nth === undefined ? candidates : candidates.slice(options.nth, options.nth + 1);

        function evaluateStep(step, parent, intermediate) {
            let result = [];
            if (step.engine === 'css') {
                if (step.sameElement) result = [parent === document ? document.documentElement : parent];
                else {
                    if (mode === 'query') parent.querySelector(step.css);
                    result = [...parent.querySelectorAll(step.css)];
                }
                result = result.filter(element => step.filters.every(filter => {
                    if (filter.type === 'visible') return visible(element);
                    return normalize(element.innerText || element.textContent || '').toLocaleLowerCase()
                        .includes(normalize(filter.value).toLocaleLowerCase());
                }));
            } else if (step.engine === 'text') {
                const raw = step.source.trim();
                const matcher = parseValue(raw, false);
                if (raw.startsWith('"') && !raw.endsWith('"s') && !raw.endsWith('"i')) matcher.kind = 'exact';
                const root = parent === document ? parent.body : parent;
                result = [...root.querySelectorAll('*')].filter(el => matchesValue(el.innerText || el.textContent || '', matcher));
                result = result.filter(el => !result.some(candidate => candidate !== el && el.contains(candidate)));
                if (!intermediate && mode !== 'intermediate') result = result.filter(el => displayed(el) || (mode === 'action' && options.force));
            } else {
                const matcher = step.engine === 'role' ? parseRole(step.source) : null;
                if (matcher && !Object.prototype.hasOwnProperty.call(matcher.attributes, 'include-hidden')) matcher.attributes['include-hidden'] = false;
                if (step.engine === 'role') {
                    result = axFacts.filter(fact => fact.element !== parent && parent.contains(fact.element) && fact.role === matcher.role
                        && (!fact.ignored || matcher.attributes['include-hidden'] === true)
                        && roleAttributesMatch(fact, matcher.attributes)).map(fact => fact.element);
                } else if (step.engine === 'label') {
                    const wanted = parseValue(step.source);
                    const controls = [...parent.querySelectorAll('input:not([type="hidden"]),select,textarea,button,meter,output,progress')];
                    result = controls.filter(control => {
                        const labels = [];
                        if ('labels' in control && control.labels) labels.push(...control.labels);
                        const ids = (control.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
                        for (const id of ids) { const node = control.ownerDocument.getElementById(id); if (node) labels.push(node); }
                        const ariaLabel = control.getAttribute('aria-label');
                        return labels.some(label => matchesValue(label.innerText || label.textContent || '', wanted))
                            || (ariaLabel !== null && matchesValue(ariaLabel, wanted));
                    });
                } else {
                    const attribute = { placeholder: 'placeholder', testid: 'data-testid', title: 'title', alt: 'alt' }[step.engine];
                    const wanted = parseValue(step.source, false);
                    result = [...parent.querySelectorAll('*')].filter(element => {
                        const actual = element.getAttribute(attribute);
                        return actual !== null && (step.engine === 'testid' ? actual === wanted.value : matchesValue(actual, wanted));
                    });
                }
            }
            return result;
        }
        function selectActionCandidates(allMatches, actionOptions) {
            const displayedMatches = allMatches.filter(displayed), sizedMatches = displayedMatches.filter(visible);
            return actionOptions.force ? allMatches : sizedMatches.length ? sizedMatches : displayedMatches;
        }
        function selectTextCandidates(allMatches, textMode, textOptions) {
            const visibleMatches = allMatches.filter(el => displayed(el) || (textMode === 'action' && textOptions.force));
            const sized = visibleMatches.filter(visible);
            const chosen = textMode === 'action' && textOptions.force ? visibleMatches : sized.length ? sized : visibleMatches;
            return chosen.sort((a, b) => {
                const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
                const area = ar.width * ar.height - br.width * br.height;
                if (area) return area;
                const depth = el => { let value = 0; for (let node = el; node; node = node.parentElement) value++; return value; };
                return depth(b) - depth(a);
            });
        }
        function uniqueInDocumentOrder(elements) {
            return [...new Set(elements)].sort((left, right) => {
                if (left === right) return 0;
                const position = left.compareDocumentPosition(right);
                return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
            });
        }

        function roleAttributesMatch(fact, attributes) {
            for (const [key, expected] of Object.entries(attributes)) {
                if (key === 'include-hidden') continue;
                if (key === 'name') { if (!matchesValue(fact.name || '', expected)) return false; continue; }
                const property = fact.properties?.find(item => item.name === key);
                // Chromium reports checked/pressed as "tristate" tokens ("true", "false", "mixed").
                const actual = property?.value === 'true' ? true : property?.value === 'false' ? false : property?.value;
                if (key === 'level') { if (actual !== expected) return false; continue; }
                if (key === 'disabled' || key === 'selected' || key === 'checked' || key === 'pressed') {
                    const value = actual === undefined ? false : actual;
                    if (expected === 'mixed' ? value !== 'mixed' : value !== expected) return false;
                } else if (actual === undefined || actual !== expected) return false;
            }
            return true;
        }
    }`;
}
