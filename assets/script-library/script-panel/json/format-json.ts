// Pretty-print JSON with 2-space indentation

const data = JSON.parse(page.content);
return JSON.stringify(data, null, 2);
