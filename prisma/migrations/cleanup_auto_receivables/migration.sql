-- Cleanup script to remove auto-created receivables and reset credit card transactions
-- Run this before re-running the auto-accounting with the new consolidated logic

-- First, identify and delete auto-created receivables
-- These are receivables created by the auto-accounting rule with title starting with "Auto:"
DELETE FROM Receivable
WHERE title LIKE 'Auto: %'
  AND remarkTogether LIKE 'Auto-accounted by rule%';

-- Reset all credit card transactions to unallocated state
-- This allows the auto-accounting to re-process them with the new consolidated logic
UPDATE CreditCardTransaction
SET isAllocated = 0
WHERE isAllocated = 1;

-- Note: The above resets ALL allocated credit card transactions.
-- If you want to be more selective, you could filter by date range or specific workspaces.
-- Example with date filter (uncomment and adjust as needed):
-- UPDATE CreditCardTransaction
-- SET isAllocated = 0
-- WHERE isAllocated = 1
--   AND transactionDate >= '2025-01-01';
