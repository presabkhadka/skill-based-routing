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

  /**
   * Resolve many skill names to their skill ids, creating any that do not
   * exist yet. Keyed by the caller's own (trimmed, lowercased) spelling.
   *
   * Distinct inputs can collapse onto one canonical skill — "react" and
   * "tailwind" are both Frontend Development — so canonicals are resolved
   * once and fanned back out, and the whole batch costs two queries instead
   * of a lookup-plus-insert per name.
   */
  async resolveNames(names: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(names.map((n) => n.trim()))].filter(Boolean);
    if (unique.length === 0) return new Map();

    const canonicalByName = new Map(
      unique.map((name) => [name, normalizeSkillName(name)]),
    );
    const canonicals = [...new Set(canonicalByName.values())];

    const existing = await this.prisma.skill.findMany({
      where: {
        OR: canonicals.map((name) => ({
          name: { equals: name, mode: "insensitive" as const },
        })),
      },
    });
    const idByCanonical = new Map(
      existing.map((s) => [s.name.toLowerCase(), s.id]),
    );

    const missing = canonicals.filter(
      (c) => !idByCanonical.has(c.toLowerCase()),
    );
    if (missing.length > 0) {
      const created = await this.prisma.$transaction(
        missing.map((name) => this.prisma.skill.create({ data: { name } })),
      );
      for (const s of created) idByCanonical.set(s.name.toLowerCase(), s.id);
    }

    return new Map(
      unique.map((name) => [
        name.toLowerCase(),
        idByCanonical.get(canonicalByName.get(name)!.toLowerCase())!,
      ]),
    );
  }
}
