import { describe, expect, it, vi } from "vitest";
import {
  createProviderModelLister,
  parseProviderModelListPayload,
  resolveProviderModelListHeaders,
  resolveProviderModelListUrls,
} from "../src/model-provider/providerModelListing.js";

describe("resolveProviderModelListUrls", () => {
  it("Base URL 已带版本段时只拼 /models", () => {
    expect(resolveProviderModelListUrls({ baseUrl: "https://api.example.com/v1" })).toEqual([
      "https://api.example.com/v1/models",
    ]);
    expect(resolveProviderModelListUrls({ baseUrl: "https://api.example.com/v4/" })).toEqual([
      "https://api.example.com/v4/models",
    ]);
  });

  it("裸 Base URL 先试 /v1/models，再回退 /models", () => {
    expect(resolveProviderModelListUrls({ baseUrl: "https://api.anthropic.com" })).toEqual([
      "https://api.anthropic.com/v1/models",
      "https://api.anthropic.com/models",
    ]);
  });

  it("丢弃查询串与 hash，非法地址返回空", () => {
    expect(resolveProviderModelListUrls({ baseUrl: "https://api.example.com/v1?key=leak#" })).toEqual(
      ["https://api.example.com/v1/models"],
    );
    expect(resolveProviderModelListUrls({ baseUrl: "  " })).toEqual([]);
    expect(resolveProviderModelListUrls({ baseUrl: "ftp://api.example.com" })).toEqual([]);
    expect(resolveProviderModelListUrls({ baseUrl: "not a url" })).toEqual([]);
  });
});

describe("resolveProviderModelListHeaders", () => {
  it("Anthropic Messages 默认带 x-api-key、Bearer 与版本头", () => {
    expect(
      resolveProviderModelListHeaders({ apiType: "anthropic-messages", apiKey: "sk-ant" }),
    ).toMatchObject({
      "x-api-key": "sk-ant",
      authorization: "Bearer sk-ant",
      "anthropic-version": "2023-06-01",
    });
  });

  it("显式关闭版本头时保留鉴权但不发 anthropic-version", () => {
    const headers = resolveProviderModelListHeaders({
      apiType: "anthropic-messages",
      apiKey: "sk-ant",
      includeAnthropicVersion: false,
    });
    expect(headers["anthropic-version"]).toBeUndefined();
    expect(headers["x-api-key"]).toBe("sk-ant");
  });

  it("OpenAI 兼容格式只用 Bearer，并截掉 Key 里的中文备注", () => {
    const headers = resolveProviderModelListHeaders({
      apiType: "openai-chat-completions",
      apiKey: "sk-live。这是备用的 Key",
    });
    expect(headers.authorization).toBe("Bearer sk-live");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("空 Key 不构造认证头", () => {
    const headers = resolveProviderModelListHeaders({
      apiType: "openai-responses",
      apiKey: "   ",
    });
    expect(headers.authorization).toBeUndefined();
  });
});

describe("parseProviderModelListPayload", () => {
  it("兼容 data/models/result 包装并去重", () => {
    expect(
      parseProviderModelListPayload({
        data: [
          { id: "gpt-5", display_name: "GPT-5", created_at: "2026-01-01" },
          { id: "gpt-5" },
          "claude-sonnet",
        ],
      }),
    ).toEqual([
      { modelId: "gpt-5", displayName: "GPT-5", createdAt: "2026-01-01" },
      { modelId: "claude-sonnet" },
    ]);
    expect(parseProviderModelListPayload({ models: [{ name: "glm-5" }] })).toEqual([
      { modelId: "glm-5" },
    ]);
    expect(parseProviderModelListPayload({ result: [{ model: "kimi" }] })).toEqual([
      { modelId: "kimi" },
    ]);
  });

  it("忽略展示名与 ID 相同的条目和无法识别的形状", () => {
    expect(parseProviderModelListPayload([{ id: "glm-5", display_name: "glm-5" }])).toEqual([
      { modelId: "glm-5" },
    ]);
    expect(parseProviderModelListPayload({ unexpected: true })).toEqual([]);
    expect(parseProviderModelListPayload(null)).toEqual([]);
  });
});

describe("createProviderModelLister", () => {
  const request = {
    apiType: "openai-chat-completions" as const,
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-live",
  };

  it("成功时返回模型清单", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), { status: 200 }),
    );
    const lister = createProviderModelLister({ fetchImpl });
    await expect(lister(request)).resolves.toEqual({
      success: true,
      models: [{ modelId: "gpt-5" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.example.com/v1/models");
  });

  it("首个候选 404 时回退根路径", async () => {
    const fetchImpl = vi
      .fn<(input: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "glm-5" }]), { status: 200 }));
    const lister = createProviderModelLister({ fetchImpl });
    await expect(
      lister({ ...request, baseUrl: "https://api.example.com" }),
    ).resolves.toEqual({ success: true, models: [{ modelId: "glm-5" }] });
    expect(fetchImpl.mock.calls.map(([input]) => input)).toEqual([
      "https://api.example.com/v1/models",
      "https://api.example.com/models",
    ]);
  });

  it("401 不重试，直接返回状态与响应摘要", async () => {
    const fetchImpl = vi.fn(async () => new Response("invalid api key", { status: 401 }));
    const lister = createProviderModelLister({ fetchImpl });
    await expect(lister(request)).resolves.toEqual({
      success: false,
      error: { code: "http-error", message: "HTTP 401: invalid api key" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("网络失败不换地址重试", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.example.com");
    });
    const lister = createProviderModelLister({ fetchImpl });
    await expect(
      lister({ ...request, baseUrl: "https://api.example.com" }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "network-error", message: "getaddrinfo ENOTFOUND api.example.com" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("缺少 Key 或 Base URL 时不发请求", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const lister = createProviderModelLister({ fetchImpl });
    await expect(lister({ ...request, apiKey: " " })).resolves.toMatchObject({
      success: false,
      error: { code: "missing-api-key" },
    });
    await expect(lister({ ...request, baseUrl: "  " })).resolves.toMatchObject({
      success: false,
      error: { code: "invalid-base-url" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Anthropic Messages 先不带版本头取真名清单，不再发第二次请求", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-6.1-terra", display_name: "GPT-6.1" }] }), {
          status: 200,
        }),
    );
    const lister = createProviderModelLister({ fetchImpl });
    await expect(
      lister({ ...request, apiType: "anthropic-messages", baseUrl: "https://relay.example.com/v1" }),
    ).resolves.toEqual({
      success: true,
      models: [{ modelId: "gpt-6.1-terra", displayName: "GPT-6.1" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    // 聚合转发站按该头切换目录：带上会返回自造别名，所以首个候选必须不带。
    expect(headers.get("anthropic-version")).toBeNull();
    expect(headers.get("x-api-key")).toBe("sk-live");
  });

  it("官方 Anthropic 在无版本头返回 400 后带上版本头重试", async () => {
    const fetchImpl = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response('{"type":"error","error":{"type":"invalid_request_error"}}', { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-6" }] }), { status: 200 }),
      );
    const lister = createProviderModelLister({ fetchImpl });
    await expect(
      lister({
        ...request,
        apiType: "anthropic-messages",
        baseUrl: "https://api.anthropic.com/v1",
      }),
    ).resolves.toEqual({ success: true, models: [{ modelId: "claude-sonnet-4-6" }] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(retryHeaders.get("anthropic-version")).toBe("2023-06-01");
  });
});
