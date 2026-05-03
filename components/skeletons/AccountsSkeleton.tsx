import { Skeleton } from "@/components/ui/Skeleton";

/*
Structural inventory: Legacy accounts page
Route: /accounts
Layout regions: standalone main.min-h-screen page; header title and Add account link are static.
Content blocks:
- Header totals: data-driven totals render under the h1, flex wrap gap 8px, 24px text line.
- Account grid: grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6, gap 8px.
- Account card: flex column justify-between, rounded-2xl, border, bg-white, padding 16px; top title + type badge, middle 20px amount, bottom 12px hint.
Do not skeletonize: page h1, Add account link, empty/error states.
*/
export function AccountsGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 8 }).map((_, index) => (
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200" key={index}>
          <div className="mb-3 flex items-start justify-between">
            <div className="space-y-1">
              <Skeleton width={index % 2 ? 92 : 70} height={17} borderRadius="4px" />
            </div>
            <Skeleton width={52} height={20} borderRadius="999px" />
          </div>
          <div className="mb-3">
            <Skeleton width={112} height={24} borderRadius="5px" />
          </div>
          <div className="mt-auto flex items-center justify-between text-xs text-slate-500">
            <Skeleton width={104} height={15} borderRadius="4px" />
            <Skeleton width={20} height={15} borderRadius="4px" />
          </div>
        </div>
      ))}
    </div>
  );
}
