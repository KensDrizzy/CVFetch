# CVFetch 本地试运行

地址：http://localhost:3008

后台：http://localhost:3008/admin

管理员密码在项目根目录 `.env` 的 `ADMIN_PASSWORD`。模型密钥也只保存在该文件中，文件权限为 600，已被 Git 和 Docker 构建上下文排除。

当前使用 DeepSeek 的 `deepseek-flash`，接口配置为 `https://api.deepseek.com/v1`，通过项目现有回执与预算机制调用。

## 当前功能与范围

- 站名改为 CVFetch，关闭通用模型榜和 Codex 重置监控。
- 只启用 arXiv cs.CV 一个信源；首批导入 10 篇，后续读取最近 50 篇。
- 预筛与评分已调整为计算机视觉研究阅读价值；暂未校准原有精选阈值。
- Atom 摘要可以完整进入模型分析，保留全部作者；页面导读明确基于摘要。
- 模型预算为每分钟 30 次、每小时 300 次、每天 1000 次调用。这是请求次数限制，不是金额上限。耗尽后排队重试，后台每 5 分钟检查待处理内容。
- 前端、API、worker 和 PostgreSQL 通过 Docker Compose 运行。网页只绑定本机 127.0.0.1:3008。

这是可运行的论文精选原型，尚未实现全量分页补漏、arXiv 跨版本统一身份、完整论文元数据与 PDF 解析、CV 专属分类导航和论文推荐榜。当前保留框架分类，论文可在“论文”分类中查看。热点榜仍基于多来源报道，单一 arXiv 源出现空榜是预期行为。

首次回灌的论文不一定进入当天日报。后续实时收录符合窗口的新论文才会进入日报；已有精选可直接在首页/全部动态查看。

## 常用命令

界面文案在 `industry/site.ts` 的 `HOME` 中；首页采用视觉几何插画和论文时间线，支持浅色、深色和手机布局。站内标识与浏览器图标均来自 `industry/brand/logo.svg`（取景框与眼睛）。修改 SVG 后，用 Node 24 运行 `node scripts/brand-icons.ts` 重新生成 PNG 和 ICO，再重新构建镜像。

在 项目根目录 下运行：

```bash
# 启动已有镜像
docker compose up -d --no-build

# 看状态（setup 正常退出是预期状态）
docker compose ps -a

# 查看后台处理日志
docker compose logs -f --tail 100 worker

# 停止服务并保留数据
docker compose down

# 修改源码后只构建一次共享镜像，再启动
docker compose build web
docker compose up -d --no-build

# 检查网页、API、RSS 和 MCP
docker compose exec web node scripts/smoke.ts --base http://localhost:3000
```

Compose 中四个应用服务共用同一个镜像。此机器的 Compose/BuildKit 在同时构建四个相同镜像名时发生过导出冲突，因此使用 `build web` 只构建一次。

`.env` 的 COLLECT_ENABLED/MODEL_CALLS_ENABLED 当前为 true。暂停自动处理时将它们改为 false，再运行 `docker compose up -d --no-build`。密钥或模型配置变更同样用 up 重建容器，不能只 restart。

## 验证记录

- DeepSeek 真实请求通过项目 chatJson/receipts 链路成功。
- 已从 arXiv 收录 50 篇真实论文，已有论文完成中文标题、摘要、评分和公开发布。
- 容器生产构建成功，TypeScript 检查通过。
- 网页测试 11 项通过；全站 smoke 检查通过。
- 2026-09-30：后端测试在新建的空库 cvhot_ui_test 中完整运行，129 项全部通过。测试进程未注入真实模型密钥，模型由本地 HTTP stub 提供；包含 Atom 摘要完整性与多作者测试。
- 测试服务需要允许本地 stub 调用，不能直接以全局 MODEL_CALLS_ENABLED=false 运行全部测试。业务开发时仍应关闭对外调用，不能把真实模型密钥注入测试进程。

完整改造路线与已知限制参见 `cvfetch-plan.md`；其中“本次尚未启动”的描述是初次分析时的历史记录，以本文件的试运行状态为准。
