import test from "node:test";
import assert from "node:assert/strict";
import { deltasFor, scoreProject, selectProject } from "../scripts/lib/ranking.mjs";

const base = {
  id: "owner/repo",
  projectId: "owner/repo",
  repository: "owner/repo",
  projectSha: "abc",
  stars: 10_000,
  forks: 1_000,
  pushedAt: "2026-07-24T00:00:00Z",
  issueActivity7d: 10,
};

test("计算七日 Stars 与 Forks 增量", () => {
  assert.deepEqual(deltasFor(base, [{
    repository: "owner/repo",
    stars: 9_800,
    forks: 980,
  }]), { stars7d: 200, forks7d: 20 });
});

test("没有历史快照时增量为 null", () => {
  assert.deepEqual(deltasFor(base, []), { stars7d: null, forks7d: null });
});

test("历史上推荐过的项目不会再次入选", () => {
  const result = selectProject(
    [base, { ...base, id: "other/repo", projectId: "other/repo", repository: "other/repo", projectSha: "def" }],
    [{ date: "2026-07-20", projectId: base.id, repository: base.repository, fingerprint: "abc" }],
    [],
    "2026-07-25",
  );
  assert.equal(result.selected.id, "other/repo");
});

test("总 Stars 是评分的主要权重", () => {
  const popular = scoreProject(base, { stars7d: 0, forks7d: 0 }, "2026-07-25");
  const viral = scoreProject(
    { ...base, stars: 50, forks: 5, issueActivity7d: 80 },
    { stars7d: 2000, forks7d: 200 },
    "2026-07-25",
  );
  assert.ok(popular > viral);
});
