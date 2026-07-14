-- CVV/CVC must never be retained after authorization. Purge existing values
-- before removing the columns so deployment cannot leave recoverable data.
UPDATE [CreditCardAccount]
SET [encryptedSecurityCode] = NULL,
    [securityCodeIv] = NULL,
    [securityCodeTag] = NULL;

ALTER TABLE [CreditCardAccount]
DROP COLUMN [encryptedSecurityCode], [securityCodeIv], [securityCodeTag];
