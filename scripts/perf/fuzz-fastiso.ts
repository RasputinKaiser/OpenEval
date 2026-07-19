/* Differential fuzz of the fastIsoUtcMs algorithm
 * (copied verbatim from lib/live.ts) against Date.parse. Property: a non-NaN
 * fast result must equal Date.parse for the same string; NaN falls back in
 * production so it can never diverge. Deterministic LCG — no Math.random. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function fastIsoUtcMs(value: string): number {
  if (value.length !== 24) return NaN;
  if (
    value.charCodeAt(4) !== 45 || value.charCodeAt(7) !== 45 || value.charCodeAt(10) !== 84 ||
    value.charCodeAt(13) !== 58 || value.charCodeAt(16) !== 58 || value.charCodeAt(19) !== 46 ||
    value.charCodeAt(23) !== 90
  ) return NaN;
  let y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, ms = 0;
  for (let i = 0; i < 23; i++) {
    if (i === 4 || i === 7 || i === 10 || i === 13 || i === 16 || i === 19) continue;
    const c = value.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return NaN;
    if (i < 4) y = y * 10 + c;
    else if (i < 7) mo = mo * 10 + c;
    else if (i < 10) d = d * 10 + c;
    else if (i < 13) h = h * 10 + c;
    else if (i < 16) mi = mi * 10 + c;
    else if (i < 19) s = s * 10 + c;
    else ms = ms * 10 + c;
  }
  if (y < 100 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return NaN;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (d > (mo === 2 && leap ? 29 : DAYS_IN_MONTH[mo - 1])) return NaN;
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

let seed = 0x2f6e2b1;
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pad = (v: number, w: number) => String(v).padStart(w, "0");

let checked = 0, fastHits = 0, failures = 0;
function check(str: string) {
  checked++;
  const fast = fastIsoUtcMs(str);
  if (Number.isNaN(fast)) return; // production falls back to Date.parse — safe
  fastHits++;
  const ref = Date.parse(str);
  if (fast !== ref) { failures++; if (failures < 20) console.log(`MISMATCH ${JSON.stringify(str)} fast=${fast} ref=${ref}`); }
}

// Edge cases incl. everything the timestamp-zoo fixtures carry
for (const t of [
  "2026-01-05T10:00:00.000Z", "2026-01-05T10:00:00Z", "2026-01-05T12:00:00.000+02:00",
  "2026-02-29T00:00:00.000Z", "2027-02-29T00:00:00.000Z", "2000-02-29T00:00:00.000Z",
  "1900-02-29T00:00:00.000Z", "2400-02-29T00:00:00.000Z", "2026-13-01T00:00:00.000Z",
  "2026-00-10T00:00:00.000Z", "2026-01-32T00:00:00.000Z", "2026-01-00T00:00:00.000Z",
  "2026-01-05T24:00:00.000Z", "2026-01-05T23:59:59.999Z", "2026-01-05T10:00:60.000Z",
  "2026-01-05T10:60:00.000Z", "0000-01-01T00:00:00.000Z", "0099-12-31T23:59:59.999Z",
  "0100-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z", "1969-12-31T23:59:59.000Z",
  "1970-01-01T00:00:00.000Z", "+202606-01-05T10:00:00.0Z", "2026-01-05t10:00:00.000Z",
  "2026-01-05T10:00:00.000z", "2026-01-05 10:00:00.000Z", "202a-01-05T10:00:00.000Z",
]) check(t);

// Random structurally-valid strings (many with invalid components)
for (let i = 0; i < 500000; i++) {
  const y = rnd(3000), mo = rnd(15), d = rnd(35), h = rnd(28), mi = rnd(65), s = rnd(65), ms = rnd(1000);
  check(`${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}.${pad(ms, 3)}Z`);
}
// Random mutations of a valid string (corrupt one char)
const base = "2026-07-18T12:34:56.789Z";
for (let i = 0; i < 200000; i++) {
  const pos = rnd(24);
  const ch = String.fromCharCode(32 + rnd(90));
  check(base.slice(0, pos) + ch + base.slice(pos + 1));
}
console.log(`checked=${checked} fastHits=${fastHits} failures=${failures}`);
if (failures) process.exit(1);
console.log("FUZZ-GREEN");
