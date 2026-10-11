import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("junta classes simples", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("ignora valores falsy e condicionais", () => {
    expect(cn("px-2", false, undefined, null, "py-1")).toBe("px-2 py-1");
  });

  it("resolve conflitos do Tailwind mantendo a última classe", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
