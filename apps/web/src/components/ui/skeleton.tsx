import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-border/70", className)} {...props} />;
}

export function MetricCardSkeleton() {
  return (
    <div className="flex min-h-[106px] items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-panel">
      <div className="flex-1 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-3 w-36" />
      </div>
      <Skeleton className="h-10 w-10 shrink-0" />
    </div>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading data">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="min-h-[72px] rounded-md border border-border bg-background/60 p-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border" aria-label="Loading table">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: columns }, (_, index) => (
              <TableHead key={index}>
                <Skeleton className="h-3 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <TableRow key={rowIndex}>
              {Array.from({ length: columns }, (_, columnIndex) => (
                <TableCell key={columnIndex}>
                  <Skeleton className={cn("h-4", columnIndex === 0 ? "w-24" : columnIndex === columns - 1 ? "w-12" : "w-16")} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ConnectionPanelSkeleton() {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-card p-4 shadow-panel xl:grid-cols-[1.05fr,1fr,1.1fr]" aria-label="Checking Kite connection">
      <SkeletonBlock lines={4} />
      <SkeletonBlock lines={5} />
      <SkeletonBlock lines={5} />
    </div>
  );
}

export function SkeletonBlock({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn("h-4", index === 0 ? "w-2/5" : index === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}
