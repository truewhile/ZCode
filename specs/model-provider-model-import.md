# 模型列表导入（Provider /models 勾选添加）

状态：已实现（本分支）

## 背景

设置页「添加模型」当前只有一种入口：手工输入模型 ID，再逐项填写上下文窗口、最大输出等元数据。
第三方 API 供应商本身已经通过 `/models`（OpenAI 兼容）或 `/v1/models`（Anthropic Messages）
暴露了可用模型清单，手工抄写既慢又容易把 ID 拼错，第一次保存后还要等连通性测试才能发现。

本次改动让用户在「添加模型」流程里直接读取供应商返回的模型清单并勾选，一次写入多个模型。

## 产品规则

1. **两个入口，默认勾选**：装配了列表能力时，「添加模型」区域同时提供
   「从 API 导入」（主入口，勾选）与「添加模型」（手工填写单个模型 ID，保留给未在清单中
   暴露的私有/灰度模型）。未装配列表能力（例如宿主未注入 lister）的宿主只显示手工入口，
   不出现无法工作的按钮。
2. **读取以已落盘配置为准**：导入前先提交当前 Provider 草稿（Base URL / API 格式 / API Key），
   Host 侧只用 Provider Settings View 的 Effective Config 发起请求，渲染层不另传 Key。
3. **已存在的模型不出现在勾选列表**：当前 Provider 已配置的模型 ID（大小写不敏感）从清单中过滤，
   底部一行提示「已添加的模型不会重复出现在这里」，避免重复勾选后触发 `Model 已存在` 报错。
4. **只新增，不改写**：导入一律按「跟随推荐配置」写入 Personal Overlay（`useRecommendedConfig: true`），
   不改动已有模型的 Personal 配置，也不新增系统字段。
5. **部分失败可见**：批量写入逐个提交；第一个失败即停止，已成功的模型保留，失败原因在弹窗内展示，
   用户可重试剩余模型。

## 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| Provider/模型配置事实 | `providerSettingsService`（Host） | 导入只通过 `addPersonalModel` 写这一份 Overlay |
| 模型清单 | `providerSettingsService.listModels` | 每次打开弹窗按需读取，不缓存、不落盘 |
| 勾选集合 / 加载态 | `ProviderModelPickerDialog`（组件局部） | 纯 UI 意图，关闭即丢弃 |
| 待提交草稿 | `InlineEditableProviderCard` | 导入前由 `commitPendingDraft` 统一 flush |

## 接口

```ts
// @zcode/shared
interface ProviderModelListEntry {
  modelId: string;
  displayName?: string;
  createdAt?: string;
}
type ProviderModelListResult =
  | { success: true; models: readonly ProviderModelListEntry[] }
  | { success: false; error: { message: string; code?: ProviderModelListErrorCode } };

// @zcode/services —— IProviderSettingsService
listModels(input: { providerId: ProviderId }): Promise<ProviderModelListResult>;
```

Host 侧请求路径：

- `api.baseUrl` 路径已带版本段（`/v1`、`/v4` …）→ `{baseUrl}/models`；
- 否则先试 `{baseUrl}/v1/models`，404 时回退 `{baseUrl}/models`。
- 请求头：`anthropic-messages` 先只发 `x-api-key` + `Authorization`，**不带** `anthropic-version`；
  该变体返回 400 时再带 `anthropic-version: 2023-06-01` 重试；其余格式只用 `Authorization: Bearer`。
  Key 经过 `normalizeApiKeyForHeader` 归一化。
  原因（2026-10-29 实测聚合转发站 api.linkmy.fun）：`GET /v1/models` 会按 `anthropic-version`
  切换目录，带该头返回站点自造的倒序别名（`claude-fable-5-dd-arret-1.6-tpg`），不带时返回真实
  模型 ID（`gpt-6.1-terra`）。用户手工 curl 不会带该头，因此必须让首个候选与手工调用同形。

响应解析兼容 `[{id}]`、`{ data: [] }`、`{ models: [] }`、`{ result: [] }`；条目支持字符串或
`{ id | name | model, display_name?, created_at? }`，按出现顺序去重。

## 事件顺序

1. 用户点击「从 API 导入」→ 打开弹窗（`open`）。
2. 弹窗 effect 调用 `onFetch` → `commitPendingDraft("model-import")` 落盘草稿。
3. Host `listModels`：等待该 Provider 未完成的写入队列 → 读 View → 发请求 → 返回清单。
4. 用户勾选 → 点击「添加 N 个模型」→ 逐个 `addPersonalModel`（串行，避免 revision 冲突）。
5. 全部成功后关闭弹窗；失败保留勾选与错误文案。

## 验收场景

| 场景 | 期望 | 不应发生 |
| --- | --- | --- |
| OpenAI 兼容供应商 Base URL 为 `https://api.example.com/v1` | 请求 `https://api.example.com/v1/models`，Bearer 鉴权 | 拼成 `/v1/v1/models` |
| Anthropic Messages 供应商 Base URL 为 `https://api.anthropic.com` | 先不带 `anthropic-version` 请求（400 后带版本头重试成功），返回真实模型 ID | 用 Bearer 而非 `x-api-key`，或只发带版本头的一次请求 |
| 聚合转发站按 `anthropic-version` 切换目录 | 得到真实模型 ID（`gpt-6.1-terra`），不是站点自造别名（`claude-fable-5-dd-arret-1.6-tpg`） | 勾选列表里出现一串前缀相同、名字倒序的假 ID |
| 网关只提供根路径 `/models` | 首个候选 404 后回退成功 | 直接报错 |
| Key 无效（401） | 弹窗显示 HTTP 401 与响应摘要，可重试 | 静默空列表 |
| 清单含已配置模型 | 该模型从可导入列表里过滤，底部提示已添加 | 允许重复添加导致 `Model 已存在` 报错 |
| 勾选 3 个模型后确认 | 3 条 Personal Model 依次写入，均跟随推荐配置 | 只写第一条，或用空配置固定模式覆盖推荐 |
| 第 2 个模型写入失败 | 保留弹窗与勾选，展示失败原因 | 关闭弹窗丢弃用户勾选 |
| 宿主未向卡片装配列表能力 | 只显示手工「添加模型」入口 | 显示一个点了没反应的按钮 |
| 远端宿主 RPC 拒绝 `listModels` | 弹窗内显示可读错误并可重新读取 | 抛出 `is not a function` 之类的原始异常到界面 |

## 回归范围

- 单测：`packages/services/test/providerModelListing.test.ts`（URL/鉴权/解析/回退）、
  `packages/services/test/providerFacadeServices.test.ts`（`listModels` 只读目标环境 Effective Config）、
  `packages/ui/test/providerModelPicker.test.ts`（勾选、已添加过滤、批量写入、失败保留、i18n 对齐）。
- i18n：`settings.modelProvider.importModels*` 需要在 zh-CN 与 en-US 同时存在。
- 手工：桌面深浅主题下弹窗滚动、长模型名换行、窄窗口；手机 Web 布局不溢出。
