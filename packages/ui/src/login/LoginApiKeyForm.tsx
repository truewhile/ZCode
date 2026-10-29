import { useState } from "react";
import type { ProviderApiType } from "@zcode/provider";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import {
  TID_LOGIN_API_KEY_CONTINUE_BUTTON,
  TID_LOGIN_API_KEY_ERROR,
  TID_LOGIN_API_KEY_INPUT,
  TID_LOGIN_API_KEY_SKIP_BUTTON,
} from "@zcode/shared/test-ids";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  buildLoginApiKeyDefaultModelPreferenceFromSelection,
  buildLoginProviderInitialConfig,
  validateLoginProviderDraft,
  type LoginProviderDraft,
  type LoginProviderDraftField,
} from "@/login/LoginApiKeyForm.helpers.js";
import { ProviderApiFormatSelect } from "@/settings/model-provider-section/ProviderApiFormatSelect.js";
import { useZCodeStore } from "@/store/StoreProvider.js";

interface LoginApiKeyFormProps {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onSkipped: () => void | Promise<void>;
}

/**
 * 登录页接入表单：直接创建第三方自定义供应商。
 *
 * 官方内置供应商（Z.ai / BigModel）与 Coding Plan 模板不再出现在登录入口，
 * 用户填写 Base URL、API 格式、API Key 与首个模型 ID 即可开始使用。
 */
export function LoginApiKeyForm({ onCancel, onSaved, onSkipped }: LoginApiKeyFormProps) {
  const { intl } = useZCodeIntl();
  const { modelSelectionService, providerSettingsService } = useServices();
  const markApiKeyLoginSuccess = useZCodeStore((state) => state.markApiKeyLoginSuccess);
  const [draft, setDraft] = useState<LoginProviderDraft>(() => ({
    name: "",
    baseUrl: "",
    apiFormat: "openai-chat-completions",
    apiKey: "",
    modelId: "",
  }));
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDraft = <Key extends keyof LoginProviderDraft>(
    key: Key,
    value: LoginProviderDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const describeFieldError = (field: LoginProviderDraftField): string => {
    switch (field) {
      case "name":
        return intl.formatMessage({ id: "login.provider.nameRequired" });
      case "baseUrl":
        return intl.formatMessage({ id: "login.provider.baseUrlInvalid" });
      case "apiKey":
        return intl.formatMessage({ id: "login.provider.apiKeyRequired" });
      case "modelId":
        return intl.formatMessage({ id: "login.provider.modelIdRequired" });
    }
  };

  const saveProvider = async () => {
    const invalidField = validateLoginProviderDraft(draft);
    if (invalidField) {
      setError(describeFieldError(invalidField));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const providerName =
        draft.name.trim() ||
        intl.formatMessage({ id: "login.provider.defaultName" });
      const created = await providerSettingsService.createPersonalProvider({
        providerName,
        initialConfig: buildLoginProviderInitialConfig(draft),
      });
      // 没有模型的 Provider 不算可用接入，创建后立刻补上首个模型，避免启动门禁反复弹登录页。
      await providerSettingsService.addPersonalModel(
        created.providerId,
        draft.modelId.trim(),
        { enabled: true },
      );
      const defaultModelPreference = buildLoginApiKeyDefaultModelPreferenceFromSelection(
        await modelSelectionService.getView(),
        created.providerId,
      );
      markApiKeyLoginSuccess(defaultModelPreference);
      await onSaved();
    } catch (saveError) {
      logger.error("[LoginEntry] 保存第三方 Provider 失败", {
        baseUrl: draft.baseUrl,
        error: saveError,
      });
      setError(
        intl.formatMessage(
          { id: "login.provider.saveError" },
          {
            error: saveError instanceof Error ? saveError.message : String(saveError),
          },
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const skipProviderSetup = async () => {
    setSkipping(true);
    setError(null);
    try {
      await onSkipped();
    } catch (skipError) {
      logger.error("[LoginEntry] 跳过第三方 Provider 接入失败", { error: skipError });
      setError(
        intl.formatMessage(
          { id: "login.provider.skipError" },
          {
            error: skipError instanceof Error ? skipError.message : String(skipError),
          },
        ),
      );
    } finally {
      setSkipping(false);
    }
  };

  const busy = saving || skipping;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "login.provider.title" })}
        </h2>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "login.provider.nameLabel" })}
            </span>
            <Input
              id="login-provider-name"
              size="lg"
              className="h-10 w-full text-ui-base"
              data-testid="login-provider-name"
              value={draft.name}
              placeholder={intl.formatMessage({ id: "login.provider.namePlaceholder" })}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => updateDraft("name", event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "login.provider.baseUrlLabel" })}
            </span>
            <Input
              id="login-provider-base-url"
              size="lg"
              className="h-10 w-full text-ui-base"
              data-testid="login-provider-base-url"
              value={draft.baseUrl}
              placeholder={intl.formatMessage({ id: "login.provider.baseUrlPlaceholder" })}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => updateDraft("baseUrl", event.target.value)}
            />
          </label>
          <div className="space-y-1">
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "login.provider.apiFormatLabel" })}
            </span>
            <ProviderApiFormatSelect
              triggerId="login-provider-api-format"
              value={draft.apiFormat}
              onChange={(value: ProviderApiType) => updateDraft("apiFormat", value)}
            />
          </div>
          <label className="block space-y-1">
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "login.provider.apiKeyLabel" })}
            </span>
            <Input
              id="login-provider-api-key"
              type="password"
              size="lg"
              className="h-10 w-full text-ui-base"
              data-testid={TID_LOGIN_API_KEY_INPUT}
              value={draft.apiKey}
              placeholder={intl.formatMessage({ id: "login.apiKey.placeholder" })}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => updateDraft("apiKey", event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "login.provider.modelIdLabel" })}
            </span>
            <Input
              id="login-provider-model-id"
              size="lg"
              className="h-10 w-full text-ui-base"
              data-testid="login-provider-model-id"
              value={draft.modelId}
              placeholder={intl.formatMessage({ id: "login.provider.modelIdPlaceholder" })}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => updateDraft("modelId", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !busy) {
                  void saveProvider();
                }
              }}
            />
          </label>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" data-testid={TID_LOGIN_API_KEY_ERROR}>
          <TriangleAlertIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Button
          type="button"
          className="h-10 w-full text-ui-base"
          size="lg"
          data-testid={TID_LOGIN_API_KEY_CONTINUE_BUTTON}
          disabled={busy}
          onClick={() => void saveProvider()}
        >
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.provider.continue" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-ui-base"
          size="lg"
          disabled={busy}
          onClick={onCancel}
        >
          {intl.formatMessage({ id: "login.apiKey.cancel" })}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-7 w-full text-ui-base text-foreground-subtle hover:text-foreground"
          data-testid={TID_LOGIN_API_KEY_SKIP_BUTTON}
          disabled={busy}
          onClick={() => void skipProviderSetup()}
        >
          {skipping ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.skip" })}
        </Button>
      </div>
    </div>
  );
}