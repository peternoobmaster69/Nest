# Legacy Migration Plan

## Goals

- Preserve all financial records from legacy tables.
- Keep deterministic source-to-target mapping for safe retries.
- Move sensitive card data into encrypted columns.

## Strategy

1. Create all reference tables first (`Workspace`, `Month`, `AccountType`, `FinancialAccount`).
2. Import master data (`BudgetEnvelope`, `ExpenseType`, `CreditCardAccount`).
3. Import transactions and dependent rows (`Transaction`, `Expense`, `CreditCardTxnLink`, `Receivable`).
4. Import note and miles modules.
5. Write one `LegacyRecordLink` row for every imported legacy record.

## Idempotency

For each legacy row:

- Build key: `(system, sourceTable, sourceId)`
- Skip import if key exists in `LegacyRecordLink`
- Otherwise upsert target and add link

## Currency and Amounts

- Legacy decimal amounts should be transformed to integer cents for all `*Cents` fields.
- Keep exchange rates (`UsdAccountEntry.exchangeRate`) as decimals.

## Suggested Import Order by Legacy Table

1. `Months`
2. `AccountTypes`
3. `CCName`
4. `Budget`
5. `ExpenseType`
6. `Transactions_Main`
7. `Expense`
8. `Interface_CC_Transactions`
9. `CCdebts`
10. `Receivables`
11. `NoteLists`
12. `Notes`
13. `Salary`
14. `USDAccount`
15. `USDInvestment`
16. `KFMiles`
17. `KFMIlesRedemption`
18. `KFMIlesRedemptionDetails`
