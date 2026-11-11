// Empty view with a title only. Real screens replace these in later steps.
export function placeholderView(title) {
  return function render(container) {
    const h1 = document.createElement("h1");
    h1.className = "page-title";
    h1.textContent = title;
    container.replaceChildren(h1);
  };
}
