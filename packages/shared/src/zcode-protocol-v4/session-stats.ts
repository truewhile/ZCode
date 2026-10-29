// 会话统计（composer 统计条）的纯累计函数。
//
// 事实归属：CLI 的 ProductProjection 是唯一所有者，本文件只提供不持有状态的加法，
// 让投影在各自的 reducer 分叉点调用；renderer 不重算、不扫描 rows 窗口。
// 规格见 docs/chat/composer-session-stats.md。
import type { SessionStatsState } from "./snapshot.js";

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 一次可见用户意图轮（product turn 边界）。 */
export function addTurnToStats(stats: SessionStatsState): SessionStatsState {
  return { ...stats, turns: stats.turns + 1 };
}

/** 一次主链路模型往返（step）。由 ModelComplete 累计，冷恢复重放时同样重建。 */
export function addStepToStats(stats: SessionStatsState): SessionStatsState {
  return { ...stats, steps: stats.steps + 1 };
}

/**
 * 一次主链路模型请求的计时样本：请求总时长 / 首 token / 解码区间。
 *
 * 只由 ModelNetworkStatus(main_turn) 累计——该事件不进 transcript，冷恢复后这些
 * 字段归零、速度读数隐藏（见 docs/chat/composer-session-stats.md）。
 *
 * 解码区间 = 请求总时长 - 首 token 时长。首 token 缺失或晚于总时长时无法切分，
 * 该样本只计入 modelMs，不污染速度读数——宁可少一个样本，也不伪造速度。
 */
export function addModelRequestTimingToStats(
  stats: SessionStatsState,
  input: {
    durationMs?: number;
    timeToFirstContentMs?: number;
    outputTokens?: number;
  },
): SessionStatsState {
  const durationMs = nonNegative(input.durationMs);
  const ttftMs = nonNegative(input.timeToFirstContentMs);
  const outputTokens = nonNegative(input.outputTokens);
  const decodeMs = durationMs > 0 && ttftMs > 0 && durationMs > ttftMs ? durationMs - ttftMs : 0;
  const countedTtft = ttftMs > 0 && durationMs > 0;
  if (durationMs === 0) return stats;
  return {
    ...stats,
    modelMs: stats.modelMs + durationMs,
    ttftMs: stats.ttftMs + (countedTtft ? ttftMs : 0),
    ttftCount: stats.ttftCount + (countedTtft ? 1 : 0),
    decodeMs: stats.decodeMs + decodeMs,
    decodeTokens: stats.decodeTokens + (decodeMs > 0 ? outputTokens : 0),
  };
}

/** 一次工具执行的实际耗时（结束时间 - 开始时间）；非法值不改统计。 */
export function addToolDurationToStats(
  stats: SessionStatsState,
  durationMs: number | undefined,
): SessionStatsState {
  const value = nonNegative(durationMs);
  return value > 0 ? { ...stats, toolMs: stats.toolMs + value } : stats;
}

/** 输出速度（tok/s）；无有效解码样本时为 null，UI 隐藏该读数。 */
export function resolveStatsTokensPerSecond(stats: SessionStatsState | null): number | null {
  if (!stats || stats.decodeMs <= 0 || stats.decodeTokens <= 0) return null;
  return stats.decodeTokens / (stats.decodeMs / 1000);
}

/** 平均首 token 时长（ms）；没有样本时为 null。 */
export function resolveStatsAverageTtftMs(stats: SessionStatsState | null): number | null {
  if (!stats || stats.ttftCount <= 0) return null;
  return stats.ttftMs / stats.ttftCount;
}
