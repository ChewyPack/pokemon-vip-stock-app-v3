-- Run ONLY against pokemon-vip-members-staging after the initial collector profile migration.
ALTER TABLE collector_profiles ADD COLUMN cover_url TEXT NOT NULL DEFAULT '';
