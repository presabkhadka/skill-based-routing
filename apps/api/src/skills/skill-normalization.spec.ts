import { normalizeSkillName } from "./skill-normalization";

describe("normalizeSkillName", () => {
  it("maps technology aliases to their canonical skill", () => {
    expect(normalizeSkillName("react js")).toBe("Frontend Development");
    expect(normalizeSkillName("React JS")).toBe("Frontend Development");
    expect(normalizeSkillName("next.js")).toBe("Frontend Development");
    expect(normalizeSkillName("node")).toBe("Backend Development");
    expect(normalizeSkillName("agentic")).toBe("Agentic AI");
    expect(normalizeSkillName("air conditioning")).toBe("HVAC");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeSkillName("  ReAcT  ")).toBe("Frontend Development");
  });

  it("maps a canonical name to itself", () => {
    expect(normalizeSkillName("Frontend Development")).toBe(
      "Frontend Development",
    );
    expect(normalizeSkillName("hvac")).toBe("HVAC");
  });

  it("passes unknown skills through unchanged (trimmed)", () => {
    expect(normalizeSkillName("  Underwater Welding ")).toBe(
      "Underwater Welding",
    );
  });
});
