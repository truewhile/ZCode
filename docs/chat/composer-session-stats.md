# Composer 会话统计条（轮/步 · tok/s · 累计 token · 缓存命中）

## 背景

DSH 在输入框下方常驻一条会话统计：`1 轮 29 步 · 116 tok/s`、`1.8M tok · 缓存命中 95%`，
点击可展开模型用时、工具用时、首 token 平均与输出速度。ZCode 目前只有 context 圆环
（`ChatContextUsage`）与设置页的历史用量，会话进行中的"轮/步/速度/累计 token/命中率"不可见。

本文件定义 ZCode 侧的同位能力：**composer 下方一行统计 pill，数据全部来自 v4 会话投影**，
不新增客户端查询、不在 renderer 侧扫描截断后的 rows 窗口。

## 数据归属（唯一所有者）

统计事实由 CLI 的 `ProductProjection` 唯一持有，通过 v4 snapshot / delta 的
`stats` 键下发（additive，带 default，旧客户端忽略、旧 CLI 缺省时 UI 不渲染）。

| 字段 | 语义 | 累计点 |
| --- | --- | --- |
| `turns` | 用户意图轮数（product turn 边界） | `onTurnStarted` 且 `visibility === "visible"` |
| `steps` | 模型往返次数（一次 request = 一个 step） | `onModelComplete` 且 `isMainTurn` |
| `modelMs` | 主轮模型请求总时长 | `model_request_completed`（main_turn）的 `durationMs` |
| `ttftMs` / `ttftCount` | 首 token 时长与其样本数 | 同上，`timeToFirstContentMs` |
| `decodeMs` / `decodeTokens` | 首 token 之后到请求结束的时长与输出 token | `durationMs - timeToFirstContentMs`、`usage.outputTokens` |
| `toolMs` | 工具执行时长 | `ToolCallResult` / `ToolCallError` 时 `endedAt - startedAt` 累计 |

输出速度 `tps = decodeTokens / (decodeMs / 1000)`，仅当 `decodeMs > 0` 时展示。

**冷恢复边界**：`turns` / `steps` 由 transcript 重放（`TurnStarted` / `ModelComplete`）
自动重建，刷新后仍然正确。`ModelNetworkStatus` 不进入 transcript，因此 `modelMs` /
`decodeMs` 在冷恢复后为 0，速度读数隐藏——不做 DB 旁路查询，避免为一条展示统计新增
第二条会话事实源。这是已知且被接受的偏斜，与 DSH 的 live 投影口径一致。

**缓存命中率与累计 token** 不进入 `stats`，直接复用既有 `usage.cumulative`
（`inputTokens` 已含 cache read/write，口径由 adapter 归一化）：

- 累计 token = `cumulative.inputTokens + cumulative.outputTokens`
- 命中率 = `cumulative.cacheReadTokens / cumulative.inputTokens`，`inputTokens === 0` 时不展示

## UI 契约

- 位置：`ConversationComposer` 输入 surface 之后的一行（`data-composer-stats`），
  与输入卡左对齐，桌面与手机 Web 共用同一 DOM 顺序。
- 两个 pill：`activity`（轮/步 · tok/s）与 `usage`（累计 token · 缓存命中）。
  pill 只在有可展示事实时渲染；`turns === 0 && steps === 0` 时整行不渲染。
- 点击 pill 打开浮层明细（`session stats`），Escape 与外部点击关闭；同一时刻只开一个。
- 字体使用 `text-ui-*` 语义档位（`text-ui-xs` 数值、`text-ui-sm` 标签），不引入任意字号。
- test-id：`TID_V4_COMPOSER_STATS`、`TID_V4_COMPOSER_STATS_ACTIVITY`、
  `TID_V4_COMPOSER_STATS_USAGE`。

## 验收场景

1. 新会话首轮进行中：`1 轮 1 步 · N tok/s`，N 来自首个 completed 请求的 decode 口径。
2. 多轮多请求：轮数只随新的用户输入增长，步数随每次模型往返增长。
3. 缓存命中：`usage.cumulative.cacheReadTokens > 0` 时展示百分比；为 0 时只展示 token 总量。
4. 刷新会话：轮/步保持，速度隐藏，累计 token 与命中率保持。
5. 旧 CLI（snapshot 无 `stats`）：整行不渲染，不影响输入区布局。

## 代码落位

| 层 | 文件 | 职责 |
| --- | --- | --- |
| contract | `packages/shared/src/zcode-protocol-v4/snapshot.ts` | `sessionStatsStateSchema` + `EMPTY_SESSION_STATS`，快照 `stats` 键（default） |
| contract | `packages/shared/src/zcode-protocol-v4/session-stats.ts` | 纯累计函数（轮/步/计时/速度换算），无状态 |
| contract | `packages/shared/src/zcode-protocol-v4/delta.ts` | `StatePatch.stats`（additive optional，不参与 revision 记账） |
| app | `apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts` | 唯一累计点：`onTurnStarted` / `onModelComplete` / `onModelNetworkStatus` / 工具终态 |
| ui | `packages/ui/src/v4/composer/sessionStatsReadings.ts` | 展示口径换算（速度、累计 token、命中率），纯函数 |
| ui | `packages/ui/src/v4/composer/ComposerSessionStats.tsx` | 两个 pill + 明细浮层 |

验证：`apps/zcode-cli/packages/bootstrap/tests/composer-session-stats-projection.test.ts`（投影侧 6 例）、
`packages/ui/test/composerSessionStats.test.ts`（UI 侧 8 例）。
