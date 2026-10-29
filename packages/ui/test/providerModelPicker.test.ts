// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TID_MODEL_PROVIDER_IMPORT_MODELS_BUTTON,
  TID_MODEL_PROVIDER_MODEL_PICKER,
  TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM,
  TID_MODEL_PROVIDER_MODEL_PICKER_ROW,
  testId,
} from "@zcode/shared/test-ids";
import {
  ProviderModelPickerDialog,
  resolveImportableModels,
} from "@/settings/model-provider-section/ProviderModelPickerDialog.js";
import { ProviderModelsSection } from "@/settings/model-provider-section/ProviderCardSections.js";
import type { ProviderSettingsFormModel } from "@/lib/providerSettingsFormTypes.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";

const messages: Record<string, string> = {
  "common.cancel": "取消",
  "settings.modelProvider.addModel": "添加模型",
  "settings.modelProvider.importModels": "从 API 导入",
  "settings.modelProvider.importModelsTitle": "从 API 导入模型",
  "settings.modelProvider.importModelsDescription": "读取 {provider} 的 /models 接口",
  "settings.modelProvider.importModelsSearch": "搜索模型 ID",
  "settings.modelProvider.importModelsRefresh": "重新读取",
  "settings.modelProvider.importModelsLoading": "正在读取模型列表…",
  "settings.modelProvider.importModelsFailed": "读取模型列表失败：{error}",
  "settings.modelProvider.importModelsEmpty": "供应商没有返回任何模型。",
  "settings.modelProvider.importModelsNoMatch": "没有匹配的模型，换个关键词试试。",
  "settings.modelProvider.importModelsSelectAll": "全选",
  "settings.modelProvider.importModelsExistingHint": "已添加的模型不会重复出现在这里。",
  "settings.modelProvider.importModelsAddSelected": "添加 {count} 个模型",
  "settings.modelProvider.importModelsAddFailed": "添加模型失败：{error}",
  "settings.modelProvider.models": "模型列表",
  "settings.modelProvider.modelsEmpty": "当前没有配置模型",
  "settings.modelProvider.testModel": "测试模型",
};

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "zh-CN",
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) => {
        const template = messages[id] ?? id;
        return values
          ? template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
          : template;
      },
    },
  }),
}));

const settingsService = vi.hoisted(() => ({ resolveModelConfig: vi.fn() }));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({ providerSettingsService: settingsService }),
}));

afterEach(() => {
  cleanup();
  settingsService.resolveModelConfig.mockReset();
});

function createModel(modelId: string): ProviderSettingsFormModel {
  return {
    kind: "candidate",
    modelId,
    builtin: false,
    personalConfig: {},
    config: { properties: { contextWindow: 128_000, supportsToolCall: true } },
    hasPersonalConfig: false,
    executable: false,
    selectable: false,
  };
}

describe("resolveImportableModels", () => {
  it("过滤已存在的模型与不匹配关键词，大小写不敏感", () => {
    const models = [
      { modelId: "GPT-5" },
      { modelId: "glm-5", displayName: "GLM 5" },
      { modelId: "kimi" },
    ];
    expect(
      resolveImportableModels({ models, existingModelIds: ["gpt-5"], query: "" }).map(
        (model) => model.modelId,
      ),
    ).toEqual(["glm-5", "kimi"]);
    expect(
      resolveImportableModels({ models, existingModelIds: [], query: "glm" }).map(
        (model) => model.modelId,
      ),
    ).toEqual(["glm-5"]);
    expect(
      resolveImportableModels({ models, existingModelIds: [], query: "  " }).length,
    ).toBe(3);
  });
});

describe("ProviderModelPickerDialog", () => {
  const fetchOk = async () => ({
    success: true as const,
    models: [{ modelId: "gpt-5" }, { modelId: "gpt-5-mini" }, { modelId: "already" }],
  });

  it("勾选后确认只提交选中的模型", async () => {
    const onAddModels = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    render(
      createElement(ProviderModelPickerDialog, {
        open: true,
        providerName: "Example",
        existingModelIds: ["already"],
        onOpenChange,
        onFetch: fetchOk,
        onAddModels,
      }),
    );
    await waitFor(() => expect(screen.getByTestId(TID_MODEL_PROVIDER_MODEL_PICKER)).not.toBeNull());
    await waitFor(() =>
      expect(screen.queryByTestId(testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, "gpt-5"))).not.toBeNull(),
    );
    // 已配置模型不再出现在可导入列表里。
    expect(screen.queryByTestId(testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, "already"))).toBeNull();
    expect(screen.getByText("已添加的模型不会重复出现在这里。")).not.toBeNull();

    fireEvent.click(
      document.querySelector(
        `[data-testid="${testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, "gpt-5-mini")}"] [data-slot=checkbox]`,
      )!,
    );
    await waitFor(() =>
      expect(screen.getByTestId(TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM).textContent).toContain(
        "添加 1 个模型",
      ),
    );
    fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM));
    await waitFor(() => expect(onAddModels).toHaveBeenCalledWith(["gpt-5-mini"]));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("写入失败保留勾选与错误提示，可再次提交", async () => {
    const onAddModels = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk write failed"))
      .mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      createElement(ProviderModelPickerDialog, {
        open: true,
        existingModelIds: [],
        onOpenChange,
        onFetch: fetchOk,
        onAddModels,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId(testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, "gpt-5"))).not.toBeNull(),
    );
    fireEvent.click(
      document.querySelector(
        `[data-testid="${testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, "gpt-5")}"] [data-slot=checkbox]`,
      )!,
    );
    await waitFor(() =>
      expect(screen.getByTestId(TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM).textContent).toContain(
        "添加 1 个模型",
      ),
    );
    fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM));
    await waitFor(() => expect(screen.getByText("添加模型失败：disk write failed")).not.toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
    // 勾选状态没有被失败清空。
    expect(screen.getByTestId(TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM).textContent).toContain(
      "添加 1 个模型",
    );
    fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM));
    await waitFor(() => expect(onAddModels).toHaveBeenCalledTimes(2));
  });

  it("读取失败展示原因并允许重新读取", async () => {
    const onFetch = vi
      .fn<() => Promise<never>>()
      .mockResolvedValueOnce({
        success: false as never,
        error: { message: "HTTP 401: invalid api key" },
      } as never)
      .mockResolvedValueOnce({ success: true, models: [{ modelId: "gpt-5" }] } as never);
    render(
      createElement(ProviderModelPickerDialog, {
        open: true,
        existingModelIds: [],
        onOpenChange: vi.fn(),
        onFetch,
        onAddModels: vi.fn(async () => {}),
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("读取模型列表失败：HTTP 401: invalid api key")).not.toBeNull(),
    );
    fireEvent.click(screen.getByText("重新读取"));
    await waitFor(() =>
      expect(screen.queryByTestId(testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, "gpt-5"))).not.toBeNull(),
    );
  });
});

describe("ProviderModelsSection 导入入口", () => {  it("未装配清单能力时不渲染导入按钮", () => {
    render(
      createElement(ProviderModelsSection, {
        providerId: "p",
        models: [createModel("gpt-5")],
        onModelCommit: vi.fn(),
        onDeleteModel: vi.fn(),
        onAddModel: vi.fn(),
      }),
    );
    expect(screen.queryByTestId(TID_MODEL_PROVIDER_IMPORT_MODELS_BUTTON)).toBeNull();
  });

  it("勾选导入按串行、跟随推荐配置写入新模型", async () => {
    const onAddModel = vi.fn(async () => {});
    const onListModels = vi.fn(async () => ({
      success: true as const,
      models: [{ modelId: "gpt-5-mini" }, { modelId: "gpt-5-nano" }, { modelId: "gpt-5" }],
    }));
    render(
      createElement(ProviderModelsSection, {
        providerId: "p",
        models: [createModel("gpt-5")],
        onModelCommit: vi.fn(),
        onDeleteModel: vi.fn(),
        onAddModel,
        onListModels,
      }),
    );
    fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_IMPORT_MODELS_BUTTON));
    await waitFor(() => expect(onListModels).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.queryByTestId(testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, "gpt-5-mini")),
      ).not.toBeNull(),
    );
    // 已配置模型不进可导入列表。
    expect(screen.queryByTestId(testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, "gpt-5"))).toBeNull();
    fireEvent.click(screen.getByText("全选"));
    await act(async () => {
      fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM));
    });
    await waitFor(() => expect(onAddModel).toHaveBeenCalledTimes(2));
    expect(onAddModel.mock.calls.map(([model]) => (model as ProviderSettingsFormModel).modelId)).toEqual(
      ["gpt-5-mini", "gpt-5-nano"],
    );
    for (const [model] of onAddModel.mock.calls) {
      expect((model as ProviderSettingsFormModel).useRecommendedConfig).toBe(true);
      expect((model as ProviderSettingsFormModel).personalConfig).toEqual({});
    }
  });
});

describe("模型导入文案", () => {
  it("zh-CN 与 en-US 覆盖同一组导入 message id", () => {
    const prefix = "settings.modelProvider.importModels";
    const zhKeys = Object.keys(zhCN).filter((key) => key.startsWith(prefix));
    const enKeys = Object.keys(enUS).filter((key) => key.startsWith(prefix));
    // 只补一侧 locale 时界面会直接显示 message id，这里用中英集合互相比对兜住。
    expect(zhKeys.sort()).toEqual(enKeys.sort());
    expect(zhKeys.length).toBeGreaterThan(0);
  });
});
