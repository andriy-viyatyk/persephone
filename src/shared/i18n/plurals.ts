const rules = new Map<string, Intl.PluralRules>();

export function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
    let rule = rules.get(locale);
    if (!rule) {
        rule = new Intl.PluralRules(locale);
        rules.set(locale, rule);
    }
    return rule.select(count);
}
