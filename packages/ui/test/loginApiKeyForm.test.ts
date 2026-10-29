import { describe, expect, it } from "vitest";
import {
  buildLoginApiKeyDefaultModelPreferenceFromSelection,
  buildLoginProviderInitialConfig,
  isHttpUrl,
  normalizeProviderBaseUrl,
  validateLoginProviderDraft,
} from "@/login/LoginApiKeyForm.helpers.js";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";

const validDraft = {
  name: "My Provider",
  baseUrl: "https://api.example.com",
  apiFormat: "openai-chat-completions" as const,
  apiKey: "sk-test",
  modelId: "gpt-4o-mini",
};

describe("LoginApiKeyForm 第三方供应商接入", () => {
  it("必填项齐全时校验通过", () => {
    expect(validateLoginProviderDraft(validDraft)).toBeNull();
  });

  it("按顺序返回第一个缺失或非法的字段", () => {
    expect(validateLoginProviderDraft({ ...validDraft, name: "  " })).toBe("name");
    expect(validateLoginProviderDraft({ ...validDraft, baseUrl: "api.example.com" })).toBe(
      "baseUrl",
    );
    expect(validateLoginProviderDraft({ ...validDraft, apiKey: " " })).toBe("apiKey");
    expect(validateLoginProviderDraft({ ...validDraft, modelId: "" })).toBe("modelId");
  });

  it("只接受带协议的合法 URL", () => {
    expect(isHttpUrl("https://api.example.com")).toBe(true);
    expect(isHttpUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isHttpUrl("ftp://api.example.com")).toBe(false);
    expect(isHttpUrl("https://")).toBe(false);
  });

  it("保存前去掉 Base URL 尾部斜杠", () => {
    expect(normalizeProviderBaseUrl(" https://api.example.com/v1/ ")).toBe(
      "https://api.example.com/v1",
    );
  });

  it("构造第三方 Provider 的初始配置：api-key + 自定义端点", () => {
    expect(
      buildLoginProviderInitialConfig({
        ...validDraft,
        baseUrl: " https://api.example.com/v1/ ",
        apiKey: " sk-test ",
      }),
    ).toEqual({
      access: { type: "api-key", apiKey: "sk-test" },
      api: { type: "openai-chat-completions", baseUrl: "https://api.example.com/v1" },
    });
  });

  it("登录后默认模型取新建 Provider 的首个模型", () => {
    expect(
      buildLoginApiKeyDefaultModelPreferenceFromSelection(
        {
          revision: 3,
          providers: [
            {
              providerId: "provider-1",
              config: { kind: "api", models: ["gpt-4o-mini"] },
              models: [{ modelId: "gpt-4o-mini", config: {} }],
            },
          ],
        },
        "provider-1",
      ),
    ).toBe(encodeCustomModelValue("provider-1", "gpt-4o-mini"));
  });
});
