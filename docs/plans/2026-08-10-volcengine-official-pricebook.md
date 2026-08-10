# 火山引擎官方价目配置记录

## 本次已发布的运行时价格

计费账本以整数积分记账；**100 积分 = 1 元人民币**。数据库不保存小数积分：按百万 token 的费率以积分整数保存，按量结算使用整数乘除和四舍五入。

| 服务 | 模型 | 计量器 | 单价 |
| --- | --- | --- | ---: |
| image | `doubao-seedream-5-0-260128` | image | 22 积分/张 |
| storyboard_image | `doubao-seedream-5-0-260128` | image | 22 积分/张 |
| video | `doubao-seedance-2-0-260128` | input_token | 含视频输入 2800；无视频输入 4600 积分/百万 token；1080P 为 3100 / 5100 |
| video | `doubao-seedance-2-0-fast-260128` | input_token | 含视频输入 2200；无视频输入 3700 积分/百万 token |
| video | `doubao-seedance-1-5-pro-251215` | input_token | 无声视频 800；有声视频 1600 积分/百万 token |
| text | `doubao-seed-2-1-pro-250528` | input_token / output_token | 600 / 3000 积分/百万 token |
| text | `doubao-seed-2-1-turbo-250528` | input_token / output_token | 300 / 1500 积分/百万 token |
| text | `doubao-seed-2-0-lite-260428` | input_token / output_token | 60 / 360 积分/百万 token（上下文 ≤32K） |
| tts | `doubao-tts-2-0` | character | 500 积分/10,000 字符 |

价格来源：火山方舟[模型价格文档](https://www.volcengine.com/docs/82379/1544106?lang=zh)和[豆包模型公开价格总览](https://www.volcengine.com/product/yunque)；采用公开按量基础价格，不采用未经确认的合同价或资源包折扣。

## 结算闭环与接入约束

- 图片：按供应商成功的实际生成张数结算；失败释放预授权。
- 文本/视觉文本：先冻结输入字节上界和有限的输出 token 上限，读取供应商响应（SSE 末事件或非流式 JSON）的 `usage` 后按实际输入/输出 token 结算；供应商成功但未返回 `usage` 时保留冻结并进入待对账，绝不按估算值扣费。
- TTS：按实际提交给供应商的 Unicode 字符数预授权并结算；失败或写入失败释放预授权。
- 视频：配置 `billing_reserve_input_tokens` 后才允许以 token 价目提交。任务轮询返回真实 `usage` 时结算；供应商成功但未返回该字段则保留预授权并进入待对账，不把视频秒数伪换算为 token。待对账默认 24 小时：管理员可凭可核验用量结算或明确豁免；超时自动释放，同时写入异常损失审计。每用户、每模型累计 3 笔待对账即暂时限流。

## 未直接配置为运行时扣费的已启用模型

| 模型 | 原因 | 当前处理 |
| --- | --- | --- |
| 已配置的 Seedance 视频模型 | 官方价格按 token 并依输入形态变化，部分供应商任务查询接口未返回 `usage`。 | 已支持真实用量解析；未返回时成功视频会完成但预授权保持冻结，进入管理员待对账队列，不能将秒数伪换算为 token。 |

这不是免费策略：系统的“未定价即拒绝、无精确用量不扣费”保护保持开启。价目条件已支持分辨率、是否含视频输入及有声状态。
