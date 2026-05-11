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

  it("has a child method for creating child loggers", () => {
    expect(typeof logger.child).toBe("function");
  });

  it("error method does not throw", () => {
    expect(() => logger.error("test error")).not.toThrow();
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
