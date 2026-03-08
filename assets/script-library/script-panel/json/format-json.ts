// Pretty-print JSON with 2-space indentation

const data = JSON.parse(page.content);
page.grouped.language = "json";
return JSON.stringify(data, null, 2);
