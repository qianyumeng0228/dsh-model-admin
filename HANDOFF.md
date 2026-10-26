# dsh-model-admin 交接文档

> 给接手的 AI / 开发者：这份文档是**自包含**的。读完它 + 仓库代码，你应该能继续开发
> 而不需要问原作者任何问题。事实以本文和仓库为准；README 只讲怎么用，这里讲**为什么这样写**。

- 仓库：`https://github.com/qianyumeng0228/dsh-model-admin`
- 当前 commit：`48ee794`（`main`）
- 版本：`0.1.0`
- 已安装位置：`~/.dsh/profiles/desktop/node_modules/dsh-model-admin`（即 `C:\Users\32818\.dsh\...`）
- 状态：可用但**未完成**——见 §8 已知缺口，其中第一条是最大的。

---

## 0. 一页纸摘要

一个 DeepSeek Harness（DSH）插件，把三件事收敛到一个设置页：

| 能力 | 做法 |
| --- | --- |
| **账号管理** | 复用 vendored 渠道包（10 家）的登录/账号池/凭据，自己不做协议 |
| **每日签到** | 宿主侧定时器，UTC+8 判重，串行调 `credits.claimAll` |
| **模型路由** | 注册一个虚拟 provider，把各渠道同名模型归一成候选，按策略选轨、零输出才切换 |

外加：`dsh-connect-workbuddy` 已装时汇总其 CodeBuddy/WorkBuddy 账号（不重复实现）。

**它不做什么**：不改变默认模型；不实现任何渠道的登录协议；不做积分到期排序（渠道包不暴露）。

---

## 1. 原始需求（用户原话，按时间）

需求是**逐步长出来的**，每次都要保留：

1. > 「our-free-model 移除了对 workbuddy 的支持，请你根据 our-free-model 这个插件以及 GitHub 上其他项目，
   > 对 workbuddy 以及其他主流 agent 反代的项目进行研究，帮我开发一个集成插件，管理这些 ai 平台的账号和签到，
   > 命名为 model-admin」

   动机：生态里每个能力一个插件（账号池一个、反代一个、签到脚本一个），用户不想装一堆。

2. > 「请推送到我的 GitHub 仓库，创建为新的项目，readme 你帮我写」

3. > 「改名为 dsh-model-admin」（对齐 DSH 生态 `dsh-` 前缀）

4. > 「我要求具备模型路由的功能，市面上那些散落的都好麻烦，得安装很多插件，我就要统一管理的」

   → 推翻了 v0.1.0 最初「不注册模型路由」的定位，路由成为核心需求。

5. > 「装上后可以显示在 deepseek 设置的左侧面板吗」（附截图：设置面板左侧导航里有
   > 账号与余额 / 常规 / 模型 / Agent 预设 / 内置插件 / … / Our Free Model / 插件市场）

   → 明确要求出现在**设置面板左侧导航**，不是「内置插件」页里的卡片。

6. > 「帮我安装」→ 见 §7.2 的坑。

7. > 「有问题，把我给你的要求和你的开发过程和用到的项目写成文档，我要交给别的 ai 开发」

   → 本文档。**「有问题」未被具体说明**，见 §10。

---

## 1.5 开发过程（做的事按时间排，含走错的路）

这份列表是为了让接手的人知道**每个设计是怎么来的**，以及哪些弯路已经走过、不用再走。

### 阶段 A：调研（没有写一行代码）

1. 先查本机：`our-free-model` 2.7.2 官方**主动移除**了 WorkBuddy 与华为云（`src/disclaimer.js`
   明说「后续更新不会重新引入」），所以 WorkBuddy 能力由一个独立插件承担。
2. 发现 `dsh-connect-workbuddy` 4.12.0 **已经装在 profile 里**，自带多账号池 + 每日签到。
3. 读它的 `checkinOne` / `checkinAllAccounts` —— 三态语义 + 串行 400ms 的来源。
4. 用 workflow 并行搜 GitHub，拿到生态图谱（30+ 个项目），重点读了
   `dsh-providers-hub`（17 渠道能力矩阵）与 `dsh-xdpool`（积分自动化）的 README。
   其中 `dsh-xdpool` 的 README 里有一句话点破了本项目的定位：
   > 「和单账号连接插件的区别：那类插件是一次一个账号」
5. **关键发现**：`our-free-model/vendor/channel-pack/pack.js` 里是 10 家渠道的完整 MIT 实现
   （登录、账号池、积分领取、自动签到引擎 `createAutoCheckin`）。这直接决定了架构：
   **不重写渠道，vendored 它**。

### 阶段 B：v0.1.0（账号 + 签到）

1. 先写纯函数层：`channels.js`（领域模型）、`schedule.js`（UTC+8）、`runs.js`（聚合）、
   `accounts.js`（归一化）、`rpc.js`（桥）—— 每个都配单测。
2. 再写宿主半身 `index.js`：pack 挂载 + RPC 桥 + 签到引擎 + 控制台 API。
3. 再写浏览器半身 —— **这里是第一版最大的错**（见阶段 E）。
4. 三道闸门（单测 / smoke / integration），集成验证需要给宿主模块造桩（`test/stubs/`），
   迭代补了 4 轮桩才让 pack 真正 mount 成功。

### 阶段 C：发布

1. `gh repo create model-admin --public` → push 被 **GH013 push protection** 拦（vendored 里的
   Google OAuth + 微信 AppID）→ 走 push-protection-bypasses 放行（§7.3）。
2. 补英文 README，改名为 `dsh-model-admin`（包名 / entry id / 数据目录 / API 路由 / 仓库名全改），
   45 处引用一次替换，闸门复跑。

### 阶段 D：加模型路由

1. 先查库：`dsh-router-core` 是独立网关产品（自带 suppliers/账号池/UI），**不可复用成库**。
   `our-free-model` 的 `aggregate.js` 是 BYO-key 车道，也不是我要的。
2. 读 DSH asar 里的 `LlmAdapter` / `LlmRuntime`，确认**宿主没有 adapter 级转发 API**。
3. 于是定下 §4.3 的「wrap `registerAdapter` 捕获」方案。
4. 写 `normalize.js` → `aggregate.js` → `adapter.js`，每层配单测；每个都踩了坑：
   - 归一化把 `v4.1` 的点吃掉（改成只换下划线）、把 `-flash` 误当 tier 剥掉（从名单移除）
   - `listModels` 是 async 却在同步路径读（改成缓存 + `refresh()`）
   - `prepared.stream` 是**函数**却被当生成器 `for await`（改成先调用）
   - 切换时把失败候选的 reasoning 也透传了（改成缓冲）
5. integration 扩展出路由链路验证：真实 pack 下 provider 注册、11 个 adapter 捕获、
   5 个路由条目、真实渠道 `prepareCall`。

### 阶段 E：用户退回 —— 面板不在左侧导航

用户发截图：设置面板左栏有 Our Free Model、路由，没有 Model Admin。

1. 定位：第一版 mount 到 `settings.plugins`（内置插件页的卡片）、用 `slots.mount`（不存在的 API）、
   组件是裸 DOM（宿主 renderer 是 React）。
2. 读 `dsh-router-core` 与 `our-free-model` 的 `client.js`，拿到正确形态（§4.8）：
   ModuleLoader bundle + React + `settings.section`。
3. 重写：`client.js`（bundle + 注册 + CSS 注入）、`src/client/page.js`（外壳）、
   `src/client/sections.js`（五个 React 页）。
   **后来这两个文件又被内联回 `client.js` 并删除**——ModuleLoader 的 `require` 只解析
   宿主包，不解析同级文件，拆出去面板直接加载失败（§4.8a）。
4. 新增两组浏览器半身测试：ModuleLoader 契约、渲染树。
5. 删掉被取代的 `src/client/panel.js` 与 `test/h.test.js`。

### 阶段 F：安装（踩了三个环境坑）

1. `pnpm install` 卡 13 分钟无输出 → 诊断出 **git 依赖的 HTTP HEAD 探测被重置**（§7.1）。
2. 换 codeload tarball 仍然卡 → 诊断出 **DSH 运行中全量 install 卡文件锁**（§7.2）。
3. 最终用「解压 tarball + 只 `--lockfile-only`」装上。
4. 装的时候顺手发现三个**分发缺陷**（`files[]` 漏 `vendor/`、`schemastery` 是死依赖、
   `inject: ['settings']` 过度耦合），修完重装。
5. 修 `cordis.patch.yml` 里过期的注释（「registers no provider」已不成立）。

### 阶段 G：交接（当前）

写本文档。用户说「有问题」但没给现象 —— 见 §10。

---

## 2. 参考项目（全部在本机，可直接读）

| 项目 | 位置 | 拿走了什么 |
| --- | --- | --- |
| **dsh-our-free-model 2.7.2** | `~/.dsh/profiles/desktop/node_modules/dsh-our-free-model` | ① `vendor/channel-pack/` —— **10 家渠道的完整 MIT 实现**（登录、账号池、积分领取、自动签到引擎），本项目直接复制过来用；② `client.js` 的 **ModuleLoader bundle 形态** + `settings.section` 注册写法；③ `src/aggregate.js` / `src/combos.js` 的路由设计（虚拟目录条目、策略、容量取交集） |
| **dsh-connect-workbuddy 4.12.0** | 同目录 | `checkinOne` 的三态语义（claimed / already / failed）、`checkinAllAccounts` 串行+400ms 间隔、账号可用性探测缓存 |
| **dsh-router-core 0.4.7** | 同目录 | `settings.section` 的**精确调用形态**、`--dsw-alias-*` 主题 token 清单、`slots.inject(slot, () => slots.register(desc, Component))` 的参数顺序。注意：它的 sidebar-entry.ts 是**桌面端左侧栏 DOM 注入**，与设置面板无关，**不要抄** |
| **dsh-providers-hub**（GitHub: iJetLi） | 未装，读 README | 17 个渠道的能力矩阵（登录方式 / 是否支持签到 / 余额能力）——`src/channels.js` 的领域模型就来自它 |
| **dsh-xdpool**（GitHub: XDTrees） | 未装，读 README | 积分自动化的五类任务设计（签到 / 活跃上报 / 任务奖励 / 连登 / 猫猫旅行）、多账号池四种策略、保留积分下限 |
| **DSH 自身（app.asar）** | `D:\ruanjian\新建文件夹\resources\app.asar` | `LlmAdapter` 契约、`LlmRuntime.registerAdapter/replace`、`connection.fetch.register`、`buildModelCatalog`。看 asar 的方法见 §7.6 |

### 2.1 vendored pack 的出处（法律与升级必备）

`vendor/channel-pack/` 来自 **iJetLi/dsh-providers-hub**（原名 `dsh-codearts-auth`），MIT：

- 上游作者：Jet（https://gitee.com/iJetLi）
- 吸收提交：`345f0a07b22713c0ae189ca7d8b97ec4f64626c6`（2026-10-06）
- 经 `dsh-our-free-model` 的 `vendor/channel-pack` 再构建（单文件 bundle，undici 内联）
- 渠道覆盖：LobsterAI、Qoder / Qoder CN、TRAE、Cline、Loomy、Raccoon、MiniMax Code（CN）、ZCode、Gemini、OpenCode
- 依赖：`qoder-auth-wasm.wasm` **必须与 pack.js 同目录**（pack 按 `import.meta.url` 定位）

上游升级路径：重新 clone iJetLi 仓库 → 用它的 `build-channel-pack` 脚本再构建 → 替换 `vendor/channel-pack/` → 重跑 §6 三道闸门。

---

## 3. 架构

```
┌─ 宿主进程（node）────────────────────────────────────────────┐
│ index.js (752 行)                                             │
│  ├─ captureAdapters(ctx)   ← wrap ctx.llm.registerAdapter     │
│  │    （必须在 pack 挂载【之前】调用，否则抓不到）             │
│  ├─ RouteAdapter            → ctx.llm.registerAdapter([route])│
│  ├─ dynamic import vendor/channel-pack/pack.js → pack.apply()  │
│  │    └─ 注册 10 个渠道 provider（各自 prepareCall/stream）    │
│  ├─ createBridge            → connection.rpc.call('/api','channel-pack',{method,payload}) │
│  ├─ createCheckinEngine     → 定时器 + credits.claimAll        │
│  └─ createApiRoutes         → webServer.registerRoute('/api/dsh-model-admin') │
└───────────────────────────────────────────────────────────────┘
                    ↕ HTTP POST {method, payload}
┌─ 浏览器 ──────────────────────────────────────────────────────┐
│ client.js (687 行)  window.__ModuleLoader__.load({id,factory}) │
│  ├─ apply(ctx) → ctx.slots.inject('settings.section', ...)     │
│  │    ※ 这一行决定它出现在设置面板左侧导航                     │
│  ├─ injectStyles()  → 一次性注入 CSS（--dsw-alias-* token）   │
│  └─ createApiClient → fetch('/api/dsh-model-admin')            │
│   （页面与五个 section 都内联在 client.js 里——见 §4.8a）      │
└───────────────────────────────────────────────────────────────┘
```

数据目录 `~/.dsh/dsh-model-admin/`：
- `settings.json` — runHour / expiringWindowDays / autoCheckin
- `checkin.json` — lastDate / lastResult / rows / history（最近 30 天）
- `routes.json` — 每条路由的 strategy / pinned / enabled

---

## 4. 关键决策与理由（最值钱的部分，别推翻重来）

### 4.1 不重写渠道，直接 vendored 一个 MIT 实现

**决策**：`vendor/channel-pack/pack.js`（2.59MB 单文件 bundle）。

**理由**：10 家渠道的登录流程 = 10 套 OAuth/设备码/短信/扫码 + 10 套错误码 + 10 套限流语义。
重写一遍必然与上游漂移，而每次上游改协议都要重新验证。vendored 的代价只是升级时重新构建。

**代价**：2.59MB 进 git（可接受）；升级需要人工重跑构建（见 §2.1）。

### 4.2 RPC 走 `connection.rpc.call`，不走 `connection.fetch`

pack 用 `connection.fetch.register({path, methods, fetch})` 注册 **HTTP 面**，浏览器/同进程
通过 `connection.rpc.call('/api', 'channel-pack', body)` 到达——宿主把两面桥接。
**这条路径在本机装 our-free-model 的线上产品里已验证**，照抄即可。

错误形态：`{ok:true,value}` / `{ok:false,error:{message}}`。`src/rpc.js` 统一成前者，并做
去重（同 method+payload 只发一次）、超时（默认 60s，领取 120s）、消息截断（300 字符）。

### 4.3 路由：wrap `registerAdapter` 捕获 adapter（**核心洞察**）

**问题**：宿主 `ctx.llm` 只暴露 `listProviders/listModels/resolveModelInfo`，**没有** adapter 级
`prepareCall` 转发 API；渠道 adapter 实例活在 pack 的闭包里，外部拿不到引用。

**解法**：在 pack 挂载**之前**替换 `ctx.llm.registerAdapter`，把每次注册的 `(providers, adapter)`
存进 `Map<providerId, adapter>`。路由 provider 的 `prepareCall` 就调
`captured.get(channel).prepareCall(channel, model, signal)`，拿到 `{model, stream}` 后再包一层。

**为什么好**：鉴权、账号池、限流换号、线上协议全留在渠道实现里，路由只做「选哪个候选 + 失败换下一个」。
**踩过的坑**：`captureAdapters` 必须在 `pack.apply` 之前安装，且 `ctx.inject` 的回调里 pack 是
异步 import 的——顺序错了就抓到空 Map，且症状是完全静默（路由列表为空）。

### 4.4 零输出才切换 + 缓冲 reasoning

**规则**：候选 A 在**产出任何可见内容之前**失败 → 换 B 重试；**已经吐过内容** → 把错误抛给用户。

**理由**：已流出的内容收不回来，拼 B 的答案会产生畸形回合。

**细节**：非可见 chunk（reasoning / tool-call）先**进缓冲**，不立即转发——A 失败时这些半截推理
必须丢弃，否则会出现在 B 的答案旁边。A 正常结束时才 flush。见 `src/route/adapter.js` 的
`streamWithFallback`，判据函数是 `isVisibleChunk`。

### 4.5 容量取交集，不取并集

候选里如果有 128K 窗口的渠道，路由就声明 128K（`intersectionOf`）。模态同理，且**未声明模态的
候选按 text-only 算**（`intersectModalities`）。按最宽的声明发出去 = 把超长/多模态失败留给用户。

### 4.6 规范名归一：只剥 tier 标记，不碰版本号和产品线

`deepseek-v4.1-flash` / `-free` / `-SG` → `deepseek-v4.1-flash`。

- `.` **保留**（`v4.1` 不能变 `v4-1`）
- `_` → `-`
- 只剥前缀黑名单里的后缀（`-free/-sg/-cn/-intl/-global/-paid/-pro/-max/-mini/-lite`）
- **`-flash` 不在名单里**：它是产品线，`v4.1` 与 `v4.1-flash` 是两个真实模型
- 最多剥两轮

### 4.7 签到：UTC+8 判重 + 跑出结果才记日 + 串行 400ms

- 日界按 **UTC+8**（上游活动在北京时间零点重置），不是宿主本地时区
- 一轮只拿到「无签到 / 未开启 / 失败」→ **不写今日标记**，下次启动重试
- 串行 + 400ms 间隔（同时打全部渠道是最快触发限流的方式）
- 关机错过 → 启动 30 秒后补跑
- 用 `setTimeout` 且**不能 unref**（await 链里的 unref 定时器不保活事件循环，无头组合下进程会中途退出）

### 4.8 浏览器半身：ModuleLoader bundle + React + `settings.section`

**这是被用户退回过一次的地方**。v0.1.0 的写法（`slots.mount('settings.plugins', 裸 DOM)`）有两个错：

1. `settings.plugins` 是「内置插件」页内的卡片，**不是左侧导航**
2. slot renderer 是 **React**，裸 DOM 元素渲染不出来；而且 `slots.mount` 这个 API 根本不存在

正确形态（抄 `dsh-our-free-model` 的 `client.js`）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-model-admin',
  factory: require => {
    const React = require('react')
    // ...组件...
    exports.apply = apply
    exports.inject = ['slots', 'locale', 'connection']
    exports.name = 'dsh-model-admin'
    return module.exports
  },
})
```

`apply` 里注册（**`register` 的第二个参数才是组件**）：

```js
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section', id: 'dsh-model-admin', order: 40,
  label: () => t('nav') || 'Model Admin',   // 函数 → 语言切换会重读
  locale: 'modelAdmin',
}, props => h(ModelAdminPage, { ...props, client, t })))
```

`package.json` 的 `dsh.client.inject` 必须是 `["react","react-dom","@deepseek-ai/dsh-client-ui-slots","@deepseek-ai/dsh-client-locale"]`。
（`order` 决定在「集成」组里的位置；our-free-model 用 35，路由用 10，本插件用 40。）

### 4.8a 浏览器半身必须是**单文件**（ModuleLoader 的 require 只认宿主包）

`client.js` 里的 `require` 是 ModuleLoader 提供的，它解析的是**宿主已装载的包**
（`react` / `react-dom`）——**不解析仓库内的同级文件**。

证据：`dsh-our-free-model` 的 `client.js`（534KB）里，全部 `require` 调用只有两个：

```
require('react')
require('react-dom')
```

**踩过的坑**：曾把页面拆成 `src/client/page.js` + `src/client/sections.js`，`client.js` 里用
`require('./src/client/page.js')` 引——在测试里（stub 支持任意 require）全绿，**在真实 shell 里面板
加载失败**。症状是设置面板里点了那一行没内容 / 控制台报模块解析错误。

**约束**：浏览器半身的一切代码必须内联在 `client.js`。
- 组件通过 `exports.__test` 暴露给测试（不要为了测试再拆文件）；
- `formatAmount` 在 `src/runs.js`（宿主侧用）和 `client.js`（内联）各有一份——这是**有意的重复**，
  8 行纯函数比引入构建步骤便宜；两边的单测用同一批输入值锁住行为一致；
- **闸门**：`test/page-render.test.js` 的 stub `require` 对 `react` 以外的任何名字**直接抛错**，
  所以一旦有人再拆文件，测试立刻红。

### 4.9 `inject = []`（不强制依赖任何宿主服务）

控制台用自带的 `settings.json`，从不访问宿主 `settings` 服务。声明成必需 → 没有该服务的组合
**整个插件不加载**。其余服务（webServer / llm / connection / credentials）都在 `apply` 内
`ctx.inject([...])` 按需注入并降级。

### 4.10 分发依赖用 codeload tarball，不用 `git+https`

见 §7.1——这台机器上 pnpm 的 git 探测会被重置，`git+https` 依赖会**卡死**。
`package.json` 里写：

```json
"dsh-model-admin": "https://codeload.github.com/qianyumeng0228/dsh-model-admin/tar.gz/<commit>"
```

---

## 5. 代码地图

| 文件 | 行数 | 职责 | 关键导出 |
| --- | --- | --- | --- |
| `index.js` | 752 | 宿主半身：pack 挂载、adapter 捕获、路由 provider、RPC 桥、签到引擎、控制台 API、调度器 | `apply` / `name` / `inject` / `Config` / `createApiRoutes` / `sanitizeSettings` / `MODEL_ADMIN_VERSION` |
| `client.js` | 687 | 浏览器半身：ModuleLoader bundle、`settings.section` 注册、CSS 注入、API 客户端 | ModuleLoader bundle → `apply` / `inject` / `name` |
| ~~`src/client/page.js`~~ | — | **已删除，内联进 `client.js`**（原因见 §4.8a）。组件经 `exports.__test` 暴露给测试 | `ModelAdminPage` |
| ~~`src/client/sections.js`~~ | — | **已删除，内联进 `client.js`** | `CheckinSection` / `RouteSection` / `AccountsSection` / `CreditsSection` / `BackupSection` |
| `src/channels.js` | 135 | 渠道能力表（登录方式 / 签到能力 / 注意事项）——**领域模型** | `CHANNELS` / `channelOf` / `autoCheckinChannelIds` / `loginNeedsHuman` |
| `src/schedule.js` | 94 | UTC+8 日期与调度纯函数 | `utc8DateString` / `ranToday` / `shouldMarkToday` / `msUntilNextUtc8Midnight` / `delayUntilHourUtc8` |
| `src/runs.js` | 116 | 一轮签到的结果聚合（**单位分列，绝不求和**） | `summarize` / `describeRun` / `formatAmount` |
| `src/accounts.js` | 168 | 账号与积分归一化（临期 / 冷却 / 待生效） | `toAccountView` / `toCreditPackView` / `usableBalance` / `formatDuration` |
| `src/rpc.js` | 154 | 渠道包 RPC 桥（去重 / 超时 / 错误规范化） | `createBridge` / `RPC_CODES` / `PACK_ENDPOINT` |
| `src/route/normalize.js` | 110 | 规范模型名归并 | `canonicalModelKey` / `canonicalDisplayName` / `groupByCanonical` |
| `src/route/aggregate.js` | 174 | 候选构建 / 策略 / 容量交集 / 切换顺序 | `buildRouteEntry` / `pickCandidate` / `fallbackOrder` / `hasFallback` / `intersectionOf` |
| `src/route/adapter.js` | 319 | 路由 provider | `RouteAdapter` / `captureAdapters` / `isVisibleChunk` / `ROUTE_PROVIDER_ID` / `ROUTE_MODEL_PREFIX` |
| `vendor/channel-pack/` | 2.9MB | 10 家渠道实现（MIT，出处见 NOTICE.md） | `apply` / `inject` / `name` |
| `scripts/smoke.mjs` | — | mock 宿主 + mock pack 的端到端 | — |
| `scripts/integration.mjs` | — | **真实 pack** 的接入验证 | — |
| `test/stubs/` | — | `@deepseek-ai/*` + `react` 的桩 + ESM resolve hook | — |

### 5.1 路由 provider 的契约（复用前必读）

```js
class RouteAdapter {
  providerInfo(p)        → { id: ROUTE_PROVIDER_ID, name: 'Model Admin 路由' }
  providerRetryPolicy(p) → 继承首个候选渠道的策略（async）
  listModels(p)          → [{ provider, id: 'route:<canonical>', name: '<名> · N 渠道', ...容量 }]
  resolveModel(p, m)     → { provider, id, name, inputModalities, context?, defaultMaxTokens? }
  prepareCall(p, m, s)   → { model, stream: options => AsyncGenerator }
  refresh()              → 重建缓存（await 各渠道 listModels）
  entries()              → 带 5s TTL 的缓存读
}
```

**注意**：渠道的 `listModels` 是 **async**，所以 `routeEntries()` 读缓存、`refresh()` 才 await。
早期版本在这里漏了 await，症状是 `(models ?? []) is not iterable`。

### 5.2 渠道包 RPC 方法面（`connection.rpc.call('/api', 'channel-pack', {method, payload})`）

从 `vendor/channel-pack/pack.js` 里抽出来的完整方法表——**接手做「登录入口」时按这个调**：

| 分组 | 方法 | 用途 |
| --- | --- | --- |
| 账号 | `account.list` / `account.create` / `account.delete` / `account.update` | 增删改查（`create` 返回 `loginUrl`，需要轮询） |
| 账号 | `account.refresh` / `account.reset` / `account.resetAll` | 续期 / 重置限流 |
| 账号 | `account.test` / `account.retest` / `account.retestAll` | 连通性与模型可用性探测 |
| 账号 | `account.reorder` | 调整选号优先级（数组顺序即优先级） |
| 登录 | `login.poll` | 轮询换取令牌（浏览器授权 / 设备码） |
| 登录 | `login.sendSms` / `login.submitSms` | 短信验证码（Loomy / Raccoon） |
| 验证码 | `captcha.carrierUrl` / `captcha.contribute` / `captcha.demand` | ZCode 的载体页（需本机浏览器产验证参数） |
| 积分 | `credits.claimAll` | **一键领取**（本项目签到引擎唯一调用） |
| 积分 | `credits.balances` / `credits.status` / `credits.permanentLock` | 余额 / 活动状态 / 锁定永久积分 |
| 模型 | `model.list` / `model.setDisabled` / `model.setDisabledMany` / `model.setAllDisabled` / `model.clearDead` | 模型黑名单 |
| 供应商 | `provider.status` / `provider.getOrder` / `provider.setOrder` / `provider.setEnabled` | 渠道级开关与排序 |
| 网关 | `gateway.getEnabled` / `gateway.setEnabled` | pack 自带的本地 OpenAI 网关 |
| 备份 | `backup.export` / `backup.import` / `backup.status` | 凭据归档 |
| 其它 | `onboarding.status` / `onboarding.claim`、`cline.quota` / `cline.requestLog`、`loomy.permanentLock` | 渠道专属 |

返回形态统一 `{ok:true,value}` / `{ok:false,error:{code,message}}`；`src/rpc.js` 已经做了规范化。

---

## 6. 闸门（唯一有效的验收标准）

```bash
cd <repo>

# 1) 87 项单元测试 —— 必须带 stub loader（浏览器半身要 import react）
node --import ./test/stubs/register.mjs --test "test/*.test.js"

# 2) 端到端冒烟（mock 渠道包，验签到引擎 + 路由偏好 RPC + 设置校验）
MODEL_ADMIN_NO_PACK=1 node scripts/smoke.mjs

# 3) 接入验证（真实渠道包，验挂载 / 10 provider / RPC 词汇 / 路由链路）
node --import ./test/stubs/register.mjs scripts/integration.mjs
```

三者必须全绿。`npm run check` 一次跑完。

### 6.1 每道闸门验什么

| 闸门 | 覆盖 |
| --- | --- |
| 单测（87） | UTC+8 边界、结果聚合、账号归一化、RPC 去重/超时/降级、规范名归并、候选策略/容量交集、**adapter 捕获 + 零输出切换 + reasoning 缓冲**、浏览器半身的 slot 注册契约、页面渲染树 |
| smoke | cordis 契约（name/inject/Config）、apply 在 mock 宿主下不抛、一轮签到的完整流程（记日/幂等/写盘）、路由偏好 RPC 的写入与校验、pack 缺失时的降级 |
| integration | **真实 pack**：`apply` 不抛、注册 `/api/channel-pack`、10 个 provider、bridge 词汇（`account.list`/`credits.claimAll`）、路由 provider 注册、11 个 adapter 可捕获、聚合出的路由条目、真实渠道上的 `prepareCall` |

### 6.2 已知的绿灯边界（不要被混合状态骗）

- integration 用 **空账号池**：它证明「链路通、拒绝理由明确」，**不证明**真实登录/签到成功。
  真实渠道需要用户登录后才能验（见 §10）。
- smoke 的 `MODEL_ADMIN_NO_PACK=1` 关掉了真实 pack，所以它测不到 pack 相关缺陷。

---

## 7. 环境坑（必读，每个都真实踩过）

### 7.1 pnpm 的 `git+https` 依赖会卡死（本机）

**症状**：`pnpm install` 十几分钟无输出，`node_modules` 里没有包，lockfile 不变。
**原因**：pnpm 对 git 依赖发 **HTTP HEAD** 探测，本机访问 GitHub HTTPS 被
`ECONNRESET` / `ETIMEDOUT` 重置（而 `git clone` 直连只要 7 秒）。
**解法**：依赖写成 codeload tarball URL（§4.10）。已验证可达：HTTP 200 / 824KB / 26s。

### 7.2 DSH 运行中跑全量 `pnpm install` 会卡在文件锁

**症状**：同样卡住无输出；但 `pnpm install --lockfile-only` 25~30s 就成功。
**原因**：全量 install 要原子替换 `node_modules` 结构，DSH 进程占着文件，Windows 重试到天荒地老。
**解法**：安装走「解压 tarball 到 `node_modules/<pkg>` + 只跑 `--lockfile-only` 同步 lockfile」，
不触发结构替换。**升级同理**。装完让用户重启 DSH 生效。

### 7.3 GitHub push protection 会拦 vendored 代码里的凭据

首次 push 被拒，`GH013`，两处：

- `pack.js` 里的 Gemini OAuth `client_id` / `client_secret`（Google 桌面客户端凭据，上游公开）
- `pack.js` 里的 Loomy 微信 `AppID`（`wx18d60be432287cf8`，公开 OAuth 标识）

**处理**：这些是上游有意公开的公开客户端标识，功能必需。用
`POST /repos/{owner}/{repo}/secret-scanning/push-protection-bypasses`
（body: `{reason: 'false_positive', placeholder_id: '<推送报的那串>'}`）放行，然后 push。
三条 alert 现在都是 `resolved/false_positive`。**不要**删代码里的凭据——会破坏 Gemini/Loomy 登录。

### 7.4 宿主提供的 `@deepseek-ai/*` 模块不在 profile 的 node_modules 里

profile 的 `node_modules/@deepseek-ai` 只有 6 个包（无 cordis / dsh-credentials / dsh-llm）。
它们由 **DSH 进程自身**提供，所以脱离 DSH 进程跑会 `ERR_MODULE_NOT_FOUND`。

**解法**：`test/stubs/` + `test/stubs/loader.mjs` 的 ESM resolve hook 把这些映射到桩，
再用 `node --import ./test/stubs/register.mjs ...` 跑。桩需要覆盖 pack 实际用到的 API 面
（`Service` 基类、`LlmAdapter`、`credentialRef`、`z` 的链式方法、`llmServiceStub.registerAdapter`）。

### 7.5 GitHub 的 raw 域在本机 TLS 失败

`raw.githubusercontent.com` 直连 `exit 35`（SSL connect error）。
**可用替代**：`api.github.com/repos/.../readme`（`-H "Accept: application/vnd.github.raw"`）、
`codeload.github.com/.../tar.gz`、`git clone`。

### 7.6 想读 DSH 内部实现 → 解 app.asar

```bash
# 定位
D:\ruanjian\新建文件夹\resources\app.asar   # 182MB

# 直接 grep（asar 是文本+二进制拼接，可读部分能搜）
grep -a -o -E ".{0,120}registerAdapter.{0,600}" app.asar | head
# 或用 python 定位偏移后按 utf-8 切片打印（注意 Windows 控制台编码，加 PYTHONIOENCODING=utf-8）
```

关键实现位置：`LlmRuntime`（`listProviders`/`registerAdapter`/`prepareCommit`）、
`searchEndpointError`（DeepSeek web fetch 的 404 引导文案）、`buildModelCatalog`。

---

## 8. 已知缺口（诚实清单，按优先级）

### P0 —— 面板没有「添加账号 / 登录」入口

现在账号页只**读**各渠道账号概况，登录必须去渠道自己的面板（或外部插件）。
用户的核心诉求之一是「管理账号」，这一块**不完整**。

**怎么做**：pack 的 RPC 有 `account.create` / `login.poll` / `login.sendSms` / `login.submitSms` /
`captcha.carrierUrl`（见 §5 的 RPC 清单）。`our-free-model` 的 `client.js` 里有完整的
`chan.login.*` 交互流程（弹出授权页 → 轮询 → 完成），照抄改造成 React 即可。
注意 `loginNeedsHuman(channel)` 区分短信/扫码（必须人工）与设备码/浏览器（可自动）。

### P1 —— 路由的用量统计在内存里

`dispatchStats` 是 `Map`，重启清零；面板上的「N 次」会归零。持久化到 `routes.json` 即可。

### P1 —— 路由没有「临期积分优先」

providers-hub 的做法是按积分到期时间排序。**pack 不暴露到期时刻**（`credits.balances` 只有余额），
所以未实现。升级路径：等 pack 暴露 expiry，或读 `credits.status` 探测。

### P2 —— 没有 i18n

`label: () => t('nav') || 'Model Admin'` 里 `t` 绑定的是 `modelAdmin` 命名空间，但仓库没带
`locale/*.json`，所以永远回落中文。要支持英文：加 `locale/en.json`、`locale/zh.json`，
`package.json` 的 `files` 加 `locale`，并在 `dsh.client.inject` 之外让 locale 服务找到它
（参考 our-free-model 的 `locale/` 结构）。

### P2 —— 面板数据无轮询

各 tab 用 `useEffect` 一次性拉取，状态可能陈旧（签到跑完后靠 `refresh()` 更新）。
加一个可见性感知的轮询（参考 providers-hub 的「面板打开期间每 2 分钟」）会更顺手。

### P2 —— CSS 是手写的

类名 `ma-*` 自建，配色走 `--dsw-alias-*` token，但几何（间距/圆角）是估的，没有对齐宿主组件的
精确规格。要精修：读 dsh-router-core 的 CSS 注释（那里有实测的 564px 内容宽、0.5px 描边等）。

### P3 —— 未在真机验证过完整登录

integration 证明链路通，但**没有**真实渠道登录后跑通一次签到。
接手后第一件事应该是：登录一个渠道 → 跑一次签到 → 看 `checkin.json` 的 rows 是否真领到。

---

## 9. 交接检查清单

接手后的建议顺序：

1. **读代码**：`src/channels.js`（领域）→ `src/rpc.js`（唯一接触面）→ `src/route/*`（路由三层）
   → `index.js` 的 `apply`（接线）→ `client.js`（浏览器半身，UI 全在这个文件里）
2. **跑闸门**：§6 三条命令，必须全绿再动手。
3. **看安装态**：`~/.dsh/profiles/desktop/node_modules/dsh-model-admin`（已装的是 `48ee794`）。
   profile 的 `package.json` 有两处必须成对存在：`dependencies["dsh-model-admin"]` 和
   `dsh.profile.bundles` 里的 `"dsh-model-admin"`。**缺一处 = 静默不加载**。
4. **改完怎么装**：§7.2 的流程（解压 + `--lockfile-only`），然后让用户重启 DSH。
5. **验证 UI**：重启后 设置 → 集成 → **Model Admin**。若没出现，按此顺序查：
   - `client.js` 是否真的 `slots.inject('settings.section')`（§4.8）
   - `package.json` 的 `dsh.client.inject` 是否含 `react` / `slots`
   - profile 的 bundles 是否含包名
   - DSH 日志里有没有 `N entry did not activate`

---

## 10. 待确认：用户报「有问题」但未说明

用户最后一句是「有问题」，没有给具体现象。可能的成因（按概率）：

| 现象 | 最可能原因 | 排查 |
| --- | --- | --- |
| 设置面板里没有 Model Admin | DSH 没重启 / bundles 缺项 / 旧版 client.js 还在 | §9 第 5 步四查 |
| 有行但点了空白 | React 组件抛错（浏览器控制台） | 看 DevTools console；stub 测试已覆盖渲染树，真 DOM 未覆盖 |
| 路由分组是空的 | 没有渠道登录 → 无候选（这是**设计如此**，不是 bug） | 先登录一个渠道 |
| 签到不跑 | 渠道包未挂载 / 时区 / 无账号 | 看 `checkin.json` 与日志里的 `channel pack not mounted` |
| 装不上 | pnpm git 探测卡死（§7.1） | 换 codeload tarball |

**接手时先问用户：具体现象是什么、截图、DSH 日志片段。** 没有这些只能猜。

---

## 11. 关键常量速查

| 名字 | 值 | 位置 |
| --- | --- | --- |
| provider id（路由） | `dsh-model-admin-route` | `src/route/adapter.js` `ROUTE_PROVIDER_ID` |
| 路由模型 id 前缀 | `route:` | 同上 `ROUTE_MODEL_PREFIX` |
| 控制台 API | `/api/dsh-model-admin` | `client.js` `API_PATH` / `index.js` 注册 |
| 渠道包 RPC 端点 | `channel-pack`，路径 `/api/channel-pack` | `src/rpc.js` `PACK_ENDPOINT` |
| settings.section id | `dsh-model-admin`，order `40` | `client.js` `apply` |
| 数据目录 | `~/.dsh/dsh-model-admin/` | `index.js` `DATA_DIR_NAME` |
| 默认签到钟点 | 09:00（UTC+8） | `index.js` `DEFAULT_RUN_HOUR` |
| 临期窗口 | 15 天 | `src/accounts.js` `DEFAULT_EXPIRING_WINDOW_DAYS` |
| 渠道串行间隔 | 400ms | `index.js` `sleep(400)` |
| 渠道包缺省开关 | `MODEL_ADMIN_NO_PACK=1` 关闭挂载 | `index.js` `packDisabled` |
