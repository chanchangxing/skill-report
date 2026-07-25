# Agent Skill Daily

每天北京时间 09:45，从 GitHub 公开仓库中发现一个热门且未推荐过的 Agent Skill，读取其 `SKILL.md` 与引用文件，生成中文技术分析并发布到 GitHub Pages。

## 工作方式

1. GitHub Actions 按 `45 1 * * *`（UTC）定时启动，即北京时间 09:45。
2. 脚本通过 GitHub API 搜索包含真实 `SKILL.md` 的活跃公开仓库，排除归档、Fork、链接合集与不完整文件。
3. 总 Stars 占评分的 70%；七日新增 Stars、Forks、Issue 活跃度与更新时间合计占 30%。
4. 系统使用 `仓库全名::SKILL.md 路径` 和文件指纹永久去重，并对同一仓库设置 14 天冷却。
5. DeepSeek 阅读选中的 Skill 及其直接引用文件，输出项目介绍、热门原因、核心能力、输入输出和具体运作流程。
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
| `AI_MODEL` | `deepseek-v4-pro` | DeepSeek 模型 |
| `AI_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 地址 |
| `MAX_REPOSITORIES` | `35` | 每次深入检查的候选仓库上限 |

GitHub API 使用 Actions 自动提供的 `GITHUB_TOKEN`，无需额外创建 Token。

## 启用 GitHub Pages

在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。工作流中的 `deploy` Job 会上传并发布 `docs/`。

## 首次运行

1. 添加 `DEEPSEEK_API_KEY`。
2. 打开仓库 **Actions → Daily Agent Skill Report → Run workflow**。
3. 首次成功后访问 `https://chanchangxing.github.io/skill-report/`。

如果暂时没有配置 Key，或 DeepSeek 临时不可用，生成器会自动输出有明确标记的规则版报告，保证历史快照和页面仍能更新。

## 历史阅读与不重复保证

- 首页展示当天推荐和最近报告。
- `/history.html` 提供历史卡片及名称、仓库、主题搜索。
- 每份报告有固定地址 `/reports/YYYY-MM-DD.html`，并提供前后翻页。
- 已推荐的 Skill ID 和文件指纹保存在 `data/history.json`；完全相同的 Skill 不会再次推荐。
- 同一仓库的其他 Skill 在 14 天内不会连续出现。
- 如果候选池耗尽，任务会明确失败，不会静默重复旧内容。

## 本地命令

需要 Node.js 20+：

```bash
npm test
npm run build
GITHUB_TOKEN=... DEEPSEEK_API_KEY=... npm run generate
```

本地不设置 `DEEPSEEK_API_KEY` 时会使用规则解析模式。未认证调用 GitHub API 的限额较低，正式定时任务始终使用 Actions 提供的 `GITHUB_TOKEN`。
