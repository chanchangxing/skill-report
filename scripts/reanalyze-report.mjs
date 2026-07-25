import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeWithDeepSeek } from "./lib/analyze.mjs";
import { enrichCandidate, loadProject } from "./lib/github.mjs";
import { renderSite } from "./lib/render.mjs";
import { reportDate } from "./lib/utils.mjs";

const root = process.cwd();
const repository = process.argv[2] || process.env.REANALYZE_PROJECT;
if (!repository) throw new Error("请提供要重新分析的 owner/repository");

const historyPath = path.join(root, "data", "history.json");
const history = JSON.parse(await readFile(historyPath, "utf8"));
const reportIndex = history.findIndex((item) =>
  (item.projectId || item.repository).toLowerCase() === repository.toLowerCase());
if (reportIndex < 0) throw new Error(`历史报告中找不到 ${repository}`);

console.log(`正在重新读取并分析完整项目：${repository}`);
const project = await enrichCandidate(
  await loadProject(repository),
  reportDate(process.env.REPORT_TIMEZONE || "Asia/Shanghai"),
);
const analysis = await analyzeWithDeepSeek(project);
if (analysis.source !== "deepseek") {
  throw new Error(`DeepSeek 重新分析失败：${analysis.caveats.join("；")}`);
}

const nextHistory = [...history];
nextHistory[reportIndex] = {
  ...history[reportIndex],
  analysis,
  reanalyzedAt: new Date().toISOString(),
};
await writeFile(historyPath, `${JSON.stringify(nextHistory, null, 2)}\n`);
await renderSite({ root, reports: nextHistory });
console.log(`已使用 ${analysis.model} 更新 ${repository} 的历史报告。`);
