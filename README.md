# Daily Skill Report

每天自动收集公开趋势信号，并用 AI 生成一份中文「最值得学的技能」报告。报告以 Markdown 提交回仓库，因此在任何电脑上拉取同一 GitHub 仓库后都能阅读完整历史。

## 项目结构

```text
.
├── .github/workflows/daily-skill-report.yml  # GitHub Actions 定时任务
├── daily/                                   # 每天自动生成的报告
├── scripts/generate-report.mjs              # 收集趋势、请求 AI、更新索引
├── templates/daily-report.md                # 报告结构参考
├── index.md                                 # 历史报告目录
└── package.json
```

## 初次使用

1. 在 GitHub 新建一个**私有或公开**空仓库，例如 `daily-skill-report`。
2. 将本目录的全部文件提交并推送到该仓库。
3. 在 GitHub 仓库中打开 **Settings → Secrets and variables → Actions**：
   - 在 **Secrets** 新增 `OPENAI_API_KEY`，值为你的 OpenAI API Key。
   - 在 **Variables** 新增 `OPENAI_MODEL`（可选）。填写你账户可用的文本模型；未填写时使用 `gpt-5-mini`。
4. 打开 **Actions**，选择 `Daily Skill Report`，点击 **Run workflow** 做首次测试。
5. 任务成功后，`daily/YYYY-MM-DD.md` 和 `index.md` 会自动提交。另一台电脑执行 `git pull`，或直接在 GitHub 网页查看即可。

> 不要把 API Key 写入仓库、`.env` 或报告内容；只放在 GitHub Actions Secret 中。

## 定时与时区

工作流的 cron 使用 UTC。`45 1 * * *` 等于 **澳洲珀斯（UTC+8）每天 09:45**。珀斯不实行夏令时。

如需更换时区，请将目标当地时间换算为 UTC，再修改 `.github/workflows/daily-skill-report.yml` 中的 `cron`。报告文件日期按 `Australia/Perth` 计算；如需改为别的日期口径，设置 workflow 的 `REPORT_TIMEZONE` 环境变量，例如 `Asia/Shanghai`。

## GitHub 权限

工作流已声明 `contents: write`，以便把新报告提交回仓库。若组织策略限制默认令牌写入权限，请在仓库 **Settings → Actions → General → Workflow permissions** 允许读写，或让管理员为此工作流授权。

## 本地运行

需要 Node.js 20+。无需安装第三方依赖。

```bash
export OPENAI_API_KEY="你的密钥"
export OPENAI_MODEL="你可用的模型名"   # 可选
node scripts/generate-report.mjs --force
```

可选环境变量：

| 名称 | 用途 | 默认值 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 必填，用于生成报告 | 无 |
| `OPENAI_MODEL` | 报告生成模型 | `gpt-5-mini` |
| `REPORT_DATE` | 指定报告日期，格式 `YYYY-MM-DD` | 珀斯当天 |
| `REPORT_TIMEZONE` | 报告日期使用的 IANA 时区 | `Australia/Perth` |

趋势数据来自 GitHub 搜索、Hacker News Algolia 和 arXiv；单个来源暂时不可用时，脚本会继续使用其余来源。报告中的链接用于追溯当天的事实信号，AI 的推荐判断则应视为学习建议，而不是投资或职业保证。

## 调整报告风格

编辑 `scripts/generate-report.mjs` 中的 `buildPrompt` 即可改变选题标准、语言、篇幅或「对我的价值」部分。`templates/daily-report.md` 是期望的成品结构，方便审核或改写提示词。

## 成本与可靠性

每次任务仅发起一次文本生成请求；费用取决于你选择的模型及当天输入/输出长度。GitHub Actions 的计划任务可能因平台调度出现少量延迟，因此报告按生成日期命名，并可随时通过 **Run workflow** 补跑。
