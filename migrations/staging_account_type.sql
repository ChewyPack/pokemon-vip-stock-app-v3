-- Run ONLY against pokemon-vip-members-staging after confirming the Preview DB binding.
-- Adds the selected account type without changing VIP membership records.
ALTER TABLE accounts ADD COLUMN account_type TEXT NOT NULL DEFAULT 'free'
  CHECK (account_type IN ('free', 'collector', 'vendor', 'organizer'));
