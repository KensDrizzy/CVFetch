<p align="center"><img src="industry/brand/logo.svg" width="88" alt="CVFetch logo"></p>

# CVFetch

**Discover and follow the latest computer vision papers.**

持续获取计算机视觉论文，生成中文导读、阅读线索与研究精选。

CVFetch 基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 开源框架改造，使用 Node.js 24、React Router 和 PostgreSQL，通过 Docker Compose 运行网站、API 和后台采集任务。

## 当前功能

- 从 arXiv `cs.CV`、Semantic Scholar、OpenAlex、CVF Open Access 获取论文元数据与摘要；按 arXiv ID、DOI 等标识跨来源去重。
- 独立的研究动态页，支持 X、公众号，以及通过 RSS / 外部推送接入的小红书；未配置账号明确显示待配置状态。
- 通过 OpenAI 兼容模型接口预筛、评分，生成中文标题、摘要和阅读线索。
- 论文精选每页 5 条，支持底部页码切换与主题筛选；提供搜索、收藏、深浅色主题和手机布局。
- 9 个 CV 研究方向筛选，支持交叉主题；新论文自动归类，已有论文可在 worker 中补标签。
- 日报、RSS、公开 API、MCP，以及信源、预算和运行状态管理后台。
- CV 专属取景框与眼睛图标。

目前是试运行版本：arXiv 首批导入 10 篇，后续每轮读取最新 50 篇；Semantic Scholar / OpenAlex 首批各 5 篇，后续读取近期窗口最新 50 篇；CVF 每个会议每天分批归档 5 篇。尚未实现论文索引的历史全量分页补齐及 PDF 阅读。导读基于标题与摘要，模型评分不代表同行评审结果；首页按收录时间排列。

## 本地运行

需要 Docker 和 Docker Compose；生成配置需要 Node.js 24.11 或更新版本。

```bash
git clone https://github.com/KensDrizzy/CVFetch.git
cd CVFetch
node scripts/init-env.ts
```

在生成的 `.env` 中填写自己的 `LLM_API_KEY`，确认 `LLM_BASE_URL` 和 `LLM_MODEL`。默认模板为 DeepSeek 兼容接口。初始化脚本会生成管理员密码和签名密钥。

```bash
docker compose build web
docker compose up -d --no-build
```

默认访问 `http://localhost:3000`，后台为 `/admin`，管理员密码在本机 `.env` 的 `ADMIN_PASSWORD` 中。端口可通过 `.env` 的 `PORT` 调整，并同步修改 `SITE_URL`。

采集和模型分析由 worker 执行。自动更新需要运行机器保持开机、联网；本地 Mac 睡眠后不能持续采集。GitHub 仓库保存源码，GitHub Pages 无法直接运行这套带数据库和 worker 的服务。

`.env`、密钥和 `.data/` 不进入 Git。开发时设置 `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`，并保持飞书、IndexNow 等对外开关关闭；正式采集需要显式开启对应开关并设置预算。

## 更新与检查

```bash
docker compose build web
docker compose up -d --no-build
docker compose exec -T web node scripts/smoke.ts --base http://localhost:3000
```

GitHub Actions 在推送 `main` 和提交 PR 时执行类型检查、网页构建、网页测试、后端测试及 Docker 冒烟检查。CI 使用临时数据库和本地模型模拟服务，无需真实 API Key 或仓库 Secrets。

## 配置与文档

| 内容 | 位置 |
| --- | --- |
| 站名、首页文案与品牌信息 | `industry/site.ts` |
| 信源、主题与分类 | `industry/sources.json`、`industry/topics.json`、`industry/taxonomy.ts` |
| 模型提示词与筛选门槛 | `industry/prompts/`、`industry/selection.ts` |
| 图标源文件 | `industry/brand/logo.svg`，修改后运行 `node scripts/brand-icons.ts` |
| 新增论文库与作者接入 | [多源采集说明](docs/cvfetch-sources.md) |
| 当前试运行说明 | [运行说明](docs/cvfetch-running.md) |
| 论文站改造路线 | [改造方案](docs/cvfetch-plan.md) |
| Docker、域名与服务器部署 | [部署文档](docs/deploy.md) |
| 框架定制与评分校准 | [定制文档](docs/customize.md)、[精选与校准](docs/selection.md) |

公开部署前需要在服务器配置自己的密钥、域名、HTTPS、备份，并确认 `industry/pages/` 中的使用条款和隐私说明。

## License

[MIT](LICENSE)。保留 AIHOT 原作者的版权与许可证声明。`@aihot/*` 工作区名称及现有数据库、Docker 卷标识沿用上游内部名称，以兼容已运行的实例。
