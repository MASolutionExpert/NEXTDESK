import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

const headless = process.env.VITEST_HEADFUL !== "1";
const isCoverage =
  process.argv.includes("--coverage") || process.env.VITEST_COVERAGE === "1";

const browserInstances = isCoverage
  ? [
      {
        browser: "chromium",
        launch: {
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        },
      },
    ]
  : [
      {
        browser: "chromium",
        launch: {
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        },
      },
      { browser: "firefox" },
    ];

const browserOptimizeInclude = [
  "lucide-react",
  "vitest-browser-react",
  "react",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
];

export default defineConfig({
  plugins: [react()],
  test: {
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.{js,jsx}"],
      exclude: [
        "node_modules/**",
        ".next/**",
        "coverage/**",
        "test/**",
        "**/*.test.{js,jsx}",
        "**/*.spec.{js,jsx}",
      ],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "test/utils/**/*.{test,spec}.{js,jsx}",
            "test/hooks/**/*.{test,spec}.{js,jsx}",
          ],
          environment: "node",
        },
      },
      {
        optimizeDeps: {
          include: browserOptimizeInclude,
        },
        test: {
          name: "browser",
          include: ["test/components/**/*.{test,spec}.{js,jsx}"],
          exclude: ["test/bench/**"],
          testTimeout: 20000,
          browser: {
            enabled: true,
            headless,
            provider: playwright(),
            instances: browserInstances,
            locators: {
              exact: false,
            },
          },
        },
      },
    ],
  },
  benchmark: {
    include: ["test/bench/**/*.bench.js"],
  },
});
