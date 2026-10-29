// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SessionStatsState, SessionUsageState } from "@zcode/shared/zcode-protocol-v4";
import {
  TID_V4_COMPOSER_STATS,
  TID_V4_COMPOSER_STATS_ACTIVITY,
  TID_V4_COMPOSER_STATS_USAGE,
} from "@zcode/shared/test-ids";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { ComposerSessionStats } from "@/v4/composer/ComposerSessionStats.js";
import {
  formatCacheHitPercent,
  resolveComposerSessionStatsReadings,
} from "@/v4/composer/sessionStatsReadings.js";

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children, title }: { children: ReactNode; title: string }) =>
    createElement("span", { "data-tooltip-title": title }, children),
}));

function createStats(overrides: Partial<SessionStatsState> = {}): SessionStatsState {
  return {
    turns: 1,
    steps: 29,
    modelMs: 60_000,
    toolMs: 12_000,
    ttftMs: 4_000,
    ttftCount: 4,
    decodeMs: 10_000,
    decodeTokens: 1_160,
    ...overrides,
  };
}

function createUsage(overrides: Partial<SessionUsageState["cumulative"]> = {}): SessionUsageState {
  return {
    contextWindow: null,
    cumulative: {
      inputTokens: 1_900_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_805_000,
      cacheWriteTokens: 0,
      ...overrides,
    },
  };
}

function renderStats(stats: SessionStatsState | null, usage: SessionUsageState | null): string {
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      null,
      createElement(ComposerSessionStats, { stats, usage }),
    ) as React.ReactElement,
  );
}

afterEach(() => {
  cleanup();
});

describe("composer session stats readings", () => {
  it("从投影事实解析轮/步、速度与累计 token", () => {
    const readings = resolveComposerSessionStatsReadings(createStats(), createUsage());
    expect(readings).not.toBeNull();
    expect(readings?.turns).toBe(1);
    expect(readings?.steps).toBe(29);
    // 1160 tokens / 10s
    expect(readings?.tokensPerSecond).toBeCloseTo(116, 5);
    expect(readings?.totalTokens).toBe(2_000_000);
    expect(readings?.cacheHitRate).toBeCloseTo(0.95, 5);
    expect(readings?.averageTtftMs).toBe(1_000);
  });

  it("无解码样本时速度读数为 null，不伪造速度", () => {
    const readings = resolveComposerSessionStatsReadings(
      createStats({ decodeMs: 0, decodeTokens: 0 }),
      createUsage(),
    );
    expect(readings?.tokensPerSecond).toBeNull();
  });

  it("无累计输入 token 时命中率为 null", () => {
    const readings = resolveComposerSessionStatsReadings(
      createStats(),
      createUsage({ inputTokens: 0, cacheReadTokens: 0 }),
    );
    expect(readings?.cacheHitRate).toBeNull();
  });

  it("零轮零步时整行不渲染", () => {
    expect(
      resolveComposerSessionStatsReadings(createStats({ turns: 0, steps: 0 }), createUsage()),
    ).toBeNull();
  });

  it("命中率接近满值时保留一位小数，不提前显示 100%", () => {
    expect(formatCacheHitPercent(0.996)).toBe(99.6);
    expect(formatCacheHitPercent(1)).toBe(100);
  });
});

describe("ComposerSessionStats", () => {
  it("渲染两个 pill 的文案", () => {
    const html = renderStats(createStats(), createUsage());
    expect(html).toContain(TID_V4_COMPOSER_STATS);
    expect(html).toContain(TID_V4_COMPOSER_STATS_ACTIVITY);
    expect(html).toContain(TID_V4_COMPOSER_STATS_USAGE);
    // 文案随 locale 变化：只断言与语言无关的数值片段。
    expect(html).toContain("29");
    expect(html).toContain("116 tok/s");
    expect(html).toContain("95%");
  });

  it("没有事实时不渲染容器", () => {
    expect(renderStats(createStats({ turns: 0, steps: 0 }), createUsage())).toBe("");
    expect(renderStats(null, null)).toBe("");
  });

  it("点击 pill 打开明细浮层", async () => {
    render(
      createElement(
        ZCodeIntlProvider,
        null,
        createElement(ComposerSessionStats, { stats: createStats(), usage: createUsage() }),
      ),
    );
    const activity = screen.getByTestId(TID_V4_COMPOSER_STATS_ACTIVITY);
    activity.click();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-expanded")).toBeNull();
    // 明细必须带速度读数，且浮层内只有一个 pill 的明细。
    expect(dialog.textContent).toContain("116 tok/s");
  });
});
