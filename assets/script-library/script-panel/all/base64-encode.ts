// Encode page content (or selection) to Base64

const text: string = page.content;
return btoa(unescape(encodeURIComponent(text)));
