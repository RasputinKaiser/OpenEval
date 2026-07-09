import test from "node:test";
import assert from "node:assert/strict";
import { passAtK, wilsonInterval, mean } from "../lib/stats";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---- passAtK (Chen et al. unbiased estimator) ----

test("passAtK boundary cases", () => {
  assert.equal(passAtK(5, 0, 1), 0); // none passed
  assert.equal(passAtK(5, 5, 1), 1); // all passed
  assert.equal(passAtK(0, 0, 1), 0); // no samples
  assert.equal(passAtK(5, 3, 0), 0); // k=0 draws nothing
});

test("passAtK at k=1 equals the sample mean c/n", () => {
  assert.ok(close(passAtK(5, 1, 1), 0.2));
  assert.ok(close(passAtK(4, 3, 1), 0.75));
  assert.ok(close(passAtK(10, 7, 1), 0.7));
});

test("passAtK matches closed-form 1 - C(n-c,k)/C(n,k)", () => {
  // n=4,c=2,k=2: 1 - C(2,2)/C(4,2) = 1 - 1/6
  assert.ok(close(passAtK(4, 2, 2), 1 - 1 / 6));
  // n=3,c=1,k=2: 1 - C(2,2)/C(3,2) = 1 - 1/3
  assert.ok(close(passAtK(3, 1, 2), 1 - 1 / 3));
  // n=10,c=3,k=5: 1 - C(7,5)/C(10,5) = 1 - 21/252
  assert.ok(close(passAtK(10, 3, 5), 1 - 21 / 252));
});

test("passAtK returns 1 when too few failures exist to fill k, and reduces to 'any' at k=n", () => {
  assert.equal(passAtK(2, 1, 2), 1); // n-c=1 < k=2
  assert.equal(passAtK(5, 1, 5), 1); // k=n, at least one passed => pass@n = 1
  assert.equal(passAtK(5, 0, 5), 0); // k=n, none passed => 0
});

test("passAtK is numerically stable for large n (no binomial overflow)", () => {
  const v = passAtK(500, 250, 100);
  assert.ok(v > 0.999 && v <= 1); // enormous chance at least one of 100 passes
  assert.ok(Number.isFinite(v));
});

// ---- wilsonInterval ----

test("wilsonInterval brackets the point estimate and stays in [0,1]", () => {
  const ci = wilsonInterval(50, 100);
  assert.ok(ci.lo < 0.5 && ci.hi > 0.5);
  assert.ok(ci.lo >= 0 && ci.hi <= 1);
  // known 95% Wilson interval for 50/100 ≈ [0.404, 0.596]
  assert.ok(close(ci.lo, 0.4038, 2e-3));
  assert.ok(close(ci.hi, 0.5962, 2e-3));
});

test("wilsonInterval handles degenerate proportions without leaving [0,1]", () => {
  const all = wilsonInterval(10, 10);
  assert.equal(all.hi, 1);
  assert.ok(all.lo > 0 && all.lo < 1); // Wilson does not collapse to [1,1]
  const none = wilsonInterval(0, 10);
  assert.equal(none.lo, 0);
  assert.ok(none.hi > 0 && none.hi < 1);
  const empty = wilsonInterval(0, 0);
  assert.deepEqual(empty, { lo: 0, hi: 0 });
});

test("wilsonInterval narrows as n grows", () => {
  const wide = wilsonInterval(5, 10);
  const narrow = wilsonInterval(500, 1000);
  assert.ok(narrow.hi - narrow.lo < wide.hi - wide.lo);
});

// ---- mean ----

test("mean averages and handles empty", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(mean([]), 0);
});
