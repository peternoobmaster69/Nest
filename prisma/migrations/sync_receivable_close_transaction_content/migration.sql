-- Backfill receivable-close postings created before title and notes were copied
-- directly from the source receivable. System-generated details are cleared so
-- clients cannot display them as a fallback for empty receivable notes.
UPDATE [transaction]
SET
    [transaction].[subject] = [receivable].[title],
    [transaction].[notes] = [receivable].[notes],
    [transaction].[details] = NULL
FROM [dbo].[Transaction] AS [transaction]
INNER JOIN [dbo].[Receivable] AS [receivable]
    ON [transaction].[externalRef] LIKE CONCAT('receivable-close:', [receivable].[id], ':%');
