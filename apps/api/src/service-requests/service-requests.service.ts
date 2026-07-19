import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateServiceRequestDto,
  Priority,
  RequestStatus,
  RequiredSkillsMap,
} from "@skill-routing/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SkillsService } from "../skills/skills.service";
import { RoutingService } from "../routing/routing.service";

/**
 * The columns and relations `toSummary` reads. Both `findAll` and `findOne`
 * select a superset of this, so each stays structurally assignable.
 */
type ServiceRequestRow = {
  id: number;
  customer: string;
  priority: Priority;
  status: RequestStatus;
  scheduledDay: number | null;
  scheduledTime: string | null;
  createdAt: Date;
  assignedTechnician: { id: number; name: string } | null;
  requiredSkills: { minLevel: number; skill: { name: string } }[];
};

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    private readonly routing: RoutingService,
  ) {}

  async create(dto: CreateServiceRequestDto) {
    return this.createAndRoute(dto.customer, dto.priority, dto.requiredSkills, {
      day: dto.scheduledDay ?? null,
      time: dto.scheduledTime ?? null,
    });
  }

  async createAndRoute(
    customer: string,
    priority: Priority,
    requiredSkills: RequiredSkillsMap,
    schedule: { day: number | null; time: string | null } = {
      day: null,
      time: null,
    },
  ) {
    const names = Object.keys(requiredSkills);
    const skillIds = await this.skills.resolveNames(names);

    const bySkillId = new Map<number, number>();
    for (const name of names) {
      const id = skillIds.get(name.trim().toLowerCase())!;
      bySkillId.set(id, Math.max(bySkillId.get(id) ?? 0, requiredSkills[name]));
    }

    const request = await this.prisma.serviceRequest.create({
      data: {
        customer,
        priority,
        scheduledDay: schedule.day,
        scheduledTime: schedule.time,
        status: "PENDING",
        requiredSkills: {
          create: [...bySkillId].map(([skillId, minLevel]) => ({
            skillId,
            minLevel,
          })),
        },
      },
    });

    await this.routing.routeAndPersist(request.id);
    return this.findOne(request.id);
  }

  findAll() {
    return this.prisma.serviceRequest
      .findMany({
        orderBy: { id: "desc" },
        include: {
          assignedTechnician: { select: { id: true, name: true } },
          requiredSkills: { include: { skill: true } },
        },
      })
      .then((rows) => rows.map((r) => this.toSummary(r)));
  }

  async findOne(id: number) {
    const r = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        assignedTechnician: { select: { id: true, name: true } },
        requiredSkills: { include: { skill: true } },
        traces: {
          include: { technician: { select: { id: true, name: true } } },
          orderBy: { technicianId: "asc" },
        },
      },
    });
    if (!r) throw new NotFoundException(`Service request ${id} not found`);

    return {
      ...this.toSummary(r),
      evaluations: r.traces.map((t) => ({
        technicianId: t.technicianId,
        technicianName: t.technician.name,
        eligible: t.eligible,
        reason: t.reason,
        rejectReason: t.rejectReason ?? null,
        workload: t.workload,
      })),
    };
  }

  async route(id: number) {
    await this.routing.routeAndPersist(id);
    return this.findOne(id);
  }

  async complete(id: number) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!request) throw new NotFoundException(`Service request ${id} not found`);
    if (request.status !== "ASSIGNED") {
      throw new BadRequestException(
        `Only an ASSIGNED request can be completed (request ${id} is ${request.status})`,
      );
    }

    await this.prisma.serviceRequest.update({
      where: { id },
      data: { status: "COMPLETED" },
    });
    // Completing frees a slot on the assignee, which is the most common way
    // queued work becomes assignable — hand it out straight away.
    const autoAssignedRequestIds = await this.routing.sweepQueued();
    return { ...(await this.findOne(id)), autoAssignedRequestIds };
  }

  private toSummary(r: ServiceRequestRow) {
    return {
      id: r.id,
      customer: r.customer,
      priority: r.priority,
      status: r.status,
      requiredSkills: Object.fromEntries(
        r.requiredSkills.map((rs) => [rs.skill.name, rs.minLevel]),
      ) as RequiredSkillsMap,
      assignedTechnician: r.assignedTechnician ?? null,
      scheduledDay: r.scheduledDay ?? null,
      scheduledTime: r.scheduledTime ?? null,
      createdAt: r.createdAt,
    };
  }
}
