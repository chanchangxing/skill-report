import { clamp } from "./utils.mjs";

export function snapshotIndex(snapshots = []) {
  return new Map(snapshots.map((item) => [item.repository, item]));
}

export function deltasFor(project, oldSnapshots = []) {
  const old = snapshotIndex(oldSnapshots).get(project.repository);
  return {
    stars7d: old ? Math.max(0, project.stars - old.stars) : null,
    forks7d: old ? Math.max(0, project.forks - old.forks) : null,
  };
}

export function scoreProject(project, deltas, date) {
  const starScore = Math.log10(project.stars + 1) / 6;
  const growthScore = deltas.stars7d === null
    ? 0
    : Math.log10(deltas.stars7d + 1) / 4;
  const forkScore = deltas.forks7d === null
    ? Math.log10(project.forks + 1) / 5
    : Math.log10(deltas.forks7d + 1) / 3;
  const pushedDays = Math.max(
    0,
    (new Date(`${date}T23:59:59Z`) - new Date(project.pushedAt)) / 86_400_000,
  );
  const recencyScore = Math.exp(-pushedDays / 30);
  const issueScore = Math.log10((project.issueActivity7d || 0) + 1) / 2;
  return Number((
    clamp(starScore, 0, 1) * 70
    + clamp(growthScore, 0, 1) * 15
    + clamp(forkScore, 0, 1) * 5
    + clamp(issueScore, 0, 1) * 5
    + clamp(recencyScore, 0, 1) * 5
  ).toFixed(2));
}

export function selectProject(projects, history, oldSnapshots, date) {
  const selectedRepositories = new Set(
    history.map((item) => item.projectId || item.repository),
  );

  const ranked = projects
    .filter((project) => !selectedRepositories.has(project.repository))
    .map((project) => {
      const deltas = deltasFor(project, oldSnapshots);
      return { ...project, ...deltas, score: scoreProject(project, deltas, date) };
    })
    .sort((a, b) => b.score - a.score || b.stars - a.stars);

  return { selected: ranked[0] || null, ranked };
}
