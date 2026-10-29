// 会话统计条（composer stats）投影黄金测试。
// 形态与 product-projection.test.ts 一致：事件序列进、snapshot.stats 断言出。
// 规格见 docs/chat/composer-session-stats.md。
import { describe, expect, it } from "vitest";
import type {
  EventId,
  SessionEvent,
  SessionEventType as SessionEventTypeUnion,
  SessionId,
  TraceId,
  TurnId,
} from "@zcode/contracts";
import { SessionEventType } from "@zcode/contracts";
import { conversationSnapshotSchema } from "@zcode/shared/zcode-protocol-v4";
import { ProductProjection } from "../src/zcode-protocol-v4/index.js";

class EventLog {
  private seq = 0;
  readonly events: SessionEvent[] = [];

  constructor(private readonly sessionId = "session-1") {}

  push(
    type: SessionEventTypeUnion,
    payload: unknown,
    opts: { timestampMs?: number; turnId?: string } = {},
  ): SessionEvent {
    this.seq += 1;
    const event: SessionEvent = {
      id: `event-${this.seq}` as EventId,
      sessionId: this.sessionId as SessionId,
      turnId: opts.turnId as TurnId | undefined,
      type,
      timestamp: new Date(opts.timestampMs ?? 1_700_000_000_000 + this.seq * 1000),
      traceId: "trace-1" as TraceId,
      sequenceNumber: this.seq,
      payload,
    };
    this.events.push(event);
    return event;
  }
}

function runAll(events: readonly SessionEvent[]): ProductProjection {
  const projection = new ProductProjection("session-1", "epoch-1");
  for (const event of events) projection.applyEvent(event);
  return projection;
}

function requestCompleted(input: {
  requestId: string;
  durationMs: number;
  timeToFirstContentMs?: number;
  outputTokens?: number;
  querySource?: string;
}): Record<string, unknown> {
  return {
    type: "model_request_completed",
    requestId: input.requestId,
    providerId: "account:bigmodel-individual-coding-plan",
    modelId: "glm-5.3",
    transport: "sse",
    attempt: 1,
    maxAttempts: 1,
    durationMs: input.durationMs,
    ...(input.timeToFirstContentMs !== undefined
      ? { timeToFirstContentMs: input.timeToFirstContentMs }
      : {}),
    ...(input.querySource !== undefined ? { querySource: input.querySource } : {}),
    ...(input.outputTokens !== undefined
      ? { usage: { inputTokens: 10, outputTokens: input.outputTokens } }
      : {}),
  };
}

describe("composer 会话统计投影", () => {
  it("可见用户轮计轮，model-only 维护轮不计轮", () => {
    const log = new EventLog();
    log.push(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
    log.push(SessionEventType.TurnStarted, { turnNumber: 1, input: "first" }, { turnId: "t1" });
    log.push(
      SessionEventType.TurnStarted,
      { turnNumber: 2, input: "", inputVisibility: "model-only" },
      { turnId: "t2" },
    );
    log.push(SessionEventType.TurnStarted, { turnNumber: 3, input: "third" }, { turnId: "t3" });

    const snapshot = runAll(log.events).getSnapshot();
    expect(snapshot.stats.turns).toBe(2);
    // 新字段必须能通过 wire schema 校验（additive + default）。
    expect(() => conversationSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("主链路模型往返计步，sidecar 请求不计", () => {
    const log = new EventLog();
    log.push(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
    log.push(SessionEventType.TurnStarted, { turnNumber: 1, input: "go" }, { turnId: "t1" });
    for (const querySource of ["main_turn", "main_turn", "session_title"]) {
      log.push(
        SessionEventType.ModelComplete,
        {
          content: "",
          stopReason: "end_turn",
          querySource,
          usage: { inputTokens: 10, outputTokens: 5 },
        },
        { turnId: "t1" },
      );
    }

    const snapshot = runAll(log.events).getSnapshot();
    expect(snapshot.stats.steps).toBe(2);
    expect(snapshot.stats.turns).toBe(1);
  });

  it("请求级计时按首 token 切出解码区间并累计输出速度样本", () => {
    const log = new EventLog();
    log.push(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
    log.push(SessionEventType.TurnStarted, { turnNumber: 1, input: "go" }, { turnId: "t1" });
    log.push(
      SessionEventType.ModelNetworkStatus,
      requestCompleted({
        requestId: "r1",
        durationMs: 10_000,
        timeToFirstContentMs: 2_000,
        outputTokens: 800,
      }),
      { turnId: "t1" },
    );
    log.push(
      SessionEventType.ModelNetworkStatus,
      requestCompleted({
        requestId: "r2",
        durationMs: 6_000,
        timeToFirstContentMs: 1_000,
        outputTokens: 500,
      }),
      { turnId: "t1" },
    );
    // 标题请求不是可见输出，不能污染速度读数。
    log.push(
      SessionEventType.ModelNetworkStatus,
      requestCompleted({
        requestId: "r3",
        durationMs: 900,
        timeToFirstContentMs: 100,
        outputTokens: 5,
        querySource: "session_title",
      }),
      { turnId: "t1" },
    );

    const stats = runAll(log.events).getSnapshot().stats;
    expect(stats.modelMs).toBe(16_000);
    expect(stats.ttftMs).toBe(3_000);
    expect(stats.ttftCount).toBe(2);
    expect(stats.decodeMs).toBe(13_000);
    expect(stats.decodeTokens).toBe(1_300);
  });

  it("缺首 token 的请求只计模型时长，不伪造解码样本", () => {
    const log = new EventLog();
    log.push(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
    log.push(SessionEventType.TurnStarted, { turnNumber: 1, input: "go" }, { turnId: "t1" });
    log.push(
      SessionEventType.ModelNetworkStatus,
      requestCompleted({ requestId: "r1", durationMs: 5_000, outputTokens: 300 }),
      { turnId: "t1" },
    );

    const stats = runAll(log.events).getSnapshot().stats;
    expect(stats.modelMs).toBe(5_000);
    expect(stats.decodeMs).toBe(0);
    expect(stats.decodeTokens).toBe(0);
    expect(stats.ttftCount).toBe(0);
  });

  it("工具终态按行的开始/结束时间累计工具耗时", () => {
    const log = new EventLog();
    log.push(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
    log.push(
      SessionEventType.TurnStarted,
      { turnNumber: 1, input: "go" },
      { turnId: "t1", timestampMs: 1_700_000_000_000 },
    );
    log.push(
      SessionEventType.ToolCallScheduled,
      { toolCallId: "tool-1", toolName: "Bash", input: { command: "ls" } },
      { turnId: "t1", timestampMs: 1_700_000_000_100 },
    );
    log.push(
      SessionEventType.ToolCallStarted,
      { toolCallId: "tool-1", toolName: "Bash" },
      { turnId: "t1", timestampMs: 1_700_000_000_200 },
    );
    log.push(
      SessionEventType.ToolCallResult,
      { toolCallId: "tool-1", result: { success: true, content: "ok" } },
      { turnId: "t1", timestampMs: 1_700_000_003_200 },
    );

    const stats = runAll(log.events).getSnapshot().stats;
    expect(stats.toolMs).toBe(3_000);
  });

  it("旧快照缺 stats 时解析为零统计（统计条整行不渲染）", () => {
    const legacy = {
      protocolVersion: 1,
      sessionId: "session-1",
      logEpoch: "epoch-1",
      seq: 0,
      revision: 0,
      control: {
        phase: "draft",
        sessionEnded: false,
        canStop: false,
        stopState: "idle",
        stopTargetKind: "unknown",
        activeWorks: [],
        lastError: null,
        apiRetry: null,
      },
      availability: {
        fork: { allowed: false, reasonCode: "forkTargetNotStable" },
        compact: { allowed: false, reasonCode: "idleCannotCompact" },
        switchModelConfig: { allowed: true },
        setFollowupMode: { allowed: true },
        queueEdit: { allowed: true },
        sendQueuedNow: { allowed: true },
        pauseGoal: { allowed: true },
        resumeGoal: { allowed: true },
      },
      inputRouting: { mode: "startNow" },
      meta: { title: "", titleSource: "default" },
      config: {
        provider: "",
        model: "",
        thought: "",
        thoughtLevels: [],
        followupMode: "queue",
        mode: "build",
      },
      modelTransition: null,
      usage: {
        contextWindow: null,
        cumulative: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
      queue: { items: [], autoDrain: true },
      pendingInteractions: [],
      pendingCommands: [],
      backgroundWorks: [],
      goal: null,
      plan: null,
      workspaceHookAdmission: null,
      rows: { window: [], totalCount: 0, firstRowId: null },
    };

    const parsed = conversationSnapshotSchema.parse(legacy);
    expect(parsed.stats).toEqual({
      turns: 0,
      steps: 0,
      modelMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftCount: 0,
      decodeMs: 0,
      decodeTokens: 0,
    });
  });
});
