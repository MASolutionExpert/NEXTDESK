import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import ServicesTab from "../../../src/components/admin/ServicesTab.tsx";

function makeData(database: any) {
  return {
    mediaWorker: { configured: false, reachable: false, latencyMs: null },
    remoteChannel: { enabled: false },
    storage: { driver: "local", reachable: true, latencyMs: 3 },
    database,
  };
}

describe("ServicesTab database card (PostgreSQL-only)", () => {
  test("postgres mode renders an enabled Database card with latency", async () => {
    render(
      <ServicesTab
        data={makeData({
          client: "postgres",
          configured: true,
          reachable: true,
          latencyMs: 12,
        })}
      />,
    );
    const card = page.getByRole("button", { name: /database/i });
    await expect.element(card).toBeInTheDocument();
    await expect.element(card).toBeEnabled();
    await expect
      .element(card.getByText("PostgreSQL · 12ms"))
      .toBeInTheDocument();
    await expect
      .element(card.getByText("Active", { exact: true }))
      .toBeInTheDocument();
  });

  test("unreachable postgres reports Unreachable", async () => {
    render(
      <ServicesTab
        data={makeData({
          client: "postgres",
          configured: true,
          reachable: false,
          latencyMs: 3001,
        })}
      />,
    );
    const card = page.getByRole("button", { name: /database/i });
    await expect.element(card).toBeInTheDocument();
    await expect.element(card).toBeEnabled();
    await expect
      .element(card.getByText("PostgreSQL unreachable."))
      .toBeInTheDocument();
    await expect
      .element(card.getByText("Unreachable", { exact: true }))
      .toBeInTheDocument();
  });
});
