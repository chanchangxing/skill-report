import test from "node:test";
import assert from "node:assert/strict";
import { fallbackAnalysis } from "../scripts/lib/analyze.mjs";

const project = {
  name: "示例项目",
  repository: "owner/repo",
  primaryDocumentPath: "README.md",
  description: "An English-only repository description.",
  markdown: "## Overview\n1. Run the command.\n",
  stars: 100,
  forks: 10,
  pushedAt: "2026-07-25T00:00:00Z",
  issueActivity7d: 3,
  referencedFiles: [],
};

test("降级报告始终提供两个中文使用场景", () => {
  const analysis = fallbackAnalysis(project, "English API error");

  assert.equal(analysis.useCases.length, 2);
  assert.ok(analysis.useCases.every((item) => /[\u3400-\u9fff]/u.test(item)));
  assert.doesNotMatch(analysis.caveats.join("\n"), /English API error/);
});
