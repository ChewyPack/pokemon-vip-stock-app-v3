-- Run ONLY against pokemon-vip-members-staging in Cloudflare D1.
-- Adds editable contact phone number to collector accounts.
ALTER TABLE accounts ADD COLUMN phone_number TEXT NOT NULL DEFAULT '';
