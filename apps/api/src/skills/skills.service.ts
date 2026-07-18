import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeSkillName } from "./skill-normalization";

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.skill.findMany({ orderBy: { name: "asc" } });
  }

  offeredSkills() {
    return this.prisma.skill.findMany({
      where: { technicianSkills: { some: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  async create(name: string) {
    const canonical = normalizeSkillName(name);
    const existing = await this.prisma.skill.findFirst({
      where: { name: { equals: canonical, mode: "insensitive" } },
    });
    if (existing) return existing;
    return this.prisma.skill.create({ data: { name: canonical } });
  }

  async resolveNames(names: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(names.map((n) => n.trim()))].filter(Boolean);
    const map = new Map<string, number>();
    for (const name of unique) {
      const skill = await this.create(name);
      map.set(name.toLowerCase(), skill.id);
    }
    return map;
  }
}
