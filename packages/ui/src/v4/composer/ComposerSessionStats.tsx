/* oxlint-disable eslint(max-lines) -- 统计条与两个 pill 的浮层明细共用一个打开状态机，拆分会重复实现「同一时刻只开一个」的约束。 */
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DatabaseIcon, GaugeIcon } from "lucide-react";
import type { Locale } from "@zcode/shared";
import type { SessionStatsState, SessionUsageState } from "@zcode/shared/zcode-protocol-v4";
import {
  TID_V4_COMPOSER_STATS,
  TID_V4_COMPOSER_STATS_ACTIVITY,
  TID_V4_COMPOSER_STATS_USAGE,
} from "@zcode/shared/test-ids";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  formatCacheHitPercent,
  hasComposerSessionStats,
  resolveComposerSessionStatsReadings,
  type ComposerSessionStatsReadings,
} from "@/v4/composer/sessionStatsReadings.js";
import { formatConversationWorkDuration } from "@/v4/conversationWorkDuration.js";

type StatsPillId = "activity" | "usage";

function formatTokens(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatSpeed(locale: string, tokensPerSecond: number): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: tokensPerSecond >= 100 ? 0 : 1,
  }).format(tokensPerSecond);
}

/** 统计条 pill：纯展示，点击由外层决定是否可展开。 */
function StatsPill({
  id,
  icon,
  label,
  testId,
  expanded,
  onToggle,
}: {
  id: StatsPillId;
  icon: ReactNode;
  label: string;
  testId: string;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const content = (
    <>
      <span className="shrink-0 text-foreground-subtle" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  const className = cn(
    "inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-sm text-foreground-subtle",
    "transition-colors",
    onToggle && "cursor-pointer hover:bg-surface hover:text-foreground",
    expanded && "bg-surface text-foreground",
  );
  if (!onToggle) {
    return (
      <span className={className} data-composer-stat={id} data-testid={testId}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-composer-stat={id}
      data-testid={testId}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {content}
    </button>
  );
}

/** 明细行：左标签右数值，与 context 面板同一排版语言。 */
function StatsDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground-subtle">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function StatsDetails({
  pill,
  readings,
  locale,
}: {
  pill: StatsPillId;
  readings: ComposerSessionStatsReadings;
  locale: Locale;
}) {
  const { intl } = useZCodeIntl();
  if (pill === "activity") {
    const ttft =
      readings.averageTtftMs === null
        ? null
        : formatConversationWorkDuration(readings.averageTtftMs, intl, locale);
    return (
      <>
        <StatsDetailRow
          label={intl.formatMessage({ id: "chat.sessionStats.turnsSteps" })}
          value={intl.formatMessage(
            { id: "chat.sessionStats.counts" },
            { turns: readings.turns, steps: readings.steps },
          )}
        />
        {readings.modelMs > 0 ? (
          <StatsDetailRow
            label={intl.formatMessage({ id: "chat.sessionStats.modelTime" })}
            value={formatConversationWorkDuration(readings.modelMs, intl, locale) ?? "-"}
          />
        ) : null}
        {readings.toolMs > 0 ? (
          <StatsDetailRow
            label={intl.formatMessage({ id: "chat.sessionStats.toolTime" })}
            value={formatConversationWorkDuration(readings.toolMs, intl, locale) ?? "-"}
          />
        ) : null}
        {ttft ? (
          <StatsDetailRow
            label={intl.formatMessage({ id: "chat.sessionStats.averageTtft" })}
            value={ttft}
          />
        ) : null}
        {readings.tokensPerSecond !== null ? (
          <StatsDetailRow
            label={intl.formatMessage({ id: "chat.sessionStats.outputSpeed" })}
            value={intl.formatMessage(
              { id: "chat.sessionStats.tokensPerSecond" },
              { value: formatSpeed(locale, readings.tokensPerSecond) },
            )}
          />
        ) : null}
      </>
    );
  }
  return (
    <>
      {readings.totalTokens !== null ? (
        <StatsDetailRow
          label={intl.formatMessage({ id: "chat.sessionStats.totalTokens" })}
          value={formatTokens(locale, readings.totalTokens)}
        />
      ) : null}
      {readings.cacheHitRate !== null ? (
        <StatsDetailRow
          label={intl.formatMessage({ id: "chat.sessionStats.cacheHit" })}
          value={intl.formatMessage(
            { id: "chat.sessionStats.cacheHitValue" },
            { percent: formatCacheHitPercent(readings.cacheHitRate) },
          )}
        />
      ) : null}
    </>
  );
}

/**
 * Composer 会话统计条（对齐 DSH 输入框下方的轮/步 · 速度 · 累计 token · 缓存命中）。
 *
 * 事实全部来自 v4 投影（`snapshot.stats` 与 `snapshot.usage`），组件不查询、不重扫 rows；
 * 没有任何轮/步事实时整行不渲染，避免空态占位。规格见 docs/chat/composer-session-stats.md。
 */
function ComposerSessionStatsImpl({
  stats,
  usage,
  className,
}: {
  stats: SessionStatsState | null | undefined;
  usage: SessionUsageState | null | undefined;
  className?: string;
}) {
  const { intl, locale } = useZCodeIntl();
  const readings = resolveComposerSessionStatsReadings(stats, usage);
  const [openPill, setOpenPill] = useState<StatsPillId | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 外部点击与 Escape 关闭：同一时刻只允许一个明细浮层，避免两个 pill 同时展开。
  useEffect(() => {
    if (openPill === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpenPill(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPill(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openPill]);

  const toggle = useCallback((pill: StatsPillId) => {
    setOpenPill((current) => (current === pill ? null : pill));
  }, []);

  if (!hasComposerSessionStats(readings)) return null;

  const activityLabel =
    readings.tokensPerSecond === null
      ? intl.formatMessage(
          { id: "chat.sessionStats.counts" },
          { turns: readings.turns, steps: readings.steps },
        )
      : intl.formatMessage(
          { id: "chat.sessionStats.countsWithSpeed" },
          {
            turns: readings.turns,
            steps: readings.steps,
            speed: formatSpeed(locale, readings.tokensPerSecond),
          },
        );
  const usageLabel =
    readings.totalTokens === null
      ? null
      : readings.cacheHitRate === null
        ? intl.formatMessage(
            { id: "chat.sessionStats.tokens" },
            { tokens: formatTokens(locale, readings.totalTokens) },
          )
        : intl.formatMessage(
            { id: "chat.sessionStats.tokensWithCacheHit" },
            {
              tokens: formatTokens(locale, readings.totalTokens),
              percent: formatCacheHitPercent(readings.cacheHitRate),
            },
          );

  return (
    <div
      ref={rootRef}
      data-testid={TID_V4_COMPOSER_STATS}
      data-composer-stats="true"
      className={cn("relative flex w-full flex-wrap items-center gap-1", className)}
    >
      <StatsPill
        id="activity"
        icon={<GaugeIcon className="size-3.5" />}
        label={activityLabel}
        testId={TID_V4_COMPOSER_STATS_ACTIVITY}
        expanded={openPill === "activity"}
        onToggle={() => toggle("activity")}
      />
      {usageLabel === null ? null : (
        <StatsPill
          id="usage"
          icon={<DatabaseIcon className="size-3.5" />}
          label={usageLabel}
          testId={TID_V4_COMPOSER_STATS_USAGE}
          expanded={openPill === "usage"}
          onToggle={() => toggle("usage")}
        />
      )}
      {openPill === null ? null : (
        <div
          role="dialog"
          aria-label={intl.formatMessage({ id: "chat.sessionStats.dialogTitle" })}
          className="absolute bottom-full left-0 z-30 mb-1 flex w-64 flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-ui-sm text-popover-foreground shadow-md"
        >
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({
              id:
                openPill === "activity"
                  ? "chat.sessionStats.dialogActivity"
                  : "chat.sessionStats.dialogUsage",
            })}
          </div>
          <div className="flex flex-col gap-1.5">
            <StatsDetails pill={openPill} readings={readings} locale={locale} />
          </div>
        </div>
      )}
    </div>
  );
}

export const ComposerSessionStats = memo(ComposerSessionStatsImpl);
