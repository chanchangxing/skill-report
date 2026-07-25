import { clamp, daysAgo } from "./utils.mjs";

export function snapshotIndex(snapshots = []) {
  return new Map(snapshots.map((item) => [item.repository, item]));
}

export function deltasFor(skill, oldSnapshots = []) {
  const old = snapshotIndex(oldSnapshots).get(skill.repository);
  return {
    stars7d: old ? Math.max(0, skill.stars - old.stars) : null,
    forks7d: old ? Math.max(0, skill.forks - old.forks) : null,
  };
}

export function scoreSkill(skill, deltas, date) {
  const starScore = Math.log10(skill.stars + 1) / 6;
  const growthScore = deltas.stars7d === null
    ? 0
    : Math.log10(deltas.stars7d + 1) / 4;
  const forkScore = deltas.forks7d === null
    ? Math.log10(skill.forks + 1) / 5
    : Math.log10(deltas.forks7d + 1) / 3;
  const pushedDays = Math.max(
    0,
    (new Date(`${date}T23:59:59Z`) - new Date(skill.pushedAt)) / 86_400_000,
  );
  const recencyScore = Math.exp(-pushedDays / 30);
  const issueScore = Math.log10((skill.issueActivity7d || 0) + 1) / 2;
  return Number((
    clamp(starScore, 0, 1) * 70
    + clamp(growthScore, 0, 1) * 15
    + clamp(forkScore, 0, 1) * 5
    + clamp(issueScore, 0, 1) * 5
    + clamp(recencyScore, 0, 1) * 5
  ).toFixed(2));
}

export function selectSkill(skills, history, oldSnapshots, date, cooldownDays = 14) {
  const selectedIds = new Set(history.map((item) => item.skillId));
  const selectedFingerprints = new Set(history.map((item) => item.fingerprint).filter(Boolean));
  const cooldownSince = daysAgo(date, cooldownDays);
  const recentRepositories = new Set(
    history
      .filter((item) => item.date >= cooldownSince)
      .map((item) => item.repository),
  );

  const ranked = skills
    .filter((skill) => !selectedIds.has(skill.id))
    .filter((skill) => !selectedFingerprints.has(skill.skillSha))
    .filter((skill) => !recentRepositories.has(skill.repository))
    .map((skill) => {
      const deltas = deltasFor(skill, oldSnapshots);
      return { ...skill, ...deltas, score: scoreSkill(skill, deltas, date) };
    })
    .sort((a, b) => b.score - a.score || b.stars - a.stars);

  return { selected: ranked[0] || null, ranked };
}
