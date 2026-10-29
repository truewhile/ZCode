import type { SessionStatsState, SessionUsageState } from "@zcode/shared/zcode-protocol-v4";

/** 统计条可展示事实；任一字段为 null 表示该读数不可展示。 */
export interface ComposerSessionStatsReadings {
  turns: number;
  steps: number;
  /** 输出速度（tok/s）；无有效解码样本时为 null。 */
  tokensPerSecond: number | null;
  /** 累计 token（输入含 cache 读/写 + 输出）；无累计事实时为 null。 */
  totalTokens: number | null;
  /** 缓存命中率（0..1）；没有输入侧计费 token 时为 null。 */
  cacheHitRate: number | null;
  /** 平均首 token 时长（ms）；无样本时为 null。 */
  averageTtftMs: number | null;
  modelMs: number;
  toolMs: number;
}

/** 统计条整行是否需要渲染：没有任何轮/步事实时不占位。 */
export function hasComposerSessionStats(
  readings: ComposerSessionStatsReadings | null,
): readings is ComposerSessionStatsReadings {
  return readings !== null && (readings.turns > 0 || readings.steps > 0);
}

function finiteNonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 从投影事实解析统计条读数。
 *
 * 归属：CLI 投影已算好 turns/steps/计时；renderer 只做展示口径换算，
 * 不重扫 rows 窗口、不重算 token（累计值来自 usage.cumulative）。
 */
export function resolveComposerSessionStatsReadings(
  stats: SessionStatsState | null | undefined,
  usage: SessionUsageState | null | undefined,
): ComposerSessionStatsReadings | null {
  if (!stats) return null;
  const turns = finiteNonNegative(stats.turns);
  const steps = finiteNonNegative(stats.steps);
  if (turns === 0 && steps === 0) return null;

  const decodeMs = finiteNonNegative(stats.decodeMs);
  const decodeTokens = finiteNonNegative(stats.decodeTokens);
  const tokensPerSecond =
    decodeMs > 0 && decodeTokens > 0 ? decodeTokens / (decodeMs / 1000) : null;

  const cumulative = usage?.cumulative;
  const inputTokens = finiteNonNegative(cumulative?.inputTokens);
  const outputTokens = finiteNonNegative(cumulative?.outputTokens);
  const cacheReadTokens = finiteNonNegative(cumulative?.cacheReadTokens);
  const totalTokens = inputTokens + outputTokens > 0 ? inputTokens + outputTokens : null;
  // 命中率分母必须与 adapter 的 input 口径一致：inputTokens 已含 cache read/write，
  // 再加 cacheWrite 会重复放大分母、把命中率算小。
  const cacheHitRate =
    inputTokens > 0 && cacheReadTokens > 0 ? cacheReadTokens / inputTokens : null;

  const ttftCount = finiteNonNegative(stats.ttftCount);
  const ttftMs = finiteNonNegative(stats.ttftMs);

  return {
    turns,
    steps,
    tokensPerSecond,
    totalTokens,
    cacheHitRate,
    averageTtftMs: ttftCount > 0 && ttftMs > 0 ? ttftMs / ttftCount : null,
    modelMs: finiteNonNegative(stats.modelMs),
    toolMs: finiteNonNegative(stats.toolMs),
  };
}

/**
 * 命中率文案：整数四舍五入仍低于 100% 时用整数，否则加小数位避免显示成 100%
 * 却未完全命中（与 context 面板同一取舍）。
 */
export function formatCacheHitPercent(rate: number): number {
  const percent = rate * 100;
  const rounded = Math.round(percent);
  return rounded >= 100 && percent < 100 ? Math.round(percent * 10) / 10 : rounded;
}
