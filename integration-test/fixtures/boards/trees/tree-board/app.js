const button = document.querySelector("#open-tree");
const status = document.querySelector("#tree-status");

button.addEventListener("click", async () => {
    button.disabled = true;
    try {
        await window.persephone.openTree({
            type: "test/tree",
            config: { conn: "a" },
            rootPath: "/",
        });
        status.textContent = "Tree opened";
    } catch (error) {
        status.textContent = error?.message ?? String(error);
    } finally {
        button.disabled = false;
    }
});
