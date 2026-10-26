# dsh-model-admin

AI 平台账号与签到管理台（DeepSeek Harness 插件）。

[English](README.en.md) | 中文

统一的控制台，管理多家 AI 编程服务的**登录账号**与**每日签到/积分领取**：
每早自动跑一遍所有支持签到的渠道，逐渠道报告领到了什么；面板汇总各账号
余额、临期积分与运行历史。**不注册任何模型路由**——装它不会改变对话用
哪个模型，它只做账号与签到的管理面。

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

## 四个页面

- **签到**：立即运行 / 今日已跑状态、自动开关、运行时间（UTC+8）、逐渠道
  结果表（已领取 / 今日已领 / 未开启 / 无签到 / 失败 + 详情）。
- **账号**：各渠道账号概况（几个号、几个可用、读取失败原因）。
- **积分**：各账号余额，积分与 Token 分列（两种单位不求和）。
- **备份**：导出含登录凭据的归档。

## 安装

```sh
dsh plugin --profile desktop add <this-repo>
```

或在 profile 的 `package.json` 里加依赖与 bundle（包名 `dsh-model-admin`，
`dsh.profile.bundles` 数组加一项），然后重启 DSH。

安装后在设置面板出现 **Model Admin** 标签页。渠道的登录入口在各渠道自己
的面板（或首次在 Model Admin 里点添加账号时打开）。

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
node --test "test/*.test.js"                    # 46 项单元测试
MODEL_ADMIN_NO_PACK=1 node scripts/smoke.mjs    # 端到端冒烟（mock 渠道包）
node --import ./test/stubs/register.mjs \
     scripts/integration.mjs                    # 接入验证（真实渠道包）
```

接入验证通过 `test/stubs/` 把宿主提供的 `@deepseek-ai/*` 模块换成桩，在
DSH 进程外真实执行渠道包的 `apply`：挂载、注册 10 个 provider、注册
`/api/channel-pack` RPC、bridge 词汇（`account.list` / `credits.claimAll`）
全部走通。

### 布局

```
index.js              宿主半身：挂载渠道包、RPC 桥、签到引擎、控制台 API
client.js             浏览器半身：设置面板入口与 API 客户端
src/channels.js       渠道能力表（登录方式 / 签到能力 / 注意事项）
src/schedule.js       UTC+8 日期与调度纯函数
src/runs.js           一轮签到的结果聚合（单位分列）
src/accounts.js       账号与积分归一化（临期、冷却、待生效）
src/rpc.js            渠道包 RPC 桥（去重、超时、错误规范化）
src/client/panel.js   面板渲染（四页）
vendor/channel-pack/  内置渠道实现（MIT，出处见 NOTICE.md）
```

## 数据

`~/.dsh/dsh-model-admin/`：`settings.json`（运行钟点、临期窗口、自动开关）、
`checkin.json`（今日标记、逐渠道结果、最近 30 天历史）。

## 声明

仅供学习研究使用，请遵守各服务方的服务条款。内置渠道实现来自上游 MIT
项目（见 [NOTICE.md](NOTICE.md)）；使用第三方渠道的一切后果由使用者自行
承担。
