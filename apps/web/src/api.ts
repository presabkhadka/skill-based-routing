const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type RequestStatus = "PENDING" | "ASSIGNED" | "UNASSIGNED" | "COMPLETED";

export interface WorkingWindow {
  day: number;
  start: string;
  end: string;
}

export interface Technician {
  id: number;
  name: string;
  available: boolean;
  workload: number;
  skills: Record<string, number>;
  workingHours: WorkingWindow[];
}

export type RejectReason =
  | "MISSING_SKILL"
  | "LEVEL_TOO_LOW"
  | "UNAVAILABLE"
  | "OUTSIDE_HOURS";

export interface Evaluation {
  technicianId: number;
  technicianName: string;
  eligible: boolean;
  reason: string;
  rejectReason: RejectReason | null;
  workload: number;
}

export interface ServiceRequestSummary {
  id: number;
  customer: string;
  priority: Priority;
  status: RequestStatus;
  requiredSkills: Record<string, number>;
  assignedTechnician: { id: number; name: string } | null;
  scheduledDay: number | null;
  scheduledTime: string | null;
  createdAt: string;
}

export interface ServiceRequestDetail extends ServiceRequestSummary {
  evaluations: Evaluation[];
}

export const api = {
  skills: () => req<{ id: number; name: string }[]>("/skills"),
  offeredSkills: () =>
    req<{ id: number; name: string }[]>("/skills/offered"),

  technicians: () => req<Technician[]>("/technicians"),
  createTechnician: (body: {
    name: string;
    available?: boolean;
    skills: { skill: string; level: number }[];
    workingHours?: WorkingWindow[];
  }) => req<Technician>("/technicians", { method: "POST", body: JSON.stringify(body) }),
  setWorkingHours: (id: number, workingHours: WorkingWindow[]) =>
    req<Technician>(`/technicians/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ workingHours }),
    }),
  setAvailability: (id: number, available: boolean) =>
    req<{ technician: Technician; reassignedRequestIds: number[] }>(
      `/technicians/${id}/availability`,
      { method: "PATCH", body: JSON.stringify({ available }) },
    ),
  setSkills: (id: number, skills: { skill: string; level: number }[]) =>
    req<Technician>(`/technicians/${id}/skills`, {
      method: "PUT",
      body: JSON.stringify({ skills }),
    }),

  requests: () => req<ServiceRequestSummary[]>("/service-requests"),
  request: (id: number) => req<ServiceRequestDetail>(`/service-requests/${id}`),
  route: (id: number) =>
    req<ServiceRequestDetail>(`/service-requests/${id}/route`, {
      method: "POST",
    }),
  completeRequest: (id: number) =>
    req<ServiceRequestDetail>(`/service-requests/${id}/complete`, {
      method: "PATCH",
    }),
  createRequest: (body: {
    customer: string;
    priority?: Priority;
    requiredSkills: Record<string, number>;
    scheduledDay?: number;
    scheduledTime?: string;
  }) =>
    req<ServiceRequestDetail>("/service-requests", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
