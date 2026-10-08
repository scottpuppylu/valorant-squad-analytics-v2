-- V2 canonical schema (canonical-schema-v1). Fresh numbering; NOT the legacy schema.
-- Ordinary PostgreSQL 18 semantics (also runs on embedded PGlite for tests and the zero-setup demo).
-- PRIVATE columns (never exported): source_accounts.provider_account_ref, matches.provider_record_ref,
-- match_participants.account_id, events.location_x / location_y / view_radians.
CREATE TABLE groups (
  group_id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'invite-only')),
  created_at timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE group_members (
  member_id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES groups (group_id) ON DELETE CASCADE,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'left')),
  joined_at timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE source_accounts (
  account_id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES group_members (member_id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  provider_account_ref text NOT NULL,
  linked_at timestamptz NOT NULL,
  UNIQUE (provider_id, provider_account_ref)
);
-- statement-breakpoint
CREATE TABLE consent_state (
  member_id text PRIMARY KEY REFERENCES group_members (member_id) ON DELETE CASCADE,
  identity_connected boolean NOT NULL,
  data_collection_allowed boolean NOT NULL,
  group_visibility_allowed boolean NOT NULL,
  public_derived_analytics_allowed boolean NOT NULL,
  policy_version text NOT NULL,
  updated_at timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE matches (
  match_key text PRIMARY KEY CHECK (match_key ~ '^cm_[0-9a-f]{24}$'),
  schema_version text NOT NULL,
  provider_id text NOT NULL,
  provider_version text NOT NULL,
  normalizer_version text NOT NULL,
  provider_record_ref text NOT NULL,
  observed_at timestamptz NOT NULL,
  history_completeness text NOT NULL CHECK (history_completeness IN ('unknown', 'provider-visible')),
  evidence_quality text NOT NULL CHECK (evidence_quality IN ('complete', 'partial', 'basic')),
  has_rounds boolean NOT NULL,
  has_events boolean NOT NULL,
  has_damage boolean NOT NULL,
  map_id text NOT NULL,
  map_name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('competitive', 'unrated', 'other', 'unknown')),
  started_at timestamptz NOT NULL,
  duration_seconds integer CHECK (duration_seconds >= 0),
  rank_context_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (provider_id, provider_record_ref)
);
-- statement-breakpoint
CREATE INDEX matches_started_at_idx ON matches (started_at DESC, match_key);
-- statement-breakpoint
CREATE TABLE match_teams (
  match_key text NOT NULL REFERENCES matches (match_key) ON DELETE CASCADE,
  team_key text NOT NULL,
  rounds_won integer NOT NULL CHECK (rounds_won >= 0),
  won boolean,
  PRIMARY KEY (match_key, team_key)
);
-- statement-breakpoint
CREATE TABLE match_participants (
  match_key text NOT NULL REFERENCES matches (match_key) ON DELETE CASCADE,
  participant_key text NOT NULL,
  team_key text NOT NULL,
  member_id text REFERENCES group_members (member_id) ON DELETE SET NULL,
  account_id text REFERENCES source_accounts (account_id) ON DELETE SET NULL,
  agent_id text,
  agent_name text,
  kills integer NOT NULL CHECK (kills >= 0),
  deaths integer NOT NULL CHECK (deaths >= 0),
  assists integer NOT NULL CHECK (assists >= 0),
  damage_dealt integer CHECK (damage_dealt >= 0),
  score integer CHECK (score >= 0),
  PRIMARY KEY (match_key, participant_key)
);
-- statement-breakpoint
CREATE INDEX match_participants_member_idx ON match_participants (member_id) WHERE member_id IS NOT NULL;
-- statement-breakpoint
CREATE TABLE rounds (
  match_key text NOT NULL REFERENCES matches (match_key) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  winning_team_key text,
  attacking_team_key text,
  PRIMARY KEY (match_key, round_number)
);
-- statement-breakpoint
CREATE TABLE events (
  match_key text NOT NULL REFERENCES matches (match_key) ON DELETE CASCADE,
  event_key text NOT NULL,
  round_number integer NOT NULL CHECK (round_number > 0),
  time_in_round_ms integer NOT NULL CHECK (time_in_round_ms >= 0),
  event_type text NOT NULL CHECK (event_type IN ('kill')),
  actor_participant_key text NOT NULL,
  target_participant_key text NOT NULL,
  assistant_participant_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  location_x double precision,
  location_y double precision,
  view_radians double precision,
  PRIMARY KEY (match_key, event_key),
  CONSTRAINT events_location_pair CHECK ((location_x IS NULL) = (location_y IS NULL))
);
-- statement-breakpoint
CREATE TABLE rank_context (
  rank_context_id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES group_members (member_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pre-match', 'current', 'peak')),
  observed_at timestamptz NOT NULL,
  tier_id integer,
  tier_name text,
  provider_id text NOT NULL
);
-- statement-breakpoint
CREATE TABLE analysis_artifacts (
  artifact_key text PRIMARY KEY,
  algorithm_id text NOT NULL,
  analytics_contract_version text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE publication_state (
  snapshot_id text PRIMARY KEY CHECK (snapshot_id ~ '^ps1-[0-9a-f]{16}$'),
  snapshot_version text NOT NULL,
  manifest_version text NOT NULL,
  publisher text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'superseded')),
  published_at timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE provider_ingest_state (
  provider_id text NOT NULL,
  account_id text NOT NULL REFERENCES source_accounts (account_id) ON DELETE CASCADE,
  next_cursor text,
  matches_seen integer NOT NULL DEFAULT 0 CHECK (matches_seen >= 0),
  last_success_at timestamptz,
  last_error text,
  PRIMARY KEY (provider_id, account_id)
);
