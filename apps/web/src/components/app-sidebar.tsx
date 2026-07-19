import {
  LayoutDashboard,
  Users,
  ClipboardList,
  PlusCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { View } from "@/App";

const NAV: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "technicians", label: "Technicians", icon: Users },
  { id: "requests", label: "Requests", icon: ClipboardList },
  { id: "new", label: "New Request", icon: PlusCircle },
];

export function AppSidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (v: View) => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Zap className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-sidebar-foreground">
            Skill Routing
          </p>
          <p className="text-xs text-muted-foreground">Dispatch console</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Menu
        </p>
        {NAV.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <item.icon
                className={cn(
                  "h-4 w-4",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-4">
        <Avatar>
          <AvatarFallback>SR</AvatarFallback>
        </Avatar>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-medium text-sidebar-foreground">
            Dispatcher
          </p>
          <p className="truncate text-xs text-muted-foreground">
            Field service ops
          </p>
        </div>
      </div>
    </aside>
  );
}
