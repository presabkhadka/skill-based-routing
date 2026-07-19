import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type RequestStatus } from "@/api";
import { StatRow, type StatTile } from "@/components/stat-card";
import { StatusBadge } from "@/components/badges";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_COLOR: Record<RequestStatus, string> = {
  ASSIGNED: "var(--chart-2)",
  UNASSIGNED: "var(--chart-5)",
  QUEUED: "var(--chart-1)",
  PENDING: "var(--chart-3)",
  COMPLETED: "var(--chart-4)",
};

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 6px 16px rgb(17 24 39 / 0.10)",
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

const EMPTY_STATUS_COUNTS: Record<RequestStatus, number> = {
  PENDING: 0,
  ASSIGNED: 0,
  UNASSIGNED: 0,
  QUEUED: 0,
  COMPLETED: 0,
};

export function Dashboard({
  onOpenRequest,
}: {
  onOpenRequest: (id: number) => void;
}) {
  const requests = useQuery({ queryKey: ["requests"], queryFn: api.requests });
  const technicians = useQuery({
    queryKey: ["technicians"],
    queryFn: api.technicians,
  });

  const r = requests.data ?? [];
  const techs = technicians.data ?? [];

  if (requests.isLoading || technicians.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  // One pass over the requests; both the stat tiles and the pie chart read
  // their numbers back out of this.
  const counts = r.reduce(
    (acc, x) => {
      acc[x.status] += 1;
      return acc;
    },
    { ...EMPTY_STATUS_COUNTS },
  );
  const availableTechs = techs.filter((t) => t.available).length;

  const tiles: StatTile[] = [
    {
      label: "Total Requests",
      value: r.length,
      sublabel: "Across all statuses",
    },
    {
      label: "Assigned",
      value: counts.ASSIGNED,
      sublabel: "Successfully routed",
      delta: {
        text: `${pct(counts.ASSIGNED, r.length)}%`,
        tone: "success",
        dir: "up",
      },
    },
    {
      label: "Unassigned",
      value: counts.UNASSIGNED,
      sublabel: "Awaiting a match",
      delta: {
        text: `${pct(counts.UNASSIGNED, r.length)}%`,
        tone: "destructive",
        dir: "down",
      },
    },
    {
      label: "Technicians Available",
      value: `${availableTechs}/${techs.length}`,
      sublabel: "Ready to take work",
      delta: {
        text: `${pct(availableTechs, techs.length)}%`,
        tone: "success",
        dir: "up",
      },
    },
  ];

  const statusData = (Object.keys(STATUS_COLOR) as RequestStatus[])
    .map((status) => ({ status, value: counts[status] }))
    .filter((d) => d.value > 0);

  const workloadData = techs
    .filter((t) => t.workload > 0)
    .sort((a, b) => b.workload - a.workload)
    .slice(0, 8)
    .map((t) => ({ name: t.name, workload: t.workload }));
  const workloadChartHeight = Math.max(140, workloadData.length * 40 + 24);

  const recent = [...r].sort((a, b) => b.id - a.id).slice(0, 6);

  return (
    <div className="space-y-5">
      <StatRow tiles={tiles} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Requests by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="flex items-center gap-6">
                <div className="h-[190px] w-[190px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="value"
                        nameKey="status"
                        innerRadius={56}
                        outerRadius={88}
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {statusData.map((d) => (
                          <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-3">
                  {statusData.map((d) => (
                    <div
                      key={d.status}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: STATUS_COLOR[d.status] }}
                        />
                        <span className="text-muted-foreground">
                          {d.status}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">
                        {pct(d.value, r.length)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Technician Workload</CardTitle>
          </CardHeader>
          <CardContent>
            {workloadData.length === 0 ? (
              <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                No technician is carrying load right now.
              </div>
            ) : (
              <div style={{ height: workloadChartHeight }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={workloadData}
                    layout="vertical"
                    barCategoryGap="28%"
                    margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                  >
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      domain={[0, "dataMax"]}
                      tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={90}
                      interval={0}
                      tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", radius: 6 }}
                      contentStyle={tooltipStyle}
                    />
                    <Bar
                      dataKey="workload"
                      fill="var(--chart-1)"
                      radius={[0, 6, 6, 0]}
                      maxBarSize={18}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No requests yet.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {recent.map((req) => (
                <button
                  key={req.id}
                  onClick={() => onOpenRequest(req.id)}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-4 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      #{req.id} · {req.customer}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {Object.entries(req.requiredSkills)
                        .map(([s, l]) => `${s} ≥ ${l}`)
                        .join(", ") || "No required skills"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="hidden text-sm text-muted-foreground sm:block">
                      {req.assignedTechnician?.name ?? "—"}
                    </span>
                    <StatusBadge status={req.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[190px] items-center justify-center text-sm text-muted-foreground">
      No data to display yet.
    </div>
  );
}
