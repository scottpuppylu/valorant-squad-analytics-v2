-- canonical-schema-v2 (V2-DATA-IMPORT-01). Rich evidence for imported real data.
-- Only bootstrap-era SYNTHETIC structures are reshaped here (no real data existed before this migration):
-- matches.duration_seconds → duration_ms, events.view_radians → event_player_snapshots, rank_context rebuilt.
-- PRIVATE columns (never exported): every *_location_*, view_radians, provider refs, season_ref, account linkage.
ALTER TABLE source_accounts ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
-- statement-breakpoint
CREATE UNIQUE INDEX source_accounts_one_primary_per_member ON source_accounts (member_id) WHERE is_primary;
-- statement-breakpoint
ALTER TABLE consent_state
  ADD COLUMN consent_status text NOT NULL DEFAULT 'explicit' CHECK (consent_status IN ('explicit', 'requires-reconciliation')),
  ADD COLUMN consent_source text NOT NULL DEFAULT 'unspecified',
  ADD CONSTRAINT consent_unreconciled_grants_nothing CHECK (consent_status = 'explicit' OR NOT (identity_connected OR data_collection_allowed
    OR group_visibility_allowed OR public_derived_analytics_allowed));
-- statement-breakpoint
ALTER TABLE matches
  DROP COLUMN duration_seconds,
  DROP COLUMN has_rounds,
  DROP COLUMN has_events,
  DROP CONSTRAINT matches_mode_check,
  ALTER COLUMN map_id DROP NOT NULL,
  ALTER COLUMN map_name DROP NOT NULL,
  ADD COLUMN duration_ms bigint CHECK (duration_ms >= 0),
  ADD COLUMN acquisition text NOT NULL DEFAULT 'provider-adapter' CHECK (acquisition IN ('provider-adapter', 'legacy-import')),
  ADD COLUMN acquisition_source text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN rounds_status text NOT NULL DEFAULT 'missing' CHECK (rounds_status IN ('observed', 'missing', 'unavailable')),
  ADD COLUMN kills_status text NOT NULL DEFAULT 'missing' CHECK (kills_status IN ('observed', 'missing', 'unavailable')),
  ADD COLUMN has_positions boolean NOT NULL DEFAULT false,
  ADD COLUMN queue_id text,
  ADD COLUMN queue_name text,
  ADD COLUMN season_key text,
  ADD COLUMN season_ref text,
  ADD CONSTRAINT matches_mode_check CHECK (mode IN ('competitive', 'unrated', 'premier', 'swiftplay', 'spike-rush', 'deathmatch',
    'team-deathmatch', 'escalation', 'replication', 'snowball', 'custom', 'other', 'unknown'));
-- statement-breakpoint
ALTER TABLE match_teams
  ALTER COLUMN rounds_won DROP NOT NULL,
  ADD COLUMN rounds_lost integer CHECK (rounds_lost >= 0);
-- statement-breakpoint
ALTER TABLE match_participants
  ALTER COLUMN kills DROP NOT NULL,
  ALTER COLUMN deaths DROP NOT NULL,
  ALTER COLUMN assists DROP NOT NULL,
  ADD COLUMN stats_status text NOT NULL DEFAULT 'observed' CHECK (stats_status IN ('observed', 'missing', 'unavailable')),
  ADD COLUMN damage_received integer CHECK (damage_received >= 0),
  ADD COLUMN headshots integer CHECK (headshots >= 0),
  ADD COLUMN bodyshots integer CHECK (bodyshots >= 0),
  ADD COLUMN legshots integer CHECK (legshots >= 0),
  ADD COLUMN ability_status text NOT NULL DEFAULT 'missing' CHECK (ability_status IN ('observed', 'missing', 'unavailable')),
  ADD COLUMN ability1_casts integer,
  ADD COLUMN ability2_casts integer,
  ADD COLUMN grenade_casts integer,
  ADD COLUMN ultimate_casts integer,
  ADD COLUMN economy_status text NOT NULL DEFAULT 'missing' CHECK (economy_status IN ('observed', 'missing', 'unavailable')),
  ADD COLUMN loadout_value_total integer,
  ADD COLUMN loadout_value_average double precision,
  ADD COLUMN spent_total integer,
  ADD COLUMN spent_average double precision;
-- statement-breakpoint
ALTER TABLE rounds
  DROP CONSTRAINT rounds_round_number_check,
  ADD CONSTRAINT rounds_round_number_check CHECK (round_number >= 0),
  ADD COLUMN result text,
  ADD COLUMN winning_team_role text CHECK (winning_team_role IN ('attacker', 'defender')),
  ADD COLUMN side_source text CHECK (side_source IN ('winning_team_role', 'plant', 'defuse')),
  ADD COLUMN plant_status text NOT NULL DEFAULT 'missing' CHECK (plant_status IN ('present', 'absent', 'missing', 'unavailable')),
  ADD COLUMN plant_participant_key text,
  ADD COLUMN plant_time_ms integer CHECK (plant_time_ms >= 0),
  ADD COLUMN plant_site text,
  ADD COLUMN plant_location_x double precision,
  ADD COLUMN plant_location_y double precision,
  ADD COLUMN defuse_status text NOT NULL DEFAULT 'missing' CHECK (defuse_status IN ('present', 'absent', 'missing', 'unavailable')),
  ADD COLUMN defuse_participant_key text,
  ADD COLUMN defuse_time_ms integer CHECK (defuse_time_ms >= 0),
  ADD COLUMN defuse_location_x double precision,
  ADD COLUMN defuse_location_y double precision,
  ADD COLUMN participants_status text NOT NULL DEFAULT 'missing' CHECK (participants_status IN ('observed', 'missing', 'unavailable')),
  ADD CONSTRAINT rounds_side_pair CHECK ((attacking_team_key IS NULL) = (side_source IS NULL)),
  ADD CONSTRAINT rounds_plant_location_pair CHECK ((plant_location_x IS NULL) = (plant_location_y IS NULL)),
  ADD CONSTRAINT rounds_defuse_location_pair CHECK ((defuse_location_x IS NULL) = (defuse_location_y IS NULL));
-- statement-breakpoint
CREATE TABLE round_participants (
  match_key text NOT NULL,
  round_number integer NOT NULL,
  participant_key text NOT NULL,
  stats_status text NOT NULL CHECK (stats_status IN ('observed', 'missing', 'unavailable')),
  kills integer,
  score integer,
  economy_status text NOT NULL CHECK (economy_status IN ('observed', 'missing', 'unavailable')),
  loadout_value integer,
  remaining_credits integer,
  weapon_status text NOT NULL CHECK (weapon_status IN ('observed', 'missing', 'unavailable')),
  weapon_id text,
  weapon_name text,
  armor_status text NOT NULL CHECK (armor_status IN ('observed', 'missing', 'unavailable')),
  armor_id text,
  armor_name text,
  PRIMARY KEY (match_key, round_number, participant_key),
  FOREIGN KEY (match_key, round_number) REFERENCES rounds (match_key, round_number) ON DELETE CASCADE
);
-- statement-breakpoint
ALTER TABLE events
  DROP COLUMN view_radians,
  DROP CONSTRAINT events_round_number_check,
  ADD CONSTRAINT events_round_number_check CHECK (round_number >= 0),
  ADD COLUMN sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  ADD COLUMN time_in_match_ms bigint CHECK (time_in_match_ms >= 0),
  ADD COLUMN weapon_id text,
  ADD COLUMN weapon_name text;
-- statement-breakpoint
CREATE TABLE event_player_snapshots (
  match_key text NOT NULL,
  event_key text NOT NULL,
  participant_key text NOT NULL,
  location_x double precision NOT NULL,
  location_y double precision NOT NULL,
  view_radians double precision,
  PRIMARY KEY (match_key, event_key, participant_key),
  FOREIGN KEY (match_key, event_key) REFERENCES events (match_key, event_key) ON DELETE CASCADE
);
-- statement-breakpoint
CREATE INDEX event_player_snapshots_participant_idx ON event_player_snapshots (match_key, participant_key);
-- statement-breakpoint
DROP TABLE rank_context;
-- statement-breakpoint
CREATE TABLE rank_context (
  rank_context_id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES group_members (member_id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES source_accounts (account_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('match-snapshot', 'history', 'current', 'peak', 'seasonal')),
  effective_at timestamptz NOT NULL,
  match_key text REFERENCES matches (match_key) ON DELETE CASCADE,
  provider_id text NOT NULL,
  source_endpoint text NOT NULL,
  provider_tier_id integer,
  provider_tier_name text,
  rr integer,
  rr_change integer,
  provider_elo integer,
  season_key text,
  queue text,
  normalized_tier_key text,
  tier_ordinal integer,
  tier_model_version text NOT NULL
);
-- statement-breakpoint
CREATE INDEX rank_context_member_time_idx ON rank_context (member_id, effective_at);
-- statement-breakpoint
CREATE TABLE import_state (
  source_system text NOT NULL,
  source_ref_hash text NOT NULL CHECK (source_ref_hash ~ '^[0-9a-f]{64}$'),
  match_key text NOT NULL REFERENCES matches (match_key) ON DELETE CASCADE,
  source_payload_sha256 text NOT NULL CHECK (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  normalizer_version text NOT NULL,
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (source_system, source_ref_hash)
);
