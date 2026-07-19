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

/**
 * Case-insensitive view over one technician's skill map.
 *
 * Skill names arrive from three directions (seed data, the console, the alias
 * normalizer) and their casing does not always agree, so every lookup has to be
 * case-tolerant. Building the folded index once per technician keeps that
 * tolerance O(1) per lookup instead of rescanning the key list every time.
 */
interface SkillLookup {
  exact: Record<string, number>;
  folded: Map<string, number>;
}

function buildSkillLookup(skills: Record<string, number>): SkillLookup {
  const folded = new Map<string, number>();
  for (const key of Object.keys(skills)) {
    const normalized = key.trim().toLowerCase();
    // First key wins, matching the original left-to-right scan.
    if (!folded.has(normalized)) folded.set(normalized, skills[key]);
  }
  return { exact: skills, folded };
}

function skillLevel(
  lookup: SkillLookup,
  skillName: string,
): number | undefined {
  const direct = lookup.exact[skillName];
  if (direct !== undefined) return direct;
  return lookup.folded.get(skillName.trim().toLowerCase());
}

function summedProficiency(
  lookup: SkillLookup,
  requiredSkills: EngineRequiredSkill[],
): number {
  return requiredSkills.reduce(
    (sum, req) => sum + (skillLevel(lookup, req.skillName) ?? 0),
    0,
  );
}

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
      blockedByCapacity: false,
    };
  }

  const lookups = technicians.map((tech) => buildSkillLookup(tech.skills));

  const evaluations: CandidateEvaluation[] = technicians.map((tech, i) =>
    evaluateTechnician(tech, lookups[i], requiredSkills, now),
  );

  // Walk technicians and evaluations in lockstep — they are index-aligned by
  // construction — and bank each survivor's proficiency score while we are
  // here, so the tiebreak comparator and the explanation never recompute it.
  const eligible: EngineTechnician[] = [];
  const proficiency = new Map<number, number>();
  technicians.forEach((tech, i) => {
    if (!evaluations[i].eligible) return;
    eligible.push(tech);
    proficiency.set(tech.id, summedProficiency(lookups[i], requiredSkills));
  });

  const winner = selectBest(eligible, proficiency);

  let selectedBecause: string | null = null;
  if (winner) {
    selectedBecause = explainSelection(winner, eligible, proficiency);
    const winnerEval = evaluations.find((e) => e.technicianId === winner.id);
    if (winnerEval) winnerEval.reason = selectedBecause;
  }

  return {
    assignedTechnicianId: winner?.id ?? null,
    assignedTechnicianName: winner?.name ?? null,
    selectedBecause,
    eligibleTechnicianIds: eligible.map((t) => t.id),
    evaluations,
    blockedByCapacity:
      !winner && evaluations.some((e) => e.rejectReason === "AT_CAPACITY"),
  };
}

/**
 * Would this technician still be a valid assignee for these requirements?
 *
 * Used when a technician's skills or shift change, to tell an assignment that
 * has gone stale from one that is still perfectly good. Routes through the
 * same evaluator as `routeRequest`, so the two can never drift apart.
 *
 * Capacity is deliberately ignored: it gates taking on *new* work, and a
 * technician already holding this request is itself part of the workload being
 * measured. Enforcing it here would make a full technician fail every one of
 * their own assignments and shed the lot.
 */
export function qualifies(
  requiredSkills: EngineRequiredSkill[],
  tech: EngineTechnician,
  now?: EvaluationTime,
): boolean {
  if (requiredSkills.length === 0) return false;
  const uncapped = { ...tech, maxWorkload: undefined };
  return evaluateTechnician(
    uncapped,
    buildSkillLookup(uncapped.skills),
    requiredSkills,
    now,
  ).eligible;
}

function evaluateTechnician(
  tech: EngineTechnician,
  lookup: SkillLookup,
  requiredSkills: EngineRequiredSkill[],
  now?: EvaluationTime,
): CandidateEvaluation {
  const base = {
    technicianId: tech.id,
    technicianName: tech.name,
    workload: tech.workload,
  };

  // Resolve every required skill once, then apply the rejection rules in
  // priority order: a skill the technician simply does not have outranks one
  // they hold at too low a level.
  const levels = requiredSkills.map((req) => skillLevel(lookup, req.skillName));

  const missingIndex = levels.indexOf(undefined);
  if (missingIndex !== -1) {
    return {
      ...base,
      eligible: false,
      rejectReason: "MISSING_SKILL",
      reason: `Missing required skill: ${requiredSkills[missingIndex].skillName}`,
    };
  }

  const tooLowIndex = levels.findIndex(
    (level, i) => level! < requiredSkills[i].minLevel,
  );
  if (tooLowIndex !== -1) {
    const req = requiredSkills[tooLowIndex];
    return {
      ...base,
      eligible: false,
      rejectReason: "LEVEL_TOO_LOW",
      reason: `${req.skillName} level ${levels[tooLowIndex]} < required ${req.minLevel}`,
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

  // Capacity is checked last on purpose: reaching this gate means the
  // technician was qualified in every other respect, so an AT_CAPACITY reject
  // reliably means "right person, no room" — which is what lets the caller
  // tell a queued request apart from an unroutable one.
  if (tech.maxWorkload !== undefined && tech.workload >= tech.maxWorkload) {
    return {
      ...base,
      eligible: false,
      rejectReason: "AT_CAPACITY",
      reason: `At capacity (${tech.workload}/${tech.maxWorkload} assignments)`,
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

/**
 * The documented tiebreak ladder: lowest workload, then highest total
 * proficiency across the required skills, then lowest id as a deterministic
 * final resort. Ids are unique, so this is a total order — the best element is
 * unambiguous and a single pass finds it.
 */
function compareCandidates(
  a: EngineTechnician,
  b: EngineTechnician,
  proficiency: Map<number, number>,
): number {
  if (a.workload !== b.workload) return a.workload - b.workload;
  const profDiff =
    (proficiency.get(b.id) ?? 0) - (proficiency.get(a.id) ?? 0);
  if (profDiff !== 0) return profDiff;
  return a.id - b.id;
}

function selectBest(
  eligible: EngineTechnician[],
  proficiency: Map<number, number>,
): EngineTechnician | null {
  if (eligible.length === 0) return null;
  return eligible.reduce((best, tech) =>
    compareCandidates(tech, best, proficiency) < 0 ? tech : best,
  );
}

function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function explainSelection(
  winner: EngineTechnician,
  eligible: EngineTechnician[],
  proficiency: Map<number, number>,
): string {
  if (eligible.length === 1) {
    return `Selected — the only eligible technician (workload ${winner.workload}).`;
  }

  const others = eligible.filter((t) => t.id !== winner.id);
  const tiedOnWorkload = others.filter((t) => t.workload === winner.workload);

  if (tiedOnWorkload.length === 0) {
    return `Selected — lowest workload (${winner.workload}) among ${eligible.length} eligible technicians.`;
  }

  const winnerProf = proficiency.get(winner.id) ?? 0;
  const tiedOnProf = tiedOnWorkload.filter(
    (t) => (proficiency.get(t.id) ?? 0) === winnerProf,
  );
  if (tiedOnProf.length === 0) {
    const runnerUpProf = Math.max(
      ...tiedOnWorkload.map((t) => proficiency.get(t.id) ?? 0),
    );
    return `Selected — tied on lowest workload (${winner.workload}) with ${listNames(
      tiedOnWorkload.map((t) => t.name),
    )}, then won on higher total proficiency across the required skills (${winnerProf} vs ${runnerUpProf}).`;
  }

  return `Selected — tied on both workload (${winner.workload}) and total proficiency (${winnerProf}) with ${listNames(
    tiedOnProf.map((t) => t.name),
  )}; chosen by lowest technician id (#${winner.id}) as the final deterministic tiebreak.`;
}
