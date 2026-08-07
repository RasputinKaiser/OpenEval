import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("evidence review stays metadata-only and bounded", () => {
  const src = read("components/evidence/EvidenceReview.tsx");
  assert.match(src, /source-qualified identity/);
  assert.match(src, /slice\(0, 3\)/);
  assert.match(src, /never renders transcript text/);
  assert.match(src, /Find matching sessions/);
  assert.match(src, /Limits/);
});

test("Collection and Timeline wire source-qualified review handoffs", () => {
  const collection = read("components/CollectionClient.tsx");
  const timeline = read("components/TimelineClient.tsx");

  assert.match(collection, /<EvidenceReview/);
  assert.match(collection, /identity=\{`\$\{s\.sourceId\} \/ \$\{s\.sessionId\}`\}/);
  assert.match(collection, /\/collection\/session\?sourceId=\$\{encodeURIComponent\(s\.sourceId\)\}&sessionId=\$\{encodeURIComponent\(s\.sessionId\)\}/);
  assert.match(collection, /s\.archived \? "archived" : "available"/);

  assert.match(timeline, /<EvidenceReview/);
  assert.match(timeline, /identity=\{`timeline\/\$\{m\.kind\}\/\$\{m\.name\}`\}/);
  assert.match(timeline, /\/collection\?q=\$\{encodeURIComponent\(m\.name\)\}/);
  assert.match(timeline, /topLevelCount/);
  assert.match(timeline, /excluded from outcome denominators/);
});
