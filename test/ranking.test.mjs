import test from "node:test";
import assert from "node:assert/strict";
import { deltasFor, scoreSkill, selectSkill } from "../scripts/lib/ranking.mjs";

const base = {
  id: "owner/repo::skills/example/SKILL.md",
  repository: "owner/repo",
  skillSha: "abc",
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

test("历史上推荐过的 Skill 不会再次入选", () => {
  const result = selectSkill(
    [base, { ...base, id: "other/repo::SKILL.md", repository: "other/repo", skillSha: "def" }],
    [{ date: "2026-07-20", skillId: base.id, repository: base.repository, fingerprint: "abc" }],
    [],
    "2026-07-25",
  );
  assert.equal(result.selected.id, "other/repo::SKILL.md");
});

test("总 Stars 是评分的主要权重", () => {
  const popular = scoreSkill(base, { stars7d: 0, forks7d: 0 }, "2026-07-25");
  const viral = scoreSkill(
    { ...base, stars: 50, forks: 5, issueActivity7d: 80 },
    { stars7d: 2000, forks7d: 200 },
    "2026-07-25",
  );
  assert.ok(popular > viral);
});
