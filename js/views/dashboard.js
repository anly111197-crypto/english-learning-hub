import { mountBackupControls } from "../components/backup-ui.js";

// Placeholder until Step 6. On phones the sidebar footer is hidden, so backup buttons live here for now.
export function dashboardView(container) {
  const h1 = document.createElement("h1");
  h1.className = "page-title";
  h1.textContent = "Dashboard";

  const section = document.createElement("section");
  section.className = "dashboard-backup";
  const label = document.createElement("h2");
  label.className = "section-label";
  label.textContent = "Dữ liệu";
  const host = document.createElement("div");
  section.append(label, host);
  mountBackupControls(host, "outline");

  container.replaceChildren(h1, section);
}
