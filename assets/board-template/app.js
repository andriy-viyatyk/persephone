// The all-false starter demonstrates local UI logic without a gated bridge call.
const out = document.getElementById("out");

document.getElementById("run").addEventListener("click", () => {
    const result = {
        message: "Your board is running.",
        timestamp: new Date().toLocaleTimeString(),
        nextStep: "Add only the permissions your board needs to board-manifest.json.",
    };
    out.textContent = JSON.stringify(result, null, 2);
});
