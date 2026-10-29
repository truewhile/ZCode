/**
 * WelcomeScreen —— 第三方 API Key 接入入口
 *
 * 产品形态：只接入第三方模型 API。官方账号 OAuth 登录入口已移除，
 * 这里仅保留 Provider + API Key 的接入表单，不再提供官方渠道登录、等待与重试流程。
 */
import type { ReactNode } from "react";
import { ZCodeAboutLogo } from "@/components/ui/ZCodeAboutLogo.js";
import { useZCodeIntl } from "./i18n/IntlProvider.js";
import { LoginApiKeyForm } from "./login/LoginApiKeyForm.js";
import { ThemeHeroVisual } from "./openWorkspacePageThemeHero.js";
import { DesktopOverlayWindowControls } from "@/DesktopOverlayWindowControls.js";

interface WelcomeScreenProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}

/** API Key 接入成功或用户选择跳过。官方 OAuth 完成态随登录入口一起移除。 */
export type LoginCompleteReason = "apiKey" | "skip";

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  return (
    <main className="relative flex h-full min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-6 text-foreground sm:px-6">
      <ThemeHeroVisual className="absolute inset-0" />
      {/* 原生拖拽命中不受 pointer-events/z-index 约束；拖拽层必须避开窗控，且先于 no-drag 区声明。 */}
      <div className="pointer-events-none absolute left-0 top-0 right-0 z-10 flex h-12 items-center [app-region:drag] platform-windows-desktop:right-[134px] platform-linux-desktop:right-[134px]" />
      <DesktopOverlayWindowControls />
      <section className="relative z-10 w-full flex flex-col gap-10 max-w-sm rounded-2xl border border-popover-border bg-background p-8 text-ui-base/relaxed shadow-md sm:p-10">
        <LoginPanel onComplete={onComplete} />
      </section>
    </main>
  );
}

interface LoginPanelProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}

export function LoginPanel({ onComplete }: LoginPanelProps) {
  const { intl } = useZCodeIntl();

  return (
    <>
      <LoginPanelHeader
        title={intl.formatMessage({ id: "login.title" })}
        description={intl.formatMessage({ id: "login.apiKey.description" })}
      >
        {null}
      </LoginPanelHeader>

      <div className="space-y-6">
        <LoginApiKeyForm
          onCancel={() => {
            // 没有官方渠道列表可返回，取消等价于跳过接入。
            return onComplete("skip");
          }}
          onSaved={() => onComplete("apiKey")}
          onSkipped={() => onComplete("skip")}
        />
      </div>
    </>
  );
}

function LoginPanelHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <header className="flex flex-col items-center gap-3 text-center">
      <LoginPanelLogo />
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-ui-base/relaxed text-foreground-subtle">{description}</p>
      </div>
      {children}
    </header>
  );
}

function LoginPanelLogo() {
  return (
    // 登录 logo 壳是固定深色底，边框不能跟随浅色主题 token，否则浅色主题下边框过重。
    <div
      className="relative mb-1 flex size-16 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] shadow-lg/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:border before:border-[rgba(255,255,255,0.1)]"
      aria-label="ZCode"
      role="img"
    >
      <ZCodeAboutLogo className="h-auto w-10" />
    </div>
  );
}