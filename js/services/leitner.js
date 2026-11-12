// Leitner boxes (spec 6.3). Step 5 adds card selection and answer handling; for now only dates.
export const BOX_INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };

const pad = (n) => String(n).padStart(2, "0");

// Local date as yyyy-mm-dd.
export const isoDate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days)); // local calendar maths, so no DST surprises
}

export function nextReviewDate(box, fromIso = isoDate()) {
  const days = BOX_INTERVAL_DAYS[box];
  if (!days) throw new RangeError(`Hộp Leitner phải từ 1 đến 5, không phải ${box}.`);
  return addDays(fromIso, days);
}

// A card is due when its nextReview is today or earlier.
export const isDue = (card, todayIso = isoDate()) => Boolean(card?.nextReview) && card.nextReview <= todayIso;
