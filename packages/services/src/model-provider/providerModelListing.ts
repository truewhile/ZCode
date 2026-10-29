import type { ProviderApiType } from "@zcode/provider";
import type { ProviderModelListEntry, ProviderModelListResult } from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { normalizeApiKeyForHeader } from "../providers/api/apiKeyHeaders.js";

const log = createServiceLogger("provider-model-listing");

/** 供应商模型清单是设置页的一次性交互请求；超时后让用户自己重试，不排队重发。 */
export const PROVIDER_MODEL_LIST_TIMEOUT_MS = 15_000;

/** Anthropic Messages 兼容网关要求版本头；缺失时直接被判成 400。 */
const ANTHROPIC_VERSION = "2023-06-01";

const VERSION_SEGMENT_PATTERN = /^v\d+$/i;

export interface ProviderModelListRequest {
  readonly apiType: ProviderApiType;
  readonly baseUrl: string;
  readonly apiKey: string;
}

export type ProviderModelListFetcher = (input: string, init: RequestInit) => Promise<Response>;

export type ProviderModelLister = (
  request: ProviderModelListRequest,
) => Promise<ProviderModelListResult>;

/**
 * 候选地址按顺序尝试：
 * - Base URL 已带版本段（`/v1`、`/v4`…）时只拼 `/models`，否则会得到 `/v1/v1/models`；
 * - 否则先试 OpenAI 约定的 `/v1/models`，再回退网关裸 `/models`。
 */
export function resolveProviderModelListUrls(input: {
  readonly baseUrl: string;
}): string[] {
  const raw = input.baseUrl.trim();
  if (!raw) return [];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return [];
  // 查询串和 hash 不参与拼接；供应商把 Key 放 query 的写法不在这里支持。
  url.search = "";
  url.hash = "";
  const pathname = url.pathname.replace(/\/+$/, "");
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const withModels = (path: string): string => {
    const next = new URL(url.toString());
    next.pathname = `${path}/models`;
    return next.toString();
  };
  if (VERSION_SEGMENT_PATTERN.test(lastSegment)) {
    return [withModels(pathname)];
  }
  return [withModels(`${pathname}/v1`), withModels(pathname)];
}

export function resolveProviderModelListHeaders(input: {
  readonly apiType: ProviderApiType;
  readonly apiKey: string;
  /**
   * 是否带 `anthropic-version`。默认带；关闭用于读取聚合网关的“原始模型目录”。
   * 有些转发站按该头判定客户端类型，带与不带会返回两套不同命名的清单。
   */
  readonly includeAnthropicVersion?: boolean;
}): Record<string, string> {
  const apiKey = normalizeApiKeyForHeader(input.apiKey);
  const headers: Record<string, string> = { accept: "application/json" };
  if (!apiKey) return headers;
  if (input.apiType === "anthropic-messages") {
    // Anthropic 兼容网关会同时读 x-api-key 与 Bearer Authorization；两者一致才不会互相覆盖。
    headers["x-api-key"] = apiKey;
    headers.authorization = `Bearer ${apiKey}`;
    if (input.includeAnthropicVersion !== false) headers["anthropic-version"] = ANTHROPIC_VERSION;
    return headers;
  }
  headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function readEntry(value: unknown): ProviderModelListEntry | null {
  if (typeof value === "string") {
    const modelId = value.trim();
    return modelId ? { modelId } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const rawId = record.id ?? record.name ?? record.model;
  if (typeof rawId !== "string") return null;
  const modelId = rawId.trim();
  if (!modelId) return null;
  const displayName =
    typeof record.display_name === "string"
      ? record.display_name
      : typeof record.displayName === "string"
        ? record.displayName
        : undefined;
  const createdAt =
    typeof record.created_at === "string"
      ? record.created_at
      : typeof record.createdAt === "string"
        ? record.createdAt
        : undefined;
  const trimmedName = displayName?.trim();
  return {
    modelId,
    ...(trimmedName && trimmedName !== modelId ? { displayName: trimmedName } : {}),
    ...(createdAt?.trim() ? { createdAt: createdAt.trim() } : {}),
  };
}

function readArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  // OpenAI/Anthropic 用 data；部分网关用 models/result/items 包一层。
  for (const key of ["data", "models", "result", "items"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

/**
 * 解析 `/models` 响应。列表结构在各家网关之间有差异，这里只做结构投影，
 * 遇到无法识别的形状返回空数组，由调用方判断“成功但为空”。
 */
export function parseProviderModelListPayload(payload: unknown): ProviderModelListEntry[] {
  const list = readArray(payload);
  if (!list) return [];
  const result: ProviderModelListEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const entry = readEntry(item);
    if (!entry || seen.has(entry.modelId)) continue;
    seen.add(entry.modelId);
    result.push(entry);
  }
  return result;
}

async function readErrorSummary(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return `HTTP ${response.status}`;
    return `HTTP ${response.status}: ${text.slice(0, 300)}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

const RETRYABLE_STATUS = new Set([404, 405]);

/**
 * 请求变体按顺序尝试：同一地址先不带 `anthropic-version`，再带上。
 *
 * 原因（2026-10-29 实测 api.linkmy.fun 这类聚合转发站）：`GET /v1/models` 会按
 * `anthropic-version` 头切换目录。带该头时返回的是站点自造的假名
 * （`claude-fable-5-dd-arret-1.6-tpg` 之类把真名倒序拼接的别名），不带时返回真实
 * 模型 ID（`gpt-6.1-terra`）。用户手工 curl 看不到那个头，于是两边清单对不上。
 *
 * 官方 Anthropic 的 /v1/models 需要该头，会先返回 4xx，再落到带头的变体重试。
 */
function resolveProviderModelListVariants(input: {
  readonly apiType: ProviderApiType;
  readonly apiKey: string;
}): { headers: Record<string, string>; includeAnthropicVersion: boolean }[] {
  const request = { apiType: input.apiType, apiKey: input.apiKey };
  if (input.apiType !== "anthropic-messages") {
    return [{ headers: resolveProviderModelListHeaders(request), includeAnthropicVersion: false }];
  }
  return [false, true].map((includeAnthropicVersion) => ({
    headers: resolveProviderModelListHeaders({ ...request, includeAnthropicVersion }),
    includeAnthropicVersion,
  }));
}

export function createProviderModelLister(dependencies: {
  readonly fetchImpl?: ProviderModelListFetcher;
  readonly timeoutMs?: number;
}): ProviderModelLister {
  const fetchImpl: ProviderModelListFetcher =
    dependencies.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = dependencies.timeoutMs ?? PROVIDER_MODEL_LIST_TIMEOUT_MS;

  return async (request) => {
    const baseUrl = request.baseUrl.trim();
    if (!baseUrl) {
      return {
        success: false,
        error: { code: "invalid-base-url", message: "Provider Base URL is empty." },
      };
    }
    const urls = resolveProviderModelListUrls({ baseUrl });
    if (urls.length === 0) {
      return {
        success: false,
        error: { code: "invalid-base-url", message: `Provider Base URL is invalid: ${baseUrl}` },
      };
    }
    if (!normalizeApiKeyForHeader(request.apiKey)) {
      return {
        success: false,
        error: { code: "missing-api-key", message: "Provider API Key is empty." },
      };
    }
    const variants = resolveProviderModelListVariants(request);
    const candidates = urls.flatMap((url) => variants.map((variant) => ({ url, ...variant })));

    let lastError: ProviderModelListResult & { success: false } = {
      success: false,
      error: { code: "network-error", message: "Provider model list request failed." },
    };
    for (const candidate of candidates) {
      let response: Response;
      try {
        response = await fetchImpl(candidate.url, {
          method: "GET",
          headers: candidate.headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // 网络层失败不换变体重试：换 header 不会修好 DNS/超时，只会放大等待。
        const message = error instanceof Error ? error.message : String(error);
        log.warn(undefined, "读取 Provider 模型清单失败", { url: candidate.url, error: message });
        return { success: false, error: { code: "network-error", message } };
      }
      if (response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          return {
            success: false,
            error: {
              code: "http-error",
              message: `Provider model list is not valid JSON: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          };
        }
        return { success: true, models: parseProviderModelListPayload(payload) };
      }
      lastError = {
        success: false,
        error: {
          code: "http-error",
          message: await readErrorSummary(response),
        },
      };
      // 只有“地址不对/方法不对”才继续换下一个候选；401/403 换 header 变体也不会变成成功。
      if (!RETRYABLE_STATUS.has(response.status) && response.status !== 400) return lastError;
    }
    return lastError;
  };
}
