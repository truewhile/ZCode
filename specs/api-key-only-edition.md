# 第三方 API 接入版（仅 API Key）

状态：已实现（本仓库当前分支）

## 背景

产品只面向「自带第三方模型 API」的使用方式。官方账号体系（Z.ai / BigModel OAuth 登录、
Coding Plan / Start Plan 套餐、奖励、云远控鉴权、营销触达）不再作为产品入口暴露；
模型能力统一通过 Provider + API Key（或自定义端点）接入。

## 产品规则

1. **登录入口唯一形态**：`WelcomeScreen` 只渲染 Provider 选择 + API Key 表单
   （`packages/ui/src/login/LoginApiKeyForm.tsx`），没有官方渠道按钮、等待态、
   失败重试或「重新登录」。
2. **启动门禁只看 Provider**：`useProviderAvailabilityLoginEntryGuard` 的唯一判定是
   「是否存在可用模型 Provider」；官方账号态、`providerFamilyDomain`、OAuth 会话恢复
   都不再参与启动判定。
3. **没有官方账号 UI**：侧边栏底部菜单、命令面板、设置页 Provider 面板都不提供
   官方登录/登出、套餐购买、奖励、营销弹窗、云远控登录按钮。
4. **第三方 API 路径不变**：Provider 模板、API Key 保存、模型选择、自定义端点、
   连通性测试保持原样。

## 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 可用 Provider 快照 | `modelSelectionService` | 启动门禁与登录入口判定的唯一事实源 |
| API Key Provider 创建 | `providerSettingsService.createPersonalProvider` | 登录页写入后由 `markApiKeyLoginSuccess` 记录偏好 |
| 登录入口开关 | `Root` 的 `welcomeScreenOpenReason` | 只剩 `startup-provider-required` 一种原因 |
| 官方账号态 | 不再有 UI 写入方 | store 中 `user` 恒为 `null` |

## 删除清单

UI 层：

- `packages/ui/src/WelcomeScreen.tsx`：重写为仅 API Key 接入。
- `packages/ui/src/hooks/useOAuth.ts`、`hooks/useTokenRefresh.ts`：删除。
- `packages/ui/src/root/useRootOAuthEffects.ts` 及 OAuth 恢复/登录尝试/账号连接丢失辅助模块：删除。
- `packages/ui/src/rewards/*`、`components/marketing-touch/*` 的 Provider、Banner、
  弹窗与刷新 hook：删除。
- `Root.tsx`：移除 OAuth 回调/轮询、token 刷新、登录请求自动拉起、登出后重连、
  `session-expired` 启动原因；Provider 树不再挂奖励与营销触达 Provider。
- 侧边栏 footer：移除账号头像菜单、登录/登出、奖励、套餐徽标、用量摘要、云远控入口。
- 设置页：移除 Provider 的官方 Coding Plan/Start Plan 导航节点、套餐购买/解绑回调、
  设置层登录/登出透传。
- 命令面板：移除 `login` / `logout` 命令。
- 聊天错误横幅、会话输入框：移除套餐升级动作（只保留「打开模型设置」）。

第二轮（打包后仍出现「智谱 / BigModel」选项）：

- `settings/model-provider-section/constants.ts`：`PRESET_PROVIDER_SPECS` 置空，
  官方预设分组（Z.ai / BigModel + Start Plan）不再出现在模型供应商导航。
- `settings/model-provider-section/ProviderTemplatePicker.tsx`：模板选择去掉 `zhipu`
  分组，`bigmodel-api` / `zai-api` / `*-standard-api` 模板不再可创建。
- `login/LoginApiKeyForm.tsx`：登录入口改为创建**第三方自定义供应商**
  （名称 + Base URL + API 格式 + API Key + 首个模型 ID），创建后立即补一条模型，
  避免「无模型 Provider 不算可用」导致登录页反复弹出。
- `settings/ModelProviderSection.tsx`：没有任何供应商时自动打开模板选择，不停在 loading 卡片。
- `settings/model-provider-section/Navigation.tsx`：空分组不再渲染标题。

CLI（未在本轮改动）：

- `apps/zcode-cli/packages/cli/src/login-command.ts`、`command-center` 的
  `/login`、`/logout`、TUI 登录态展示仍保留官方 OAuth 实现，属于后续独立变更。

## 验收场景

1. 首次启动、未配置任何 Provider → 显示登录页，表单为「供应商名称 / Base URL / API 格式 / API Key / 模型 ID」。
2. 填写合法值 → 创建自定义 Provider + 首个模型，关闭登录页，进入工作区。
3. 选择「暂时跳过」→ 关闭登录页，进入匿名工作区，不再自动弹出登录页。
4. 已配置可用 Provider → 重启后直接进入工作区，不出现登录页。
5. 侧边栏底部菜单只有语言、主题、界面模式、缩放与设置入口。
6. 命令面板不存在 `login` / `logout` 命令。
7. 设置页模型供应商只有「自定义供应商」分组，没有「智谱 / BigModel」预设与 Coding Plan 节点。
8. 全新安装进入设置 → 模型供应商，自动打开模板选择（只含第三方模板 + 自定义供应商）。

## 验证

- `pnpm typecheck`：通过。
- `pnpm lint`：0 error（警告为存量）。
- `npx vitest run packages/ui/test`：相关用例已按新形态更新。