import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * 从 Provider `/models` 勾选导入模型的浏览器用例。
 *
 * 夹具让 Host 侧 `onListModels` 返回两条新模型和一条已配置模型，
 * 断言：已配置模型不出现在勾选列表、全选只提交新增模型、弹窗按保存结果关闭。
 */
export function registerProviderModelImportCases(getEnvironment) {
  for (const [width, locale, theme] of [
    [390, "zh-CN", "light"],
    [1200, "en-US", "dark"],
  ]) {
    // 首个用例还要等 Vite 依赖预打包，30s 会把它误判成失败；
    // 本用例只新增一个弹窗交互，放宽到 90s 不掩盖真实卡死。
    test(`provider model import ${width}/${locale}`, { timeout: 90000 }, async () => {
      const { browser, origin } = getEnvironment();
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      // 单独运行本用例时 Vite 仍在冷启动预打包；默认 30s 导航超时会把冷启动当成产品失败。
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(90000);
      const mutations = [];
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.route("**/mutation", async (route) => {
        mutations.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, body: "{}" });
      });
      try {
        await page.goto(
          `${origin}fixture?${new URLSearchParams({ locale, theme, access: "manual" })}`,
        );
        await page.getByTestId("model-provider-import-models-button").click();
        const picker = page.getByTestId("model-provider-model-picker");
        await picker.waitFor();
        await page.getByTestId("model-provider-model-picker-row-import-fixture-a").waitFor();
        // 夹具回包里第一条是已配置模型，它必须被过滤掉，只剩两条可导入。
        assert.equal(
          await page.locator('[data-testid^="model-provider-model-picker-row-"]').count(),
          2,
        );
        assert.equal(mutations.filter((item) => item.action === "listModels").length, 1);

        const selectAll =
          locale === "zh-CN" ? picker.getByText("全选") : picker.getByText("Select all");
        await selectAll.click();
        const confirm = page.getByTestId("model-provider-model-picker-confirm");
        await confirm.click();
        await page.waitForFunction(
          () => !document.querySelector('[data-testid="model-provider-model-picker"]'),
        );
        const added = mutations.filter((item) => item.action === "add");
        // 夹具的 onAddPersonalModel 只回传 modelId，这里比较串本身。
        assert.deepEqual(
          added.map((item) => item.payload),
          ["import-fixture-a", "import-fixture-b"],
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }
}
