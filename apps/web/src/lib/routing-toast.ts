import { toast } from "sonner";
import type { ServiceRequestDetail } from "@/api";

const listIds = (ids: number[]) => `#${ids.join(", #")}`;

/**
 * Announce what routing did with a request.
 *
 * The three outcomes need genuinely different messages: assigned is a plain
 * success, QUEUED means "everyone is full, sit tight — this lands itself",
 * and UNASSIGNED means nobody can do the work at all and a human has to act.
 * Collapsing the last two into one "unassigned" toast is what makes a
 * dispatcher chase a problem that would have solved itself.
 */
export function toastRoutingOutcome(request: ServiceRequestDetail) {
  const label = `Request #${request.id} · ${request.customer}`;

  if (request.status === "ASSIGNED" && request.assignedTechnician) {
    // The winner's trace row carries the human-readable "why them" string.
    const why = request.evaluations.find(
      (e) => e.technicianId === request.assignedTechnician?.id,
    )?.reason;
    toast.success(`Assigned to ${request.assignedTechnician.name}`, {
      description: why ? `${label} — ${why}` : label,
    });
    return;
  }

  if (request.status === "QUEUED") {
    const packed = request.evaluations.filter(
      (e) => e.rejectReason === "AT_CAPACITY",
    );
    const names = packed.map((e) => e.technicianName).join(", ");
    toast.warning("All technicians are currently packed", {
      description:
        `${label} is queued. ${packed.length} qualified technician(s) — ${names} — ` +
        `are at their max workload. It will be assigned automatically to the first one who frees up.`,
      duration: 9000,
    });
    return;
  }

  toast.error("No technician can take this request", {
    description: `${label} — nobody on the roster meets every required skill at the requested level. Add the skill to a technician, or adjust the requirements.`,
    duration: 9000,
  });
}

/** Queued work that got picked up as a side effect of freeing capacity. */
export function toastAutoAssigned(ids: number[]) {
  if (ids.length === 0) return;
  toast.success(
    `${ids.length} queued request${ids.length === 1 ? "" : "s"} auto-assigned`,
    {
      description: `Capacity freed up — ${listIds(ids)} ${
        ids.length === 1 ? "was" : "were"
      } handed to the next available technician.`,
    },
  );
}

/** Requests that moved because a technician's setup changed. */
export function toastReassigned(ids: number[], prefix: string) {
  if (ids.length === 0) {
    toast.success(prefix, { description: "No request assignments changed." });
    return;
  }
  toast.success(prefix, {
    description: `Re-routed ${ids.length} request(s): ${listIds(ids)}.`,
  });
}
