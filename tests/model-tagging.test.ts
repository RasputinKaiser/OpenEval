import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tagModel, groupByFamily } from "../lib/model-taxonomy";

describe("tagModel: provider inference", () => {
  it("tags mainstream providers from bare ids", () => {
    assert.equal(tagModel("claude-sonnet-4-5-20250929").provider, "anthropic");
    assert.equal(tagModel("gpt-5.2").provider, "openai");
    assert.equal(tagModel("glm-5.3-flash").provider, "zai");
    assert.equal(tagModel("gemini-2.5-pro").provider, "google");
    assert.equal(tagModel("llama-3.3-70b").provider, "meta");
    assert.equal(tagModel("deepseek-r1").provider, "deepseek");
    assert.equal(tagModel("grok-4").provider, "xai");
    assert.equal(tagModel("kimi-k2").provider, "moonshot");
    assert.equal(tagModel("qwen3-32b").provider, "alibaba");
  });

  it("tags providers from org-qualified ids", () => {
    assert.equal(tagModel("z-ai/glm-4.6").provider, "zai");
    assert.equal(tagModel("anthropic/claude-opus-4.1").provider, "anthropic");
    assert.equal(tagModel("meta-llama/Llama-4-Scout").provider, "meta");
    assert.equal(tagModel("openrouter/deepseek/deepseek-chat").provider, "deepseek");
  });

  it("tags local runtimes", () => {
    assert.equal(tagModel("ollama/llama3:8b").provider, "local");
    const t = tagModel("127.0.0.1:8080/my-model");
    assert.equal(t.provider, "local");
  });

  it("marks unknown providers without crashing", () => {
    const t = tagModel("some-startup/whizzbang-9b");
    assert.equal(t.providerUnknown, true);
    assert.equal(t.provider, "unknown");
    assert.equal(t.id, "some-startup/whizzbang-9b"); // verbatim id preserved
  });
});

describe("tagModel: family + label", () => {
  it("strips org prefixes, dates, and quantization for family", () => {
    assert.equal(tagModel("claude-sonnet-4-5-20250929").family, "claude-sonnet");
    assert.equal(tagModel("z-ai/glm-4.6").family, "glm");
    assert.equal(tagModel("Ornith-1.5-9B-4bit").family, "ornith");
    assert.equal(tagModel("gpt-4o-mini-2024-07-18").family, "gpt");
  });

  it("builds readable labels", () => {
    assert.equal(tagModel("claude-sonnet-4-5-20250929").label, "claude sonnet 4 5");
    assert.equal(tagModel("z-ai/glm-4.6").label, "glm 4.6");
  });

  it("never mangles ids with no version signal", () => {
    const t = tagModel("whizzbang");
    assert.equal(t.id, "whizzbang");
    assert.equal(t.family, "whizzbang");
  });
});

describe("groupByFamily", () => {
  it("collapses variants under one canonical id", () => {
    const g = groupByFamily([
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
      "z-ai/glm-4.6",
      "glm-5.3-flash",
    ]);
    assert.equal(g.get("claude-sonnet")?.ids.length, 2);
    assert.equal(g.get("glm")?.ids.length, 2);
    assert.equal(g.get("glm")?.canonical, "z-ai/glm-4.6"); // first-seen wins
  });

  it("handles empty input", () => {
    assert.equal(groupByFamily([]).size, 0);
  });
});
