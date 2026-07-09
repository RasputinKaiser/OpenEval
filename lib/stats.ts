/**
 * Statistical estimators for evaluation metrics.
 *
 * The headline numbers of an eval — pass@k and its uncertainty — deserve
 * principled estimators rather than ad-hoc counts. These are pure functions
 * with no I/O so they can be unit-tested against known values.
 */

export interface Interval {
  lo: number;
  hi: number;
}

/**
 * Unbiased pass@k estimator (Chen et al. 2021, "Evaluating Large Language
 * Models Trained on Code", the HumanEval pass@k).
 *
 * Given `n` total samples of a case, of which `c` passed, the probability
 * that at least one of `k` samples drawn without replacement passes is
 *
 *     pass@k = 1 - C(n-c, k) / C(n, k)
 *
 * computed in the numerically stable product form
 *
 *     1 - Π_{i=n-c+1}^{n} (1 - k/i)
 *
 * so it never materializes large binomial coefficients. Reduces to the naive
 * "any passed" only at k = n; for k < n it is the minimum-variance estimate
 * of what a k-sample budget would achieve.
 */
export function passAtK(n: number, c: number, k: number): number {
  if (n <= 0) return 0;
  const kk = Math.min(Math.max(Math.floor(k), 0), n);
  const cc = Math.min(Math.max(Math.floor(c), 0), n);
  if (kk <= 0) return 0;
  if (cc <= 0) return 0;
  // More than n-c failing samples exist to fill k? Impossible to draw k all-failing.
  if (n - cc < kk) return 1;
  let prod = 1;
  for (let i = n - cc + 1; i <= n; i++) {
    prod *= 1 - kk / i;
  }
  return 1 - prod;
}

/**
 * Wilson score interval for a binomial proportion. Far better behaved than the
 * normal (Wald) approximation near p=0/1 and for small n — it never leaves
 * [0, 1] and stays sensible when successes are 0 or all. Default z=1.96 → 95%.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { lo: 0, hi: 0 };
  const phat = Math.min(Math.max(successes / n, 0), 1);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
  return {
    lo: Math.max(0, center - half),
    hi: Math.min(1, center + half),
  };
}

/** Mean of a list, or 0 for an empty list. */
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
