// Cambridge Practice · Notebook & tài liệu. Content comes in Step 4; for now only the header and tabs.
import { h } from "../components/dom.js";
import { renderPracticeHeader } from "./practice.js";

export function practiceNotebooksView(container) {
  const root = h("div", { class: "practice" });
  renderPracticeHeader(root, "notebooks");
  container.replaceChildren(root);
}
