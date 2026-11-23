# 智能体项目日报

每天北京时间 09:45，从 GitHub 公开仓库中发现一个热门且未推荐过的智能体开源项目。项目可以是独立的智能体技能、人工智能智能体、智能体框架或相关工具，但推荐对象始终是完整 GitHub 仓库，不是某个项目内部的单个 `SKILL.md` 文件。

## 工作方式

1. GitHub Actions 按 `45 1 * * *`（UTC）定时启动，即北京时间 09:45。
2. 脚本通过 GitHub API 分页搜索智能体项目，提前排除历史推荐，按 Stars 排序逐批校验并补足候选。要求仓库包含项目级 README 以及实际代码或根目录 `SKILL.md`，并排除归档、Fork 和纯链接合集。
3. 总 Stars 占评分的 70%；七日新增 Stars、Forks、Issue 活跃度与更新时间合计占 30%。
4. 系统使用仓库全名永久去重，已经推荐过的项目不会再次出现。
5. DeepSeek 阅读项目 README、架构说明和根目录技能说明等项目级资料，输出项目介绍、热门原因、核心能力、两个使用场景、输入输出和具体运作流程。
6. 报告、指标快照和历史索引写回仓库；静态站点部署到 GitHub Pages。

> 七日新增 Stars/Forks 来自本仓库每天保存的快照。运行前七天会显示“待积累”，之后使用真实增量，不用模型猜测。

## 项目结构

```text
.
├── .github/workflows/daily-skill-report.yml
├── data/
│   ├── history.json
│   └── snapshots/
├── docs/                     # 自动生成的 GitHub Pages
├── scripts/
│   ├── generate-report.mjs
│   └── lib/
├── static/                   # 页面样式和交互
└── test/
```

## 你需要配置的内容

打开仓库的 **Settings → Secrets and variables → Actions**。

### Secret（必填）

| Name | Value |
| --- | --- |
| `DEEPSEEK_API_KEY` | 你的 DeepSeek API Key |

Secret 只注入 GitHub Actions，不会进入仓库或公开页面。不要把 Key 写进代码、提交记录或 Issue。

### Variables（均为可选）

| Name | 默认值 | 用途 |
| --- | --- | --- |
| `AI_MODEL` | `deepseek-v4-flash` | DeepSeek 模型 |
| `AI_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 地址 |
| `MAX_REPOSITORIES` | `35` | 目标合格新项目数量（1–100），历史或不合格项目不占名额 |
| `MAX_SEARCH_PAGES` | `5` | 每个搜索条件的分页上限，每页 30 个结果（1–34） |
| `MAX_DISCOVERY_REQUESTS` | `200` | 发现阶段实际 HTTP 请求上限，含搜索、文件树、README 和重试（1–1000） |

GitHub API 使用 Actions 自动提供的 `GITHUB_TOKEN`，无需额外创建 Token。

## 启用 GitHub Pages

在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。工作流中的 `deploy` Job 会上传并发布 `docs/`。

## 首次运行

1. 添加 `DEEPSEEK_API_KEY`。
2. 打开仓库 **Actions → Daily AI Agent Project Report → Run workflow**。
3. 首次成功后访问 `https://chanchangxing.github.io/skill-report/`。

如果暂时没有配置 Key，或 DeepSeek 临时不可用，生成器会自动输出有明确标记的规则版报告，保证历史快照和页面仍能更新。

## 历史阅读与不重复保证

- 首页展示当天推荐和最近报告。
- `/history.html` 提供历史卡片及名称、仓库、主题搜索。
- 首页的“立即推荐新项目”按钮会打开安全的 Actions 触发页；登录 GitHub 后点击 **Run workflow** 即可追加一份推荐。
- 如需用当前模型更新旧报告，可在 `reanalyze_project` 中填写 `owner/repository`；系统只更新分析内容，不新增项目或覆盖原始指标。
- 手动推荐使用 `/reports/YYYY-MM-DD-HHMMSS.html`，同一天可生成多份且不会覆盖旧报告；定时报告仍使用 `/reports/YYYY-MM-DD.html`。
- 每份报告提供前后翻页。
- 已推荐的项目仓库保存在 `data/history.json`；同一项目不会再次推荐。
- 仓库中的单个技能文件、插件或子目录不会成为独立推荐对象。
- 只有全部搜索结果检查完成且没有合格新项目时，任务才会明确报告耗尽；来源不可用、响应不完整或预算不足会分别报告原因，不能据此判定耗尽。
- 上述情况下保留旧站点、历史和快照，不生成假报告或静默重复推荐。部分来源失败或预算用完时，如果已有通过完整校验的新项目，仍可正常推荐。
- GitHub 429（以及带限流信息的 403）按 `Retry-After` 秒数或 HTTP 日期退避；超过 60 秒的等待直接报告来源不可用，避免提前重试或无限等待。

## 本地命令

需要 Node.js 20+：

```bash
npm test
npm run lint
npm run build
GITHUB_TOKEN=... DEEPSEEK_API_KEY=... npm run generate
```

本地不设置 `DEEPSEEK_API_KEY` 时会使用规则解析模式。未认证调用 GitHub API 的限额较低，正式定时任务始终使用 Actions 提供的 `GITHUB_TOKEN`。

修复分支和 PR 的验证工作流只执行语法检查、测试和已有站点构建，不调用 DeepSeek、写回日报或部署 Pages。
