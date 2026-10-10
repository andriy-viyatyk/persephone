const t = (key, params) => persephone.i18n.t(key, params);
const out = document.getElementById("out");

document.title = t("starter.title");
document.querySelector("h1").textContent = t("starter.title");
document.querySelector("body > p").textContent = t("starter.description");
document.getElementById("run").textContent = t("starter.run");
out.textContent = t("starter.output");

document.getElementById("run").addEventListener("click", () => {
    const result = { messageKey: "starter.result" };
    out.textContent = t(result.messageKey);
});
