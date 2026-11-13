// Word-level comparison of a wrong sentence and its correction, so only the wrong words are marked. Pure.

const edge = /^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu;
// Compare words without surrounding punctuation ("lives" = "lives."), but keep capital letters.
const key = (token) => token.replace(edge, "") || token;

const MAX_CELLS = 40000; // very long texts: skip the comparison instead of freezing the page

// Returns { wrong: [{ text, changed }], right: [{ text, changed }] }.
// `changed` on wrong = word removed or replaced; on right = word added or replaced.
// options.maxCells raises the size limit (the Writing screen compares whole essays: 250 x 250 words > 40000).
export function diffWords(wrongText, rightText, { maxCells = MAX_CELLS } = {}) {
  const a = String(wrongText ?? "").match(/\S+/g) ?? [];
  const b = String(rightText ?? "").match(/\S+/g) ?? [];
  const plain = (tokens) => tokens.map((text) => ({ text, changed: false }));
  if (b.length === 0 || a.length * b.length > maxCells) return { wrong: plain(a), right: plain(b) };

  const ka = a.map(key);
  const kb = b.map(key);
  // lengths of the longest common subsequence of the suffixes
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const wrong = a.map((text) => ({ text, changed: true }));
  const right = b.map((text) => ({ text, changed: true }));
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (ka[i] === kb[j]) {
      wrong[i].changed = false;
      right[j].changed = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { wrong, right };
}
