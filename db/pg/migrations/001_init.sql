-- 001_init.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id         bigserial PRIMARY KEY,
  filename   text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id               bigserial PRIMARY KEY,
  username         text NOT NULL UNIQUE,
  display_name     text NOT NULL,
  password_hash    text NOT NULL,
  role             text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user','agent')),
  avatar_url       text,
  invited_by       bigint REFERENCES users(id),
  invite_code      text,
  is_online        boolean NOT NULL DEFAULT false,
  last_seen        timestamptz,
  chat_color_index integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  id                  bigserial PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  created_by          bigint NOT NULL REFERENCES users(id),
  used_by             bigint REFERENCES users(id),
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  token               text,
  nume                text,
  prenume             text,
  default_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  note                text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_token
  ON invitations(token) WHERE token IS NOT NULL;

CREATE TABLE IF NOT EXISTS rooms (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  description text,
  type        text NOT NULL DEFAULT 'group'
              CHECK(type IN ('direct','group','channel','cult','private')),
  is_archived boolean NOT NULL DEFAULT false,
  created_by  bigint REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id      bigint NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
  access_level text NOT NULL DEFAULT 'readandwrite' CHECK(access_level IN ('readonly','readandwrite','post_docs')),
  color_index  integer,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id           bigserial PRIMARY KEY,
  room_id      bigint NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id    bigint NOT NULL REFERENCES users(id),
  recipient_id bigint REFERENCES users(id),
  text         text NOT NULL,
  type         text NOT NULL DEFAULT 'text' CHECK(type IN ('text','file','system')),
  file_url     text,
  file_name    text,
  reply_to     bigint REFERENCES messages(id) ON DELETE SET NULL,
  is_edited    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  keys       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  value      jsonb NOT NULL DEFAULT 'true'::jsonb,
  granted_by bigint REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);

CREATE TABLE IF NOT EXISTS room_requests (
  id                bigserial PRIMARY KEY,
  requested_by      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  requested_members jsonb NOT NULL DEFAULT '[]'::jsonb,
  status            text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by       bigint REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  admin_note        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_requests_status ON room_requests(status);

CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS themes (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL,
  tokens     jsonb NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_themes_active ON themes(is_active);

CREATE TABLE IF NOT EXISTS hub_cards (
  id             bigserial PRIMARY KEY,
  title          text NOT NULL,
  description    text,
  icon           text,
  image_url      text,
  accent_color   text,
  action_type    text NOT NULL CHECK(action_type IN ('url','room','script','internal_app')),
  action_payload jsonb NOT NULL,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_cards_sort ON hub_cards(sort_order);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS private_requests (
  id              bigserial PRIMARY KEY,
  from_user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initial_message text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_private_req_pending
  ON private_requests(from_user_id, to_user_id) WHERE status = 'pending';

COMMIT;
