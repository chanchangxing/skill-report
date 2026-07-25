import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { escapeHtml, formatNumber, relativeTimeLabel } from "./utils.mjs";

function list(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function workflow(items) {
  return `<ol class="workflow">${items.map((item, index) =>
    `<li><span>${index + 1}</span><p>${escapeHtml(item)}</p></li>`).join("")}</ol>`;
}

function metric(label, value, hint = "") {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ""}</div>`;
}

function layout({ title, description, content, root = "." }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${root}/assets/site.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="${root}/index.html"><span>Agent Skill</span> Daily</a>
    <nav><a href="${root}/index.html">今日推荐</a><a href="${root}/history.html">历史报告</a></nav>
  </header>
  <main>${content}</main>
  <footer>每天北京时间 09:45 自动更新 · 数据来自 GitHub · 分析由 DeepSeek 或本地规则生成</footer>
  <script src="${root}/assets/site.js" defer></script>
</body>
</html>`;
}

function reportCard(report, root = ".") {
  return `<article class="report-card" data-search="${escapeHtml(`${report.name} ${report.repository} ${(report.topics || []).join(" ")}`.toLowerCase())}">
    <div><time>${escapeHtml(report.date)}</time><span class="score">热度 ${report.score}</span></div>
    <h3><a href="${root}/reports/${report.date}.html">${escapeHtml(report.name)}</a></h3>
    <p>${escapeHtml(report.description)}</p>
    <div class="card-meta"><span>★ ${formatNumber(report.stars)}</span><span>⑂ ${formatNumber(report.forks)}</span><span>${escapeHtml(report.repository)}</span></div>
  </article>`;
}

function reportBody(report) {
  const analysis = report.analysis;
  const aiLabel = analysis.source === "deepseek"
    ? `DeepSeek · ${analysis.model}`
    : "规则解析（AI 降级模式）";
  return `<section class="hero report-hero">
    <p class="eyebrow">${escapeHtml(report.date)} · 今日 Agent Skill</p>
    <h1>${escapeHtml(analysis.title || report.name)}</h1>
    <p class="lead">${escapeHtml(analysis.introduction)}</p>
    <div class="actions"><a class="button" href="${escapeHtml(report.skillUrl)}">查看 SKILL.md</a><a class="button secondary" href="${escapeHtml(report.repositoryUrl)}">GitHub 仓库</a></div>
  </section>
  <section class="metrics">
    ${metric("总 Stars", formatNumber(report.stars), "选题最高优先级")}
    ${metric("7 日新增 Stars", formatNumber(report.stars7d), report.stars7d === null ? "快照积累满 7 天后显示" : "")}
    ${metric("总 Forks", formatNumber(report.forks))}
    ${metric("7 日新增 Forks", formatNumber(report.forks7d), report.forks7d === null ? "快照积累中" : "")}
    ${metric("7 日 Issue 活跃", formatNumber(report.issueActivity7d))}
    ${metric("最近推送", relativeTimeLabel(report.pushedAt, report.date), report.pushedAt.slice(0, 10))}
  </section>
  <div class="content-grid">
    <article class="panel wide"><h2>为什么热门</h2>${list(analysis.whyHot)}</article>
    <article class="panel"><h2>核心能力</h2>${list(analysis.capabilities)}</article>
    <article class="panel"><h2>输入与输出</h2><h3>输入</h3>${list(analysis.inputs)}<h3>输出</h3>${list(analysis.outputs)}</article>
    <article class="panel wide"><h2>具体运作流程</h2>${workflow(analysis.workflow)}</article>
    <article class="panel"><h2>证据文件</h2>${list(analysis.evidence)}</article>
    <article class="panel"><h2>限制与判断边界</h2>${list(analysis.caveats)}<p class="source-label">分析方式：${escapeHtml(aiLabel)}</p></article>
  </div>`;
}

export async function renderSite({ root, reports }) {
  const docs = path.join(root, "docs");
  const reportsDir = path.join(docs, "reports");
  const dataDir = path.join(docs, "data");
  const assetsDir = path.join(docs, "assets");
  await Promise.all([
    mkdir(reportsDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(assetsDir, { recursive: true }),
  ]);

  const sorted = [...reports].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const empty = `<section class="hero"><p class="eyebrow">Agent Skill Daily</p><h1>第一份报告即将生成</h1><p class="lead">配置 DeepSeek API Key 后，在 Actions 中手动运行一次工作流。</p></section>`;
  const latestContent = latest
    ? `${reportBody(latest)}<section class="more"><h2>最近推荐</h2><div class="cards">${sorted.slice(1, 7).map((item) => reportCard(item)).join("") || "<p>暂无更多历史报告。</p>"}</div><a class="text-link" href="./history.html">浏览全部历史 →</a></section>`
    : empty;
  await writeFile(
    path.join(docs, "index.html"),
    layout({
      title: latest ? `${latest.name} — Agent Skill Daily` : "Agent Skill Daily",
      description: latest?.description || "每日发现并分析一个热门开源 Agent Skill。",
      content: latestContent,
    }),
  );

  const historyContent = `<section class="hero compact"><p class="eyebrow">Archive</p><h1>历史推荐</h1><p class="lead">按名称、仓库或主题查找过去的 Agent Skill。</p><label class="search"><span>搜索</span><input id="history-search" type="search" placeholder="例如：PDF、browser、anthropics"></label></section><section><div id="history-list" class="cards">${sorted.map((item) => reportCard(item)).join("") || "<p>暂无历史报告。</p>"}</div></section>`;
  await writeFile(
    path.join(docs, "history.html"),
    layout({
      title: "历史推荐 — Agent Skill Daily",
      description: "浏览 Agent Skill Daily 的全部历史推荐。",
      content: historyContent,
    }),
  );

  for (let index = 0; index < sorted.length; index += 1) {
    const report = sorted[index];
    const newer = sorted[index - 1];
    const older = sorted[index + 1];
    const navigation = `<nav class="report-nav">${newer ? `<a href="./${newer.date}.html">← ${escapeHtml(newer.name)}</a>` : "<span></span>"}${older ? `<a href="./${older.date}.html">${escapeHtml(older.name)} →</a>` : "<span></span>"}</nav>`;
    await writeFile(
      path.join(reportsDir, `${report.date}.html`),
      layout({
        title: `${report.name} — ${report.date}`,
        description: report.description,
        content: `${reportBody(report)}${navigation}`,
        root: "..",
      }),
    );
  }

  const publicReports = sorted.map(({ analysis, ...report }) => ({
    ...report,
    summary: analysis.introduction,
  }));
  await writeFile(path.join(dataDir, "reports.json"), `${JSON.stringify(publicReports, null, 2)}\n`);
  await writeFile(path.join(docs, ".nojekyll"), "");
  const [css, js] = await Promise.all([
    readFile(path.join(root, "static", "site.css"), "utf8"),
    readFile(path.join(root, "static", "site.js"), "utf8"),
  ]);
  await Promise.all([
    writeFile(path.join(assetsDir, "site.css"), css),
    writeFile(path.join(assetsDir, "site.js"), js),
  ]);
}
