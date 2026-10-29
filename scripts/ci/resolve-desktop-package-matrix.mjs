#!/usr/bin/env node
// GitHub Actions 桌面打包流水线的目标矩阵解析（唯一所有者）。
//
// 为什么不把矩阵写在 YAML 里：手动触发需要按 platforms 输入收窄平台，
// tag / PR / push 又要有稳定默认值。两处各写一份矩阵会让 runner 标签和
// electron-builder 的 os/arch 别名逐渐漂移，这里集中一次并支持本地自检：
//
//   node scripts/ci/resolve-desktop-package-matrix.mjs
//   node scripts/ci/resolve-desktop-package-matrix.mjs --platforms macos-arm64,windows-x64
//   node scripts/ci/resolve-desktop-package-matrix.mjs --platforms "" --github-output out.txt
//
// runner 标签选择依据：
// - macos-15       → Apple Silicon（arm64），GitHub 标准 macOS 标签
// - macos-15-intel → 最后一个 x86_64 macOS 镜像，支持到 2027 年 8 月
// - windows-2025 / ubuntu-24.04 / ubuntu-24.04-arm 为当前标准镜像
// 见 https://docs.github.com/actions/using-jobs/choosing-the-runner-for-a-job

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 与 `packages/desktop/scripts/bundle.mjs` 的 os/arch 别名保持一致：
 * builder.mjs 接受 mac|win|linux + x64|arm64，脚本内部再映射成 --mac/--win/--linux。
 */
export const DESKTOP_PACKAGE_TARGETS = Object.freeze([
  { name: "macos-arm64", os: "mac", arch: "arm64", runner: "macos-15" },
  { name: "macos-x64", os: "mac", arch: "x64", runner: "macos-15-intel" },
  { name: "windows-x64", os: "win", arch: "x64", runner: "windows-2025" },
  { name: "windows-arm64", os: "win", arch: "arm64", runner: "windows-2025" },
  { name: "linux-x64", os: "linux", arch: "x64", runner: "ubuntu-24.04" },
  { name: "linux-arm64", os: "linux", arch: "arm64", runner: "ubuntu-24.04-arm" },
]);

// 默认矩阵：正式发布覆盖 Windows/macOS/Linux 的 x64 与 Apple Silicon，
// windows-arm64 与 linux-arm64 保留为手动可选，避免默认把 6 个 runner 全部拉满。
export const DEFAULT_DESKTOP_PACKAGE_PLATFORMS = Object.freeze([
  "macos-arm64",
  "macos-x64",
  "windows-x64",
  "linux-x64",
]);

const KNOWN_TARGET_NAMES = new Set(DESKTOP_PACKAGE_TARGETS.map((target) => target.name));

function parsePlatformList(rawValue) {
  const requested = (rawValue ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    return [...DEFAULT_DESKTOP_PACKAGE_PLATFORMS];
  }

  const unknown = requested.filter((name) => !KNOWN_TARGET_NAMES.has(name));
  if (unknown.length > 0) {
    // 未知平台必须直接失败：静默忽略会让「手动选了 arm64」变成「什么都没打」。
    throw new Error(
      `unknown desktop package platform(s): ${unknown.join(", ")}; expected one of ${[
        ...KNOWN_TARGET_NAMES,
      ].join(", ")}`,
    );
  }

  // 去重但保持 YAML 中声明的顺序，方便阅读 job 列表。
  const requestedSet = new Set(requested);
  return DESKTOP_PACKAGE_TARGETS.filter((target) => requestedSet.has(target.name)).map(
    (target) => target.name,
  );
}

export function resolveDesktopPackageMatrix({ platforms } = {}) {
  const selectedNames = parsePlatformList(platforms);
  const selectedSet = new Set(selectedNames);
  const include = DESKTOP_PACKAGE_TARGETS.filter((target) => selectedSet.has(target.name));

  if (include.length === 0) {
    throw new Error("desktop package matrix is empty");
  }

  return {
    include,
    platforms: include.map((target) => target.name),
  };
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function writeGithubOutput(filePath, values) {
  const absolutePath = resolve(filePath);
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(absolutePath, `${lines.join("\n")}\n`, "utf8");
}

function readWorkspaceVersion() {
  return JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).version;
}

function main(argv) {
  const platformsArg = readArg(argv, "--platforms");
  const githubOutput = readArg(argv, "--github-output");
  const { include, platforms } = resolveDesktopPackageMatrix({
    platforms: platformsArg ?? undefined,
  });
  const version = readWorkspaceVersion();

  const matrixJson = JSON.stringify({ include });
  if (githubOutput) {
    writeGithubOutput(githubOutput, {
      matrix: matrixJson,
      platforms: platforms.join(","),
      version,
    });
  }
  process.stdout.write(`${matrixJson}\n`);
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : null;
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    // CI 日志里只需要一句人可读的原因，不打整段堆栈。
    console.error(
      `[ci] resolve desktop package matrix failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
