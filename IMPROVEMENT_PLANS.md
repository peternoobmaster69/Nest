# UX & Performance Improvement Plans

## Progress Tracker
| # | Improvement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Parallelize Dashboard API Database Queries | Done | Parallelized independent dashboard summary reads with `Promise.all()`; build passed. |
| 2 | Memoize Heavy Dashboard Components | Done | Memoized skeleton components and focused dashboard derived rows/callbacks; build passed. |
| 3 | Add Pagination to Transactions API | Done | Added opt-in paginated API responses and moved transactions page to `useInfiniteQuery`; build passed. |
| 4 | Optimize Bank Logo Images with Next.js Image | Done | Converted bank logo render sites to `next/image`; build passed. |
| 5 | Implement API Response Caching | Done | Added dashboard response cache headers and React Query cache defaults; mutation refetches revalidate all affected query families. |

---

## 1. Parallelize Dashboard API Database Queries
**Status:** Done
**Impact:** High (40-60% API latency reduction)
**Effort:** Low

### Problem
`app/api/dashboard/summary/route.ts` executes 6+ sequential database queries:
- budgets → monthlyBudgetOutgoing → receivableSourceTotals → legacyReceivableTotals → transactions → creditCardTransactions

### Solution
Wrap independent queries in `Promise.all()`:
```typescript
const [budgets, monthlyBudgetOutgoing, receivableSourceTotals, transactions, creditCardTransactions] = await Promise.all([
  prisma.budgetEnvelope.findMany(...),
  prisma.transaction.groupBy(...),
  prisma.receivable.groupBy(...),
  prisma.transaction.findMany(...),
  prisma.creditCardTransaction.findMany(...),
]);
```

### Files Modified
- `app/api/dashboard/summary/route.ts`

### Testing
- Verify dashboard loads correctly
- Monitor API response times
- Check error handling still works

---

## 2. Memoize Heavy Dashboard Components
**Status:** Done
**Impact:** High (prevents unnecessary re-renders)
**Effort:** Medium

### Problem
- `dashboard-shell.tsx`: 1,591 lines, 37 state hooks
- `transactions-page.tsx`: 1,659 lines
- No `React.memo`, `useCallback`, or `useMemo` optimizations
- Entire tree re-renders on any state change

### Solution
1. Wrap card components with `React.memo()`
2. Memoize expensive calculations with `useMemo()`
3. Stabilize callbacks with `useCallback()`
4. Split large components into smaller memoized sub-components

### Files Modified
- `components/dashboard-shell.tsx`
- `components/ui-skeleton.tsx` (add memo to skeleton components)

### Key Components to Memoize
- Budget cards grid
- Transaction rows
- Credit card displays
- Net worth strip

---

## 3. Add Pagination to Transactions API
**Status:** Done
**Impact:** Critical (prevents UI freeze with large datasets)
**Effort:** Medium

### Problem
`app/api/transactions/route.ts` fetches ALL transactions:
```typescript
const txs = await prisma.transaction.findMany({
  where: { workspaceId },
  // NO take/limit!
});
```
This becomes unusable with 1000+ transactions.

### Solution
1. Add pagination params to API:
   - `page` (default: 1)
   - `limit` (default: 50, max: 100)
   - `cursor` for infinite scroll

2. Update transactions-page.tsx:
   - Implement infinite scroll with react-query's `useInfiniteQuery`
   - Add an IntersectionObserver load-more sentinel for incremental rendering

### Files Modified
- `app/api/transactions/route.ts`
- `components/transactions-page.tsx`
- `components/dashboard-shell.tsx` (limit dashboard recent transaction query)
- No new dependency added; `@tanstack/react-virtual` remains optional.

### API Changes
```typescript
const { searchParams } = new URL(request.url);
const page = parseInt(searchParams.get("page") || "1");
const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
const skip = (page - 1) * limit;

const txs = await prisma.transaction.findMany({
  where: { workspaceId },
  skip,
  take: limit,
  orderBy: [{ date: "desc" }, { createdAt: "desc" }],
});

const total = await prisma.transaction.count({ where: { workspaceId } });
return NextResponse.json({ transactions: txs, total, page, limit });
```

---

## 4. Optimize Bank Logo Images with Next.js Image
**Status:** Done
**Impact:** Medium (reduce 1.3MB to ~200KB with WebP)
**Effort:** Low

### Problem
- 28 PNG logos = 1.3MB in `/public/banks/`
- No image optimization
- Using `<img>` tags instead of `<Image>`
- No responsive sizing

### Solution
1. Update `next.config.ts` image optimization settings
2. Replace `<img>` with `<Image>` component
3. Enable automatic AVIF/WebP conversion
4. Add proper `sizes` and lazy loading attributes

### Files Modified
- `next.config.ts`
- `app/globals.css`
- `components/dashboard-shell.tsx` (bank logo display)
- `components/transactions-page.tsx` (bank selector)
- `components/settings-page.tsx` (bank cards)
- `components/credit-cards-page.tsx` (credit card bank logos)
- `components/credit-transactions-page.tsx` (credit card selector logos)

### Example Change
```typescript
// Before
<img src={`/banks/${bank.code}.png`} />

// After
<Image
  src={`/banks/${bank.code}.png`}
  alt={bank.name}
  width={44}
  height={24}
  style={{ objectFit: 'contain' }}
  loading="lazy"
/>
```

---

## 5. Implement API Response Caching
**Status:** Done
**Impact:** Medium (reduce redundant database queries)
**Effort:** Low

### Problem
- Dashboard data fetched on every navigation
- No Cache-Control headers
- No stale-while-revalidate pattern
- Context API called repeatedly

### Solution
1. Add cache headers to dashboard summary:
   - `Cache-Control: private, max-age=60, stale-while-revalidate=300`
   - 60 seconds fresh, 5 minutes stale-while-revalidate

2. Add React Query cache defaults for common route data

3. Optimize context fetching with shared cache

### Files Modified
- `app/api/dashboard/summary/route.ts`
- `app/providers.tsx` (query client config)
- `components/dashboard-shell.tsx` (dashboard summary fetch revalidation and React Query stale time)
- Mutation invalidation coverage updated across money pages so creates/updates/deletes refresh affected derived data.

### Example Headers
```typescript
return NextResponse.json(data, {
  headers: {
    'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
  },
});
```

---

## Recommended Implementation Order
1. **#1** (Parallelize Dashboard API) - Quick win, immediate impact
2. **#4** (Image Optimization) - Easy fix, good UX improvement
3. **#5** (API Caching) - Low effort, compound benefits
4. **#3** (Pagination) - Critical for data scale
5. **#2** (Component Memoization) - Most effort, ongoing benefit

---

## Effort Summary
| # | Improvement | Lines Changed | Files | Risk |
|---|-------------|---------------|-------|------|
| 1 | Parallelize API | ~30 | 1 | Low |
| 2 | Memoize Components | ~100 | 3 | Medium |
| 3 | Pagination | ~150 | 2 | Medium |
| 4 | Image Optimization | ~20 | 4 | Low |
| 5 | API Caching | ~10 | 2 | Low |
