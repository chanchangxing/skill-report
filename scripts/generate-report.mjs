import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeWithDeepSeek } from "./lib/analyze.mjs";
import { discoverSkills, enrichCandidate } from "./lib/github.mjs";
import { selectSkill } from "./lib/ranking.mjs";
import { renderSite } from "./lib/render.mjs";
import { daysAgo, reportDate } from "./lib/utils.mjs";

const root = process.cwd();
const timezone = process.env.REPORT_TIMEZONE || "Asia/Shanghai";
const date = reportDate(timezone);
const force = process.argv.includes("--force");
const historyPath = path.join(root, "data", "history.json");
const snapshotDir = path.join(root, "data", "snapshots");
const snapshotPath = path.join(snapshotDir, `${date}.json`);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function existingSnapshotAtOrBefore(targetDate) {
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = path.join(snapshotDir, `${daysAgo(targetDate, offset)}.json`);
    try {
      await access(candidate);
      return readJson(candidate, []);
    } catch {
      // Continue looking for the closest snapshot.
    }
  }
  return [];
}

await mkdir(snapshotDir, { recursive: true });
const history = await readJson(historyPath, []);
if (history.some((item) => item.date === date) && !force) {
  console.log(`${date} 的报告已存在；使用 --force 可重新生成。`);
  await renderSite({ root, reports: history });
  process.exit(0);
}

console.log("正在从 GitHub 搜索真实的 Agent Skills…");
const discovered = await discoverSkills({
  maxRepositories: Number(process.env.MAX_REPOSITORIES || 35),
});
if (!discovered.length) throw new Error("没有发现通过校验的 Agent Skill，未生成空报告。");

const oldSnapshots = await existingSnapshotAtOrBefore(daysAgo(date, 7));
const snapshot = [...new Map(discovered.map((skill) => [
  skill.repository,
  {
    repository: skill.repository,
    stars: skill.stars,
    forks: skill.forks,
    capturedAt: new Date().toISOString(),
  },
])).values()];
await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

const preliminary = selectSkill(discovered, history, oldSnapshots, date);
if (!preliminary.selected) {
  throw new Error("候选池中没有未推荐过的新 Skill；系统不会静默重复推荐。");
}

// Only spend extra API calls on the strongest candidates, then score with issue activity.
const enriched = [];
for (const candidate of preliminary.ranked.slice(0, 8)) {
  enriched.push(await enrichCandidate(candidate, date));
}
const finalSelection = selectSkill(enriched, history, oldSnapshots, date).selected;
if (!finalSelection) throw new Error("无法选出今日 Skill。");

console.log(`今日选择：${finalSelection.id}`);
const analysis = await analyzeWithDeepSeek(finalSelection);
const report = {
  date,
  skillId: finalSelection.id,
  fingerprint: finalSelection.skillSha,
  name: finalSelection.name,
  description: finalSelection.description,
  repository: finalSelection.repository,
  repositoryUrl: finalSelection.repositoryUrl,
  skillUrl: finalSelection.skillUrl,
  skillPath: finalSelection.skillPath,
  stars: finalSelection.stars,
  stars7d: finalSelection.stars7d,
  forks: finalSelection.forks,
  forks7d: finalSelection.forks7d,
  issueActivity7d: finalSelection.issueActivity7d,
  pushedAt: finalSelection.pushedAt,
  topics: finalSelection.topics,
  language: finalSelection.language,
  score: finalSelection.score,
  analysis,
};

const nextHistory = [
  ...history.filter((item) => item.date !== date),
  report,
].sort((a, b) => a.date.localeCompare(b.date));
await writeFile(historyPath, `${JSON.stringify(nextHistory, null, 2)}\n`);
await renderSite({ root, reports: nextHistory });
console.log(`已生成 ${date} 的报告及 GitHub Pages 历史页面（${analysis.source}）。`);
