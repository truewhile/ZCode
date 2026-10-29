import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  DEFAULT_DESKTOP_PACKAGE_PLATFORMS,
  DESKTOP_PACKAGE_TARGETS,
  resolveDesktopPackageMatrix,
} from "../ci/resolve-desktop-package-matrix.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../..");
const scriptPath = resolve(repoRoot, "scripts/ci/resolve-desktop-package-matrix.mjs");
const workflowPath = resolve(repoRoot, ".github/workflows/desktop-package.yml");

test("默认矩阵覆盖 macOS/Windows/Linux 的 x64 与 Apple Silicon 主链路", () => {
  const { include, platforms } = resolveDesktopPackageMatrix({});

  assert.deepEqual(platforms, [...DEFAULT_DESKTOP_PACKAGE_PLATFORMS]);
  assert.deepEqual(
    include.map((target) => target.name),
    [...DEFAULT_DESKTOP_PACKAGE_PLATFORMS],
  );
  assert.ok(include.every((target) => target.runner.length > 0));
});

test("每个目标都携带 electron-builder 可识别的 os/arch 组合", () => {
  const allowedOs = new Set(["mac", "win", "linux"]);
  const allowedArch = new Set(["x64", "arm64"]);

  for (const target of DESKTOP_PACKAGE_TARGETS) {
    assert.ok(allowedOs.has(target.os), `unexpected os: ${target.os}`);
    assert.ok(allowedArch.has(target.arch), `unexpected arch: ${target.arch}`);
    assert.equal(
      target.name,
      `${target.os === "mac" ? "macos" : target.os === "win" ? "windows" : "linux"}-${target.arch}`,
    );
  }
});

test("platforms 输入按声明顺序收窄并忽略空白", () => {
  const { include, platforms } = resolveDesktopPackageMatrix({
    platforms: " linux-arm64 , windows-x64 , ",
  });

  assert.deepEqual(platforms, ["windows-x64", "linux-arm64"]);
  assert.deepEqual(
    include.map((target) => target.runner),
    ["windows-2025", "ubuntu-24.04-arm"],
  );
});

test("空 platforms 回落到默认矩阵", () => {
  for (const platforms of ["", "   ", undefined]) {
    const resolved = resolveDesktopPackageMatrix({ platforms });
    assert.deepEqual(resolved.platforms, [...DEFAULT_DESKTOP_PACKAGE_PLATFORMS]);
  }
});

test("未知平台直接失败，不被静默忽略", () => {
  assert.throws(
    () => resolveDesktopPackageMatrix({ platforms: "windows-x86" }),
    /unknown desktop package platform/,
  );
  assert.throws(
    () => resolveDesktopPackageMatrix({ platforms: "macos-arm64,linux-x86" }),
    /unknown desktop package platform/,
  );
});

test("命令行未知平台以退出码 1 结束，且只输出一行原因", async () => {
  const failure = await execFileAsync(
    process.execPath,
    [scriptPath, "--platforms", "windows-x86"],
    { cwd: repoRoot },
  ).then(
    () => null,
    (error) => error,
  );

  assert.ok(failure, "expected non-zero exit");
  assert.equal(failure.code, 1);
  assert.match(failure.stderr, /\[ci\] resolve desktop package matrix failed: unknown/);
  assert.doesNotMatch(failure.stderr, /\n\s+at /);
});

test("命令行输出可直接作为 matrix.include 使用", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [scriptPath, "--platforms", "windows-x64"],
    { cwd: repoRoot },
  );

  const parsed = JSON.parse(stdout);
  // include 必须是数组：workflow 里写的是 `matrix: include: ${{ fromJSON(...) }}`，
  // 一旦包成 { include: [...] }，GitHub 求值 strategy 时会报 "A mapping was not expected"。
  assert.ok(Array.isArray(parsed), `expected an array, received ${typeof parsed}`);
  assert.deepEqual(parsed, [
    { name: "windows-x64", os: "win", arch: "x64", runner: "windows-2025" },
  ]);
});

test("--github-output 写入 matrix/platforms/version 三个键", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-ci-matrix-"));
  const outputPath = join(dir, "github-output.txt");

  try {
    await execFileAsync(
      process.execPath,
      [scriptPath, "--platforms", "macos-arm64", "--github-output", outputPath],
      { cwd: repoRoot },
    );

    const content = await readFile(outputPath, "utf8");
    const keys = content
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(0, line.indexOf("=")));

    assert.deepEqual(keys, ["matrix", "platforms", "version"]);
    assert.match(content, /platforms=macos-arm64/);
    assert.match(content, /version=\d+\.\d+\.\d+/);

    // GITHUB_OUTPUT 里的 matrix 同样是数组字面量，不是带 include 包裹的对象。
    const matrixLine = content.split("\n").find((line) => line.startsWith("matrix="));
    assert.ok(matrixLine, "matrix output missing");
    assert.ok(Array.isArray(JSON.parse(matrixLine.slice("matrix=".length))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("workflow 用解析脚本产出矩阵，且不重复声明 runner 映射", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /resolve-desktop-package-matrix\.mjs/);
  assert.match(workflow, /include:\s*\$\{\{ fromJSON\(needs\.meta\.outputs\.matrix\) \}\}/);
  // 打包必须走仓库统一入口，不能在这里直接调 electron-builder。
  assert.match(
    workflow,
    /pnpm bundle:desktop -- --os \$\{\{ matrix\.os \}\} --arch \$\{\{ matrix\.arch \}\}/,
  );
  assert.doesNotMatch(workflow, /exec electron-builder/);
});

test("Release 只收扁平化后可去重的资产，更新清单留在 artifact", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  // 多个平台都会产出 latest*.yml，拍平到 Release 资产必然重名互相覆盖。
  assert.match(workflow, /name 'SHA256SUMS\.txt'/);
  assert.match(workflow, /files:\s*\|\s*\n\s*release-assets\/\*\*/);
  assert.doesNotMatch(workflow, /files:\s*\|\s*\n\s*artifacts\/\*\*/);
  assert.doesNotMatch(workflow, /release-assets\/latest/);
});

test("workflow 里引用的每个 matrix.* 键都存在于目标对象", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  // matrix.include 必须是单个表达式取值；写成映射字面量就是 GitHub 报
  // "A mapping was not expected" 的那种错误。这里按行断言，避免为了解析 YAML
  // 把 yaml 依赖带进 meta job（那一步跑在 pnpm install 之前）。
  const includeLine = workflow
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("include:"));
  assert.ok(includeLine, "workflow 缺少 matrix.include");
  assert.match(
    includeLine,
    /^include:\s*\$\{\{\s*fromJSON\(needs\.meta\.outputs\.matrix\)\s*\}\}$/,
  );
  assert.doesNotMatch(includeLine, /\{$/);

  // 只匹配 `${{ matrix.xxx }}` 形式的表达式，避免把脚本名 resolve-desktop-package-matrix.mjs
  // 里的 "matrix.mjs" 误当成矩阵键。
  const referencedKeys = new Set(
    [...workflow.matchAll(/\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map(
      (match) => match[1],
    ),
  );
  assert.ok(referencedKeys.size > 0, "workflow 未引用任何 matrix 键");

  for (const target of DESKTOP_PACKAGE_TARGETS) {
    const availableKeys = new Set(Object.keys(target));
    for (const key of referencedKeys) {
      assert.ok(availableKeys.has(key), `matrix.${key} 不在目标对象 ${target.name} 上`);
    }
  }
});
