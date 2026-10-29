# GitHub Actions 桌面打包

状态：已实现（`.github/workflows/desktop-package.yml`）

## 背景

桌面安装包此前只有 GitLab CI 一条流水线（见 [Desktop CI/CD](desktop-ci-cd.md)），它依赖内网
Runner、共享目录、OSS 上传与后端 release API。开源仓库与没有内网设施的协作者需要一个只要
GitHub 账号就能跑通的打包入口：推 tag 出安装包，PR 能验证打包链路没坏。

本流水线**只负责产出安装包**，不承担灰度、全量发布、CDN 预热和更新 feed 写入；那些仍是
既有发布链路的职责。

## 产品规则

1. **单一打包入口**：每个平台 job 只执行
   `pnpm bundle:desktop -- --os <os> --arch <arch>`。`packages/desktop/scripts/bundle.mjs`
   自己负责 `prepare:runtime-assets` → 生产构建 → electron-builder → 产物运行时依赖自检 →
   体积审计。workflow 不复制 electron-builder 参数，也不直接调 `electron-builder`。
2. **矩阵只有一个所有者**：目标平台、runner 标签与 `--os/--arch` 的映射集中在
   [`scripts/ci/resolve-desktop-package-matrix.mjs`](../scripts/ci/resolve-desktop-package-matrix.mjs)。
   workflow 的 `meta` job 调用它，再用 `fromJSON(needs.meta.outputs.matrix)` 展开
   `matrix.include`。
3. **未知平台直接失败**：`platforms` 输入里出现不认识的平台名时脚本抛错并退出 1，不静默忽略。
4. **签名默认关闭**：没有证书时产出未签名但可安装的包。证书 secrets 存在时才按平台打开开关。
5. **tag 才发 Release**：`v*` tag 推送后汇总全部平台产物，生成 `SHA256SUMS.txt`，创建**草稿**
   Release；不覆盖任何更新 feed。

## 目标平台

| matrix.name     | os      | arch    | runner             | 产物                                                            |
| --------------- | ------- | ------- | ------------------ | --------------------------------------------------------------- |
| `macos-arm64`   | `mac`   | `arm64` | `macos-15`         | `.dmg`、`.zip`、`latest-mac.yml`、`*.blockmap`                  |
| `macos-x64`     | `mac`   | `x64`   | `macos-15-intel`   | 同上                                                            |
| `windows-x64`   | `win`   | `x64`   | `windows-2025`     | `.exe`（NSIS）、`latest.yml`、`*.blockmap`                      |
| `windows-arm64` | `win`   | `arm64` | `windows-2025`     | 同上（x64 runner 交叉产出 arm64 NSIS）                          |
| `linux-x64`     | `linux` | `x64`   | `ubuntu-24.04`     | `.AppImage`、`.deb`、`.rpm`、`.pkg.tar.zst`、`latest-linux.yml` |
| `linux-arm64`   | `linux` | `arm64` | `ubuntu-24.04-arm` | 同上                                                            |

默认矩阵是 `macos-arm64`、`macos-x64`、`windows-x64`、`linux-x64`。`windows-arm64` 与
`linux-arm64` 保留为手动可选，避免默认把 6 个 runner 同时拉满。

`macos-15-intel` 是 GitHub 目前唯一还能用的 x86_64 macOS 镜像，官方支持到 2027 年 8 月
（[runner 标签说明](https://docs.github.com/actions/using-jobs/choosing-the-runner-for-a-job)、
[macOS 13 镜像退役公告](https://github.blog/changelog/2025-09-19-github-actions-macos-13-runner-image-is-closing-down)）。
需要长期 Intel 支持时应改用自建 runner。

## 触发

| 事件                     | 行为                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| push `v*` tag            | 默认矩阵（四平台）打包 → 草稿 Release + `SHA256SUMS.txt`                       |
| PR 到 `main` / `staging` | 只打 `windows-x64,linux-x64`，验证打包链路，只留 artifact，不发 Release        |
| `workflow_dispatch`      | 用 `platforms` 输入任意收窄平台；`environment` 选 `test` 打 Preview/`_TEST` 包 |

PR 收窄到两个 x64 平台是刻意取舍：macOS 双架构与 arm64 需要额外 runner 分钟数，而打包链路
（准备资源 → 生产构建 → electron-builder → 产物依赖自检 → 体积审计）在 Windows/Linux 上已全部
覆盖。需要验证 macOS 产物时用 `workflow_dispatch` 指定 `platforms`。

`workflow_dispatch` 示例：

```bash
# 只打 Windows x64 与 Linux arm64 的测试后端包
gh workflow run desktop-package.yml \
  -f platforms="windows-x64,linux-arm64" \
  -f environment=test
```

## 关键变量

| 变量                                    | 作用                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `ZCODE_TARGET_OS` / `ZCODE_TARGET_ARCH` | 交给 `bundle.mjs` 的交叉打包目标（与 `--os/--arch` 同义）                          |
| `ZCODE_ENV`                             | `production` 出正式包；`test` 出 `_TEST` 后缀 + Preview 身份包                     |
| `ZCODE_ENABLE_MAC_SIGN`                 | 只有 `1` 且存在 `APPLE_SIGNING_IDENTITY`/`CSC_NAME` 时才启用 hardened runtime 签名 |
| `ZCODE_ENABLE_WINDOWS_SIGN`             | 本流水线固定 `0`：仓库 `scripts/sign-windows.ps1` 封装不随开源树发布               |
| `ELECTRON_MIRROR`                       | Electron runtime 下载源，GitHub runner 上用官方 release 地址                       |
| `ELECTRON_BUILDER_BINARIES_MIRROR`      | NSIS / dmg-builder / appimage / fpm 辅助包下载源                                   |

可选 secrets：

| Secret                                          | 用途                                                    |
| ----------------------------------------------- | ------------------------------------------------------- |
| `APPLE_SIGNING_IDENTITY`                        | macOS 签名身份（`Developer ID Application: ...`）       |
| `APPLE_CSC_LINK` / `APPLE_CSC_KEY_PASSWORD`     | macOS `.p12`（base64 或路径）与口令                     |
| `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD` | Windows 证书与口令，交给 electron-builder 自带 signtool |

未配置密钥时 macOS 产物未签名，Gatekeeper 会拦截首次打开：

```bash
sudo xattr -rd com.apple.quarantine /Applications/ZCode.app
```

## 与 GitLab 流水线的分工

| 职责                                 | GitHub Actions               | GitLab CI |
| ------------------------------------ | ---------------------------- | --------- |
| 打安装包（六平台）                   | 是（默认四平台，手动可全选） | 是        |
| 单元测试 / typecheck                 | 否（只跑矩阵脚本自测）       | 是        |
| 内网签名基础设施（vsigntool）        | 否                           | 是        |
| DMG 公证 + staple                    | 否                           | 是        |
| OSS 上传 / CDN 预热 / 灰度与全量发布 | 否                           | 是        |
| 草稿 GitHub Release                  | 是（仅 tag）                 | 否        |

## 排障

- **`fpm` 报 `Need executable 'rpmbuild'`**：Linux job 缺 `rpm`/`xz-utils`；workflow 已安装，
  自建 runner 需预装。
- **`pnpm install --frozen-lockfile` 失败**：lockfile 与 `package.json` 不一致。本地先跑
  `pnpm install` 并提交 `pnpm-lock.yaml`，不要在 CI 里放宽成非 frozen 安装。
- **`bundle:verify-runtime-dependencies` 失败**：打包产物缺少 `app.asar` 内部依赖闭包，
  属于真实缺陷（安装后会启动崩溃），不要跳过该步。
- **`audit:bundle-size` 失败**：产物体积超过 500MB 上限，先确认是否误把 `dist/` 中间目录或
  其他平台 native 带进包。
- **`latest.yml` 互相覆盖**：`download-artifact` 显式用 `merge-multiple: false`，各平台清单位于
  各自的 `zcode-<platform>-<arch>/` 子目录。

## 验证

```bash
# 矩阵解析与 workflow 契约
node --test scripts/test/ci-desktop-package-matrix.test.mjs

# 矩阵输出（CI 与本地同一份实现）
node scripts/ci/resolve-desktop-package-matrix.mjs
node scripts/ci/resolve-desktop-package-matrix.mjs --platforms "windows-x64,linux-arm64"

# 打包入口参数（不实际打包）
pnpm bundle:desktop -- --os win --arch x64 --dry-run
```
