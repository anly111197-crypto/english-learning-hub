// Counts open sheets/modals and mirrors it on <body data-overlay-open> so the FAB hides (spec 5.4).
let open = 0;

export function overlayOpened() {
  open++;
  document.body.dataset.overlayOpen = "";
}

export function overlayClosed() {
  open = Math.max(0, open - 1);
  if (open === 0) delete document.body.dataset.overlayOpen;
}
