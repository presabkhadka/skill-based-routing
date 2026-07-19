import { TrendingUp, TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatTile {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
  delta?: {
    text: string;
    tone: "success" | "destructive" | "muted";
    dir?: "up" | "down";
  };
}

export function StatRow({ tiles }: { tiles: StatTile[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-1 divide-y divide-border/60 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        {tiles.map((t) => (
          <Tile key={t.label} {...t} />
        ))}
      </div>
    </Card>
  );
}

function Tile({ label, value, sublabel, delta }: StatTile) {
  const toneClasses: Record<string, string> = {
    success: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    destructive: "bg-destructive/12 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  const DirIcon = delta?.dir === "down" ? TrendingDown : TrendingUp;
  return (
    <div className="px-6 py-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold",
              toneClasses[delta.tone],
            )}
          >
            {delta.dir && <DirIcon className="h-3 w-3" />}
            {delta.text}
          </span>
        )}
      </div>
      {sublabel && (
        <p className="mt-1.5 text-xs text-muted-foreground">{sublabel}</p>
      )}
    </div>
  );
}
