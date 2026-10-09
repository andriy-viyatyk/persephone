# Language packs

Place developer-provided packs in this directory. Persephone loads files named
`<code>.lang.json`, such as `uk.lang.json`, and validates the embedded code against the
filename. User packs belong in `<userData>/data/languages/` and override built-in messages
per key.

Each pack uses `schemaVersion: 1`, a BCP-47 `code`, localized `name`, English `englishName`,
optional `direction: "ltr"`, a `messages` object keyed by typed message ids, and optional
`source` hashes. A message is a string or an object of CLDR plural categories. Placeholder
names must match the English source message exactly. English messages are maintained in the
TypeScript catalog; no English JSON pack is needed.
