import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.assignmentTrace.deleteMany();
  await prisma.requiredSkill.deleteMany();
  await prisma.serviceRequest.deleteMany();
  await prisma.technicianSkill.deleteMany();
  await prisma.technician.deleteMany();
  await prisma.skill.deleteMany();

  const skill = (name: string) => prisma.skill.create({ data: { name } });
  const hvac = await skill("HVAC");
  const electrical = await skill("Electrical");
  const plumbing = await skill("Plumbing");
  const frontend = await skill("Frontend Development");
  const refrigeration = await skill("Refrigeration");

  const tech = (
    name: string,
    skills: [number, number][],
    opts: {
      available?: boolean;
      workingHours?: { day: number; start: string; end: string }[];
    } = {},
  ) =>
    prisma.technician.create({
      data: {
        name,
        available: opts.available ?? true,
        workingHours: opts.workingHours ?? [],
        skills: {
          create: skills.map(([skillId, level]) => ({ skillId, level })),
        },
      },
    });

  const john = await tech("John", [
    [hvac.id, 5],
    [electrical.id, 4],
  ]);
  const sarah = await tech("Sarah", [
    [hvac.id, 4],
    [electrical.id, 5],
  ]);
  await tech(
    "Mike",
    [
      [hvac.id, 5],
      [electrical.id, 5],
    ],
    { available: false },
  );
  await tech("Priya", [
    [plumbing.id, 5],
    [hvac.id, 3],
  ]);
  await tech(
    "Alex",
    [
      [hvac.id, 5],
      [electrical.id, 5],
    ],
    {
      workingHours: [1, 2, 3, 4, 5].map((day) => ({
        day,
        start: "09:00",
        end: "17:00",
      })),
    },
  );
  await tech("Dev", [[frontend.id, 5]]);

  const assigned = (
    customer: string,
    technicianId: number,
    reqs: [number, number][],
  ) =>
    prisma.serviceRequest.create({
      data: {
        customer,
        priority: "MEDIUM",
        status: "ASSIGNED",
        assignedTechnicianId: technicianId,
        requiredSkills: {
          create: reqs.map(([skillId, minLevel]) => ({ skillId, minLevel })),
        },
      },
    });

  await assigned("Northwind HVAC", john.id, [[hvac.id, 4]]);
  await assigned("Globex Heating", john.id, [[hvac.id, 3]]);
  await assigned("Initech Wiring", john.id, [[electrical.id, 3]]);
  await assigned("Umbrella AC", sarah.id, [[hvac.id, 4]]);

  await prisma.serviceRequest.create({
    data: {
      customer: "Wonka Cold Storage",
      priority: "HIGH",
      status: "UNASSIGNED",
      requiredSkills: { create: [{ skillId: refrigeration.id, minLevel: 4 }] },
    },
  });

  console.log(
    "Seeded 5 skills, 6 technicians (John workload 3, Sarah 1, Mike unavailable, Alex Mon-Fri 09:00-17:00), 4 assigned + 1 unassigned request.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
