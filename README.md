# dsh-model-admin

AI 平台账号、签到与模型路由管理台（DeepSeek Harness 插件）。

[English](README.en.md) | 中文

统一的控制台，把三件事管在一起：多家 AI 编程服务的**登录账号**、
**每日签到/积分领取**，以及**跨渠道的模型路由**。每早自动跑一遍所有支持
签到的渠道，逐渠道报告领到了什么；同一个模型在多个渠道可用时归成一个
路由条目，按候选顺序发请求，某个渠道在产出任何内容前失败就自动换下一
个。装它不改变对话的默认模型——路由条目就在模型选择器里，选中才生效。

## 它能管什么

控制台认识 15 个账号渠道，能力分三档：

- **内置渠道包（10 家，开箱可用）**：LobsterAI、Qoder / Qoder 中国版、TRAE、
  Cline、Loomy、Raccoon、MiniMax Code（国内版）、ZCode、Gemini、OpenCode。
  登录、账号池、积分领取随插件一起分发。
- **复用已装插件（2 家）**：CodeBuddy（腾讯）与 WorkBuddy（国际版）由
  `dsh-connect-workbuddy` 提供——本插件不重复实现，装了就汇总它的账号状态。
- **待对应插件（3 家）**：CodeArts（华为云）、MiniMax Code（国际版）、
  OpenCode 的账号管理由各自的连接插件负责；本插件列出能力与签到方式，
  装上对应插件后即纳入汇总。

| 渠道 | 登录方式 | 签到 |
|---|---|---|
| CodeBuddy（腾讯） | 浏览器授权 | 每日签到 + 成长任务 |
| WorkBuddy（国际版） | 浏览器授权 | 无（登录即发每日额度） |
| CodeArts（华为云） | 浏览器回调 | 每日签到 |
| LobsterAI（有道） | 浏览器回调 | 每日签到 |
| Qoder / Qoder 中国版（阿里） | 设备码 | 每日领取 |
| TRAE（字节） | 浏览器回调 | 签到 |
| Cline | 设备码 | 无 |
| Loomy（讯飞） | 短信验证码 | 每日签到（凭据不自动续期） |
| Raccoon（商汤） | 微信扫码 | 无 |
| MiniMax Code 国内/国际版 | 设备码 + PKCE | 每日签到 |
| ZCode（智谱） | 设备码 | 每日领取（含营销活动） |
| OpenCode | 浏览器授权 | 无 |
| Gemini Code Assist | 浏览器回调 | 无（需代理出口） |

无签到接口的渠道**不会**被自动签到调用——面板明说"无签到"，而不是留一个
点了必然失败的按钮。

## 五个页面

- **签到**：立即运行 / 今日已跑状态、自动开关、运行时间（UTC+8）、逐渠道
  结果表（已领取 / 今日已领 / 未开启 / 无签到 / 失败 + 详情）。
- **路由**：每个模型一条目，候选渠道按尝试顺序排列；点 ★ 把某个渠道
  提到最前（★ 的顺序即优先顺序）；策略三选——顺序（fallback）/ 轮换
  （round-robin）/ 会话粘连（sticky）；候选上标注实际被用的次数。
- **账号**：各渠道账号概况（几个号、几个可用、读取失败原因）。
- **积分**：各账号余额，积分与 Token 分列（两种单位不求和）。
- **备份**：导出含登录凭据的归档。

## 模型路由怎么工作

路由不是第二套渠道实现。它在渠道包挂载**之前**观察宿主登记的所有
adapter，把每个渠道自己的 `prepareCall` 原样复用——鉴权、账号池、限流
换号、线上协议都还是各渠道自己的事，路由只做两件它该做的事：

1. **归并**：`deepseek-v4.1-flash`、`deepseek-v4.1-flash-free`、
   `DeepSeek-V4.1-Flash-SG` 归到同一个规范名下（版本号与产品线保留，
   只剥 tier 标记——把两个真实不同的模型并成一个是路由能犯的最坏错）。
2. **选择与切换**：按策略选首个候选发请求；该候选在产出任何可见内容
   **之前**失败，才换下一个候选重试（已输出的内容收不回来，中途拼接
   会产生畸形回答）；失败候选的半截 reasoning 不会出现在最终流里。

两条从生态的踩坑里保留下来的不变式：

- **容量取交集，不取并集**：候选里有 128K 窗口的渠道，路由就声明 128K——
  按最宽的声明发出去，让限流的候选超长失败，是把失败留给用户。
- **★ 的顺序是严格序**：手工 pin 的渠道永远排在没 pin 的之前，不被任何
  自动评分静默覆盖。

路由条目出现在模型选择器的 **Model Admin 路由** 分组；没登录任何渠道时
该分组为空，而不是塞一堆点不动的模型。

## 安装

```sh
dsh plugin --profile desktop add <this-repo>
```

或在 profile 的 `package.json` 里加依赖与 bundle（包名 `dsh-model-admin`，
`dsh.profile.bundles` 数组加一项），然后重启 DSH。

安装后 **设置面板左侧导航**（「集成」分组）出现 **Model Admin** 一行——
它注册在宿主的 `settings.section` 座位上，和 Our Free Model、路由同一层，
不在「内置插件」页里。渠道的登录入口在各渠道自己的面板（或首次在 Model
Admin 里点添加账号时打开）。

## 自动签到的语义

- **一天一轮**：按 UTC+8 日期判重（上游活动在北京时间零点重置），不是宿主
  所在时区——换时区的机器不会因此多跑或漏跑。
- **跑出了东西才记日**：一轮下来只有"无签到/未开启"，不写入今日标记，
  下次启动会重试；领到或已领过才记。
- **串行 + 间隔**：逐渠道顺序执行，间隔 400ms——同时打全部渠道是触发上游
  限流最快的方式。
- **补跑**：宿主关机错过的轮次，在下次启动 30 秒后补一次，不等设定钟点。
- **降级**：渠道包没挂上（headless 组合、精简安装）时，签到记录失败原因，
  面板显示"渠道包未挂载"，而不是一片空白看着像"没有账号"。

## 开发

```sh
node --import ./test/stubs/register.mjs \
     --test "test/*.test.js"                      # 87 项单元测试
MODEL_ADMIN_NO_PACK=1 node scripts/smoke.mjs    # 端到端冒烟（mock 渠道包）
node --import ./test/stubs/register.mjs \
     scripts/integration.mjs                    # 接入验证（真实渠道包）
```

接入验证通过 `test/stubs/` 把宿主提供的 `@deepseek-ai/*` 与 `react` 换成桩，
在 DSH 进程外真实执行渠道包的 `apply`：挂载、注册 10 个 provider、注册
`/api/channel-pack` RPC、bridge 词汇（`account.list` / `credits.claimAll`），
以及路由链路（路由 provider 注册、渠道 adapter 捕获、聚合出的路由条目、
真实渠道上的 `prepareCall`）全部走通。浏览器半身的契约另有独立检查：走
`window.__ModuleLoader__.load` 真实加载 `client.js`，断言它注册到
`settings.section`（id / order / label）并注入主题化的 CSS。

### 布局

```
index.js              宿主半身：挂载渠道包、RPC 桥、签到引擎、路由
                      provider、控制台 API
client.js             浏览器半身：ModuleLoader bundle，注册 settings.section
                      （设置左侧导航那一行）+ 注入主题 CSS + API 客户端
src/client/page.js    页面外壳：五个 tab、summary 读取、错误横幅
src/client/sections.js 五个页面组件（签到 / 路由 / 账号 / 积分 / 备份）
src/channels.js       渠道能力表（登录方式 / 签到能力 / 注意事项）
src/schedule.js       UTC+8 日期与调度纯函数
src/runs.js           一轮签到的结果聚合（单位分列）
src/accounts.js       账号与积分归一化（临期、冷却、待生效）
src/rpc.js            渠道包 RPC 桥（去重、超时、错误规范化）
src/route/normalize.js  规范模型名归并（纯函数）
src/route/aggregate.js  候选、策略、容量交集（纯函数）
src/route/adapter.js    路由 provider：adapter 捕获、prepareCall
                        转发、零输出失败切换
vendor/channel-pack/  内置渠道实现（MIT，出处见 NOTICE.md）
```

浏览器半身是**手写的 ModuleLoader bundle**（`window.__ModuleLoader__.load({id, factory})`），
没有任何构建步骤；它只依赖 shell 已提供的 `react`，样式全部取宿主的
`--dsw-alias-*` 主题 token，因此跟随明暗切换。

## 数据

`~/.dsh/dsh-model-admin/`：`settings.json`（运行钟点、临期窗口、自动开关）、
`checkin.json`（今日标记、逐渠道结果、最近 30 天历史）、
`routes.json`（每条路由的策略、pin、启停）。

## 声明

仅供学习研究使用，请遵守各服务方的服务条款。内置渠道实现来自上游 MIT
项目（见 [NOTICE.md](NOTICE.md)）；使用第三方渠道的一切后果由使用者自行
承担。
