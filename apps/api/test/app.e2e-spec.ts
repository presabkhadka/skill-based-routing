import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

interface SkillInput {
  skill: string;
  level: number;
}

describe("Skill-Based Routing (e2e)", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.assignmentTrace.deleteMany();
    await prisma.requiredSkill.deleteMany();
    await prisma.serviceRequest.deleteMany();
    await prisma.technicianSkill.deleteMany();
    await prisma.technician.deleteMany();
    await prisma.skill.deleteMany();
  });

  async function createTech(
    name: string,
    skills: SkillInput[],
    opts: {
      available?: boolean;
      workingHours?: { day: number; start: string; end: string }[];
      maxWorkload?: number;
    } = {},
  ): Promise<number> {
    const res = await http
      .post("/technicians")
      .send({
        name,
        skills,
        available: opts.available ?? true,
        workingHours: opts.workingHours ?? [],
        ...(opts.maxWorkload !== undefined
          ? { maxWorkload: opts.maxWorkload }
          : {}),
      })
      .expect(201);
    return res.body.id;
  }

  async function setWorkload(techId: number, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await prisma.serviceRequest.create({
        data: {
          customer: `workload-filler-${techId}-${i}`,
          priority: "MEDIUM",
          status: "ASSIGNED",
          assignedTechnicianId: techId,
        },
      });
    }
  }

  const HVAC_ELEC = { HVAC: 4, Electrical: 3 };

  it("assigns the brief's canonical scenario to Sarah (lowest workload)", async () => {
    const john = await createTech("John", [
      { skill: "HVAC", level: 5 },
      { skill: "Electrical", level: 4 },
    ]);
    const sarah = await createTech("Sarah", [
      { skill: "HVAC", level: 4 },
      { skill: "Electrical", level: 5 },
    ]);
    const mike = await createTech(
      "Mike",
      [
        { skill: "HVAC", level: 5 },
        { skill: "Electrical", level: 5 },
      ],
      { available: false },
    );
    await setWorkload(john, 3);
    await setWorkload(sarah, 1);

    const res = await http
      .post("/service-requests")
      .send({ customer: "ABC Corp", requiredSkills: HVAC_ELEC })
      .expect(201);

    expect(res.body.status).toBe("ASSIGNED");
    expect(res.body.assignedTechnician.name).toBe("Sarah");

    const byId = (id: number) =>
      res.body.evaluations.find((e: any) => e.technicianId === id);
    expect(byId(john).eligible).toBe(true);
    expect(byId(sarah).eligible).toBe(true);
    expect(byId(mike).eligible).toBe(false);
    expect(byId(mike).reason).toMatch(/unavailable/i);
    expect(byId(mike).rejectReason).toBe("UNAVAILABLE");
  });

  it("frees a technician's workload when a request is completed", async () => {
    const john = await createTech("John", [
      { skill: "HVAC", level: 5 },
      { skill: "Electrical", level: 4 },
    ]);
    const sarah = await createTech("Sarah", [
      { skill: "HVAC", level: 4 },
      { skill: "Electrical", level: 5 },
    ]);
    await setWorkload(john, 2);
    await setWorkload(sarah, 1);

    // Sarah wins on workload (1 vs 2) and now carries 2.
    const first = await http
      .post("/service-requests")
      .send({ customer: "First Corp", requiredSkills: HVAC_ELEC })
      .expect(201);
    expect(first.body.assignedTechnician.name).toBe("Sarah");

    // Completing it drops Sarah back to 1 — workload counts ASSIGNED only.
    const completed = await http
      .patch(`/service-requests/${first.body.id}/complete`)
      .expect(200);
    expect(completed.body.status).toBe("COMPLETED");

    const techs = await http.get("/technicians").expect(200);
    const workload = (id: number) =>
      techs.body.find((t: any) => t.id === id).workload;
    expect(workload(sarah)).toBe(1);
    expect(workload(john)).toBe(2);

    // So Sarah wins again rather than the load having silently stuck at 2.
    const second = await http
      .post("/service-requests")
      .send({ customer: "Second Corp", requiredSkills: HVAC_ELEC })
      .expect(201);
    expect(second.body.assignedTechnician.name).toBe("Sarah");
  });

  it("refuses to re-route a COMPLETED request (terminal state)", async () => {
    await createTech("Solo", [
      { skill: "HVAC", level: 5 },
      { skill: "Electrical", level: 5 },
    ]);
    const created = await http
      .post("/service-requests")
      .send({ customer: "Terminal Corp", requiredSkills: HVAC_ELEC })
      .expect(201);
    await http.patch(`/service-requests/${created.body.id}/complete`).expect(200);

    await http.post(`/service-requests/${created.body.id}/route`).expect(400);

    const after = await http
      .get(`/service-requests/${created.body.id}`)
      .expect(200);
    expect(after.body.status).toBe("COMPLETED");
  });

  it("rejects completing a request that is not ASSIGNED", async () => {
    await createTech("Dev", [{ skill: "Frontend Development", level: 5 }]);
    const unassigned = await http
      .post("/service-requests")
      .send({ customer: "Nobody Corp", requiredSkills: { Refrigeration: 4 } })
      .expect(201);
    expect(unassigned.body.status).toBe("UNASSIGNED");

    await http
      .patch(`/service-requests/${unassigned.body.id}/complete`)
      .expect(400);
  });

  it("leaves a request unassigned when a technician is missing a required skill", async () => {
    await createTech("HvacOnly", [{ skill: "HVAC", level: 5 }]);

    const res = await http
      .post("/service-requests")
      .send({ customer: "MissSkill", requiredSkills: HVAC_ELEC })
      .expect(201);

    expect(res.body.status).toBe("UNASSIGNED");
    expect(res.body.assignedTechnician).toBeNull();
    expect(res.body.evaluations[0].reason).toMatch(/missing required skill/i);
  });

  it("leaves a request unassigned when the proficiency level is too low", async () => {
    await createTech("LowHvac", [{ skill: "HVAC", level: 3 }]);

    const res = await http
      .post("/service-requests")
      .send({ customer: "LowLevel", requiredSkills: { HVAC: 4 } })
      .expect(201);

    expect(res.body.status).toBe("UNASSIGNED");
    expect(res.body.evaluations[0].reason).toMatch(/< required/i);
  });

  it("rejects an unavailable technician but assigns an available skilled one", async () => {
    await createTech(
      "Away",
      [
        { skill: "HVAC", level: 5 },
        { skill: "Electrical", level: 5 },
      ],
      { available: false },
    );
    await createTech("Ready", [
      { skill: "HVAC", level: 5 },
      { skill: "Electrical", level: 5 },
    ]);

    const res = await http
      .post("/service-requests")
      .send({ customer: "Avail", requiredSkills: HVAC_ELEC })
      .expect(201);

    expect(res.body.assignedTechnician.name).toBe("Ready");
  });

  it("leaves a request unassigned when no technician qualifies", async () => {
    await createTech("HvacGuy", [{ skill: "HVAC", level: 5 }]);

    const res = await http
      .post("/service-requests")
      .send({ customer: "NoMatch", requiredSkills: { Plumbing: 5 } })
      .expect(201);

    expect(res.body.status).toBe("UNASSIGNED");
    expect(res.body.assignedTechnician).toBeNull();
  });

  it("auto-reassigns a technician's requests when they go unavailable", async () => {
    const john = await createTech("John", [
      { skill: "HVAC", level: 5 },
      { skill: "Electrical", level: 5 },
    ]);
    // Sarah is heavily loaded so John wins on workload, but her cap is raised
    // well clear of that load: this test is about reassignment, and capacity
    // must not be the thing that decides it.
    const sarah = await createTech(
      "Sarah",
      [
        { skill: "HVAC", level: 5 },
        { skill: "Electrical", level: 5 },
      ],
      { maxWorkload: 20 },
    );
    await setWorkload(sarah, 5);

    const created = await http
      .post("/service-requests")
      .send({ customer: "Reassign", requiredSkills: HVAC_ELEC })
      .expect(201);
    expect(created.body.assignedTechnician.id).toBe(john);

    const toggled = await http
      .patch(`/technicians/${john}/availability`)
      .send({ available: false })
      .expect(200);
    expect(toggled.body.reassignedRequestIds.length).toBeGreaterThan(0);

    const detail = await http
      .get(`/service-requests/${created.body.id}`)
      .expect(200);
    expect(detail.body.assignedTechnician.id).toBe(sarah);
  });

  it("matches a normalized alias: 'react' request → 'Frontend Development' technician", async () => {
    await createTech("Dev", [{ skill: "Frontend Development", level: 5 }]);

    const res = await http
      .post("/service-requests")
      .send({ customer: "WebCo", requiredSkills: { react: 4 } })
      .expect(201);

    expect(res.body.status).toBe("ASSIGNED");
    expect(res.body.assignedTechnician.name).toBe("Dev");
    expect(Object.keys(res.body.requiredSkills)).toContain(
      "Frontend Development",
    );
  });

  it("re-running routing on a request is idempotent for the same state", async () => {
    await createTech("Solo", [
      { skill: "HVAC", level: 5 },
      { skill: "Electrical", level: 5 },
    ]);
    const created = await http
      .post("/service-requests")
      .send({ customer: "Rerun", requiredSkills: HVAC_ELEC })
      .expect(201);

    const rerun = await http
      .post(`/service-requests/${created.body.id}/route`)
      .expect(201);
    expect(rerun.body.assignedTechnician.name).toBe("Solo");
  });

  describe("scheduled time drives the working-hours gate", () => {
    const MON_FRI = [1, 2, 3, 4, 5].map((day) => ({
      day,
      start: "09:00",
      end: "17:00",
    }));
    const weekdayTech = () =>
      createTech(
        "Weekday",
        [
          { skill: "HVAC", level: 5 },
          { skill: "Electrical", level: 5 },
        ],
        { workingHours: MON_FRI },
      );

    it("assigns a shift technician when scheduled inside their shift", async () => {
      await weekdayTech();
      const res = await http
        .post("/service-requests")
        .send({
          customer: "Sched",
          requiredSkills: HVAC_ELEC,
          scheduledDay: 1,
          scheduledTime: "10:00",
        })
        .expect(201);
      expect(res.body.assignedTechnician.name).toBe("Weekday");
    });

    it("rejects a shift technician when scheduled outside their shift", async () => {
      await weekdayTech();
      const res = await http
        .post("/service-requests")
        .send({
          customer: "Sched",
          requiredSkills: HVAC_ELEC,
          scheduledDay: 6,
          scheduledTime: "10:00",
        })
        .expect(201);
      expect(res.body.status).toBe("UNASSIGNED");
      expect(res.body.evaluations[0].reason).toMatch(/outside working hours/i);
    });

    it("ignores working hours entirely when no scheduled time is given", async () => {
      await weekdayTech();
      const res = await http
        .post("/service-requests")
        .send({ customer: "Sched", requiredSkills: HVAC_ELEC })
        .expect(201);
      expect(res.body.assignedTechnician.name).toBe("Weekday");
    });

    it("rejects a scheduled day without a time (400)", async () => {
      await http
        .post("/service-requests")
        .send({ customer: "Bad", requiredSkills: HVAC_ELEC, scheduledDay: 1 })
        .expect(400);
    });
  });

  it("exposes the union of technician-held skills via /skills/offered", async () => {
    await createTech("A", [
      { skill: "HVAC", level: 5 },
      { skill: "Electrical", level: 4 },
    ]);
    await createTech("B", [
      { skill: "Plumbing", level: 5 },
      { skill: "HVAC", level: 3 },
    ]);
    await http.post("/skills").send({ name: "Refrigeration" }).expect(201);

    const res = await http.get("/skills/offered").expect(200);
    const names = res.body.map((s: any) => s.name).sort();
    expect(names).toEqual(["Electrical", "HVAC", "Plumbing"]);
    expect(names).not.toContain("Refrigeration");
  });

  it("rejects invalid input (level out of 1–5) with 400", async () => {
    await http
      .post("/technicians")
      .send({ name: "Bad", skills: [{ skill: "HVAC", level: 9 }] })
      .expect(400);
  });

  it("rejects a request with no required skills with 400", async () => {
    await http
      .post("/service-requests")
      .send({ customer: "Empty", requiredSkills: {} })
      .expect(400);
  });

  describe("capacity (max workload) and the QUEUED state", () => {
    const soleTech = (maxWorkload: number) =>
      createTech(
        "Only",
        [
          { skill: "HVAC", level: 5 },
          { skill: "Electrical", level: 5 },
        ],
        { maxWorkload },
      );

    it("queues a request when every qualified technician is at capacity", async () => {
      await soleTech(1);
      await http
        .post("/service-requests")
        .send({ customer: "First", requiredSkills: HVAC_ELEC })
        .expect(201);

      const second = await http
        .post("/service-requests")
        .send({ customer: "Second", requiredSkills: HVAC_ELEC })
        .expect(201);

      expect(second.body.status).toBe("QUEUED");
      expect(second.body.assignedTechnician).toBeNull();
      expect(second.body.evaluations[0].rejectReason).toBe("AT_CAPACITY");
    });

    it("keeps UNASSIGNED distinct from QUEUED when nobody qualifies at all", async () => {
      await soleTech(1);
      const res = await http
        .post("/service-requests")
        .send({ customer: "Impossible", requiredSkills: { Refrigeration: 4 } })
        .expect(201);

      // Nobody holds the skill, so this is not a capacity problem and must not
      // be queued — it needs a human, not patience.
      expect(res.body.status).toBe("UNASSIGNED");
    });

    it("auto-assigns queued work as soon as a completion frees capacity", async () => {
      await soleTech(1);
      const first = await http
        .post("/service-requests")
        .send({ customer: "First", requiredSkills: HVAC_ELEC })
        .expect(201);
      const queued = await http
        .post("/service-requests")
        .send({ customer: "Queued", requiredSkills: HVAC_ELEC })
        .expect(201);
      expect(queued.body.status).toBe("QUEUED");

      const completed = await http
        .patch(`/service-requests/${first.body.id}/complete`)
        .expect(200);
      expect(completed.body.autoAssignedRequestIds).toContain(queued.body.id);

      const after = await http
        .get(`/service-requests/${queued.body.id}`)
        .expect(200);
      expect(after.body.status).toBe("ASSIGNED");
    });

    it("picks up queued work when a cap is raised", async () => {
      const tech = await soleTech(1);
      await http
        .post("/service-requests")
        .send({ customer: "First", requiredSkills: HVAC_ELEC })
        .expect(201);
      const queued = await http
        .post("/service-requests")
        .send({ customer: "Queued", requiredSkills: HVAC_ELEC })
        .expect(201);

      const raised = await http
        .patch(`/technicians/${tech}`)
        .send({ maxWorkload: 5 })
        .expect(200);
      expect(raised.body.reassignedRequestIds).toContain(queued.body.id);
    });
  });

  describe("updating a technician re-validates only what it must", () => {
    it("unblocks previously unroutable work when a skill is learned", async () => {
      const tech = await createTech("Learner", [{ skill: "HVAC", level: 5 }]);
      const stuck = await http
        .post("/service-requests")
        .send({ customer: "NeedsElec", requiredSkills: HVAC_ELEC })
        .expect(201);
      expect(stuck.body.status).toBe("UNASSIGNED");

      const updated = await http
        .put(`/technicians/${tech}/skills`)
        .send({
          skills: [
            { skill: "HVAC", level: 5 },
            { skill: "Electrical", level: 5 },
          ],
        })
        .expect(200);
      expect(updated.body.reassignedRequestIds).toContain(stuck.body.id);

      const after = await http.get(`/service-requests/${stuck.body.id}`);
      expect(after.body.status).toBe("ASSIGNED");
    });

    it("re-routes only the assignments a dropped skill invalidated", async () => {
      const john = await createTech("John", [
        { skill: "HVAC", level: 5 },
        { skill: "Electrical", level: 5 },
      ]);
      await createTech("Backup", [{ skill: "HVAC", level: 5 }]);

      const hvacOnly = await http
        .post("/service-requests")
        .send({ customer: "HvacOnly", requiredSkills: { HVAC: 4 } })
        .expect(201);
      const needsBoth = await http
        .post("/service-requests")
        .send({ customer: "Both", requiredSkills: HVAC_ELEC })
        .expect(201);
      expect(needsBoth.body.assignedTechnician.id).toBe(john);

      // Drop Electrical: the HVAC-only job is still perfectly valid for John
      // and must not be churned; only the Electrical job may move.
      const updated = await http
        .put(`/technicians/${john}/skills`)
        .send({ skills: [{ skill: "HVAC", level: 5 }] })
        .expect(200);
      expect(updated.body.reassignedRequestIds).toContain(needsBoth.body.id);
      expect(updated.body.reassignedRequestIds).not.toContain(hvacOnly.body.id);
    });

    it("does not touch routing when only the name changes", async () => {
      const tech = await createTech("Before", [
        { skill: "HVAC", level: 5 },
        { skill: "Electrical", level: 5 },
      ]);
      await http
        .post("/service-requests")
        .send({ customer: "Held", requiredSkills: HVAC_ELEC })
        .expect(201);

      const renamed = await http
        .patch(`/technicians/${tech}`)
        .send({ name: "After" })
        .expect(200);
      expect(renamed.body.technician.name).toBe("After");
      expect(renamed.body.reassignedRequestIds).toEqual([]);
    });

    it("keeps a full technician's own assignments when they are edited", async () => {
      const tech = await createTech(
        "Full",
        [
          { skill: "HVAC", level: 5 },
          { skill: "Electrical", level: 5 },
        ],
        { maxWorkload: 1 },
      );
      const held = await http
        .post("/service-requests")
        .send({ customer: "Held", requiredSkills: HVAC_ELEC })
        .expect(201);
      expect(held.body.assignedTechnician.id).toBe(tech);

      // The technician is at 1/1. Capacity gates *new* work, so editing them
      // must not make them fail the request they are already holding.
      const updated = await http
        .put(`/technicians/${tech}/skills`)
        .send({
          skills: [
            { skill: "HVAC", level: 5 },
            { skill: "Electrical", level: 5 },
            { skill: "Plumbing", level: 2 },
          ],
        })
        .expect(200);
      expect(updated.body.reassignedRequestIds).toEqual([]);

      const after = await http.get(`/service-requests/${held.body.id}`);
      expect(after.body.assignedTechnician.id).toBe(tech);
    });
  });
});
