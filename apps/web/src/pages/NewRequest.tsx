import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { api, type Priority, type ServiceRequestDetail } from "@/api";
import { WEEKDAY_CHIPS, dayLabel } from "@/components/working-hours";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SkillRow {
  skill: string;
  level: number;
}

export function NewRequest({ onCreated }: { onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const offered = useQuery({
    queryKey: ["offered-skills"],
    queryFn: api.offeredSkills,
  });
  const offeredSkills = offered.data ?? [];

  const [customer, setCustomer] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [scheduledDay, setScheduledDay] = useState<number | null>(null);
  const [scheduledTime, setScheduledTime] = useState("10:00");
  const [skills, setSkills] = useState<SkillRow[]>([{ skill: "", level: 4 }]);

  const onSuccess = (r: ServiceRequestDetail) => {
    qc.invalidateQueries({ queryKey: ["requests"] });
    qc.invalidateQueries({ queryKey: ["technicians"] });
    onCreated(r.id);
  };

  const create = useMutation({
    mutationFn: () =>
      api.createRequest({
        customer,
        priority,
        requiredSkills: Object.fromEntries(
          skills.filter((s) => s.skill).map((s) => [s.skill, s.level]),
        ),
        ...(scheduledDay !== null ? { scheduledDay, scheduledTime } : {}),
      }),
    onSuccess,
  });

  const setSkill = (i: number, patch: Partial<SkillRow>) =>
    setSkills((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const optionsFor = (i: number) => {
    const takenElsewhere = new Set(
      skills.filter((_, j) => j !== i).map((s) => s.skill),
    );
    return offeredSkills.filter((o) => !takenElsewhere.has(o.name));
  };

  const chosen = skills.filter((s) => s.skill);
  const allOfferedUsed = chosen.length >= offeredSkills.length;
  const canSubmit = customer.trim().length > 0 && chosen.length > 0;

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Create Service Request</CardTitle>
        <CardDescription>
          Pick the customer and the required skills. Only skills that at least
          one technician has are selectable — so a request can never require a
          skill nobody in the workforce holds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-2">
            <Label htmlFor="customer">Customer</Label>
            <Input
              id="customer"
              placeholder="e.g. ABC Corp"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Priority</Label>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as Priority)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Scheduled for (optional)</Label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_CHIPS.map((d) => (
              <button
                key={d.i}
                type="button"
                onClick={() =>
                  setScheduledDay(scheduledDay === d.i ? null : d.i)
                }
                className={cn(
                  "h-8 w-11 rounded-md border text-xs font-medium transition-colors",
                  scheduledDay === d.i
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={scheduledTime}
              disabled={scheduledDay === null}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="w-32"
            />
            <span className="text-xs text-muted-foreground">
              {scheduledDay === null
                ? "— pick a day to require technicians on shift then; leave off to ignore working hours"
                : `Technicians must be on shift ${dayLabel(scheduledDay)} at ${scheduledTime}`}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <Label>Required skills</Label>

          {offered.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading skills…</p>
          ) : offeredSkills.length === 0 ? (
            <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              No technician has any skills yet. Add technicians with skills first
              — a request can only require skills the workforce actually has.
            </p>
          ) : (
            <>
              {skills.map((s, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Select
                    value={s.skill}
                    onValueChange={(v) => setSkill(i, { skill: v })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a skill" />
                    </SelectTrigger>
                    <SelectContent>
                      {optionsFor(i).map((o) => (
                        <SelectItem key={o.id} value={o.name}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(s.level)}
                    onValueChange={(v) => setSkill(i, { level: Number(v) })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          Min {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove skill"
                    disabled={skills.length === 1}
                    onClick={() => setSkills(skills.filter((_, j) => j !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={allOfferedUsed}
                  onClick={() => setSkills([...skills, { skill: "", level: 3 }])}
                >
                  <Plus className="h-4 w-4" />
                  Add skill
                </Button>
                <Button
                  disabled={!canSubmit || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "Routing…" : "Create & route"}
                </Button>
              </div>
              {create.isError && (
                <p className="text-sm text-destructive">
                  {(create.error as Error).message}
                </p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
