import { Badge } from "@/components/ui/badge";
import type { Priority, RejectReason, RequestStatus } from "@/api";

export const REJECT_LABEL: Record<RejectReason, string> = {
  MISSING_SKILL: "missing skill",
  LEVEL_TOO_LOW: "level too low",
  UNAVAILABLE: "unavailable",
  OUTSIDE_HOURS: "off shift",
  AT_CAPACITY: "at capacity",
};

const STATUS_VARIANT: Record<
  RequestStatus,
  "success" | "destructive" | "warning" | "secondary"
> = {
  ASSIGNED: "success",
  UNASSIGNED: "destructive",
  QUEUED: "warning",
  PENDING: "warning",
  COMPLETED: "secondary",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}

export function AvailabilityBadge({ available }: { available: boolean }) {
  return (
    <Badge variant={available ? "success" : "destructive"}>
      {available ? "Available" : "Away"}
    </Badge>
  );
}

const PRIORITY_VARIANT: Record<Priority, "destructive" | "warning" | "secondary"> =
  {
    HIGH: "destructive",
    MEDIUM: "warning",
    LOW: "secondary",
  };

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{priority}</Badge>;
}

export function SkillChips({
  skills,
  op = "·",
}: {
  skills: Record<string, number>;
  op?: "·" | "≥";
}) {
  const entries = Object.entries(skills);
  if (entries.length === 0)
    return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([skill, level]) => (
        <span
          key={skill}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {skill}
          <span className="text-muted-foreground">
            {op} {level}
          </span>
        </span>
      ))}
    </div>
  );
}
