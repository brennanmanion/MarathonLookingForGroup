BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE party_status AS ENUM (
    'open',
    'full',
    'in_progress',
    'closed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE party_member_status AS ENUM (
    'accepted',
    'pending',
    'declined',
    'left',
    'kicked'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE party_member_event_type AS ENUM (
    'join_requested',
    'join_accepted',
    'join_declined',
    'left',
    'kicked'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS bungie_accounts (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  bungie_membership_id bigint NOT NULL UNIQUE,
  bungie_display_name text,
  bungie_global_display_name text,
  bungie_global_display_name_code smallint,
  bungie_verified boolean NOT NULL DEFAULT false,
  bungie_verified_at timestamptz,
  marathon_membership_id bigint UNIQUE,
  marathon_verified boolean NOT NULL DEFAULT false,
  marathon_verified_at timestamptz,
  last_membership_sync_at timestamptz,
  raw_membership_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bungie_oauth_tokens (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_expires_at timestamptz,
  token_scope text NOT NULL DEFAULT 'ReadBasicUserProfile',
  is_stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_login_transactions (
  id uuid PRIMARY KEY,
  oauth_state text NOT NULL UNIQUE,
  redirect_mode text NOT NULL CHECK (redirect_mode IN ('web', 'native')),
  app_state text,
  platform text,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_transactions_expires_idx
  ON auth_login_transactions (expires_at);

CREATE TABLE IF NOT EXISTS auth_handoff_tickets (
  ticket_id uuid PRIMARY KEY,
  login_id uuid NOT NULL REFERENCES auth_login_transactions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_handoff_tickets_login_idx
  ON auth_handoff_tickets (login_id);

CREATE TABLE IF NOT EXISTS app_refresh_tokens (
  token_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by_login_id uuid REFERENCES auth_login_transactions(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_refresh_tokens_user_idx
  ON app_refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id uuid NOT NULL REFERENCES app_users(id),
  title text NOT NULL,
  activity_key text NOT NULL,
  playlist_key text,
  platform_key text NOT NULL DEFAULT 'any',
  region_key text,
  language_key text,
  voice_required boolean NOT NULL DEFAULT false,
  ranked boolean,
  scheduled_for timestamptz,
  max_size smallint NOT NULL CHECK (max_size > 0),
  approval_mode text NOT NULL DEFAULT 'manual',
  visibility text NOT NULL DEFAULT 'public',
  requires_marathon_verified boolean NOT NULL DEFAULT true,
  status party_status NOT NULL DEFAULT 'open',
  requirement_text text,
  description text,
  external_join_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parties_host_idx
  ON parties (host_user_id);

CREATE TABLE IF NOT EXISTS party_members (
  id bigserial PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status party_member_status NOT NULL,
  joined_at timestamptz,
  responded_at timestamptz,
  note_to_host text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS party_members_one_active_row
  ON party_members (party_id, user_id)
  WHERE status IN ('accepted', 'pending');

CREATE INDEX IF NOT EXISTS party_members_latest_status_idx
  ON party_members (party_id, user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS party_members_party_status_idx
  ON party_members (party_id, status);

CREATE TABLE IF NOT EXISTS party_member_events (
  id bigserial PRIMARY KEY,
  party_member_id bigint NOT NULL REFERENCES party_members(id) ON DELETE CASCADE,
  event_type party_member_event_type NOT NULL,
  from_status party_member_status,
  to_status party_member_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS party_member_events_member_created_idx
  ON party_member_events (party_member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS party_tags (
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  tag_key text NOT NULL,
  tag_value text,
  PRIMARY KEY (party_id, tag_key, tag_value)
);

CREATE OR REPLACE VIEW party_capacity AS
SELECT
  p.id AS party_id,
  p.max_size,
  1 + COUNT(*) FILTER (WHERE pm.status = 'accepted') AS filled_slots,
  GREATEST(p.max_size - (1 + COUNT(*) FILTER (WHERE pm.status = 'accepted')), 0) AS open_slots
FROM parties p
LEFT JOIN party_members pm
  ON pm.party_id = p.id
GROUP BY p.id, p.max_size;

COMMIT;
