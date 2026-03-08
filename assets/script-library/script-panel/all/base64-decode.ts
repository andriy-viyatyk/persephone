// Decode Base64 content back to text

const text: string = page.content.trim();
return decodeURIComponent(escape(atob(text)));
