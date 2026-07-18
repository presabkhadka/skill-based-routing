import { z } from "zod";

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 5;

export const levelSchema = z
  .number()
  .int()
  .min(LEVEL_MIN)
  .max(LEVEL_MAX);

export const Priority = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];
export const prioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export const RequestStatus = {
  PENDING: "PENDING",
  ASSIGNED: "ASSIGNED",
  UNASSIGNED: "UNASSIGNED",
  COMPLETED: "COMPLETED",
} as const;
export type RequestStatus =
  (typeof RequestStatus)[keyof typeof RequestStatus];
export const requestStatusSchema = z.enum([
  "PENDING",
  "ASSIGNED",
  "UNASSIGNED",
  "COMPLETED",
]);


export const createSkillSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type CreateSkillDto = z.infer<typeof createSkillSchema>;

export const technicianSkillSchema = z.object({
  skill: z.string().trim().min(1).max(60),
  level: levelSchema,
});
export type TechnicianSkillDto = z.infer<typeof technicianSkillSchema>;

export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24-hour)");

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const workingWindowSchema = z.object({
  day: z.number().int().min(0).max(6),
  start: timeOfDaySchema,
  end: timeOfDaySchema,
});
export type WorkingWindow = z.infer<typeof workingWindowSchema>;

export const workingHoursSchema = z.array(workingWindowSchema);
export type WorkingHours = WorkingWindow[];

export const setWorkingHoursSchema = z.object({
  workingHours: workingHoursSchema,
});
export type SetWorkingHoursDto = z.infer<typeof setWorkingHoursSchema>;

export interface EvaluationTime {
  dayOfWeek: number;
  minutes: number;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isWithinWorkingHours(
  windows: WorkingWindow[] | null | undefined,
  at: EvaluationTime,
): boolean {
  if (!windows || windows.length === 0) return true;
  return windows
    .filter((w) => w.day === at.dayOfWeek)
    .some((w) => {
      const s = hhmmToMinutes(w.start);
      const e = hhmmToMinutes(w.end);
      return e > s
        ? at.minutes >= s && at.minutes < e
        : at.minutes >= s || at.minutes < e;
    });
}

export const createTechnicianSchema = z.object({
  name: z.string().trim().min(1).max(120),
  available: z.boolean().optional().default(true),
  skills: z.array(technicianSkillSchema).default([]),
  workingHours: workingHoursSchema.optional().default([]),
});
export type CreateTechnicianDto = z.infer<typeof createTechnicianSchema>;

export const updateTechnicianSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  available: z.boolean().optional(),
  workingHours: workingHoursSchema.optional(),
});
export type UpdateTechnicianDto = z.infer<typeof updateTechnicianSchema>;

export const setAvailabilitySchema = z.object({
  available: z.boolean(),
});
export type SetAvailabilityDto = z.infer<typeof setAvailabilitySchema>;

export const setSkillsSchema = z.object({
  skills: z.array(technicianSkillSchema),
});
export type SetSkillsDto = z.infer<typeof setSkillsSchema>;

export const requiredSkillsSchema = z
  .record(z.string().trim().min(1), levelSchema)
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one required skill must be specified",
  });
export type RequiredSkillsMap = z.infer<typeof requiredSkillsSchema>;

export const createServiceRequestSchema = z
  .object({
    customer: z.string().trim().min(1).max(160),
    priority: prioritySchema.optional().default("MEDIUM"),
    requiredSkills: requiredSkillsSchema,
    scheduledDay: z.number().int().min(0).max(6).optional(),
    scheduledTime: timeOfDaySchema.optional(),
  })
  .refine(
    (d) => (d.scheduledDay === undefined) === (d.scheduledTime === undefined),
    { message: "scheduledDay and scheduledTime must be provided together" },
  );
export type CreateServiceRequestDto = z.infer<
  typeof createServiceRequestSchema
>;

export interface EngineRequiredSkill {
  skillName: string;
  minLevel: number;
}

export interface EngineTechnician {
  id: number;
  name: string;
  available: boolean;
  workload: number;
  skills: Record<string, number>;
  workingHours?: WorkingWindow[];
}

export type RejectReason =
  | "MISSING_SKILL"
  | "LEVEL_TOO_LOW"
  | "UNAVAILABLE"
  | "OUTSIDE_HOURS";

export interface CandidateEvaluation {
  technicianId: number;
  technicianName: string;
  eligible: boolean;
  reason: string;
  rejectReason?: RejectReason;
  workload: number;
}

export interface RoutingResult {
  assignedTechnicianId: number | null;
  assignedTechnicianName: string | null;
  selectedBecause: string | null;
  eligibleTechnicianIds: number[];
  evaluations: CandidateEvaluation[];
}
