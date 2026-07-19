import type {
  EngineRequiredSkill,
  EngineTechnician,
  WorkingWindow,
} from "@skill-routing/shared";
import { qualifies, routeRequest } from "./routing.engine";

function tech(
  id: number,
  name: string,
  skills: Record<string, number>,
  opts: {
    available?: boolean;
    workload?: number;
    workingHours?: WorkingWindow[];
    maxWorkload?: number;
  } = {},
): EngineTechnician {
  return {
    id,
    name,
    available: opts.available ?? true,
    workload: opts.workload ?? 0,
    skills,
    workingHours: opts.workingHours,
    maxWorkload: opts.maxWorkload,
  };
}

const REQUEST: EngineRequiredSkill[] = [
  { skillName: "HVAC", minLevel: 4 },
  { skillName: "Electrical", minLevel: 3 },
];

describe("routeRequest — Skill-Based Routing engine", () => {
  it("Scenario: technician missing one required skill → not assigned", () => {
    const t = tech(1, "NoElec", { HVAC: 5 });
    const result = routeRequest(REQUEST, [t]);

    expect(result.assignedTechnicianId).toBeNull();
    expect(result.eligibleTechnicianIds).toEqual([]);
    const evalT = result.evaluations[0];
    expect(evalT.eligible).toBe(false);
    expect(evalT.rejectReason).toBe("MISSING_SKILL");
  });

  it("Scenario: technician skill level below requirement → not assigned", () => {
    const t = tech(1, "LowHvac", { HVAC: 3, Electrical: 5 });
    const result = routeRequest(REQUEST, [t]);

    expect(result.assignedTechnicianId).toBeNull();
    expect(result.evaluations[0].rejectReason).toBe("LEVEL_TOO_LOW");
  });

  it("Scenario: technician unavailable → not assigned", () => {
    const t = tech(1, "Away", { HVAC: 5, Electrical: 5 }, { available: false });
    const result = routeRequest(REQUEST, [t]);

    expect(result.assignedTechnicianId).toBeNull();
    expect(result.evaluations[0].rejectReason).toBe("UNAVAILABLE");
  });

  it("Scenario: multiple eligible → lowest workload selected (brief's headline)", () => {
    const john = tech(1, "John", { HVAC: 5, Electrical: 4 }, { workload: 3 });
    const sarah = tech(2, "Sarah", { HVAC: 4, Electrical: 5 }, { workload: 1 });
    const mike = tech(
      3,
      "Mike",
      { HVAC: 5, Electrical: 5 },
      { available: false, workload: 0 },
    );

    const result = routeRequest(REQUEST, [john, sarah, mike]);

    expect(result.assignedTechnicianName).toBe("Sarah");
    expect(result.eligibleTechnicianIds).toEqual([1, 2]);
    expect(result.selectedBecause).toContain("lowest workload");
    const mikeEval = result.evaluations.find((e) => e.technicianId === 3);
    expect(mikeEval?.rejectReason).toBe("UNAVAILABLE");
  });

  it("Scenario: equal workload → documented tie-breaker (higher proficiency wins)", () => {
    const john = tech(1, "John", { HVAC: 4, Electrical: 4 }, { workload: 2 });
    const sarah = tech(2, "Sarah", { HVAC: 4, Electrical: 5 }, { workload: 2 });

    const result = routeRequest(REQUEST, [john, sarah]);

    expect(result.assignedTechnicianName).toBe("Sarah");
    expect(result.selectedBecause).toContain("higher total proficiency");
    expect(result.selectedBecause).toContain("John");
  });

  it("Tie-breaker falls through to lowest id when workload AND proficiency tie", () => {
    const a = tech(5, "A", { HVAC: 4, Electrical: 5 }, { workload: 2 });
    const b = tech(3, "B", { HVAC: 4, Electrical: 5 }, { workload: 2 });

    const result = routeRequest(REQUEST, [a, b]);

    expect(result.assignedTechnicianId).toBe(3);
    expect(result.selectedBecause).toContain("lowest technician id");
    expect(result.selectedBecause).toContain("A");
    const winnerRow = result.evaluations.find((e) => e.technicianId === 3);
    expect(winnerRow?.reason).toBe(result.selectedBecause);
  });

  it("Scenario: no eligible technician → request remains unassigned", () => {
    const t1 = tech(1, "NoSkill", { Plumbing: 5 });
    const t2 = tech(2, "TooLow", { HVAC: 2, Electrical: 2 });
    const t3 = tech(3, "Away", { HVAC: 5, Electrical: 5 }, { available: false });

    const result = routeRequest(REQUEST, [t1, t2, t3]);

    expect(result.assignedTechnicianId).toBeNull();
    expect(result.eligibleTechnicianIds).toEqual([]);
    expect(result.selectedBecause).toBeNull();
  });

  it("evaluation order: missing skill reported before level/availability", () => {
    const t = tech(1, "X", { HVAC: 5 }, { available: false });
    const result = routeRequest(REQUEST, [t]);
    expect(result.evaluations[0].rejectReason).toBe("MISSING_SKILL");
  });

  it("returns a full evaluation trace for every technician", () => {
    const john = tech(1, "John", { HVAC: 5, Electrical: 4 }, { workload: 3 });
    const sarah = tech(2, "Sarah", { HVAC: 4, Electrical: 5 }, { workload: 1 });
    const result = routeRequest(REQUEST, [john, sarah]);
    expect(result.evaluations).toHaveLength(2);
    expect(result.evaluations.every((e) => typeof e.reason === "string")).toBe(
      true,
    );
  });

  it("matches skill names case-insensitively", () => {
    const jordan = tech(1, "Jordan", {
      "Ai Development": 5,
      "agentic ai": 3,
    });
    const req: EngineRequiredSkill[] = [
      { skillName: "AI Development", minLevel: 4 },
      { skillName: "Agentic AI", minLevel: 3 },
    ];
    const result = routeRequest(req, [jordan]);

    expect(result.assignedTechnicianId).toBe(1);
    expect(result.evaluations[0].eligible).toBe(true);
  });

  it("still enforces the minimum level after a case-insensitive match", () => {
    const jordan = tech(1, "Jordan", { "ai development": 2 });
    const req: EngineRequiredSkill[] = [
      { skillName: "AI Development", minLevel: 4 },
    ];
    const result = routeRequest(req, [jordan]);

    expect(result.assignedTechnicianId).toBeNull();
    expect(result.evaluations[0].rejectReason).toBe("LEVEL_TOO_LOW");
  });

  describe("working hours (shift gate)", () => {
    const shifted = () =>
      tech(1, "NineToFive", { HVAC: 5, Electrical: 5 }, {
        workingHours: [{ day: 1, start: "09:00", end: "17:00" }],
      });

    it("rejects a technician outside their working hours", () => {
      const result = routeRequest(REQUEST, [shifted()], {
        dayOfWeek: 1,
        minutes: 20 * 60,
      });
      expect(result.assignedTechnicianId).toBeNull();
      expect(result.evaluations[0].rejectReason).toBe("OUTSIDE_HOURS");
      expect(result.evaluations[0].reason).toContain("shift 09:00–17:00");
    });

    it("rejects on a day the technician does not work", () => {
      const result = routeRequest(REQUEST, [shifted()], {
        dayOfWeek: 0,
        minutes: 12 * 60,
      });
      expect(result.evaluations[0].rejectReason).toBe("OUTSIDE_HOURS");
      expect(result.evaluations[0].reason).toContain("no shift on Sun");
    });

    it("accepts a technician within their working hours", () => {
      const result = routeRequest(REQUEST, [shifted()], {
        dayOfWeek: 1,
        minutes: 10 * 60,
      });
      expect(result.assignedTechnicianId).toBe(1);
    });

    it("treats a technician with no schedule as always on shift", () => {
      const t = tech(1, "Always", { HVAC: 5, Electrical: 5 });
      const result = routeRequest(REQUEST, [t], { dayOfWeek: 3, minutes: 180 });
      expect(result.assignedTechnicianId).toBe(1);
    });

    it("skips the shift gate entirely when no time is provided", () => {
      const result = routeRequest(REQUEST, [shifted()]);
      expect(result.assignedTechnicianId).toBe(1);
    });

    it("applies availability before working hours", () => {
      const t = tech(1, "Off", { HVAC: 5, Electrical: 5 }, {
        available: false,
        workingHours: [{ day: 1, start: "09:00", end: "17:00" }],
      });
      const result = routeRequest(REQUEST, [t], { dayOfWeek: 1, minutes: 1200 });
      expect(result.evaluations[0].rejectReason).toBe("UNAVAILABLE");
    });
  });

  describe("capacity (max workload)", () => {
    const full = () =>
      tech(1, "Full", { HVAC: 5, Electrical: 5 }, {
        workload: 5,
        maxWorkload: 5,
      });

    it("skips a technician who is at their cap", () => {
      const result = routeRequest(REQUEST, [full()]);
      expect(result.assignedTechnicianId).toBeNull();
      expect(result.evaluations[0].rejectReason).toBe("AT_CAPACITY");
      expect(result.evaluations[0].reason).toContain("5/5");
    });

    it("flags blockedByCapacity when capacity is the only thing in the way", () => {
      expect(routeRequest(REQUEST, [full()]).blockedByCapacity).toBe(true);
    });

    it("does not flag blockedByCapacity when nobody was qualified anyway", () => {
      const unskilled = tech(1, "NoSkill", { Plumbing: 5 }, { maxWorkload: 1 });
      const result = routeRequest(REQUEST, [unskilled]);
      expect(result.assignedTechnicianId).toBeNull();
      expect(result.blockedByCapacity).toBe(false);
    });

    it("does not flag blockedByCapacity when someone was assigned", () => {
      const free = tech(2, "Free", { HVAC: 5, Electrical: 5 }, {
        workload: 0,
        maxWorkload: 5,
      });
      const result = routeRequest(REQUEST, [full(), free]);
      expect(result.assignedTechnicianId).toBe(2);
      expect(result.blockedByCapacity).toBe(false);
    });

    it("still assigns a technician who is below their cap", () => {
      const room = tech(1, "Room", { HVAC: 5, Electrical: 5 }, {
        workload: 4,
        maxWorkload: 5,
      });
      expect(routeRequest(REQUEST, [room]).assignedTechnicianId).toBe(1);
    });

    it("treats an unset cap as uncapped", () => {
      const busy = tech(1, "Busy", { HVAC: 5, Electrical: 5 }, {
        workload: 99,
      });
      expect(routeRequest(REQUEST, [busy]).assignedTechnicianId).toBe(1);
    });

    it("reports capacity only after skill, availability and shift checks", () => {
      // Every one of these is also at capacity; the more fundamental
      // rejection must win so the dispatcher sees the real blocker.
      const noSkill = tech(1, "NoSkill", { HVAC: 5 }, {
        workload: 9,
        maxWorkload: 1,
      });
      const away = tech(2, "Away", { HVAC: 5, Electrical: 5 }, {
        available: false,
        workload: 9,
        maxWorkload: 1,
      });
      const offShift = tech(3, "OffShift", { HVAC: 5, Electrical: 5 }, {
        workload: 9,
        maxWorkload: 1,
        workingHours: [{ day: 1, start: "09:00", end: "17:00" }],
      });

      const result = routeRequest(REQUEST, [noSkill, away, offShift], {
        dayOfWeek: 0,
        minutes: 12 * 60,
      });
      expect(result.evaluations[0].rejectReason).toBe("MISSING_SKILL");
      expect(result.evaluations[1].rejectReason).toBe("UNAVAILABLE");
      expect(result.evaluations[2].rejectReason).toBe("OUTSIDE_HOURS");
    });

    it("keeps a full technician's existing assignments valid", () => {
      // Capacity gates new work only. If `qualifies` enforced it, editing a
      // full technician would shed every request they are already holding.
      expect(qualifies(REQUEST, full())).toBe(true);
    });
  });

  describe("qualifies — is an existing assignment still valid?", () => {
    it("holds while the technician still meets every requirement", () => {
      expect(qualifies(REQUEST, tech(1, "Ok", { HVAC: 5, Electrical: 4 }))).toBe(
        true,
      );
    });

    it("fails once a required skill is dropped", () => {
      expect(qualifies(REQUEST, tech(1, "Lost", { HVAC: 5 }))).toBe(false);
    });

    it("fails once a level is downgraded below the requirement", () => {
      expect(
        qualifies(REQUEST, tech(1, "Down", { HVAC: 2, Electrical: 4 })),
      ).toBe(false);
    });

    it("fails when the technician is unavailable", () => {
      expect(
        qualifies(
          REQUEST,
          tech(1, "Away", { HVAC: 5, Electrical: 5 }, { available: false }),
        ),
      ).toBe(false);
    });

    it("fails when a narrowed shift no longer covers the scheduled time", () => {
      const narrowed = tech(1, "Shift", { HVAC: 5, Electrical: 5 }, {
        workingHours: [{ day: 1, start: "09:00", end: "12:00" }],
      });
      expect(qualifies(REQUEST, narrowed, { dayOfWeek: 1, minutes: 10 * 60 })).toBe(
        true,
      );
      expect(qualifies(REQUEST, narrowed, { dayOfWeek: 1, minutes: 15 * 60 })).toBe(
        false,
      );
    });

    it("ignores shifts for an unscheduled request", () => {
      const narrowed = tech(1, "Shift", { HVAC: 5, Electrical: 5 }, {
        workingHours: [{ day: 1, start: "09:00", end: "12:00" }],
      });
      expect(qualifies(REQUEST, narrowed)).toBe(true);
    });

    it("matches skill names case-insensitively, like routeRequest", () => {
      expect(
        qualifies(REQUEST, tech(1, "Case", { hvac: 5, ELECTRICAL: 4 })),
      ).toBe(true);
    });

    it("agrees with routeRequest's own eligibility verdict", () => {
      const candidates = [
        tech(1, "A", { HVAC: 5, Electrical: 4 }),
        tech(2, "B", { HVAC: 1, Electrical: 4 }),
        tech(3, "C", { HVAC: 5 }),
        tech(4, "D", { HVAC: 5, Electrical: 5 }, { available: false }),
      ];
      const result = routeRequest(REQUEST, candidates);
      for (const t of candidates) {
        expect(qualifies(REQUEST, t)).toBe(
          result.eligibleTechnicianIds.includes(t.id),
        );
      }
    });

    it("never qualifies when there are no required skills", () => {
      expect(qualifies([], tech(1, "Any", { HVAC: 5 }))).toBe(false);
    });
  });

  it("never assigns a request with no required skills", () => {
    const a = tech(1, "A", { HVAC: 5 });
    const b = tech(2, "B", { Electrical: 5 });
    const result = routeRequest([], [a, b]);

    expect(result.assignedTechnicianId).toBeNull();
    expect(result.eligibleTechnicianIds).toEqual([]);
    expect(result.selectedBecause).toBeNull();
    expect(result.evaluations).toEqual([]);
  });
});
