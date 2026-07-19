import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type RejectReason } from "@/api";

const REJECT_LABEL: Record<RejectReason, string> = {
  MISSING_SKILL: "missing skill",
  LEVEL_TOO_LOW: "level too low",
  UNAVAILABLE: "unavailable",
  OUTSIDE_HOURS: "off shift",
};
import { dayLabel } from "@/components/working-hours";
import { PriorityBadge, SkillChips, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export function Requests({
  focusId,
  onFocus,
}: {
  focusId: number | null;
  onFocus: (id: number | null) => void;
}) {
  if (focusId != null) {
    return <RequestDetail id={focusId} onBack={() => onFocus(null)} />;
  }
  return <RequestList onOpen={onFocus} />;
}

function RequestList({ onOpen }: { onOpen: (id: number) => void }) {
  const requests = useQuery({ queryKey: ["requests"], queryFn: api.requests });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          All Requests{" "}
          <span className="text-muted-foreground">
            ({requests.data?.length ?? 0})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {requests.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">#</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.data?.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => onOpen(r.id)}
                >
                  <TableCell className="font-medium text-primary">
                    #{r.id}
                  </TableCell>
                  <TableCell className="font-medium">{r.customer}</TableCell>
                  <TableCell>
                    <SkillChips skills={r.requiredSkills} op="≥" />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={r.priority} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.assignedTechnician?.name ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {requests.data?.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No requests yet — create one from “New Request”.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RequestDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<{
    kind: "success" | "info" | "error";
    text: string;
  } | null>(null);
  const request = useQuery({
    queryKey: ["request", id],
    queryFn: () => api.request(id),
  });

  const reroute = useMutation({
    mutationFn: () => api.route(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["request", id] });
      qc.invalidateQueries({ queryKey: ["requests"] });
      if (result.assignedTechnician) {
        setBanner({
          kind: "success",
          text: `Routing re-run — assigned to ${result.assignedTechnician.name}.`,
        });
      } else {
        setBanner({
          kind: "info",
          text: "Routing re-run — still unassigned. No available technician has all required skills.",
        });
      }
    },
    onError: (err) => {
      setBanner({ kind: "error", text: (err as Error).message });
    },
  });

  const complete = useMutation({
    mutationFn: () => api.completeRequest(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["request", id] });
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["technicians"] });
      setBanner({
        kind: "success",
        text: `Request completed — ${result.assignedTechnician?.name ?? "the technician"}'s workload is freed up for future routing.`,
      });
    },
    onError: (err) => {
      setBanner({ kind: "error", text: (err as Error).message });
    },
  });

  const r = request.data;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4" />
        Back to list
      </Button>

      {banner && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm",
            banner.kind === "success" &&
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            banner.kind === "info" &&
              "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            banner.kind === "error" &&
              "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {banner.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <RefreshCw className="h-4 w-4 shrink-0" />
          )}
          {banner.text}
        </div>
      )}

      {!r ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-3 text-lg">
                    Request #{r.id} · {r.customer}
                    <StatusBadge status={r.status} />
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <PriorityBadge priority={r.priority} />
                    <span>·</span>
                    <SkillChips skills={r.requiredSkills} op="≥" />
                    {r.scheduledDay !== null && r.scheduledTime && (
                      <>
                        <span>·</span>
                        <span>
                          Scheduled{" "}
                          <span className="font-medium text-foreground">
                            {dayLabel(r.scheduledDay)} {r.scheduledTime}
                          </span>
                        </span>
                      </>
                    )}
                    {r.assignedTechnician && (
                      <>
                        <span>·</span>
                        <span>
                          Assigned to{" "}
                          <span className="font-medium text-foreground">
                            {r.assignedTechnician.name}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === "COMPLETED" ? (
                    <span className="text-sm text-muted-foreground">
                      Completed — this request is closed and can no longer be
                      routed.
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => reroute.mutate()}
                      disabled={reroute.isPending}
                    >
                      <RefreshCw
                        className={reroute.isPending ? "animate-spin" : ""}
                      />
                      {reroute.isPending ? "Re-running…" : "Re-run routing"}
                    </Button>
                  )}
                  {r.status === "ASSIGNED" && (
                    <Button
                      size="sm"
                      onClick={() => complete.mutate()}
                      disabled={complete.isPending}
                    >
                      <CheckCircle2 />
                      {complete.isPending ? "Completing…" : "Mark complete"}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Eligibility Trace</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Technician</TableHead>
                    <TableHead className="text-center">Workload</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.evaluations.map((e) => {
                    const isWinner = r.assignedTechnician?.id === e.technicianId;
                    return (
                      <TableRow
                        key={e.technicianId}
                        className={isWinner ? "bg-emerald-500/5" : undefined}
                      >
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {e.technicianName}
                            {isWinner && (
                              <Badge variant="success">Selected</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {e.workload}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                              e.eligible
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-destructive"
                            }`}
                          >
                            {e.eligible ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                            {e.eligible ? "Eligible" : "Rejected"}
                          </span>
                          {e.rejectReason && (
                            <Badge variant="outline" className="ml-2 font-mono text-[11px]">
                              {REJECT_LABEL[e.rejectReason]}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.reason}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {r.evaluations.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No technicians evaluated (no required skills extracted).
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
