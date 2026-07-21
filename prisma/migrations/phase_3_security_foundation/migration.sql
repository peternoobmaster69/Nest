-- OAuth state is intentionally ephemeral. Purge outstanding grants before PKCE becomes mandatory.
DELETE FROM [IntegrationOAuthState];

ALTER TABLE [IntegrationOAuthState]
ADD [pkceVerifier] NVARCHAR(MAX) NOT NULL;

-- Plaintext legacy Google grants cannot be safely transformed inside SQL. Force a one-time reconnect.
UPDATE [GmailIntegration]
SET
  [accessToken] = NULL,
  [refreshToken] = NULL,
  [expiryDate] = NULL,
  [isActive] = 0;

-- Social sign-in uses provider identity only; provider API credentials are not retained.
UPDATE [Account]
SET
  [access_token] = NULL,
  [refresh_token] = NULL,
  [id_token] = NULL,
  [session_state] = NULL;

-- Nest retains only card metadata; purge and remove all legacy full-cardholder data columns.
UPDATE [CreditCardAccount]
SET
  [encryptedCardNumber] = NULL,
  [encryptedHolderName] = NULL,
  [encryptionIv] = NULL,
  [encryptionTag] = NULL;

ALTER TABLE [CreditCardAccount]
DROP COLUMN [encryptedCardNumber], [encryptedHolderName], [encryptionIv], [encryptionTag];

ALTER TABLE [CreditCardAccount]
ADD CONSTRAINT [CreditCardAccount_last4Digit_format]
CHECK (LEN([last4Digit]) = 4 AND [last4Digit] NOT LIKE '%[^0-9]%');
