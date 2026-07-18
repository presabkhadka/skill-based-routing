import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateTechnicianDto,
  UpdateTechnicianDto,
  TechnicianSkillDto,
  EngineTechnician,
  WorkingWindow,
} from "@skill-routing/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SkillsService } from "../skills/skills.service";

type TechnicianWithSkills = {
  id: number;
  name: string;
  available: boolean;
  workingHours: Prisma.JsonValue | null;
  createdAt: Date;
  skills: { level: number; skill: { name: string } }[];
};

export interface TechnicianView {
  id: number;
  name: string;
  available: boolean;
  workload: number;
  skills: Record<string, number>;
  workingHours: WorkingWindow[];
  createdAt: Date;
}

@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
  ) {}

  private async workloadMap(): Promise<Map<number, number>> {
    const grouped = await this.prisma.serviceRequest.groupBy({
      by: ["assignedTechnicianId"],
      where: { status: "ASSIGNED", assignedTechnicianId: { not: null } },
      _count: { _all: true },
    });
    return new Map(
      grouped
        .filter((g) => g.assignedTechnicianId !== null)
        .map((g) => [g.assignedTechnicianId as number, g._count._all]),
    );
  }

  private toView(t: TechnicianWithSkills, workload: number): TechnicianView {
    return {
      id: t.id,
      name: t.name,
      available: t.available,
      workload,
      skills: Object.fromEntries(t.skills.map((s) => [s.skill.name, s.level])),
      workingHours: (t.workingHours as WorkingWindow[] | null) ?? [],
      createdAt: t.createdAt,
    };
  }

  async findAll(): Promise<TechnicianView[]> {
    const [techs, workloads] = await Promise.all([
      this.prisma.technician.findMany({
        include: { skills: { include: { skill: true } } },
        orderBy: { id: "asc" },
      }),
      this.workloadMap(),
    ]);
    return techs.map((t) => this.toView(t, workloads.get(t.id) ?? 0));
  }

  async findOne(id: number): Promise<TechnicianView> {
    const t = await this.prisma.technician.findUnique({
      where: { id },
      include: { skills: { include: { skill: true } } },
    });
    if (!t) throw new NotFoundException(`Technician ${id} not found`);
    const workloads = await this.workloadMap();
    return this.toView(t, workloads.get(id) ?? 0);
  }

  async create(dto: CreateTechnicianDto): Promise<TechnicianView> {
    const skillIds = await this.skills.resolveNames(
      dto.skills.map((s) => s.skill),
    );
    const tech = await this.prisma.technician.create({
      data: {
        name: dto.name,
        available: dto.available ?? true,
        workingHours: dto.workingHours ?? [],
        skills: {
          create: this.dedupeSkills(dto.skills, skillIds),
        },
      },
    });
    return this.findOne(tech.id);
  }

  private dedupeSkills(
    skills: TechnicianSkillDto[],
    skillIds: Map<string, number>,
  ): { skillId: number; level: number }[] {
    const bySkillId = new Map<number, number>();
    for (const s of skills) {
      const id = skillIds.get(s.skill.trim().toLowerCase())!;
      bySkillId.set(id, Math.max(bySkillId.get(id) ?? 0, s.level));
    }
    return [...bySkillId].map(([skillId, level]) => ({ skillId, level }));
  }

  async update(id: number, dto: UpdateTechnicianDto): Promise<TechnicianView> {
    await this.ensureExists(id);
    await this.prisma.technician.update({
      where: { id },
      data: {
        name: dto.name,
        available: dto.available,
        ...(dto.workingHours !== undefined
          ? { workingHours: dto.workingHours }
          : {}),
      },
    });
    return this.findOne(id);
  }

  async setSkills(
    id: number,
    skills: TechnicianSkillDto[],
  ): Promise<TechnicianView> {
    await this.ensureExists(id);
    const skillIds = await this.skills.resolveNames(skills.map((s) => s.skill));
    await this.prisma.$transaction([
      this.prisma.technicianSkill.deleteMany({ where: { technicianId: id } }),
      this.prisma.technicianSkill.createMany({
        data: this.dedupeSkills(skills, skillIds).map((s) => ({
          technicianId: id,
          skillId: s.skillId,
          level: s.level,
        })),
      }),
    ]);
    return this.findOne(id);
  }

  async setAvailability(
    id: number,
    available: boolean,
  ): Promise<TechnicianView> {
    await this.ensureExists(id);
    await this.prisma.technician.update({
      where: { id },
      data: { available },
    });
    return this.findOne(id);
  }

  async getEngineTechnicians(): Promise<EngineTechnician[]> {
    const views = await this.findAll();
    return views.map((v) => ({
      id: v.id,
      name: v.name,
      available: v.available,
      workload: v.workload,
      skills: v.skills,
      workingHours: v.workingHours,
    }));
  }

  private async ensureExists(id: number): Promise<void> {
    const count = await this.prisma.technician.count({ where: { id } });
    if (!count) throw new NotFoundException(`Technician ${id} not found`);
  }
}
