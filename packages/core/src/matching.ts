/** Pure name-matching helpers for import mapping. No I/O. */

export function normalizeAlias(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Classic Levenshtein edit distance (two-row DP). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** Similarity in [0,1] after normalization; 1 = identical. */
export function fuzzyScore(a: string, b: string): number {
  const na = normalizeAlias(a);
  const nb = normalizeAlias(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length));
}

/** Fuzzy matches at or above this score are surfaced for review. */
export const FUZZY_THRESHOLD = 0.6;
