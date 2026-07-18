import {
  DAY_NAMES,
  isWithinWorkingHours,
  minutesToHhmm,
  type EngineRequiredSkill,
  type EngineTechnician,
  type EvaluationTime,
  type CandidateEvaluation,
  type RoutingResult,
} from "@skill-routing/shared";

export function routeRequest(
  requiredSkills: EngineRequiredSkill[],
  technicians: EngineTechnician[],
  now?: EvaluationTime,
): RoutingResult {
  if (requiredSkills.length === 0) {
    return {
      assignedTechnicianId: null,
      assignedTechnicianName: null,
      selectedBecause: null,
      eligibleTechnicianIds: [],
      evaluations: [],
    };
  }

  const evaluations: CandidateEvaluation[] = technicians.map((tech) =>
    evaluateTechnician(tech, requiredSkills, now),
  );

  const eligible = technicians.filter(
    (t) => evaluations.find((e) => e.technicianId === t.id)?.eligible,
  );

  const winner = selectBest(eligible, requiredSkills);

  let selectedBecause: string | null = null;
  if (winner) {
    selectedBecause = explainSelection(winner, eligible, requiredSkills);
    const winnerEval = evaluations.find((e) => e.technicianId === winner.id);
    if (winnerEval) winnerEval.reason = selectedBecause;
  }

  return {
    assignedTechnicianId: winner?.id ?? null,
    assignedTechnicianName: winner?.name ?? null,
    selectedBecause,
    eligibleTechnicianIds: eligible.map((t) => t.id),
    evaluations,
  };
}

function skillLevel(
  skills: Record<string, number>,
  skillName: string,
): number | undefined {
  const direct = skills[skillName];
  if (direct !== undefined) return direct;
  const target = skillName.trim().toLowerCase();
  for (const key of Object.keys(skills)) {
    if (key.trim().toLowerCase() === target) return skills[key];
  }
  return undefined;
}

function evaluateTechnician(
  tech: EngineTechnician,
  requiredSkills: EngineRequiredSkill[],
  now?: EvaluationTime,
): CandidateEvaluation {
  const base = {
    technicianId: tech.id,
    technicianName: tech.name,
    workload: tech.workload,
  };

  const missing = requiredSkills.find(
    (req) => skillLevel(tech.skills, req.skillName) === undefined,
  );
  if (missing) {
    return {
      ...base,
      eligible: false,
      rejectReason: "MISSING_SKILL",
      reason: `Missing required skill: ${missing.skillName}`,
    };
  }

  const tooLow = requiredSkills.find(
    (req) => skillLevel(tech.skills, req.skillName)! < req.minLevel,
  );
  if (tooLow) {
    const have = skillLevel(tech.skills, tooLow.skillName);
    return {
      ...base,
      eligible: false,
      rejectReason: "LEVEL_TOO_LOW",
      reason: `${tooLow.skillName} level ${have} < required ${tooLow.minLevel}`,
    };
  }

  if (!tech.available) {
    return {
      ...base,
      eligible: false,
      rejectReason: "UNAVAILABLE",
      reason: "Technician is unavailable",
    };
  }

  if (now && !isWithinWorkingHours(tech.workingHours, now)) {
    return {
      ...base,
      eligible: false,
      rejectReason: "OUTSIDE_HOURS",
      reason: describeOffShift(tech, now),
    };
  }

  return {
    ...base,
    eligible: true,
    reason: `Eligible (workload ${tech.workload})`,
  };
}

function describeOffShift(tech: EngineTechnician, at: EvaluationTime): string {
  const dayName = DAY_NAMES[at.dayOfWeek];
  const timeStr = minutesToHhmm(at.minutes);
  const todays = (tech.workingHours ?? []).filter((w) => w.day === at.dayOfWeek);
  if (todays.length === 0) {
    return `Outside working hours (no shift on ${dayName})`;
  }
  const shifts = todays.map((w) => `${w.start}–${w.end}`).join(", ");
  return `Outside working hours (${dayName} ${timeStr} is outside shift ${shifts})`;
}

function summedProficiency(
  tech: EngineTechnician,
  requiredSkills: EngineRequiredSkill[],
): number {
  return requiredSkills.reduce(
    (sum, req) => sum + (skillLevel(tech.skills, req.skillName) ?? 0),
    0,
  );
}

function selectBest(
  eligible: EngineTechnician[],
  requiredSkills: EngineRequiredSkill[],
): EngineTechnician | null {
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => {
    if (a.workload !== b.workload) return a.workload - b.workload;
    const profDiff =
      summedProficiency(b, requiredSkills) -
      summedProficiency(a, requiredSkills);
    if (profDiff !== 0) return profDiff;
    return a.id - b.id;
  })[0];
}

function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function explainSelection(
  winner: EngineTechnician,
  eligible: EngineTechnician[],
  requiredSkills: EngineRequiredSkill[],
): string {
  if (eligible.length === 1) {
    return `Selected — the only eligible technician (workload ${winner.workload}).`;
  }

  const others = eligible.filter((t) => t.id !== winner.id);
  const tiedOnWorkload = others.filter((t) => t.workload === winner.workload);

  if (tiedOnWorkload.length === 0) {
    return `Selected — lowest workload (${winner.workload}) among ${eligible.length} eligible technicians.`;
  }

  const winnerProf = summedProficiency(winner, requiredSkills);
  const tiedOnProf = tiedOnWorkload.filter(
    (t) => summedProficiency(t, requiredSkills) === winnerProf,
  );
  if (tiedOnProf.length === 0) {
    const runnerUpProf = Math.max(
      ...tiedOnWorkload.map((t) => summedProficiency(t, requiredSkills)),
    );
    return `Selected — tied on lowest workload (${winner.workload}) with ${listNames(
      tiedOnWorkload.map((t) => t.name),
    )}, then won on higher total proficiency across the required skills (${winnerProf} vs ${runnerUpProf}).`;
  }

  return `Selected — tied on both workload (${winner.workload}) and total proficiency (${winnerProf}) with ${listNames(
    tiedOnProf.map((t) => t.name),
  )}; chosen by lowest technician id (#${winner.id}) as the final deterministic tiebreak.`;
}
