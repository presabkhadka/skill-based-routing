import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  EngineRequiredSkill,
  EvaluationTime,
  RoutingResult,
} from "@skill-routing/shared";
import { hhmmToMinutes, PRIORITY_WEIGHT } from "@skill-routing/shared";
import { PrismaService } from "../prisma/prisma.service";
import { TechniciansService } from "../technicians/technicians.service";
import { routeRequest } from "./routing.engine";

@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TechniciansService))
    private readonly technicians: TechniciansService,
  ) {}

  async routeAndPersist(serviceRequestId: number): Promise<RoutingResult> {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: serviceRequestId },
      include: { requiredSkills: { include: { skill: true } } },
    });
    if (!request) {
      throw new NotFoundException(
        `Service request ${serviceRequestId} not found`,
      );
    }
    // COMPLETED is terminal: re-routing would resurrect the request and
    // silently re-add load to the assignee. Guarded here — the single choke
    // point every routing path goes through.
    if (request.status === "COMPLETED") {
      throw new BadRequestException(
        `Service request ${serviceRequestId} is COMPLETED and cannot be re-routed`,
      );
    }

    const requiredSkills: EngineRequiredSkill[] = request.requiredSkills.map(
      (rs) => ({ skillName: rs.skill.name, minLevel: rs.minLevel }),
    );

    const technicians = await this.technicians.getEngineTechnicians();

    const when: EvaluationTime | undefined =
      request.scheduledDay !== null && request.scheduledTime !== null
        ? {
            dayOfWeek: request.scheduledDay,
            minutes: hhmmToMinutes(request.scheduledTime),
          }
        : undefined;
    const result = routeRequest(requiredSkills, technicians, when);

    await this.persistResult(serviceRequestId, result);
    return result;
  }

  private async persistResult(
    serviceRequestId: number,
    result: RoutingResult,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.serviceRequest.update({
        where: { id: serviceRequestId },
        data: {
          status: result.assignedTechnicianId ? "ASSIGNED" : "UNASSIGNED",
          assignedTechnicianId: result.assignedTechnicianId,
        },
      }),
      this.prisma.assignmentTrace.deleteMany({ where: { serviceRequestId } }),
      this.prisma.assignmentTrace.createMany({
        data: result.evaluations.map((e) => ({
          serviceRequestId,
          technicianId: e.technicianId,
          eligible: e.eligible,
          reason: e.reason,
          rejectReason: e.rejectReason ?? null,
          workload: e.workload,
        })),
      }),
    ]);
  }

  async routePendingBatch(serviceRequestIds: number[]): Promise<void> {
    const requests = await this.prisma.serviceRequest.findMany({
      where: { id: { in: serviceRequestIds } },
    });
    const ordered = [...requests].sort(
      (a, b) =>
        PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (const req of ordered) {
      await this.routeAndPersist(req.id);
    }
  }

  async reassignFor(technicianId: number): Promise<number[]> {
    const affected = await this.prisma.serviceRequest.findMany({
      where: { assignedTechnicianId: technicianId, status: "ASSIGNED" },
      select: { id: true },
    });
    if (affected.length === 0) return [];

    const ids = affected.map((r) => r.id);
    await this.prisma.serviceRequest.updateMany({
      where: { id: { in: ids } },
      data: { status: "PENDING", assignedTechnicianId: null },
    });
    await this.routePendingBatch(ids);
    return ids;
  }
}
