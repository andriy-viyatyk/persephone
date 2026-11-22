const mockPage = {
    text(selector) {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Expected mock page element: ${selector}`);
        return element.textContent.trim();
    },
    texts(selector) {
        return Array.from(document.querySelectorAll(selector), (element) => element.textContent.trim());
    },
};
