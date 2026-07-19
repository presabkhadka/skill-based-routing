import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Clock, Pencil } from "lucide-react";
import {
  api,
  type Technician,
  type TechnicianSkillInput,
  type WorkingWindow,
} from "@/api";
import { toast } from "sonner";
import { AvailabilityBadge, SkillChips } from "@/components/badges";
import { toastReassigned } from "@/lib/routing-toast";
import { cn } from "@/lib/utils";
import {
  WorkingHoursEditor,
  summarizeHours,
} from "@/components/working-hours";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type SkillRow = TechnicianSkillInput;

interface Draft {
  name: string;
  skills: SkillRow[];
  hours: WorkingWindow[];
  maxWorkload: number;
}

const DEFAULT_MAX_WORKLOAD = 5;

const NEW_TECHNICIAN: Draft = {
  name: "",
  skills: [{ skill: "", level: 3 }],
  hours: [],
  maxWorkload: DEFAULT_MAX_WORKLOAD,
};

const filledSkills = (rows: SkillRow[]) =>
  rows.filter((s) => s.skill.trim()).map((s) => ({ ...s, skill: s.skill.trim() }));

/** Order-insensitive comparison — reordering rows is not an edit. */
const sameSkills = (a: SkillRow[], b: SkillRow[]) => {
  const key = (rows: SkillRow[]) =>
    JSON.stringify(
      [...rows]
        .map((s) => [s.skill.toLowerCase(), s.level] as const)
        .sort((x, y) => x[0].localeCompare(y[0])),
    );
  return key(a) === key(b);
};

const draftOf = (t: Technician): Draft => ({
  name: t.name,
  skills: Object.entries(t.skills).map(([skill, level]) => ({ skill, level })),
  hours: t.workingHours,
  maxWorkload: t.maxWorkload,
});

export function Technicians() {
  const qc = useQueryClient();
  const technicians = useQuery({
    queryKey: ["technicians"],
    queryFn: api.technicians,
  });

  const [draft, setDraft] = useState<Draft>(NEW_TECHNICIAN);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Draft>(NEW_TECHNICIAN);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["technicians"] });
    qc.invalidateQueries({ queryKey: ["requests"] });
    qc.invalidateQueries({ queryKey: ["offered-skills"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.createTechnician({
        name: draft.name.trim(),
        skills: filledSkills(draft.skills),
        workingHours: draft.hours,
        maxWorkload: draft.maxWorkload,
      }),
    onSuccess: (t) => {
      setDraft(NEW_TECHNICIAN);
      invalidate();
      toast.success(`${t.name} added`, {
        description: `Max workload ${t.maxWorkload}. Ready to take assignments.`,
      });
    },
  });

  const toggle = useMutation({
    mutationFn: (v: { id: number; available: boolean }) =>
      api.setAvailability(v.id, v.available),
    onSuccess: (res) => {
      invalidate();
      toastReassigned(
        res.reassignedRequestIds,
        `${res.technician.name} set ${res.technician.available ? "available" : "away"}`,
      );
    },
  });

  /**
   * Skills and the name/hours live behind different endpoints, so a single
   * save may be two calls. Only changed sections are sent — a rename must not
   * churn the technician's skill rows or re-open routing.
   */
  const save = useMutation({
    mutationFn: async (v: { original: Technician; next: Draft }) => {
      const { original, next } = v;
      const skills = filledSkills(next.skills);
      const movedIds: number[] = [];

      if (!sameSkills(skills, draftOf(original).skills)) {
        const res = await api.setSkills(original.id, skills);
        movedIds.push(...res.reassignedRequestIds);
      }

      const patch: {
        name?: string;
        workingHours?: WorkingWindow[];
        maxWorkload?: number;
      } = {};
      if (next.name.trim() && next.name.trim() !== original.name) {
        patch.name = next.name.trim();
      }
      if (JSON.stringify(next.hours) !== JSON.stringify(original.workingHours)) {
        patch.workingHours = next.hours;
      }
      if (next.maxWorkload !== original.maxWorkload) {
        patch.maxWorkload = next.maxWorkload;
      }
      if (Object.keys(patch).length > 0) {
        const res = await api.updateTechnician(original.id, patch);
        movedIds.push(...res.reassignedRequestIds);
      }

      return { name: next.name.trim() || original.name, movedIds };
    },
    onSuccess: ({ name, movedIds }) => {
      invalidate();
      setEditingId(null);
      toastReassigned([...new Set(movedIds)], `${name} updated`);
    },
  });

  const startEdit = (t: Technician) => {
    save.reset();
    setEditingId(t.id);
    setEdit(draftOf(t));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Technician</CardTitle>
          <CardDescription>
            Create a technician, their skill proficiencies (1–5), and optional
            working hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="grid flex-1 gap-2 sm:max-w-sm">
              <Label htmlFor="tech-name">Name</Label>
              <Input
                id="tech-name"
                placeholder="e.g. Jordan Lee"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <MaxWorkloadField
              id="tech-max-workload"
              value={draft.maxWorkload}
              onChange={(maxWorkload) => setDraft({ ...draft, maxWorkload })}
            />
          </div>

          <div className="space-y-2">
            <Label>Skills</Label>
            <SkillRowsEditor
              rows={draft.skills}
              onChange={(skills) => setDraft({ ...draft, skills })}
            />
          </div>

          <div className="space-y-2">
            <Label>Working hours</Label>
            <p className="text-xs text-muted-foreground">
              Pick working days and a daily window. Leave all days off for a
              technician who's always available.
            </p>
            <WorkingHoursEditor
              value={draft.hours}
              onChange={(hours) => setDraft({ ...draft, hours })}
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              disabled={!draft.name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create technician"}
            </Button>
            {create.isError && (
              <p className="text-sm text-destructive">{create.error.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Technicians{" "}
            <span className="text-muted-foreground">
              ({technicians.data?.length ?? 0})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {technicians.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Skills</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead className="text-center">Capacity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {technicians.data?.map((t) => (
                  <Fragment key={t.id}>
                    <TableRow>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>
                        <SkillChips skills={t.skills} />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {summarizeHours(t.workingHours)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <CapacityMeter
                          workload={t.workload}
                          max={t.maxWorkload}
                        />
                      </TableCell>
                      <TableCell>
                        <AvailabilityBadge available={t.available} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              editingId === t.id
                                ? setEditingId(null)
                                : startEdit(t)
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {editingId === t.id ? "Close" : "Edit"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={toggle.isPending}
                            onClick={() =>
                              toggle.mutate({
                                id: t.id,
                                available: !t.available,
                              })
                            }
                          >
                            {t.available ? "Set away" : "Set available"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {editingId === t.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-muted/30">
                          <div className="space-y-4 py-2">
                            <p className="text-sm font-medium">
                              Editing {t.name}
                            </p>

                            <div className="flex flex-wrap gap-4">
                              <div className="grid flex-1 gap-2 sm:max-w-sm">
                                <Label htmlFor={`edit-name-${t.id}`}>
                                  Name
                                </Label>
                                <Input
                                  id={`edit-name-${t.id}`}
                                  value={edit.name}
                                  onChange={(e) =>
                                    setEdit({ ...edit, name: e.target.value })
                                  }
                                />
                              </div>
                              <MaxWorkloadField
                                id={`edit-max-${t.id}`}
                                value={edit.maxWorkload}
                                onChange={(maxWorkload) =>
                                  setEdit({ ...edit, maxWorkload })
                                }
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Skills</Label>
                              <p className="text-xs text-muted-foreground">
                                Add a newly learned skill, or adjust a
                                proficiency level as it improves.
                              </p>
                              <SkillRowsEditor
                                rows={edit.skills}
                                onChange={(skills) =>
                                  setEdit({ ...edit, skills })
                                }
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Working hours</Label>
                              {/* Keyed per technician so the editor reseeds
                                  its internal state when the row changes. */}
                              <WorkingHoursEditor
                                key={t.id}
                                value={edit.hours}
                                onChange={(hours) => setEdit({ ...edit, hours })}
                              />
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                disabled={save.isPending}
                                onClick={() =>
                                  save.mutate({ original: t, next: edit })
                                }
                              >
                                {save.isPending ? "Saving…" : "Save changes"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </Button>
                              {save.isError && (
                                <p className="text-sm text-destructive">
                                  {save.error.message}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Workload against cap, so a full technician is obvious at a glance. */
function CapacityMeter({ workload, max }: { workload: number; max: number }) {
  const full = workload >= max;
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <span
        className={cn(
          "text-sm tabular-nums",
          full ? "font-semibold text-destructive" : "text-foreground",
        )}
      >
        {workload} / {max}
      </span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full transition-all",
            full ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, (workload / max) * 100)}%` }}
        />
      </span>
    </div>
  );
}

/** Max concurrent assignments before routing skips this technician. */
function MaxWorkloadField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid gap-2 sm:max-w-[14rem]">
      <Label htmlFor={id}>Max workload</Label>
      <Input
        id={id}
        type="number"
        min={1}
        max={100}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(100, Math.max(1, n)));
        }}
      />
      <p className="text-xs text-muted-foreground">
        Routing skips this technician once they hold this many open
        assignments.
      </p>
    </div>
  );
}

/** Free-text skill name + level rows. Shared by the create and edit forms. */
function SkillRowsEditor({
  rows,
  onChange,
}: {
  rows: SkillRow[];
  onChange: (rows: SkillRow[]) => void;
}) {
  const patch = (i: number, next: Partial<SkillRow>) =>
    onChange(rows.map((s, j) => (j === i ? { ...s, ...next } : s)));

  return (
    <div className="space-y-2">
      {rows.map((s, i) => (
        <div key={i} className="flex items-end gap-2">
          <Input
            placeholder="e.g. HVAC"
            value={s.skill}
            onChange={(e) => patch(i, { skill: e.target.value })}
          />
          <Select
            value={String(s.level)}
            onValueChange={(v) => patch(i, { level: Number(v) })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Level {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove skill"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, { skill: "", level: 3 }])}
      >
        <Plus className="h-4 w-4" />
        Add skill
      </Button>
    </div>
  );
}
