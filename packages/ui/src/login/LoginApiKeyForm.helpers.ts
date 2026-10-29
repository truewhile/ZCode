import type { ModelSelectionView } from "@zcode/services";
import type { ProviderApiType } from "@zcode/provider";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";

/** 登录页只创建第三方自定义供应商，不再提供官方内置供应商模板。 */
export interface LoginProviderDraft {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiFormat: ProviderApiType;
  readonly apiKey: string;
  readonly modelId: string;
}

export type LoginProviderDraftField = "name" | "baseUrl" | "apiKey" | "modelId";

/** 返回第一个未通过校验的字段；全部通过时返回 null。 */
export function validateLoginProviderDraft(draft: LoginProviderDraft): LoginProviderDraftField | null {
  if (draft.name.trim().length === 0) {
    return "name";
  }
  if (!isHttpUrl(draft.baseUrl)) {
    return "baseUrl";
  }
  if (draft.apiKey.trim().length === 0) {
    return "apiKey";
  }
  if (draft.modelId.trim().length === 0) {
    return "modelId";
  }
  return null;
}

export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    return new URL(trimmed).hostname.length > 0;
  } catch {
    return false;
  }
}

/** 去掉尾部斜杠，避免保存出的 Base URL 与 API 路径拼接出双斜杠。 */
export function normalizeProviderBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function buildLoginProviderInitialConfig(draft: LoginProviderDraft) {
  return {
    access: {
      type: "api-key" as const,
      apiKey: draft.apiKey.trim(),
    },
    api: {
      type: draft.apiFormat,
      baseUrl: normalizeProviderBaseUrl(draft.baseUrl),
    },
  };
}

export function buildLoginApiKeyDefaultModelPreferenceFromSelection(
  view: ModelSelectionView,
  providerId: string,
): string | null {
  const firstModel = view.providers.find((provider) => provider.providerId === providerId)
    ?.models[0]?.modelId;
  return firstModel ? encodeCustomModelValue(providerId, firstModel) : null;
}