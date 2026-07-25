import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeWithDeepSeek } from "./lib/analyze.mjs";
import { discoverProjects, enrichCandidate } from "./lib/github.mjs";
import { selectProject } from "./lib/ranking.mjs";
import { renderSite } from "./lib/render.mjs";
import { daysAgo, reportDate } from "./lib/utils.mjs";

const root = process.cwd();
const timezone = process.env.REPORT_TIMEZONE || "Asia/Shanghai";
const date = reportDate(timezone);
const additional = process.argv.includes("--additional") || process.env.REPORT_MODE === "on-demand";
const generatedAt = new Date().toISOString();
const timeId = new Intl.DateTimeFormat("en-GB", {
  timeZone: timezone,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
}).format(new Date()).replaceAll(":", "");
const reportId = additional ? `${date}-${timeId}` : date;
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
if (!additional && history.some((item) => item.date === date && item.kind !== "on-demand")) {
  console.log(`${date} 的定时报告已存在；无需重复生成。`);
  await renderSite({ root, reports: history });
  process.exit(0);
}

console.log("正在从 GitHub 搜索完整的智能体开源项目…");
const discovered = await discoverProjects({
  maxRepositories: Number(process.env.MAX_REPOSITORIES || 35),
});
if (!discovered.length) throw new Error("没有发现通过项目级校验的智能体开源项目，未生成空报告。");

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

const preliminary = selectProject(discovered, history, oldSnapshots, date);
if (!preliminary.selected) {
  throw new Error("候选池中没有未推荐过的新项目；系统不会静默重复推荐。");
}

// Only spend extra API calls on the strongest candidates, then score with issue activity.
const enriched = [];
for (const candidate of preliminary.ranked.slice(0, 8)) {
  enriched.push(await enrichCandidate(candidate, date));
}
const finalSelection = selectProject(enriched, history, oldSnapshots, date).selected;
if (!finalSelection) throw new Error("无法选出今日项目。");

console.log(`今日选择：${finalSelection.id}`);
const analysis = await analyzeWithDeepSeek(finalSelection);
const report = {
  reportId,
  date,
  generatedAt,
  kind: additional ? "on-demand" : "daily",
  projectId: finalSelection.projectId,
  fingerprint: finalSelection.projectSha,
  name: finalSelection.name,
  description: finalSelection.description,
  repository: finalSelection.repository,
  repositoryUrl: finalSelection.repositoryUrl,
  projectUrl: finalSelection.projectUrl,
  homepageUrl: finalSelection.homepageUrl,
  primaryDocumentPath: finalSelection.primaryDocumentPath,
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
  ...history.filter((item) => additional || item.date !== date || item.kind === "on-demand"),
  report,
].sort((a, b) => (a.generatedAt || a.date).localeCompare(b.generatedAt || b.date));
await writeFile(historyPath, `${JSON.stringify(nextHistory, null, 2)}\n`);
await renderSite({ root, reports: nextHistory });
console.log(`已生成 ${reportId} 的${additional ? "即时" : "定时"}报告及 GitHub Pages 历史页面（${analysis.source}）。`);
