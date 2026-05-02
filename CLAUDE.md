# Nest Performance & UX Improvements

## Context
This is a Next.js 16 + React 19 + Prisma personal finance app. Each improvement below is designed to be completed independently by separate agents.

---

## Improvement 1: Parallelize Dashboard API Queries
**File:** `app/api/dashboard/summary/route.ts`

### Problem
The dashboard API executes 6+ sequential database queries, adding unnecessary latency.

### Specification
Refactor the GET handler to use `Promise.all` for independent queries:

1. **Group 1 (Independent):**
   - `prisma.budgetEnvelope.findMany()`
   - `prisma.transaction.findMany()`
   - `prisma.creditCardTransaction.findMany()`
   - `getBankConsistency()`

2. **Group 2 (Depends on budgets):**
   - `prisma.transaction.groupBy()` for monthly outgoing
   - `prisma.receivable.groupBy()` for source totals
   - Legacy receivable totals (only if budgetIds exist)

3. **Constraints:**
   - Keep existing error handling
   - Maintain response structure
   - Add `await Promise.all()` pattern

### Expected Result
- Reduced API latency from ~800ms to ~300ms
- No change to response format

---

## Improvement 2: Memoize Dashboard Components
**Files:**
- `components/dashboard-shell.tsx`
- `components/ui-skeleton.tsx`

### Problem
The dashboard shell is 1,591 lines with 37 state hooks. No React.memo prevents unnecessary re-renders.

### Specification

1. **Add React.memo to export:**
   ```typescript
   export const DashboardShell = memo(function DashboardShell() { ... })
   ```

2. **Memoize expensive calculations inside:**
   - Credit card grouping logic (`useMemo`)
   - Budget filtering/sorting (`useMemo`)
   - Event handlers (`useCallback`)

3. **Extract stable sub-components:**
   - `CreditCardList` (memoized)
   - `BudgetCardList` (memoized)
   - `TransactionList` (memoized)

4. **Skeleton components in ui-skeleton.tsx:**
   - Add `memo()` to all exported skeleton components
   - `SkeletonCard`, `SkeletonBankCard`, `SkeletonCreditCard`, etc.

### Constraints
- Do not change component props interface
- Ensure callbacks are stable for child memoization
- Keep TypeScript types intact

### Testing Checklist
- [ ] Dashboard renders correctly
- [ ] No console warnings about unstable references
- [ ] Interactions still work (modals, forms, navigation)

---

## Improvement 3: Add Pagination to Transactions API
**Files:**
- `app/api/transactions/route.ts`
- `components/transactions-page.tsx`

### Problem
The transactions API fetches ALL transactions without limits, causing UI freeze with large datasets.

### Specification

#### API Changes (`app/api/transactions/route.ts`)

1. **Accept query parameters:**
   - `page` (default: 1, min: 1)
   - `limit` (default: 50, max: 100)
   - `cursor` (optional, for future infinite scroll)

2. **Return paginated response:**
   ```typescript
   {
     transactions: Transaction[];
     total: number;
     page: number;
     limit: number;
     totalPages: number;
   }
   ```

3. **Implement Prisma pagination:**
   ```typescript
   const skip = (page - 1) * limit;
   const [transactions, total] = await Promise.all([
     prisma.transaction.findMany({
       where: { workspaceId },
       skip,
       take: limit,
       orderBy: [{ date: "desc" }, { createdAt: "desc" }],
     }),
     prisma.transaction.count({ where: { workspaceId } }),
   ]);
   ```

#### Frontend Changes (`components/transactions-page.tsx`)

1. **Add pagination UI:**
   - Previous/Next buttons
   - Page indicator ("Page 1 of 5")
   - Page size selector (25, 50, 100)

2. **Update fetch function:**
   ```typescript
   const fetchTransactions = async (page: number, limit: number) => {
     const res = await fetch(`/api/transactions?page=${page}&limit=${limit}`);
     return res.json();
   };
   ```

3. **Update useQuery:**
   - Add `page` and `limit` to queryKey
   - Pass pagination params to queryFn

### Constraints
- Default to 50 results per page
- Keep existing filter/sort behavior
- Maintain TypeScript types for new response shape
- Handle edge cases (empty pages, last page)

### Testing Checklist
- [ ] API returns paginated results
- [ ] Frontend pagination controls work
- [ ] Page refresh maintains current page (via URL params optional)
- [ ] Empty state when no transactions
- [ ] Edge case: last page with fewer items

---

## Improvement 4: Optimize Bank Logo Images
**Files:**
- `next.config.ts`
- Multiple component files

### Problem
28 PNG bank logos (1.3MB) loaded via `<img>` without optimization or WebP conversion.

### Specification

#### Config Changes (`next.config.ts`)

1. **Add static image optimization:**
   ```typescript
   images: {
     remotePatterns: [
       {
         protocol: "https",
         hostname: "lh3.googleusercontent.com",
       },
     ],
     // Allow local images without optimization (they're static)
     unoptimized: false, // Enable optimization
   },
   ```

#### Component Changes

**Find and replace these patterns:**

1. **In `components/dashboard-shell.tsx`:**
   ```typescript
   // Before:
   <img src={getBankLogoUrl(bank)} alt={bank.name} className="bank-logo" />
   
   // After:
   <Image
     src={getBankLogoUrl(bank)}
     alt={bank.name}
     width={44}
     height={24}
     className="bank-logo"
     loading="lazy"
   />
   ```

2. **In `components/transactions-page.tsx`:**
   - Bank selector img → Image
   - Add appropriate sizing

3. **In `components/settings-page.tsx`:**
   - Bank card logos

### Constraints
- Import Image from 'next/image'
- Keep existing fallback behavior (bank initials when logo fails)
- Use `loading="lazy"` for below-fold images
- Use explicit width/height to prevent layout shift

### Testing Checklist
- [ ] TypeScript: `import Image from "next/image";`
- [ ] Logos display correctly
- [ ] Fallback initials still work
- [ ] No layout shift on load

---

## Improvement 5: Implement API Response Caching
**Files:**
- `app/api/dashboard/summary/route.ts`
- `app/providers.tsx`

### Problem
Dashboard data is fetched on every navigation with no caching, causing redundant database queries.

### Specification

#### API Changes (`app/api/dashboard/summary/route.ts`)

1. **Add Cache-Control headers:**
   ```typescript
   return NextResponse.json(data, {
     headers: {
       'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
     },
   });
   ```

2. **Policy explanation:**
   - `private` - only browser cache, not CDN
   - `max-age=60` - fresh for 60 seconds
   - `stale-while-revalidate=300` - serve stale for 5 mins while revalidating

#### React Query Config (`app/providers.tsx`)

1. **Update queryClient defaults:**
   ```typescript
   const [queryClient] = useState(() => new QueryClient({
     defaultOptions: {
       queries: {
         staleTime: 30_000, // Already set, confirm
         gcTime: 5 * 60 * 1000, // Garbage collect after 5 min
         refetchOnWindowFocus: false,
       },
     },
   }));
   ```

2. **Add prefetching for common routes in page components**

### Constraints
- Use private cache only (workspace data is per-user)
- Keep existing error handling structure
- Don't cache error responses

### Testing Checklist
- [ ] Response includes Cache-Control header
- [ ] Subsequent loads use cached data (Network tab shows 200 from disk cache or 304)
- [ ] After 60s, fresh data is fetched
- [ ] Error responses are not cached

---

## Common Patterns

### Parallel Queries with Prisma
```typescript
const [result1, result2, result3] = await Promise.all([
  prisma.model.findMany({...}),
  prisma.model.count({...}),
  prisma.other.findMany({...}),
]);
```

### React.memo Pattern
```typescript
import { memo, useMemo, useCallback } from "react";

export const ComponentName = memo(function ComponentName(props) {
  const computed = useMemo(() => expensiveFn(props.data), [props.data]);
  const handler = useCallback(() => { ... }, [deps]);
  
  return (...)
});
```

### Pagination Calculation
```typescript
const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
const skip = (page - 1) * limit;
```

---

## Repository Info
- **Framework:** Next.js 16.1.6, React 19.2.3, TypeScript 5.x
- **Database:** Prisma 6.16.3 with SQL Server
- **Query Client:** TanStack Query 5.90.21
- **Styling:** Tailwind 4.x, globals.css
- **Key Components:** See `components/` directory
- **API Routes:** See `app/api/` directory

## Before Committing
1. Run `npm run lint` - no errors
2. Run `npm run build` - successful
3. Test the specific improvement manually
4. Update this checklist in the IMPROVEMENT_PLANS.md
