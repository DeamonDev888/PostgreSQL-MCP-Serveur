import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Logger", () => {
  let logger: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../src/utils/logger.js");
    logger = mod.default;
  });

  it("has info, warn, error, debug methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("has a close method", () => {
    expect(typeof logger.close).toBe("function");
  });

  it("error writes to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.error("test error");
    expect(spy).toHaveBeenCalled();
    const written = spy.mock.calls.map((c: any) => String(c[0])).join("");
    expect(written).toContain("test error");
    spy.mockRestore();
  });

  it("debug does not write in production", async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const mod = await import("../src/utils/logger.js");
    const prodLogger = mod.default;

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    prodLogger.debug("should not appear");
    const written = spy.mock.calls.map((c: any) => String(c[0])).join("");
    expect(written).not.toContain("should not appear");
    spy.mockRestore();
    process.env.NODE_ENV = origEnv;
  });
});
