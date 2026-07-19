import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Clock } from "lucide-react";
import { api, type WorkingWindow } from "@/api";
import { AvailabilityBadge, SkillChips } from "@/components/badges";
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

interface SkillRow {
  skill: string;
  level: number;
}

export function Technicians() {
  const qc = useQueryClient();
  const technicians = useQuery({
    queryKey: ["technicians"],
    queryFn: api.technicians,
  });

  const [name, setName] = useState("");
  const [skills, setSkills] = useState<SkillRow[]>([{ skill: "", level: 3 }]);
  const [hours, setHours] = useState<WorkingWindow[]>([]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftHours, setDraftHours] = useState<WorkingWindow[]>([]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["technicians"] });
    qc.invalidateQueries({ queryKey: ["requests"] });
    qc.invalidateQueries({ queryKey: ["offered-skills"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.createTechnician({
        name,
        skills: skills.filter((s) => s.skill.trim()),
        workingHours: hours,
      }),
    onSuccess: () => {
      setName("");
      setSkills([{ skill: "", level: 3 }]);
      setHours([]);
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: (v: { id: number; available: boolean }) =>
      api.setAvailability(v.id, v.available),
    onSuccess: (res) => {
      invalidate();
      if (res.reassignedRequestIds.length) {
        alert(
          `Auto-reassigned ${res.reassignedRequestIds.length} request(s): #${res.reassignedRequestIds.join(", #")}`,
        );
      }
    },
  });

  const saveHours = useMutation({
    mutationFn: (v: { id: number; hours: WorkingWindow[] }) =>
      api.setWorkingHours(v.id, v.hours),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
    },
  });

  const setSkill = (i: number, patch: Partial<SkillRow>) => {
    setSkills((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
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
          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="tech-name">Name</Label>
            <Input
              id="tech-name"
              placeholder="e.g. Jordan Lee"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Skills</Label>
            {skills.map((s, i) => (
              <div key={i} className="flex items-end gap-2">
                <Input
                  placeholder="e.g. HVAC"
                  value={s.skill}
                  onChange={(e) => setSkill(i, { skill: e.target.value })}
                />
                <Select
                  value={String(s.level)}
                  onValueChange={(v) => setSkill(i, { level: Number(v) })}
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
                  onClick={() => setSkills(skills.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSkills([...skills, { skill: "", level: 3 }])}
            >
              <Plus className="h-4 w-4" />
              Add skill
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Working hours</Label>
            <p className="text-xs text-muted-foreground">
              Pick working days and a daily window. Leave all days off for a
              technician who's always available.
            </p>
            <WorkingHoursEditor value={hours} onChange={setHours} />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create technician"}
            </Button>
            {create.isError && (
              <p className="text-sm text-destructive">
                {(create.error as Error).message}
              </p>
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
        <CardContent>
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
                  <TableHead className="text-center">Workload</TableHead>
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
                        <button
                          onClick={() => {
                            setEditingId(editingId === t.id ? null : t.id);
                            setDraftHours(t.workingHours);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Clock className="h-3.5 w-3.5" />
                          {summarizeHours(t.workingHours)}
                        </button>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {t.workload}
                      </TableCell>
                      <TableCell>
                        <AvailabilityBadge available={t.available} />
                      </TableCell>
                      <TableCell className="text-right">
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
                      </TableCell>
                    </TableRow>
                    {editingId === t.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-muted/30">
                          <div className="space-y-3 py-1">
                            <p className="text-sm font-medium">
                              Working hours — {t.name}
                            </p>
                            <WorkingHoursEditor
                              value={t.workingHours}
                              onChange={setDraftHours}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={saveHours.isPending}
                                onClick={() =>
                                  saveHours.mutate({
                                    id: t.id,
                                    hours: draftHours,
                                  })
                                }
                              >
                                {saveHours.isPending ? "Saving…" : "Save hours"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </Button>
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
