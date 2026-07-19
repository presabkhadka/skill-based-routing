import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { Dashboard } from "@/pages/Dashboard";
import { Technicians } from "@/pages/Technicians";
import { Requests } from "@/pages/Requests";
import { NewRequest } from "@/pages/NewRequest";
import { Toaster } from "@/components/ui/sonner";

export type View = "dashboard" | "technicians" | "requests" | "new";

const META: Record<View, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Live overview of requests, technicians and routing outcomes",
  },
  technicians: {
    title: "Technicians",
    subtitle: "Manage your workforce, skills and availability",
  },
  requests: {
    title: "Service Requests",
    subtitle: "Every request with its full routing decision trace",
  },
  new: {
    title: "New Request",
    subtitle: "Specify required skills and minimum levels, then route",
  },
};

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [focusRequestId, setFocusRequestId] = useState<number | null>(null);

  const navigate = (v: View) => {
    setView(v);
    if (v !== "requests") setFocusRequestId(null);
  };

  const openRequest = (id: number) => {
    setFocusRequestId(id);
    setView("requests");
  };

  const meta = META[view];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar view={view} onNavigate={navigate} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border bg-card/60 px-8 py-4 backdrop-blur">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {meta.title}
            </h1>
            <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
          </div>
          {view !== "new" && (
            <Button onClick={() => navigate("new")}>
              <PlusCircle className="h-4 w-4" />
              New Request
            </Button>
          )}
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-6xl">
            {view === "dashboard" && <Dashboard onOpenRequest={openRequest} />}
            {view === "technicians" && <Technicians />}
            {view === "requests" && (
              <Requests focusId={focusRequestId} onFocus={setFocusRequestId} />
            )}
            {view === "new" && <NewRequest onCreated={openRequest} />}
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
