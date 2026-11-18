window.persephone.settings.onChange((change) => {
  document.querySelector("#result").innerText = JSON.stringify(change);
});

window.persephone.page.onVisibilityChange((visible) => {
  document.querySelector("#result").innerText = JSON.stringify({ visible });
});
