fetch("/browser/page-tools/resources.svg?from=fetch")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    document.querySelector("#fetch-result").textContent = "resource fetch complete";
  })
  .catch((error) => {
    document.querySelector("#fetch-result").textContent = error.message;
  });
