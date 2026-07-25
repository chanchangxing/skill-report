const input = document.querySelector("#history-search");
const cards = [...document.querySelectorAll(".report-card")];

input?.addEventListener("input", () => {
  const query = input.value.trim().toLowerCase();
  for (const card of cards) {
    card.hidden = Boolean(query) && !card.dataset.search.includes(query);
  }
});
