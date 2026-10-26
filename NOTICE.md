# NOTICE

## dsh-model-admin

本插件自身代码以 MIT 发布（见 `LICENSE`）。

## 内置渠道实现（vendor 来源）

账号登录、账号池、积分领取与自动签到的渠道实现来自
[iJetLi/dsh-providers-hub](https://github.com/iJetLi/dsh-providers-hub)
（原名 `dsh-codearts-auth`，Gitee: https://gitee.com/iJetLi），MIT 许可证，
由 `dsh-our-free-model` 以 `vendor/channel-pack` 形式再构建后随本插件一同
分发；再构建出处：

- 上游作者：Jet（https://gitee.com/iJetLi）
- 吸收提交：`345f0a07b22713c0ae189ca7d8b97ec4f64626c6`（2026-10-06）
- 许可证：MIT

渠道覆盖（内置渠道包注册的 10 个账号 provider）：LobsterAI、Qoder、
Qoder 中国版、TRAE、Cline、Loomy、Raccoon、MiniMax Code（国内版）、
ZCode、Gemini。渠道包同时带 OpenCode 适配器（上游默认关闭匿名通道，
本插件沿用该默认）。WorkBuddy / CodeBuddy 渠道由
[dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)
（dingminhua，MIT）提供，本插件不重复实现，仅在其已安装时汇总其账号状态。

## 使用声明

本项目仅供学习研究使用。请遵守各 AI 服务提供方的服务条款；使用第三方
渠道的一切后果由使用者自行承担。
