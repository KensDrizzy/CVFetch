# CVFetch 论文库与研究动态

## 已配置的来源

- arXiv cs.CV：每小时最新 50 篇，首次 10 篇。
- Semantic Scholar：官方 Graph bulk search，检索视觉相关术语，限定最近 90 天且不超过今天。首次 5 篇，后续每 6 小时取最新 50 篇。可填 `SEMANTIC_SCHOLAR_API_KEY` 提升公共额度下的稳定性。
- OpenAlex：官方 Works API，按 Computer Vision and Pattern Recognition 子领域 1707 筛选，最近 90 天且不超过今天。首次 5 篇，后续每 6 小时取最新 50 篇。可填 `OPENALEX_API_KEY`；请求经过 `openalex` 回执与预算，不下载全文。
- CVF：自动发现 CVPR、ICCV、WACV 的最新主会议，分别每天归档 5 篇。只读论文页面的标题、作者、摘要；使用会议官网公布的发布日，不把会议档案计为当天新论文。批次失败不前移游标；会议年份更新时从新会议开始。

Semantic Scholar / OpenAlex 使用最新窗口，不能保证覆盖窗口之外或索引延迟的全部论文；CVF 是会议档案补充，不是预印本实时源。模型继续进行 CV 相关性筛选，未改评分门槛。

元数据优先用 DOI、arXiv ID（去掉版本号）、Semantic Scholar / OpenAlex ID 建立别名。同一论文的其他来源只增加发现记录，不覆盖原摘要；没有共同标识的记录不会仅凭相似标题强行合并。迁移保留旧链接与文章 ID，并补入现有 arXiv 标识。

## 作者名单与待配置状态

用户确认的首批名单：

| 平台 | 账号 | 状态 |
| --- | --- | --- |
| X | @sainingxie、@drfeifei | 已配置查询，默认暂停，等待 SocialData 凭据 |
| 微信公众号 | 我爱计算机视觉、极市平台、3D视觉工坊 | 默认暂停，等待 Dajiala 凭据及准确账号 ID |
| 小红书 | 待确认作者主页 | 等待 RSS 或外部采集渠道，不虚构账号或帖子 |

`/updates` 展示研究动态，`/following` 展示公开的来源状态。论文首页与 `/all` 按来源类型排除帖子，即使帖子讨论论文、被模型分类为“论文”，也不会混入论文流。主题筛选和搜索同样可用于研究动态。已暂停且缺凭据的来源不会发起采集请求。

## 在本地启用账号

编辑忽略提交的 `.env`：

```dotenv
SOCIALDATA_API_KEY=
DAJIALA_KEY=
# 选填：论文库凭据
SEMANTIC_SCHOLAR_API_KEY=
OPENALEX_API_KEY=
```

修改环境变量后运行 `docker compose up -d --no-build`，让 API 与 worker 重建并读取变量。然后进入 `/admin/sources`：

1. 启用两个 X 来源，查询已填好，并排除了回复。
2. 为各公众号填入经确认的 `ghid` 或 `wxid`，保留现有 `nickname`、`contentType` 和 `platform`。显示名不是账号 ID，不能直接代替。
3. 启用对应来源，并“抓取一次”查看结果。SocialData 与 Dajiala 可能收费，沿用后台已有预算熔断；不填 key 不调用。

账号配置不会因重复运行 `scripts/seed.ts` 被覆盖。更新已有来源配置会通过后台审计。

## 小红书与其他订阅渠道

若有自己的 RSSHub / 订阅服务，在后台新建 `rss` 来源，例如：

```json
{
  "feedUrl": "https://your-feed-service.example/your-author-feed",
  "summaryIsBody": true,
  "contentType": "post",
  "platform": "小红书",
  "profileUrl": "https://www.xiaohongshu.com/user/profile/已核实的作者ID"
}
```

以上为配置示例，不是已接通的订阅地址。第三方服务的登录和授权由该服务处理，CVFetch 不保存平台登录 Cookie，也不绕过访问限制。

也可用已有 `POST /api/ingest/items`：先在后台创建 `external` 来源，配置 `contentType: "post"`、`platform: "小红书"` 并设为 `editorial`，再用 `.env` 中的 `INGEST_TOKEN` 推送标题、摘要与原文 URL。未明确许可时不启用站内全文。

## 官方资料

- [Semantic Scholar API](https://api.semanticscholar.org/api-docs/)
- [OpenAlex API](https://help.openalex.org/api/)、[鉴权和额度](https://help.openalex.org/api/authentication/)
- [CVF Open Access](https://openaccess.thecvf.com/)
