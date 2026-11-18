const contentElement = document.querySelector("[data-testid='file-content']");
const statusElement = document.querySelector("[data-testid='save-status']");

async function loadContent() {
    contentElement.textContent = await persephone.host.getContent();
}

document.querySelector("#save-updated").addEventListener("click", async () => {
    await persephone.host.setContent("fixture-updated");
    await persephone.host.save();
    statusElement.textContent = "saved";
});

loadContent();
