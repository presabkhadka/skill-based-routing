import { useState } from "react";
import type { WorkingWindow } from "@/api";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Week starts Monday and wraps Sunday to the end — display order, not index order. */
export const DAYS = [
  { i: 1, label: "Mon" },
  { i: 2, label: "Tue" },
  { i: 3, label: "Wed" },
  { i: 4, label: "Thu" },
  { i: 5, label: "Fri" },
  { i: 6, label: "Sat" },
  { i: 0, label: "Sun" },
];

export function dayLabel(i: number): string {
  return DAYS.find((d) => d.i === i)?.label ?? "";
}

/** A single weekday toggle. Shared by the hours editor and the scheduler. */
export function DayChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 w-11 rounded-md border text-xs font-medium transition-colors",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

export function summarizeHours(windows: WorkingWindow[]): string {
  if (windows.length === 0) return "Always";
  const { start, end } = windows[0];
  const uniform = windows.every((w) => w.start === start && w.end === end);
  if (!uniform) return `${windows.length} shifts`;

  const covered = DAYS.filter((d) => windows.some((w) => w.day === d.i)).map(
    (d) => d.i,
  );
  return `${contiguousLabel(covered)} ${start}–${end}`;
}

/** "Mon–Fri" when the days run consecutively in display order, else "Mon, Wed, Fri". */
function contiguousLabel(dayIdx: number[]): string {
  const positions = dayIdx
    .map((i) => DAYS.findIndex((d) => d.i === i))
    .sort((a, b) => a - b);
  const contiguous =
    positions.length > 1 &&
    positions.every((p, k) => k === 0 || p === positions[k - 1] + 1);
  if (contiguous) {
    return `${DAYS[positions[0]].label}–${DAYS[positions[positions.length - 1]].label}`;
  }
  return positions.map((p) => DAYS[p].label).join(", ");
}

export function WorkingHoursEditor({
  value,
  onChange,
}: {
  value: WorkingWindow[];
  onChange: (v: WorkingWindow[]) => void;
}) {
  const [start, setStart] = useState(value[0]?.start ?? "09:00");
  const [end, setEnd] = useState(value[0]?.end ?? "17:00");
  const [days, setDays] = useState<Set<number>>(
    new Set(value.map((w) => w.day)),
  );

  const emit = (d: Set<number>, s: string, e: string) =>
    onChange(
      [...d].sort((a, b) => a - b).map((day) => ({ day, start: s, end: e })),
    );

  const toggle = (i: number) => {
    const next = new Set(days);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setDays(next);
    emit(next, start, end);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((d) => (
          <DayChip
            key={d.i}
            label={d.label}
            selected={days.has(d.i)}
            onClick={() => toggle(d.i)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="time"
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            emit(days, e.target.value, end);
          }}
          className="w-32"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="time"
          value={end}
          onChange={(e) => {
            setEnd(e.target.value);
            emit(days, start, e.target.value);
          }}
          className="w-32"
        />
        <span className="text-xs text-muted-foreground">
          {days.size === 0 ? "— always available" : summarizeHours(value)}
        </span>
      </div>
    </div>
  );
}
