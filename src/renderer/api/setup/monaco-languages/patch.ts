import * as monaco from "monaco-editor";

type Monaco = typeof monaco;

/**
 * Define Patch language with structural syntax highlighting for .patch and .diff files.
 */
export function definePatchLanguage(monacoInstance: Monaco): void {
    const languageId = "patch";

    const conf: monaco.languages.LanguageConfiguration = {};

    const monarchLanguage: monaco.languages.IMonarchLanguage = {
        ignoreCase: false,

        tokenizer: {
            root: [
                [/^diff --git .*$/, "meta.header.patch"],
                [/^diff .*$/, "meta.header.patch"],
                [
                    // The trailing text is optional: "GIT binary patch" stands alone on its
                    // line, while "index abc..def" and the rest carry an argument.
                    /^(index|old mode|new mode|new file mode|deleted file mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|GIT binary patch|Binary files)( .*)?$/,
                    "meta.patch",
                ],
                [/^--- .*$/, "meta.file.patch"],
                [/^\+\+\+ .*$/, "meta.file.patch"],
                [/^@@.*$/, "meta.range.patch"],
                [/^Index: .*$/, "meta.patch"],
                [/^[=*-]{3,}$/, "meta.patch"],
                [/^-.*$/, "deleted.patch"],
                [/^\+.*$/, "inserted.patch"],
                [/^\\.*$/, "meta.patch"],
            ],
        },
    };

    monacoInstance.languages.register({
        id: languageId,
        extensions: [".patch", ".diff"],
        aliases: ["Patch", "patch", "Diff", "diff"],
    });

    monacoInstance.languages.setLanguageConfiguration(languageId, conf);
    monacoInstance.languages.setMonarchTokensProvider(
        languageId,
        monarchLanguage
    );
}
