import { describe, test } from "vitest";
import { validateSetting } from "../../../src/server/lib/appSettings.ts";
import {
  normalizeHexColor,
  parseListValue,
  normalizeGroupUsername,
} from "../../../src/server/lib/dbToolHelpers.ts";
import { readEnvBool, readEnvInt } from "../../../src/server/settings/env.ts";

// ─── validateSetting ──────────────────────────────────────────────────────────
// Called on every settings read/write in the admin panel.

describe("validateSetting", () => {
  test("bool — valid truthy value", async ({ bench }: any) => {
    await bench("bool — valid truthy value", () => {
      validateSetting("SIGN_UP", "true");
    }).run();
  });

  test("bool — invalid value", async ({ bench }: any) => {
    await bench("bool — invalid value", () => {
      validateSetting("SIGN_UP", "maybe");
    }).run();
  });

  test("int — valid in-range value", async ({ bench }: any) => {
    await bench("int — valid in-range value", () => {
      validateSetting("FILE_UPLOAD_MAX_SIZE_MB", "50");
    }).run();
  });

  test("int — value below min (rejection path)", async ({ bench }: any) => {
    await bench("int — value below min (rejection path)", () => {
      validateSetting("FILE_UPLOAD_MAX_SIZE_MB", "0");
    }).run();
  });

  test("string — valid URL", async ({ bench }: any) => {
    await bench("string — valid URL", () => {
      validateSetting("PUSH_PROXY_URL", "http://proxy.example.com:8080");
    }).run();
  });

  test("unknown key (early-exit path)", async ({ bench }: any) => {
    await bench("unknown key (early-exit path)", () => {
      validateSetting("NO_SUCH_KEY", "value");
    }).run();
  });
});

// ─── normalizeHexColor ────────────────────────────────────────────────────────
// Called when saving user/group colors.

describe("normalizeHexColor", () => {
  test("valid 6-char hex with #", async ({ bench }: any) => {
    await bench("valid 6-char hex with #", () => {
      normalizeHexColor("#10b981");
    }).run();
  });

  test("valid 6-char hex without #", async ({ bench }: any) => {
    await bench("valid 6-char hex without #", () => {
      normalizeHexColor("10b981");
    }).run();
  });

  test("3-char shorthand expansion", async ({ bench }: any) => {
    await bench("3-char shorthand expansion", () => {
      normalizeHexColor("#f0a");
    }).run();
  });

  test("invalid input (null path)", async ({ bench }: any) => {
    await bench("invalid input (null path)", () => {
      normalizeHexColor("not-a-color");
    }).run();
  });
});

// ─── parseListValue ───────────────────────────────────────────────────────────
// Used when parsing CLI member lists.

describe("parseListValue", () => {
  test("comma-separated list", async ({ bench }: any) => {
    await bench("comma-separated list", () => {
      parseListValue("alice,bob,carol,dave");
    }).run();
  });

  test("space-separated list", async ({ bench }: any) => {
    await bench("space-separated list", () => {
      parseListValue("alice bob carol dave");
    }).run();
  });

  test("empty string", async ({ bench }: any) => {
    await bench("empty string", () => {
      parseListValue("");
    }).run();
  });
});

// ─── normalizeGroupUsername ───────────────────────────────────────────────────

describe("normalizeGroupUsername", () => {
  test("plain username", async ({ bench }: any) => {
    await bench("plain username", () => {
      normalizeGroupUsername("MyGroup");
    }).run();
  });

  test("@ prefixed", async ({ bench }: any) => {
    await bench("@ prefixed", () => {
      normalizeGroupUsername("@my_group");
    }).run();
  });
});

// ─── readEnvInt / readEnvBool ─────────────────────────────────────────────────
// Called at startup for every env var, and during hot reload.

describe("readEnvInt", () => {
  test("env var present and valid", async ({ bench }: any) => {
    process.env._BENCH_INT = "8080";
    await bench("env var present and valid", () => {
      readEnvInt("_BENCH_INT", 3000);
    }).run();
  });

  test("env var absent (fallback path)", async ({ bench }: any) => {
    delete process.env._BENCH_INT;
    await bench("env var absent (fallback path)", () => {
      readEnvInt("_BENCH_INT", 3000);
    }).run();
  });

  test("array of keys, first defined", async ({ bench }: any) => {
    process.env._BENCH_B = "42";
    await bench("array of keys, first defined", () => {
      readEnvInt(["_BENCH_A", "_BENCH_B"], 0);
    }).run();
  });
});

describe("readEnvBool", () => {
  test("truthy value", async ({ bench }: any) => {
    process.env._BENCH_BOOL = "true";
    await bench("truthy value", () => {
      readEnvBool("_BENCH_BOOL", false);
    }).run();
  });

  test("falsy value", async ({ bench }: any) => {
    process.env._BENCH_BOOL = "false";
    await bench("falsy value", () => {
      readEnvBool("_BENCH_BOOL", true);
    }).run();
  });

  test("env var absent (fallback path)", async ({ bench }: any) => {
    delete process.env._BENCH_BOOL;
    await bench("env var absent (fallback path)", () => {
      readEnvBool("_BENCH_BOOL", false);
    }).run();
  });
});
