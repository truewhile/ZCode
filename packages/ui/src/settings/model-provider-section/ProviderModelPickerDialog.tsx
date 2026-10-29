import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ProviderModelListEntry, ProviderModelListResult } from "@zcode/shared";
import {
  TID_MODEL_PROVIDER_MODEL_PICKER,
  TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM,
  TID_MODEL_PROVIDER_MODEL_PICKER_REFRESH,
  TID_MODEL_PROVIDER_MODEL_PICKER_ROW,
  testId,
} from "@zcode/shared/test-ids";
import { cn } from "@/components/lib/utils.js";

/** 已配置模型按大小写不敏感比较：供应商清单与手工输入的大小写习惯不一致。 */
function toModelIdKey(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export function resolveImportableModels(params: {
  models: readonly ProviderModelListEntry[];
  existingModelIds: readonly string[];
  query: string;
}): readonly ProviderModelListEntry[] {
  const existing = new Set(params.existingModelIds.map(toModelIdKey));
  const query = params.query.trim().toLowerCase();
  return params.models.filter((model) => {
    if (existing.has(toModelIdKey(model.modelId))) return false;
    if (!query) return true;
    return (
      model.modelId.toLowerCase().includes(query) ||
      (model.displayName?.toLowerCase().includes(query) ?? false)
    );
  });
}

/**
 * 从 Provider `/models` 勾选添加模型。
 *
 * 该弹窗只保留勾选意图；写入由外层 `onAddModels` 串行提交，
 * 失败时保留勾选和错误，避免用户重新勾一遍。
 */
export function ProviderModelPickerDialog({
  open,
  providerName,
  existingModelIds,
  onOpenChange,
  onFetch,
  onAddModels,
}: {
  open: boolean;
  providerName?: string;
  existingModelIds: readonly string[];
  onOpenChange: (open: boolean) => void;
  onFetch: () => Promise<ProviderModelListResult>;
  onAddModels: (modelIds: readonly string[]) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; models: readonly ProviderModelListEntry[] }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const savingRef = useRef(false);
  // 关闭后迟到的响应不能把新一次打开的空状态改成旧清单。
  const generationRef = useRef(0);
  // 父层每次渲染都会换 onFetch 身份；读取只在打开时发生一次，回调走 ref。
  const onFetchRef = useRef(onFetch);
  onFetchRef.current = onFetch;

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setState({ status: "loading" });
    setCommitError(null);
    try {
      const result = await onFetchRef.current();
      if (generationRef.current !== generation) return;
      if (!result.success) {
        setState({ status: "error", message: result.error.message });
        return;
      }
      setState({ status: "ready", models: result.models });
    } catch (error) {
      if (generationRef.current !== generation) return;
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    if (!open) {
      generationRef.current += 1;
      setState({ status: "idle" });
      setSelected(new Set());
      setQuery("");
      setCommitError(null);
      setSaving(false);
      savingRef.current = false;
      return;
    }
    // 只在打开瞬间读取一次；父层重渲染带来的 onFetch 身份变化不应重新发请求。
    void load();
  }, [load, open]);

  const importable = useMemo(
    () =>
      state.status === "ready"
        ? resolveImportableModels({ models: state.models, existingModelIds, query })
        : [],
    [existingModelIds, query, state],
  );
  const existingKeys = useMemo(
    () => new Set(existingModelIds.map(toModelIdKey)),
    [existingModelIds],
  );
  const selectedIds = useMemo(
    () => importable.filter((model) => selected.has(model.modelId)).map((model) => model.modelId),
    [importable, selected],
  );

  const toggle = (modelId: string, next: boolean) => {
    setSelected((current) => {
      const nextSet = new Set(current);
      if (next) nextSet.add(modelId);
      else nextSet.delete(modelId);
      return nextSet;
    });
  };

  const commit = async () => {
    if (savingRef.current || selectedIds.length === 0) return;
    savingRef.current = true;
    setSaving(true);
    setCommitError(null);
    try {
      await onAddModels(selectedIds);
      savingRef.current = false;
      setSaving(false);
      onOpenChange(false);
    } catch (error) {
      savingRef.current = false;
      setSaving(false);
      setCommitError(error instanceof Error ? error.message : String(error));
    }
  };

  const allImportableSelected =
    importable.length > 0 && importable.every((model) => selected.has(model.modelId));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 保存中的关闭会让旧请求结束后清掉新草稿；等提交完成再允许关闭。
        if (savingRef.current) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[min(40rem,calc(100vh-4rem))] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-clip"
        data-testid={TID_MODEL_PROVIDER_MODEL_PICKER}
        data-no-model-drag="true"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">
            {intl.formatMessage({ id: "settings.modelProvider.importModelsTitle" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage(
              { id: "settings.modelProvider.importModelsDescription" },
              { provider: providerName ?? "" },
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 -mr-3 space-y-3 overflow-y-auto pr-4">
          <div className="flex items-center gap-2">
            <Input
              type="search"
              size="lg"
              value={query}
              placeholder={intl.formatMessage({ id: "settings.modelProvider.importModelsSearch" })}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="shrink-0"
              data-testid={TID_MODEL_PROVIDER_MODEL_PICKER_REFRESH}
              disabled={state.status === "loading" || saving}
              onClick={() => void load()}
            >
              <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.importModelsRefresh" })}
            </Button>
          </div>
          {state.status === "loading" ? (
            <div
              role="status"
              className="flex min-h-16 items-center justify-center gap-2 text-ui-base text-foreground-subtle"
            >
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.importModelsLoading" })}
            </div>
          ) : null}
          {state.status === "error" ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive"
            >
              {intl.formatMessage(
                { id: "settings.modelProvider.importModelsFailed" },
                { error: state.message },
              )}
            </div>
          ) : null}
          {state.status === "ready" ? (
            importable.length === 0 ? (
              <div className="flex min-h-16 items-center justify-center rounded-lg border border-dashed border-border px-4 text-ui-base text-foreground-subtle">
                {intl.formatMessage({
                  id:
                    state.models.length === 0
                      ? "settings.modelProvider.importModelsEmpty"
                      : "settings.modelProvider.importModelsNoMatch",
                })}
              </div>
            ) : (
              <div className="space-y-1">
                <label className="flex min-h-8 cursor-pointer items-center gap-2 px-1 text-ui-sm text-foreground-subtle">
                  <Checkbox
                    checked={
                      allImportableSelected
                        ? true
                        : selectedIds.length > 0
                          ? "indeterminate"
                          : false
                    }
                    aria-label={intl.formatMessage({
                      id: "settings.modelProvider.importModelsSelectAll",
                    })}
                    onCheckedChange={() => {
                      if (allImportableSelected) {
                        setSelected(new Set());
                        return;
                      }
                      setSelected(new Set(importable.map((model) => model.modelId)));
                    }}
                  />
                  {intl.formatMessage({ id: "settings.modelProvider.importModelsSelectAll" })}
                </label>
                <div className="overflow-hidden rounded-lg border border-input-border bg-input">
                  {importable.map((model, index) => {
                    const checkboxId = `provider-model-import-${index}`;
                    const checked = selected.has(model.modelId);
                    return (
                      <label
                        key={model.modelId}
                        htmlFor={checkboxId}
                        data-testid={testId(TID_MODEL_PROVIDER_MODEL_PICKER_ROW, model.modelId)}
                        data-selected={checked}
                        className={cn(
                          "flex min-h-9 cursor-pointer items-center gap-2 px-3 py-1.5 text-ui-base text-foreground",
                          index > 0 && "border-t border-input-border",
                        )}
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          disabled={saving}
                          onCheckedChange={(value) => toggle(model.modelId, value === true)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-ui-base">
                            {model.modelId}
                          </span>
                          {model.displayName ? (
                            <span className="block truncate text-ui-sm text-foreground-subtle">
                              {model.displayName}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {state.models.some((model) => existingKeys.has(toModelIdKey(model.modelId))) ? (
                  <p className="px-1 text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.modelProvider.importModelsExistingHint" })}
                  </p>
                ) : null}
              </div>
            )
          ) : null}
          {commitError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive"
            >
              {intl.formatMessage(
                { id: "settings.modelProvider.importModelsAddFailed" },
                { error: commitError },
              )}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button
            type="button"
            variant="default"
            size="lg"
            data-testid={TID_MODEL_PROVIDER_MODEL_PICKER_CONFIRM}
            disabled={saving || selectedIds.length === 0}
            onClick={() => void commit()}
          >
            {saving ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage(
              { id: "settings.modelProvider.importModelsAddSelected" },
              { count: String(selectedIds.length) },
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
