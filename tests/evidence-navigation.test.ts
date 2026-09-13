import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceCitationHref,
  evidenceNavigationHref,
  parseEvidenceNavigation,
  setEvidenceNavigation,
} from "../lib/collection/evidence-navigation";

test("evidence navigation preserves chart and section filters while changing selection", () => {
  const base = new URLSearchParams("vizSource=codex&section=evidence&kind=tool");
  const next = setEvidenceNavigation(base, { sourceId: "codex", sessionId: "s-1", evidenceId: "r-2" });
  assert.equal(next.get("vizSource"), "codex");
  assert.equal(next.get("section"), "evidence");
  assert.deepEqual(parseEvidenceNavigation(next), { sourceId: "codex", sessionId: "s-1", evidenceId: "r-2" });
  const changed = setEvidenceNavigation(next, { sourceId: "codex", sessionId: "s-2" });
  assert.equal(changed.get("evidenceId"), null);
  assert.equal(changed.get("section"), "evidence");
});

test("citation href is source qualified and bounded", () => {
  const href = evidenceCitationHref("/collection/timeline", { sourceId: "hermes", sessionId: "abc", evidenceId: "record-1" }, new URLSearchParams("section=evidence"));
  assert.equal(href, "/collection/timeline?section=evidence&sourceId=hermes&sessionId=abc&evidenceId=record-1");
  const parsed = parseEvidenceNavigation(new URLSearchParams("sourceId=ok\u0000bad&sessionId=s"));
  assert.deepEqual(parsed, { sessionId: "s" });
  assert.equal(evidenceNavigationHref("/collection", {}), "/collection");
});
