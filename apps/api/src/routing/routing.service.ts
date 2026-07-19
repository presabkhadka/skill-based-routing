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
import { qualifies, routeRequest } from "./routing.engine";

/** The shape `evaluationTimeOf` needs — a request's optional schedule. */
type Scheduled = { scheduledDay: number | null; scheduledTime: string | null };

function evaluationTimeOf(request: Scheduled): EvaluationTime | undefined {
  if (request.scheduledDay === null || request.scheduledTime === null) {
    return undefined;
  }
  return {
    dayOfWeek: request.scheduledDay,
    minutes: hhmmToMinutes(request.scheduledTime),
  };
}

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
    const result = routeRequest(
      requiredSkills,
      technicians,
      evaluationTimeOf(request),
    );

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
          status: result.assignedTechnicianId
            ? "ASSIGNED"
            : result.blockedByCapacity
              ? "QUEUED"
              : "UNASSIGNED",
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

  /**
   * Hand queued work to whoever just freed up.
   *
   * A QUEUED request is one that had takers but no room, so the moment any
   * capacity opens — a completion, a raised cap, a technician coming back —
   * it should land immediately rather than wait for a dispatcher. Ordered by
   * priority then age, so the queue drains fairly.
   */
  async sweepQueued(): Promise<number[]> {
    const queued = await this.prisma.serviceRequest.findMany({
      where: { status: "QUEUED" },
      select: { id: true },
    });
    if (queued.length === 0) return [];

    const ids = queued.map((r) => r.id);
    await this.routePendingBatch(ids);

    const assigned = await this.prisma.serviceRequest.findMany({
      where: { id: { in: ids }, status: "ASSIGNED" },
      select: { id: true },
    });
    return assigned.map((r) => r.id);
  }

  /**
   * Re-check the routing landscape after a technician's skills or shift
   * changed, and return the ids of requests whose assignment actually moved.
   *
   * Two directions matter, and only these two:
   *  - work they can no longer do (a dropped skill, a narrowed shift) has to
   *    find a new home;
   *  - a newly learned skill may unblock requests nobody could take before.
   *
   * Assignments that are still valid are deliberately left alone — re-routing
   * those would bounce requests between technicians on workload drift alone,
   * for no gain.
   */
  async revalidateFor(technicianId: number): Promise<number[]> {
    const technicians = await this.technicians.getEngineTechnicians();
    const tech = technicians.find((t) => t.id === technicianId);
    if (!tech) throw new NotFoundException(`Technician ${technicianId} not found`);

    const [assigned, unassigned] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where: { assignedTechnicianId: technicianId, status: "ASSIGNED" },
        include: { requiredSkills: { include: { skill: true } } },
      }),
      // QUEUED counts here too: raising a cap or bringing a technician back
      // frees capacity, which is exactly what queued work is waiting on.
      this.prisma.serviceRequest.findMany({
        where: { status: { in: ["UNASSIGNED", "QUEUED"] } },
        select: { id: true },
      }),
    ]);

    const stale = assigned.filter(
      (r) =>
        !qualifies(
          r.requiredSkills.map((rs) => ({
            skillName: rs.skill.name,
            minLevel: rs.minLevel,
          })),
          tech,
          evaluationTimeOf(r),
        ),
    );

    const candidateIds = [
      ...stale.map((r) => r.id),
      ...unassigned.map((r) => r.id),
    ];
    if (candidateIds.length === 0) return [];

    // Snapshot first so we can report what genuinely moved rather than
    // everything we merely re-examined.
    const before = new Map(
      (
        await this.prisma.serviceRequest.findMany({
          where: { id: { in: candidateIds } },
          select: { id: true, assignedTechnicianId: true },
        })
      ).map((r) => [r.id, r.assignedTechnicianId]),
    );

    if (stale.length > 0) {
      await this.prisma.serviceRequest.updateMany({
        where: { id: { in: stale.map((r) => r.id) } },
        data: { status: "PENDING", assignedTechnicianId: null },
      });
    }
    await this.routePendingBatch(candidateIds);

    const after = await this.prisma.serviceRequest.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, assignedTechnicianId: true },
    });
    return after
      .filter((r) => before.get(r.id) !== r.assignedTechnicianId)
      .map((r) => r.id);
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
