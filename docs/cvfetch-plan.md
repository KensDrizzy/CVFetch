# AIHOT → CVFetch：改造与启动方案

> 后续已启动本地 CVFetch 试运行版，当前地址与运行说明见 [cvfetch-running.md](cvfetch-running.md)。下文保留初次分析时的状态与完整改造建议。

分析日期：2026-09-29。基于本地提交 `589f79e`。

本次已克隆仓库并检查源码、Docker 环境和论文源。本文是实施建议，尚未修改应用配置或实现论文采集器，也未启动模型处理流水线。

## 1. 推荐做成什么

第一版定位为「计算机视觉论文发现与中文精选」：

- 主要输入是 arXiv cs.CV 的论文标题和摘要。
- 先按方向筛选，再评价研究贡献，输出中文标题、摘要、阅读理由和原文链接。
- 主页展示近期精选；全部论文按时间浏览；方向通过标签和主题订阅。
- 不把模型根据摘要给出的分数称为同行评审或经验证的论文质量。
- 暂不依赖 PDF 全文解析、社交媒体、引用数或商业爬虫服务。

可以复用现有 web、api、worker、PostgreSQL、任务队列、后台、RSS、搜索和日报。第一版主要修改行业配置，并补采集与论文身份处理；不需要重写整个网站。

现有链路：

```text
sources → collect → materials → queueProcessing
        → extract（需要时）→ prefilter → 两次 score + structure
        → 中文标题摘要 → publication → 网页 / RSS / 日报
                                 └→ events → 热点榜
```

## 2. 行业配置改动

| 文件 | CVFetch 建议 |
| --- | --- |
| `industry/site.ts` | `name` 和运营者名改为 CVFetch，`subject` 改为 CV，`mcpPrefix` 改为 cvfetch，抓取 UA 改为 CVFetchBot；首页和关于页说明是论文索引与摘要。 |
| `industry/sources.json` | 用论文源替换示例新闻源，第一阶段仅启用 cs.CV；不要一开始抓整个 cs.AI/cs.LG。 |
| `industry/taxonomy.ts` | 增加检测/分割、3D 视觉、视觉语言、图像/视频生成、视频理解、具身视觉等方向标签；与提示词中的白名单保持一致。 |
| `industry/topics.json` | 配置上述方向主题。第一版可以保留 `paper` 大类，以标签区分研究方向，减少对已有 API 和测试的影响。 |
| `industry/prompts/prefilter.md` | 从宽泛 AI 相关改为 CV 研究相关；排除融资、纯文本 LLM 新闻、营销等，保留视觉交叉研究。 |
| `industry/prompts/selection-score.md` | 将读者改为 CV 研究者/工程师，移除对专业方法研究的一概压分；保留类型、五轴加权、单字段 JSON 和输入安全边界。 |
| `industry/prompts/content-understanding.md` | 摘要回答研究问题、方法和原文明确报告的结果；材料缺少实验、局限或代码时不得补写。同步类型和标签白名单。 |
| `industry/prompts/rules-domain.md` | 补齐 mAP、IoU、PSNR、SSIM、NeRF、3DGS、VLM、VLA 等术语规则。 |
| `industry/prompts/structure.md`、`summarize-*.md` | 同步分类、研究主体和普通条目的摘要规则，否则未精选条目仍沿用新闻表达。 |
| `industry/prompts/group-*.md` | 同一论文的介绍可归组；同一课题的不同论文必须分开，不能因同机构/同任务合并。 |
| `industry/prompts/report-*.md`、`story-digest.md` | 改成研究方向导语与论文进展综述。 |
| `industry/selection.ts` | 先保留现有阈值作为基线，再用人工标注的 CV 样本校准，不能把默认阈值当作适用于论文的结论。 |
| `industry/features.ts` | 将 `leaderboard` 和 `codexResetMonitor` 设为 false。原模型榜不是 CV 论文榜。 |
| `industry/brand/` | 更新图标、报头和 favicon，报头生成方式见 `docs/customize.md`。 |
| `industry/pages/` | 正式上线前按实际运营情况完善条款与隐私说明。 |

建议的评分含义：研究问题的重要性、方法/结论的新颖性、已提供证据的强度、对目标 CV 方向的相关性、可复现或可迁移价值。保留现有五轴计算结构；权重、阈值和具体噪声边界用样本评测决定。仅有摘要时，不能评价未读到的消融、数据泄漏或统计显著性。

## 3. 必须知道的源码限制

### 3.1 原评分规则与目标不一致

`industry/prompts/selection-score.md:3` 明确面向普通 AI 重度用户，而不是论文研究员；第 65、76 行对专业论文、训练方法和局部方法改进设置了限制。

因此只添加论文 RSS 会出现「抓到了，但有价值的专业论文没进精选」的问题。优先改预筛和评分，不要只降低所有入选阈值。

### 3.2 普通 RSS 存在前 60 条截断

`packages/backend/src/sources/collect.ts:24` 定义 `MAX_ITEMS_PER_RUN = 60`；第 130–137 行首次按 `initialBackfillLimit` 截断，后续非 X 信源直接取前 60 条，然后才入库。

这不是「每轮取下一批 60 条」。同一个 feed 如果一次发布超过 60 条，其余条目可能持续漏收，条件请求的 304 还会延后重新读取。提高抓取频率不能解决这个问题。

可靠改法：拉取后先持久化整批候选或持久化待处理游标，再分批入库/分析；只有候选都已可靠保存后才能推进成功游标和 HTTP validator。不要只无限扩大常量。

新配置项还必须登记在 `packages/backend/src/sources/config-keys.ts`，否则会被拒绝。

### 3.3 RSS 与 Atom 摘要处理不一致

`packages/backend/src/sources/rss.ts` 的 RSS 分支支持 `summaryIsBody`；Atom 分支第 186–197 行只把 `content` 作为正文，没有对 `summary` 应用这一选项，而且只取第一个作者。

arXiv API 返回 Atom，主要摘要在 `summary` 中。直接把 API URL 填入 `feedUrl` 不会得到完整的论文适配器：摘要可能只落入被截短的 excerpt，并触发额外网页提取；作者列表、版本、DOI 等也没有结构化保存。

建议补一个 arXiv 元数据适配层，完整保留摘要和作者，把摘要作为「供模型分析的文本」，同时保存 `evidenceLevel=abstract` 之类的证据范围。不要把它向读者显示成论文全文。

### 3.4 论文需要稳定身份

`packages/backend/src/lib/url.ts:48` 只对 X 特化身份，其余按规范化 URL 判重。arXiv 的 `/abs/ID`、`/abs/IDv2`、`/pdf/ID` 仍可能成为不同条目。

在适配层生成 `identityKey = arxiv:<不带版本的 ID>`，并独立保存版本和 updated 时间；同一 ID 的 v2 更新已有论文，不重新发一篇。`content/materials.ts` 已接受显式 identityKey，可以复用其修订流程。需要防止旧版本抓取覆盖新版本。

作者博客、会议页和代码仓库可以关联同一论文，但原始报道仍应保留各自来源；不要把所有报道的 article identity 都强制合成一个 ID。

### 3.5 当前热点榜不是论文推荐榜

`packages/backend/src/events/hot.ts:7` 起规定：48 小时窗口、24 小时半衰期、至少两个独立参与方；第 93 行执行过滤。

只在 arXiv 上出现的论文可以进入精选时间线，但通常无法进入热点榜。不要把空热点榜误诊为采集失败，也不要伪造两个来源让它上榜。

第一版使用已有精选时间线；如果需要论文 Top 榜，再增加独立的「近期论文推荐」读取逻辑：按相关性/研究评分排序，兼顾时效和方向覆盖；热度只作为以后可选的一个信号。

相关改动位置为 `packages/backend/src/publication/`、`apps/api/src/routes/`、`packages/contracts/src/` 和 `apps/web/app/`。所有公开出口继续走 publication 层，页面请求不能触发模型调用。

### 3.6 外部推送接口不会消费摘要

`packages/backend/src/ingest/items.ts:19` 的 ItemIn 只接受 title、url、publishedAt、author 和 raw；第 56 行起没有将摘要映射到 excerpt/bodyText。

因此「Python 抓 arXiv，再 POST 一个 abstract」目前并不能让模型直接读到这个摘要；把摘要藏进 raw 也不会自动进入模型输入。

若选外部脚本路线，要扩展接口的输入校验和摘要/正文映射，并限制长度、清理 HTML、验证修订行为。接口每批最多 50 条，未知 source 默认 isolated，需要在后台调整为 editorial。服务内的 arXiv 适配器可以直接复用 materials 和 queueProcessing，少改一层接口。

## 4. 信源接法

官方 RSS：<https://rss.arxiv.org/rss/cs.CV>。arXiv 同时提供 RSS 与 Atom，按学科订阅；参见 [RSS 文档](https://info.arxiv.org/help/rss.html)。

下列条目可作为 `industry/sources.json` 的试抓配置。它用于验证链路，仍受上面的条数限制约束，不代表已实现全量采集：

```json
{
  "id": "rss-arxiv-cv",
  "name": "arXiv · Computer Vision",
  "kind": "rss",
  "config": {
    "feedUrl": "https://rss.arxiv.org/rss/cs.CV",
    "summaryIsBody": true,
    "_aihot": { "initialBackfillLimit": 20 }
  },
  "tier": "T1",
  "first_party": true,
  "owner_entity_id": null,
  "participation_mode": "editorial",
  "interval_minutes": 60,
  "tags": ["论文/研究"],
  "site_fulltext": false,
  "syndicate_fulltext": false
}
```

这里 T1/first_party 表达作者原始论文材料，不代表经过同行评审，也不能把 arXiv 当成论文所属机构。tier 会影响入选阈值，应在 CV 样本校准时一起确认。

论文库的正式采集建议用 arXiv API 分页与时间窗口补漏，查询示例：

```text
https://export.arxiv.org/api/query?search_query=cat%3Acs.CV&start=0&max_results=100&sortBy=submittedDate&sortOrder=descending
```

这只是第一页。实现必须推进 start，按窗口结束条件停止，使用重叠窗口和 ID 去重，并按需扫描更新版本。连续请求遵循官方建议的至少 3 秒间隔、单路限速和失败退避。官方接口说明见 [arXiv API 手册](https://info.arxiv.org/help/api/user-manual.html)。

已有 RSS/Atom 解析可复用，但分页、状态、作者/版本/摘要保存需要专门实现。若新增 `arxiv` kind，需要同步数据库 kind 约束、SourceRow、配置校验、后台表单、seed 类型和 collect 分支；更小的改法是给 rss 增加经过校验的 arXiv adapter，并明确绕过通用截断路径。

未来再接会议论文目录、OpenReview 或论文社区信号；它们应按各自当前接口单独设计适配器，不假定存在通用 RSS。先从 cs.CV 跑通，再考虑 cs.RO/cs.LG 中真正与视觉有关的交叉论文。

## 5. 本机怎么启动

已确认：本机 Node v22.22.3、Docker 29.2.1、Compose v5.0.2，Docker daemon 可连接。项目 engines 要求 Node >=24.11，Dockerfile 自带 Node 24，因此建议用 Docker 运行应用。

仅初始化 `.env` 的脚本无第三方依赖，已经在临时目录验证能用本机 Node 22 执行。当前仓库没有创建 `.env`，密钥由你在本地填写。

### 第一步：先做上述行业配置，再生成本地环境

```bash
cd /Users/lqf/projects/aihot
node scripts/init-env.ts
```

编辑生成的 `.env`：

```dotenv
SITE_URL=http://localhost:3000
LLM_BASE_URL=你的服务商的OpenAI兼容地址
LLM_API_KEY=你的API密钥
LLM_MODEL=该服务商支持的模型ID
LLM_EXTRA_JSON={}

# 第一次先验证空站启动，暂不开采集和模型调用
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
FEISHU_CONTENT_PUSH_ENABLED=false
FEISHU_INTERNAL_ENABLED=false
INDEXNOW_SUBMIT_ENABLED=false
```

初始化脚本会生成管理员密码和随机签名/数据库密钥，后台密码在 ADMIN_PASSWORD。LLM_EXTRA_JSON 默认含特定服务商参数，换供应商时也要调整。普通 RSS 不需要 Firecrawl、SocialData、公众号或 embedding key；本次 Firecrawl 只是用于核对官方文档。

### 第二步：启动并检查空站

```bash
docker compose up -d --build
docker compose ps -a
docker compose logs --tail 100 setup api worker web
docker compose exec web node scripts/smoke.ts --base http://localhost:3000
```

浏览器打开 <http://localhost:3000>；后台 <http://localhost:3000/admin>。db 保持 healthy、setup 正常退出、api/worker/web 保持运行是预期状态。

### 第三步：确认只有目标论文源启用，再打开流水线

在 `.env` 将 COLLECT_ENABLED 和 MODEL_CALLS_ENABLED 改为 true，然后：

```bash
docker compose up -d
docker compose logs -f --tail 100 worker
```

进入后台检查信源试抓、运行记录和模型预算。没有有效的 LLM key，只能验证网页/数据库等基础服务，不能完成论文打分和中文摘要链路。

修改源码或 industry 文件需要重新 `docker compose up -d --build`。修改 `.env` 后用 `up -d` 重建相关容器，单纯 restart 不会重新加载 Compose 环境。

### 已有数据时的注意点

- seed 对已有 source 使用 `ON CONFLICT DO NOTHING`。改 JSON 不会覆盖数据库中原信源，删掉 JSON 中的新闻源也不会停掉数据库里的新闻源；在后台逐一停用或更新。
- 新源首次导入和超过 48 小时的旧内容会标记回灌。日报在 `reports/compose.ts:58` 排除了 backfill，所以首次导入成功不等于当天日报立即有内容；先看后台与全部动态。
- arXiv submitted/updated 时间与公开公告时间不是一回事，直接使用 API published 可能触发 48 小时归档。正式版应保存 submission、updated、announcement/discovery 的不同含义，再明确「今日论文」口径，不能通过伪造日期解决。
- 原日报北京时间 08:00 生成（`apps/worker/src/schedules.ts:46`）。arXiv RSS 在美国东部午夜更新，应设计好日报的覆盖窗口；若想覆盖当天新 feed，可以安排在采集处理完成后发布。
- 自动调频在 `sources/collect.ts` 的 adaptIntervals 中会重设信源间隔。若 arXiv 要按发布节奏定时拉取，需让适配器拥有明确的调度策略，而不只修改一次 interval_minutes。

## 6. 第二阶段：完整论文站

有了稳定的标题/摘要采集后，再增量迁移一张 papers 表及关联表，保存 arxiv_id、version、authors、abstract、submitted_at、updated_at、venue、doi、pdf_url、code_url 和 project_url。

不要只往 prompt 里要求输出这些字段：还要修改结构化输出 schema、落库逻辑、publication 映射、API 契约以及卡片/详情页。新增迁移放在现有最大编号之后；当前为 0038，因此下一份可用 0039，但实施时应再次检查。

全文解析只对精选候选按需执行。方法、实验、局限、代码可用性分别保留证据出处；区分预印本与已接收论文，缺失信息显示未知。论文更新和代码开源可成为同一论文下的进展，不能制造重复新论文。

## 7. 实施后验收

按仓库 AGENTS.md，在 Node 24 环境和独立测试库中执行 typecheck、数据库迁移与后端测试、web build 与 web 测试，最后执行 smoke；开发/测试时关闭所有对外调用开关。

针对论文适配至少验证：

1. 单批超过 60 条全部可入库，重试不丢失；只有持久化成功才推进游标。
2. 同一 ID 的 abs/pdf/v1/v2 去重，v2 能修订且旧版本不回写。
3. 多作者、完整摘要、发布时间和 updated 保留；摘要不是全文。
4. 一个来源的高分论文能进精选；不同论文不会因同题材被合并。
5. 首次回灌不刷屏，后续新论文可正常进入公开列表与对应日报窗口。

本次实际验证：git clone 完成；Docker daemon/Compose 可用；Compose 配置通过静态校验；init-env 在临时目录执行通过；cs.CV RSS HTTP 请求成功，但返回的当前 feed 含 0 条论文；arXiv API 的 3 条样本请求在 20 秒后超时。因此还不能宣称已经抓到真实论文或跑通了完整流水线。实施采集器时还需要核对部署机器到 arXiv 的网络连通性。未安装 npm 依赖、未运行应用构建/测试、未调用付费模型。
