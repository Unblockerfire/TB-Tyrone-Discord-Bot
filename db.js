// db.js
const Database = require("better-sqlite3");

// Create / open the database file
const db = new Database("tbsbot.db");

// ---------- TABLE SETUP ----------

// user_stats: Discord strikes and warnings
db.prepare(`
  CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,
    strikes INTEGER NOT NULL DEFAULT 0,
    warnings INTEGER NOT NULL DEFAULT 0
  )
`).run();

// user_status: current status (streaming / afk / sleeping / etc)
db.prepare(`
  CREATE TABLE IF NOT EXISTS user_status (
    user_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    note TEXT,
    clear_at TEXT,
    updated_at INTEGER NOT NULL
  )
`).run();

// Migration safety: if the table already existed before clear_at was added,
// this adds the column without breaking existing installs.
try {
  db.prepare(`
    ALTER TABLE user_status
    ADD COLUMN clear_at TEXT
  `).run();
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) {
    console.error("[DB] Error while ensuring clear_at column exists:", err);
  }
}

// mod_interest: whether a user said yes/no to future staff interest
db.prepare(`
  CREATE TABLE IF NOT EXISTS mod_interest (
    user_id TEXT PRIMARY KEY,
    interested INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();

// tyrone_ai_cache
db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_ai_cache (
    question_key TEXT PRIMARY KEY,
    answer TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 0
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_faq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    match_type TEXT NOT NULL DEFAULT 'includes',
    pattern TEXT NOT NULL,
    answer TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    detail_json TEXT,
    created_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_seen_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT,
    channel_id TEXT,
    guild_id TEXT,
    user_id TEXT,
    username TEXT,
    content TEXT,
    outcome TEXT,
    detail_json TEXT,
    created_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_response_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    source_ref TEXT,
    channel_id TEXT,
    guild_id TEXT,
    user_id TEXT,
    username TEXT,
    prompt_text TEXT,
    response_text TEXT,
    path TEXT,
    detail_json TEXT,
    created_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT,
    trigger_text TEXT NOT NULL,
    response_text TEXT NOT NULL,
    notes TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_response_log_id INTEGER,
    updated_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_user_id TEXT NOT NULL,
    reporter_username TEXT,
    guild_id TEXT,
    channel_id TEXT,
    report_type TEXT NOT NULL,
    feedback_mode TEXT NOT NULL,
    source_response_log_id INTEGER,
    source_seen_message_id INTEGER,
    question_text TEXT,
    response_text TEXT,
    tyrone_guess TEXT,
    user_feedback TEXT,
    admin_resolution TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    detail_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS private_vc_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    text_channel_id TEXT,
    category_id TEXT,
    name TEXT,
    invited_json TEXT NOT NULL DEFAULT '[]',
    is_private INTEGER NOT NULL DEFAULT 1,
    auto_delete_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_empty_at INTEGER
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS checklist_panels (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    guild_id TEXT,
    updated_at INTEGER NOT NULL
  )
`).run();

// ---------- FORTNITE TABLES ----------

// fortnite_links: Discord user <-> Fortnite username link + verification/rules status
db.prepare(`
  CREATE TABLE IF NOT EXISTS fortnite_links (
    user_id TEXT PRIMARY KEY,
    epic_username TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    verified_at INTEGER,
    accepted_rules_at INTEGER,
    updated_at INTEGER NOT NULL
  )
`).run();

// Backfill accepted_rules_at if older table exists
try {
  db.prepare(`
    ALTER TABLE fortnite_links
    ADD COLUMN accepted_rules_at INTEGER
  `).run();
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) {
    console.error("[DB] Error while ensuring accepted_rules_at exists:", err);
  }
}

// fortnite_queue: Discord users currently queued for party rotation
db.prepare(`
  CREATE TABLE IF NOT EXISTS fortnite_queue (
    user_id TEXT PRIMARY KEY,
    queued_at INTEGER NOT NULL
  )
`).run();

// fortnite_queue_guests: manual / guest queue users without Discord
db.prepare(`
  CREATE TABLE IF NOT EXISTS fortnite_queue_guests (
    guest_id TEXT PRIMARY KEY,
    guest_name TEXT NOT NULL,
    epic_username TEXT NOT NULL,
    queued_at INTEGER NOT NULL
  )
`).run();

// fortnite_queue_state: generic state table for queue / overlay / message ids
db.prepare(`
  CREATE TABLE IF NOT EXISTS fortnite_queue_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`).run();

// fortnite_stats: Fortnite-only strike tracking
db.prepare(`
  CREATE TABLE IF NOT EXISTS fortnite_stats (
    user_id TEXT PRIMARY KEY,
    strikes INTEGER NOT NULL DEFAULT 0,
    last_action_at INTEGER
  )
`).run();

// fortnite_discipline: ban ladder + blacklist state
db.prepare(`
  CREATE TABLE IF NOT EXISTS fortnite_discipline (
    user_id TEXT PRIMARY KEY,
    ban_tier INTEGER NOT NULL DEFAULT 0,
    banned_until INTEGER,
    blacklist_type TEXT,
    last_reason TEXT,
    updated_at INTEGER NOT NULL
  )
`).run();

// ---------- PREPARED STATEMENTS ----------

// Discord user stats
const getUserStatsStmt = db.prepare(`
  SELECT user_id, strikes, warnings
  FROM user_stats
  WHERE user_id = ?
`);

const upsertUserStatsStmt = db.prepare(`
  INSERT INTO user_stats (user_id, strikes, warnings)
  VALUES (@user_id, @strikes, @warnings)
  ON CONFLICT(user_id) DO UPDATE SET
    strikes = excluded.strikes,
    warnings = excluded.warnings
`);

// User status
const getUserStatusStmt = db.prepare(`
  SELECT user_id, status, note, clear_at, updated_at
  FROM user_status
  WHERE user_id = ?
`);

const upsertUserStatusStmt = db.prepare(`
  INSERT INTO user_status (user_id, status, note, clear_at, updated_at)
  VALUES (@user_id, @status, @note, @clear_at, @updated_at)
  ON CONFLICT(user_id) DO UPDATE SET
    status = excluded.status,
    note = excluded.note,
    clear_at = excluded.clear_at,
    updated_at = excluded.updated_at
`);

const deleteUserStatusStmt = db.prepare(`
  DELETE FROM user_status
  WHERE user_id = ?
`);

// Mod interest
const getModInterestStmt = db.prepare(`
  SELECT user_id, interested, updated_at
  FROM mod_interest
  WHERE user_id = ?
`);

const upsertModInterestStmt = db.prepare(`
  INSERT INTO mod_interest (user_id, interested, updated_at)
  VALUES (@user_id, @interested, @updated_at)
  ON CONFLICT(user_id) DO UPDATE SET
    interested = excluded.interested,
    updated_at = excluded.updated_at
`);

// Tyrone cache
const getTyroneCacheStmt = db.prepare(`
  SELECT question_key, answer, created_at
  FROM tyrone_ai_cache
  WHERE question_key = ?
`);

const touchTyroneCacheStmt = db.prepare(`
  UPDATE tyrone_ai_cache
  SET last_used_at = ?, use_count = use_count + 1
  WHERE question_key = ?
`);

const upsertTyroneCacheStmt = db.prepare(`
  INSERT INTO tyrone_ai_cache (question_key, answer, created_at, last_used_at, use_count)
  VALUES (@question_key, @answer, @created_at, @last_used_at, 0)
  ON CONFLICT(question_key) DO UPDATE SET
    answer = excluded.answer,
    last_used_at = excluded.last_used_at
`);

const deleteTyroneCacheStmt = db.prepare(`
  DELETE FROM tyrone_ai_cache
  WHERE question_key = ?
`);

const countTyroneCacheStmt = db.prepare(`
  SELECT COUNT(*) as cnt
  FROM tyrone_ai_cache
`);

const listTyroneCacheStmt = db.prepare(`
  SELECT question_key, answer, created_at, last_used_at, use_count
  FROM tyrone_ai_cache
  ORDER BY last_used_at DESC
  LIMIT ?
`);

const clearTyroneCacheStmt = db.prepare(`
  DELETE FROM tyrone_ai_cache
`);

const deleteTyroneCacheByKeyStmt = db.prepare(`
  DELETE FROM tyrone_ai_cache
  WHERE question_key = ?
`);

const trimOldestTyroneCacheStmt = db.prepare(`
  DELETE FROM tyrone_ai_cache
  WHERE question_key IN (
    SELECT question_key
    FROM tyrone_ai_cache
    ORDER BY last_used_at ASC
    LIMIT ?
  )
`);

const getTyroneSettingStmt = db.prepare(`
  SELECT key, value, updated_at
  FROM tyrone_settings
  WHERE key = ?
`);

const listTyroneSettingsStmt = db.prepare(`
  SELECT key, value, updated_at
  FROM tyrone_settings
`);

const upsertTyroneSettingStmt = db.prepare(`
  INSERT INTO tyrone_settings (key, value, updated_at)
  VALUES (@key, @value, @updated_at)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);

const getAppSettingStmt = db.prepare(`
  SELECT key, value, updated_at
  FROM app_settings
  WHERE key = ?
`);

const listAppSettingsStmt = db.prepare(`
  SELECT key, value, updated_at
  FROM app_settings
`);

const upsertAppSettingStmt = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (@key, @value, @updated_at)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);

const listTyroneFaqStmt = db.prepare(`
  SELECT id, label, match_type, pattern, answer, enabled, sort_order, updated_at
  FROM tyrone_faq
  ORDER BY sort_order ASC, id ASC
`);

const getTyroneFaqByIdStmt = db.prepare(`
  SELECT id, label, match_type, pattern, answer, enabled, sort_order, updated_at
  FROM tyrone_faq
  WHERE id = ?
`);

const insertTyroneFaqStmt = db.prepare(`
  INSERT INTO tyrone_faq (label, match_type, pattern, answer, enabled, sort_order, updated_at)
  VALUES (@label, @match_type, @pattern, @answer, @enabled, @sort_order, @updated_at)
`);

const updateTyroneFaqStmt = db.prepare(`
  UPDATE tyrone_faq
  SET label = @label,
      match_type = @match_type,
      pattern = @pattern,
      answer = @answer,
      enabled = @enabled,
      sort_order = @sort_order,
      updated_at = @updated_at
  WHERE id = @id
`);

const deleteTyroneFaqStmt = db.prepare(`
  DELETE FROM tyrone_faq
  WHERE id = ?
`);

const countTyroneFaqStmt = db.prepare(`
  SELECT COUNT(*) as cnt
  FROM tyrone_faq
`);

const insertTyroneEventStmt = db.prepare(`
  INSERT INTO tyrone_events (kind, detail_json, created_at)
  VALUES (?, ?, ?)
`);

const listTyroneEventsStmt = db.prepare(`
  SELECT id, kind, detail_json, created_at
  FROM tyrone_events
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const insertTyroneSeenMessageStmt = db.prepare(`
  INSERT INTO tyrone_seen_messages (
    message_id,
    channel_id,
    guild_id,
    user_id,
    username,
    content,
    outcome,
    detail_json,
    created_at
  )
  VALUES (
    @message_id,
    @channel_id,
    @guild_id,
    @user_id,
    @username,
    @content,
    @outcome,
    @detail_json,
    @created_at
  )
`);

const updateTyroneSeenMessageOutcomeStmt = db.prepare(`
  UPDATE tyrone_seen_messages
  SET outcome = @outcome,
      detail_json = @detail_json
  WHERE id = @id
`);

const listTyroneSeenMessagesStmt = db.prepare(`
  SELECT id, message_id, channel_id, guild_id, user_id, username, content, outcome, detail_json, created_at
  FROM tyrone_seen_messages
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const getTyroneSeenMessageByIdStmt = db.prepare(`
  SELECT id, message_id, channel_id, guild_id, user_id, username, content, outcome, detail_json, created_at
  FROM tyrone_seen_messages
  WHERE id = ?
`);

const insertTyroneResponseLogStmt = db.prepare(`
  INSERT INTO tyrone_response_logs (
    source_type,
    source_ref,
    channel_id,
    guild_id,
    user_id,
    username,
    prompt_text,
    response_text,
    path,
    detail_json,
    created_at
  )
  VALUES (
    @source_type,
    @source_ref,
    @channel_id,
    @guild_id,
    @user_id,
    @username,
    @prompt_text,
    @response_text,
    @path,
    @detail_json,
    @created_at
  )
`);

const listTyroneResponseLogsStmt = db.prepare(`
  SELECT id, source_type, source_ref, channel_id, guild_id, user_id, username, prompt_text, response_text, path, detail_json, created_at
  FROM tyrone_response_logs
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const getTyroneResponseLogByIdStmt = db.prepare(`
  SELECT id, source_type, source_ref, channel_id, guild_id, user_id, username, prompt_text, response_text, path, detail_json, created_at
  FROM tyrone_response_logs
  WHERE id = ?
`);

const findRecentTyroneResponseLogStmt = db.prepare(`
  SELECT id, source_type, source_ref, channel_id, guild_id, user_id, username, prompt_text, response_text, path, detail_json, created_at
  FROM tyrone_response_logs
  WHERE user_id = ?
    AND (? IS NULL OR channel_id = ?)
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`);

const insertTyroneCorrectionStmt = db.prepare(`
  INSERT INTO tyrone_corrections (
    label,
    trigger_text,
    response_text,
    notes,
    enabled,
    sort_order,
    source_response_log_id,
    updated_at
  )
  VALUES (
    @label,
    @trigger_text,
    @response_text,
    @notes,
    @enabled,
    @sort_order,
    @source_response_log_id,
    @updated_at
  )
`);

const updateTyroneCorrectionStmt = db.prepare(`
  UPDATE tyrone_corrections
  SET label = @label,
      trigger_text = @trigger_text,
      response_text = @response_text,
      notes = @notes,
      enabled = @enabled,
      sort_order = @sort_order,
      updated_at = @updated_at
  WHERE id = @id
`);

const deleteTyroneCorrectionStmt = db.prepare(`
  DELETE FROM tyrone_corrections
  WHERE id = ?
`);

const listTyroneCorrectionsStmt = db.prepare(`
  SELECT id, label, trigger_text, response_text, notes, enabled, sort_order, source_response_log_id, updated_at
  FROM tyrone_corrections
  ORDER BY sort_order ASC, id ASC
`);

const getTyroneCorrectionByIdStmt = db.prepare(`
  SELECT id, label, trigger_text, response_text, notes, enabled, sort_order, source_response_log_id, updated_at
  FROM tyrone_corrections
  WHERE id = ?
`);

const insertTyroneReportStmt = db.prepare(`
  INSERT INTO tyrone_reports (
    reporter_user_id,
    reporter_username,
    guild_id,
    channel_id,
    report_type,
    feedback_mode,
    source_response_log_id,
    source_seen_message_id,
    question_text,
    response_text,
    tyrone_guess,
    user_feedback,
    admin_resolution,
    status,
    detail_json,
    created_at,
    updated_at
  )
  VALUES (
    @reporter_user_id,
    @reporter_username,
    @guild_id,
    @channel_id,
    @report_type,
    @feedback_mode,
    @source_response_log_id,
    @source_seen_message_id,
    @question_text,
    @response_text,
    @tyrone_guess,
    @user_feedback,
    @admin_resolution,
    @status,
    @detail_json,
    @created_at,
    @updated_at
  )
`);

const updateTyroneReportStmt = db.prepare(`
  UPDATE tyrone_reports
  SET feedback_mode = @feedback_mode,
      tyrone_guess = @tyrone_guess,
      user_feedback = @user_feedback,
      admin_resolution = @admin_resolution,
      status = @status,
      detail_json = @detail_json,
      updated_at = @updated_at
  WHERE id = @id
`);

const listTyroneReportsStmt = db.prepare(`
  SELECT id, reporter_user_id, reporter_username, guild_id, channel_id, report_type, feedback_mode,
         source_response_log_id, source_seen_message_id, question_text, response_text, tyrone_guess,
         user_feedback, admin_resolution, status, detail_json, created_at, updated_at
  FROM tyrone_reports
  ORDER BY updated_at DESC, id DESC
  LIMIT ?
`);

const getTyroneReportByIdStmt = db.prepare(`
  SELECT id, reporter_user_id, reporter_username, guild_id, channel_id, report_type, feedback_mode,
         source_response_log_id, source_seen_message_id, question_text, response_text, tyrone_guess,
         user_feedback, admin_resolution, status, detail_json, created_at, updated_at
  FROM tyrone_reports
  WHERE id = ?
`);

const getPrivateVcByChannelIdStmt = db.prepare(`
  SELECT channel_id, guild_id, owner_id, text_channel_id, category_id, name, invited_json,
         is_private, auto_delete_enabled, created_at, updated_at, last_empty_at
  FROM private_vc_channels
  WHERE channel_id = ?
`);

const listPrivateVcChannelsStmt = db.prepare(`
  SELECT channel_id, guild_id, owner_id, text_channel_id, category_id, name, invited_json,
         is_private, auto_delete_enabled, created_at, updated_at, last_empty_at
  FROM private_vc_channels
  ORDER BY created_at DESC
`);

const deletePrivateVcByChannelIdStmt = db.prepare(`
  DELETE FROM private_vc_channels
  WHERE channel_id = ?
`);

const upsertPrivateVcStmt = db.prepare(`
  INSERT INTO private_vc_channels (
    channel_id,
    guild_id,
    owner_id,
    text_channel_id,
    category_id,
    name,
    invited_json,
    is_private,
    auto_delete_enabled,
    created_at,
    updated_at,
    last_empty_at
  )
  VALUES (
    @channel_id,
    @guild_id,
    @owner_id,
    @text_channel_id,
    @category_id,
    @name,
    @invited_json,
    @is_private,
    @auto_delete_enabled,
    @created_at,
    @updated_at,
    @last_empty_at
  )
  ON CONFLICT(channel_id) DO UPDATE SET
    guild_id = excluded.guild_id,
    owner_id = excluded.owner_id,
    text_channel_id = excluded.text_channel_id,
    category_id = excluded.category_id,
    name = excluded.name,
    invited_json = excluded.invited_json,
    is_private = excluded.is_private,
    auto_delete_enabled = excluded.auto_delete_enabled,
    updated_at = excluded.updated_at,
    last_empty_at = excluded.last_empty_at
`);

// Fortnite links
const getFortniteLinkStmt = db.prepare(`
  SELECT user_id, epic_username, verified, verified_at, accepted_rules_at, updated_at
  FROM fortnite_links
  WHERE user_id = ?
`);

const getFortniteLinkByEpicStmt = db.prepare(`
  SELECT user_id, epic_username, verified, verified_at, accepted_rules_at, updated_at
  FROM fortnite_links
  WHERE lower(epic_username) = lower(?)
`);

const upsertFortniteLinkStmt = db.prepare(`
  INSERT INTO fortnite_links (user_id, epic_username, verified, verified_at, accepted_rules_at, updated_at)
  VALUES (@user_id, @epic_username, @verified, @verified_at, @accepted_rules_at, @updated_at)
  ON CONFLICT(user_id) DO UPDATE SET
    epic_username = excluded.epic_username,
    verified = excluded.verified,
    verified_at = excluded.verified_at,
    accepted_rules_at = excluded.accepted_rules_at,
    updated_at = excluded.updated_at
`);

const deleteFortniteLinkStmt = db.prepare(`
  DELETE FROM fortnite_links
  WHERE user_id = ?
`);

// Fortnite queue: Discord users
const getFortniteQueueEntryStmt = db.prepare(`
  SELECT user_id, queued_at
  FROM fortnite_queue
  WHERE user_id = ?
`);

const insertFortniteQueueEntryStmt = db.prepare(`
  INSERT OR REPLACE INTO fortnite_queue (user_id, queued_at)
  VALUES (?, ?)
`);

const deleteFortniteQueueEntryStmt = db.prepare(`
  DELETE FROM fortnite_queue
  WHERE user_id = ?
`);

const clearFortniteQueueStmt = db.prepare(`
  DELETE FROM fortnite_queue
`);

const listFortniteQueueDiscordStmt = db.prepare(`
  SELECT user_id, queued_at
  FROM fortnite_queue
  ORDER BY queued_at ASC
`);

// Fortnite queue: Guests
const getFortniteGuestQueueEntryByIdStmt = db.prepare(`
  SELECT guest_id, guest_name, epic_username, queued_at
  FROM fortnite_queue_guests
  WHERE guest_id = ?
`);

const getFortniteGuestQueueEntryByNameStmt = db.prepare(`
  SELECT guest_id, guest_name, epic_username, queued_at
  FROM fortnite_queue_guests
  WHERE lower(guest_name) = lower(?)
`);

const insertFortniteGuestQueueEntryStmt = db.prepare(`
  INSERT OR REPLACE INTO fortnite_queue_guests (guest_id, guest_name, epic_username, queued_at)
  VALUES (@guest_id, @guest_name, @epic_username, @queued_at)
`);

const deleteFortniteGuestQueueEntryByIdStmt = db.prepare(`
  DELETE FROM fortnite_queue_guests
  WHERE guest_id = ?
`);

const deleteFortniteGuestQueueEntryByNameStmt = db.prepare(`
  DELETE FROM fortnite_queue_guests
  WHERE lower(guest_name) = lower(?)
`);

const clearFortniteGuestQueueStmt = db.prepare(`
  DELETE FROM fortnite_queue_guests
`);

const listFortniteQueueGuestsStmt = db.prepare(`
  SELECT guest_id, guest_name, epic_username, queued_at
  FROM fortnite_queue_guests
  ORDER BY queued_at ASC
`);

// Fortnite queue state
const getFortniteQueueStateValueStmt = db.prepare(`
  SELECT value
  FROM fortnite_queue_state
  WHERE key = ?
`);

const setFortniteQueueStateValueStmt = db.prepare(`
  INSERT INTO fortnite_queue_state (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value
`);

const deleteFortniteQueueStateValueStmt = db.prepare(`
  DELETE FROM fortnite_queue_state
  WHERE key = ?
`);

// Fortnite stats / strikes
const getFortniteStatsStmt = db.prepare(`
  SELECT user_id, strikes, last_action_at
  FROM fortnite_stats
  WHERE user_id = ?
`);

const upsertFortniteStatsStmt = db.prepare(`
  INSERT INTO fortnite_stats (user_id, strikes, last_action_at)
  VALUES (@user_id, @strikes, @last_action_at)
  ON CONFLICT(user_id) DO UPDATE SET
    strikes = excluded.strikes,
    last_action_at = excluded.last_action_at
`);

// Fortnite discipline / bans
const getFortniteDisciplineStmt = db.prepare(`
  SELECT user_id, ban_tier, banned_until, blacklist_type, last_reason, updated_at
  FROM fortnite_discipline
  WHERE user_id = ?
`);

const upsertFortniteDisciplineStmt = db.prepare(`
  INSERT INTO fortnite_discipline (
    user_id,
    ban_tier,
    banned_until,
    blacklist_type,
    last_reason,
    updated_at
  )
  VALUES (
    @user_id,
    @ban_tier,
    @banned_until,
    @blacklist_type,
    @last_reason,
    @updated_at
  )
  ON CONFLICT(user_id) DO UPDATE SET
    ban_tier = excluded.ban_tier,
    banned_until = excluded.banned_until,
    blacklist_type = excluded.blacklist_type,
    last_reason = excluded.last_reason,
    updated_at = excluded.updated_at
`);

// ---------- USER STATS HELPERS ----------

function getUserStats(userId) {
  const row = getUserStatsStmt.get(userId);

  if (!row) {
    return {
      user_id: userId,
      strikes: 0,
      warnings: 0
    };
  }

  return row;
}

function setUserStats(userId, strikes, warnings) {
  upsertUserStatsStmt.run({
    user_id: userId,
    strikes,
    warnings
  });
}

function addStrike(userId) {
  const current = getUserStats(userId);
  const updated = {
    strikes: current.strikes + 1,
    warnings: current.warnings + 1
  };

  setUserStats(userId, updated.strikes, updated.warnings);

  return {
    user_id: userId,
    strikes: updated.strikes,
    warnings: updated.warnings
  };
}

function clearUserStats(userId) {
  setUserStats(userId, 0, 0);
  return getUserStats(userId);
}

// ---------- USER STATUS HELPERS ----------

function getUserStatus(userId) {
  return getUserStatusStmt.get(userId) || null;
}

function setUserStatus(userId, status, note = null, clearAt = null) {
  upsertUserStatusStmt.run({
    user_id: userId,
    status,
    note,
    clear_at: clearAt,
    updated_at: Date.now()
  });

  return getUserStatus(userId);
}

function clearUserStatus(userId) {
  deleteUserStatusStmt.run(userId);
  return null;
}

// ---------- MOD INTEREST HELPERS ----------

function getModInterest(userId) {
  return getModInterestStmt.get(userId) || null;
}

function setModInterest(userId, interested) {
  upsertModInterestStmt.run({
    user_id: userId,
    interested: interested ? 1 : 0,
    updated_at: Date.now()
  });

  return getModInterest(userId);
}

// ---------- GENERIC ROLE HELPERS ----------

function userHasRole(member, roleId) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return member.roles.cache.has(roleId);
}

function userHasAnyRole(member, roleIds) {
  if (!member || !member.roles || !member.roles.cache) return false;
  if (!Array.isArray(roleIds)) return false;
  return roleIds.some(id => member.roles.cache.has(id));
}

// ---------- TYRONE AI CACHE HELPERS ----------

function normalizeQuestionKey(q) {
  return (q || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getTyroneCachedAnswer(question, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  const key = normalizeQuestionKey(question);
  if (!key) return null;

  const row = getTyroneCacheStmt.get(key);
  if (!row) return null;

  const now = Date.now();
  if (now - row.created_at > maxAgeMs) {
    try {
      deleteTyroneCacheStmt.run(key);
    } catch {}
    return null;
  }

  try {
    touchTyroneCacheStmt.run(now, key);
  } catch {}

  return row.answer || null;
}

function setTyroneCachedAnswer(question, answer, maxEntries = 500) {
  const key = normalizeQuestionKey(question);
  const safeAnswer = (answer || "").toString().trim();
  if (!key || !safeAnswer) return false;

  const now = Date.now();

  try {
    upsertTyroneCacheStmt.run({
      question_key: key,
      answer: safeAnswer,
      created_at: now,
      last_used_at: now
    });
  } catch (err) {
    console.error("[DB] Failed to upsert tyrone cache:", err);
    return false;
  }

  try {
    const { cnt } = countTyroneCacheStmt.get() || { cnt: 0 };
    if (cnt > maxEntries) {
      const toDelete = cnt - maxEntries;
      trimOldestTyroneCacheStmt.run(toDelete);
    }
  } catch (err) {
    console.error("[DB] Failed to trim tyrone cache:", err);
  }

  return true;
}

function getTyroneCacheStats() {
  const row = countTyroneCacheStmt.get() || { cnt: 0 };
  return { count: Number(row.cnt || 0) };
}

function listTyroneCache(limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 25)));
  return listTyroneCacheStmt.all(safeLimit);
}

function clearTyroneCache() {
  return clearTyroneCacheStmt.run();
}

function deleteTyroneCacheByKey(questionKey) {
  if (!questionKey) return null;
  return deleteTyroneCacheByKeyStmt.run(questionKey);
}

function getTyroneSetting(key) {
  return getTyroneSettingStmt.get(key) || null;
}

function listTyroneSettings() {
  return listTyroneSettingsStmt.all();
}

function setTyroneSetting(key, value) {
  const now = Date.now();
  const stored =
    typeof value === "string"
      ? value
      : JSON.stringify(value);

  upsertTyroneSettingStmt.run({
    key: String(key),
    value: stored,
    updated_at: now
  });

  return getTyroneSetting(key);
}

function setManyTyroneSettings(entries) {
  if (!entries || typeof entries !== "object") return [];

  const tx = db.transaction((obj) => {
    for (const [key, value] of Object.entries(obj)) {
      setTyroneSetting(key, value);
    }
  });

  tx(entries);
  return listTyroneSettings();
}

function getAppSetting(key) {
  return getAppSettingStmt.get(key) || null;
}

function listAppSettings() {
  return listAppSettingsStmt.all();
}

function setAppSetting(key, value) {
  const now = Date.now();
  const stored =
    typeof value === "string"
      ? value
      : JSON.stringify(value);

  upsertAppSettingStmt.run({
    key: String(key),
    value: stored,
    updated_at: now
  });

  return getAppSetting(key);
}

function setManyAppSettings(entries) {
  if (!entries || typeof entries !== "object") return [];

  const tx = db.transaction((obj) => {
    for (const [key, value] of Object.entries(obj)) {
      setAppSetting(key, value);
    }
  });

  tx(entries);
  return listAppSettings();
}

function listTyroneFaq() {
  return listTyroneFaqStmt.all();
}

function getTyroneFaqById(id) {
  return getTyroneFaqByIdStmt.get(id) || null;
}

function createTyroneFaq({ label = null, match_type = "includes", pattern, answer, enabled = 1, sort_order = 0 }) {
  const now = Date.now();
  const result = insertTyroneFaqStmt.run({
    label: label ? String(label).trim() : null,
    match_type: String(match_type || "includes").trim() || "includes",
    pattern: String(pattern || "").trim(),
    answer: String(answer || "").trim(),
    enabled: enabled ? 1 : 0,
    sort_order: Number(sort_order || 0),
    updated_at: now
  });

  return getTyroneFaqById(result.lastInsertRowid);
}

function updateTyroneFaq(id, { label = null, match_type = "includes", pattern, answer, enabled = 1, sort_order = 0 }) {
  const now = Date.now();
  updateTyroneFaqStmt.run({
    id: Number(id),
    label: label ? String(label).trim() : null,
    match_type: String(match_type || "includes").trim() || "includes",
    pattern: String(pattern || "").trim(),
    answer: String(answer || "").trim(),
    enabled: enabled ? 1 : 0,
    sort_order: Number(sort_order || 0),
    updated_at: now
  });

  return getTyroneFaqById(id);
}

function deleteTyroneFaq(id) {
  return deleteTyroneFaqStmt.run(Number(id));
}

function countTyroneFaq() {
  const row = countTyroneFaqStmt.get() || { cnt: 0 };
  return Number(row.cnt || 0);
}

function logTyroneEvent(kind, detail = null) {
  const safeKind = String(kind || "").trim();
  if (!safeKind) return null;

  const detailJson =
    detail === null || detail === undefined
      ? null
      : JSON.stringify(detail);

  const now = Date.now();
  const result = insertTyroneEventStmt.run(safeKind, detailJson, now);
  return {
    id: result.lastInsertRowid,
    kind: safeKind,
    detail_json: detailJson,
    created_at: now
  };
}

function listTyroneEvents(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  return listTyroneEventsStmt.all(safeLimit).map(row => ({
    ...row,
    detail: (() => {
      try {
        return row.detail_json ? JSON.parse(row.detail_json) : null;
      } catch {
        return row.detail_json || null;
      }
    })()
  }));
}

function parseDetailJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw || null;
  }
}

function logTyroneSeenMessage(entry = {}) {
  const now = Date.now();
  const result = insertTyroneSeenMessageStmt.run({
    message_id: entry.message_id || null,
    channel_id: entry.channel_id || null,
    guild_id: entry.guild_id || null,
    user_id: entry.user_id || null,
    username: entry.username || null,
    content: entry.content || "",
    outcome: entry.outcome || "seen",
    detail_json: entry.detail ? JSON.stringify(entry.detail) : null,
    created_at: now
  });

  return getTyroneSeenMessageById(result.lastInsertRowid);
}

function updateTyroneSeenMessageOutcome(id, outcome, detail = null) {
  updateTyroneSeenMessageOutcomeStmt.run({
    id: Number(id),
    outcome: String(outcome || "updated"),
    detail_json: detail ? JSON.stringify(detail) : null
  });
  return getTyroneSeenMessageById(id);
}

function listTyroneSeenMessages(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
  return listTyroneSeenMessagesStmt.all(safeLimit).map(row => ({
    ...row,
    detail: parseDetailJson(row.detail_json)
  }));
}

function getTyroneSeenMessageById(id) {
  const row = getTyroneSeenMessageByIdStmt.get(Number(id));
  if (!row) return null;
  return { ...row, detail: parseDetailJson(row.detail_json) };
}

function logTyroneResponse(entry = {}) {
  const now = Date.now();
  const result = insertTyroneResponseLogStmt.run({
    source_type: entry.source_type || "discord",
    source_ref: entry.source_ref || null,
    channel_id: entry.channel_id || null,
    guild_id: entry.guild_id || null,
    user_id: entry.user_id || null,
    username: entry.username || null,
    prompt_text: entry.prompt_text || "",
    response_text: entry.response_text || "",
    path: entry.path || "unknown",
    detail_json: entry.detail ? JSON.stringify(entry.detail) : null,
    created_at: now
  });

  return getTyroneResponseLogById(result.lastInsertRowid);
}

function listTyroneResponseLogs(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
  return listTyroneResponseLogsStmt.all(safeLimit).map(row => ({
    ...row,
    detail: parseDetailJson(row.detail_json)
  }));
}

function getTyroneResponseLogById(id) {
  const row = getTyroneResponseLogByIdStmt.get(Number(id));
  if (!row) return null;
  return { ...row, detail: parseDetailJson(row.detail_json) };
}

function findRecentTyroneResponseLog(userId, channelId = null) {
  const row = findRecentTyroneResponseLogStmt.get(String(userId), channelId, channelId);
  if (!row) return null;
  return { ...row, detail: parseDetailJson(row.detail_json) };
}

function listTyroneCorrections() {
  return listTyroneCorrectionsStmt.all().map(row => ({
    ...row,
    enabled: !!row.enabled
  }));
}

function getTyroneCorrectionById(id) {
  const row = getTyroneCorrectionByIdStmt.get(Number(id));
  return row ? { ...row, enabled: !!row.enabled } : null;
}

function createTyroneCorrection({
  label = null,
  trigger_text,
  response_text,
  notes = null,
  enabled = 1,
  sort_order = 0,
  source_response_log_id = null
}) {
  const now = Date.now();
  const result = insertTyroneCorrectionStmt.run({
    label: label ? String(label).trim() : null,
    trigger_text: String(trigger_text || "").trim(),
    response_text: String(response_text || "").trim(),
    notes: notes ? String(notes).trim() : null,
    enabled: enabled ? 1 : 0,
    sort_order: Number(sort_order || 0),
    source_response_log_id: source_response_log_id ? Number(source_response_log_id) : null,
    updated_at: now
  });
  return getTyroneCorrectionById(result.lastInsertRowid);
}

function updateTyroneCorrection(id, {
  label = null,
  trigger_text,
  response_text,
  notes = null,
  enabled = 1,
  sort_order = 0
}) {
  const now = Date.now();
  updateTyroneCorrectionStmt.run({
    id: Number(id),
    label: label ? String(label).trim() : null,
    trigger_text: String(trigger_text || "").trim(),
    response_text: String(response_text || "").trim(),
    notes: notes ? String(notes).trim() : null,
    enabled: enabled ? 1 : 0,
    sort_order: Number(sort_order || 0),
    updated_at: now
  });
  return getTyroneCorrectionById(id);
}

function deleteTyroneCorrection(id) {
  return deleteTyroneCorrectionStmt.run(Number(id));
}

function createTyroneReport(entry = {}) {
  const now = Date.now();
  const result = insertTyroneReportStmt.run({
    reporter_user_id: String(entry.reporter_user_id || ""),
    reporter_username: entry.reporter_username || null,
    guild_id: entry.guild_id || null,
    channel_id: entry.channel_id || null,
    report_type: String(entry.report_type || "incorrect"),
    feedback_mode: String(entry.feedback_mode || "none"),
    source_response_log_id: entry.source_response_log_id ? Number(entry.source_response_log_id) : null,
    source_seen_message_id: entry.source_seen_message_id ? Number(entry.source_seen_message_id) : null,
    question_text: entry.question_text || null,
    response_text: entry.response_text || null,
    tyrone_guess: entry.tyrone_guess || null,
    user_feedback: entry.user_feedback || null,
    admin_resolution: entry.admin_resolution || null,
    status: entry.status || "pending",
    detail_json: entry.detail ? JSON.stringify(entry.detail) : null,
    created_at: now,
    updated_at: now
  });
  return getTyroneReportById(result.lastInsertRowid);
}

function updateTyroneReport(id, patch = {}) {
  const current = getTyroneReportById(id);
  if (!current) return null;
  const now = Date.now();
  updateTyroneReportStmt.run({
    id: Number(id),
    feedback_mode: patch.feedback_mode || current.feedback_mode,
    tyrone_guess: patch.tyrone_guess !== undefined ? patch.tyrone_guess : current.tyrone_guess,
    user_feedback: patch.user_feedback !== undefined ? patch.user_feedback : current.user_feedback,
    admin_resolution: patch.admin_resolution !== undefined ? patch.admin_resolution : current.admin_resolution,
    status: patch.status || current.status,
    detail_json: JSON.stringify(patch.detail !== undefined ? patch.detail : current.detail),
    updated_at: now
  });
  return getTyroneReportById(id);
}

function listTyroneReports(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
  return listTyroneReportsStmt.all(safeLimit).map(row => ({
    ...row,
    detail: parseDetailJson(row.detail_json)
  }));
}

function getTyroneReportById(id) {
  const row = getTyroneReportByIdStmt.get(Number(id));
  if (!row) return null;
  return { ...row, detail: parseDetailJson(row.detail_json) };
}

function parsePrivateVcRow(row) {
  if (!row) return null;
  let invited_user_ids = [];
  try {
    invited_user_ids = row.invited_json ? JSON.parse(row.invited_json) : [];
  } catch {
    invited_user_ids = [];
  }

  return {
    ...row,
    invited_user_ids: Array.isArray(invited_user_ids) ? invited_user_ids : [],
    is_private: !!row.is_private,
    auto_delete_enabled: !!row.auto_delete_enabled
  };
}

function getPrivateVcByChannelId(channelId) {
  return parsePrivateVcRow(getPrivateVcByChannelIdStmt.get(String(channelId)));
}

function listPrivateVcChannels() {
  return listPrivateVcChannelsStmt.all().map(parsePrivateVcRow);
}

function upsertPrivateVc(entry = {}) {
  const now = Date.now();
  const current = entry.channel_id ? getPrivateVcByChannelId(entry.channel_id) : null;
  upsertPrivateVcStmt.run({
    channel_id: String(entry.channel_id || current?.channel_id || ""),
    guild_id: String(entry.guild_id || current?.guild_id || ""),
    owner_id: String(entry.owner_id || current?.owner_id || ""),
    text_channel_id: entry.text_channel_id !== undefined ? entry.text_channel_id : (current?.text_channel_id || null),
    category_id: entry.category_id !== undefined ? entry.category_id : (current?.category_id || null),
    name: entry.name !== undefined ? entry.name : (current?.name || null),
    invited_json: JSON.stringify(
      Array.isArray(entry.invited_user_ids)
        ? entry.invited_user_ids
        : (current?.invited_user_ids || [])
    ),
    is_private: entry.is_private !== undefined ? (entry.is_private ? 1 : 0) : (current?.is_private ? 1 : 0),
    auto_delete_enabled:
      entry.auto_delete_enabled !== undefined
        ? (entry.auto_delete_enabled ? 1 : 0)
        : (current?.auto_delete_enabled ? 1 : 0),
    created_at: current?.created_at || now,
    updated_at: now,
    last_empty_at:
      entry.last_empty_at !== undefined
        ? entry.last_empty_at
        : (current?.last_empty_at || null)
  });

  return getPrivateVcByChannelId(entry.channel_id || current?.channel_id);
}

function deletePrivateVcByChannelId(channelId) {
  deletePrivateVcByChannelIdStmt.run(String(channelId));
  return null;
}

// ---------- FORTNITE LINK HELPERS ----------

function getFortniteLink(userId) {
  return getFortniteLinkStmt.get(userId) || null;
}

function getFortniteLinkByEpic(epicUsername) {
  if (!epicUsername) return null;
  return getFortniteLinkByEpicStmt.get(epicUsername) || null;
}

function setFortniteLink(userId, epicUsername = null, verified = false, acceptedRulesAt = null) {
  const now = Date.now();
  const current = getFortniteLink(userId);

  upsertFortniteLinkStmt.run({
    user_id: userId,
    epic_username:
      epicUsername !== null
        ? String(epicUsername || "").trim()
        : (current?.epic_username || null),
    verified: verified ? 1 : 0,
    verified_at: verified ? now : null,
    accepted_rules_at:
      acceptedRulesAt !== null
        ? acceptedRulesAt
        : (current?.accepted_rules_at || null),
    updated_at: now
  });

  return getFortniteLink(userId);
}

function acceptFortniteRules(userId) {
  const now = Date.now();
  const current = getFortniteLink(userId);

  upsertFortniteLinkStmt.run({
    user_id: userId,
    epic_username: current?.epic_username || null,
    verified: current?.verified ? 1 : 0,
    verified_at: current?.verified_at || null,
    accepted_rules_at: now,
    updated_at: now
  });

  return getFortniteLink(userId);
}

function verifyFortniteLink(userId) {
  const current = getFortniteLink(userId);

  if (!current) return null;

  return setFortniteLink(
    userId,
    current.epic_username,
    true,
    current.accepted_rules_at || null
  );
}

function unverifyFortniteLink(userId) {
  const current = getFortniteLink(userId);

  if (!current) return null;

  return setFortniteLink(
    userId,
    current.epic_username,
    false,
    current.accepted_rules_at || null
  );
}

function deleteFortniteLink(userId) {
  deleteFortniteLinkStmt.run(userId);
  return null;
}

// ---------- FORTNITE QUEUE HELPERS ----------

function isInFortniteQueue(userId) {
  return !!getFortniteQueueEntryStmt.get(userId);
}

function addToFortniteQueue(userId) {
  insertFortniteQueueEntryStmt.run(userId, Date.now());
  return listFortniteQueue();
}

function removeFromFortniteQueue(userId) {
  deleteFortniteQueueEntryStmt.run(userId);
  return listFortniteQueue();
}

function clearFortniteQueue() {
  clearFortniteQueueStmt.run();
  clearFortniteGuestQueueStmt.run();
  return [];
}

function makeGuestId(name, epicUsername) {
  return `guest:${String(name || "").trim().toLowerCase()}::${String(epicUsername || "")
    .trim()
    .toLowerCase()}`;
}

function addGuestToFortniteQueue(guestName, epicUsername) {
  const safeName = String(guestName || "").trim();
  const safeEpic = String(epicUsername || "").trim();

  if (!safeName || !safeEpic) {
    throw new Error("Guest name and Epic username are required.");
  }

  const guestId = makeGuestId(safeName, safeEpic);

  insertFortniteGuestQueueEntryStmt.run({
    guest_id: guestId,
    guest_name: safeName,
    epic_username: safeEpic,
    queued_at: Date.now()
  });

  return listFortniteQueue();
}

function getGuestFortniteQueueEntryById(guestId) {
  return getFortniteGuestQueueEntryByIdStmt.get(guestId) || null;
}

function getGuestFortniteQueueEntryByName(guestName) {
  if (!guestName) return null;
  return getFortniteGuestQueueEntryByNameStmt.get(guestName) || null;
}

function removeGuestFromFortniteQueueById(guestId) {
  deleteFortniteGuestQueueEntryByIdStmt.run(guestId);
  return listFortniteQueue();
}

function removeGuestFromFortniteQueueByName(guestName) {
  deleteFortniteGuestQueueEntryByNameStmt.run(guestName);
  return listFortniteQueue();
}

function listFortniteQueue() {
  const discordEntries = listFortniteQueueDiscordStmt.all().map(entry => ({
    entry_type: "discord",
    user_id: entry.user_id,
    guest_id: null,
    guest_name: null,
    epic_username: null,
    queued_at: entry.queued_at
  }));

  const guestEntries = listFortniteQueueGuestsStmt.all().map(entry => ({
    entry_type: "guest",
    user_id: null,
    guest_id: entry.guest_id,
    guest_name: entry.guest_name,
    epic_username: entry.epic_username,
    queued_at: entry.queued_at
  }));

  return [...discordEntries, ...guestEntries].sort((a, b) => a.queued_at - b.queued_at);
}

function getNextFortniteQueueUser() {
  const queue = listFortniteQueue();
  return queue.length ? queue[0] : null;
}

// ---------- FORTNITE QUEUE STATE HELPERS ----------

function getFortniteQueueState(key, fallback = null) {
  const row = getFortniteQueueStateValueStmt.get(key);
  if (!row) return fallback;

  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setFortniteQueueState(key, value) {
  const stored = typeof value === "string" ? value : JSON.stringify(value);
  setFortniteQueueStateValueStmt.run(key, stored);
  return getFortniteQueueState(key);
}

function deleteFortniteQueueState(key) {
  deleteFortniteQueueStateValueStmt.run(key);
  return null;
}

// ---------- FORTNITE STRIKE HELPERS ----------

function getFortniteStats(userId) {
  const row = getFortniteStatsStmt.get(userId);

  if (!row) {
    return {
      user_id: userId,
      strikes: 0,
      last_action_at: null
    };
  }

  return row;
}

function setFortniteStrikes(userId, strikes) {
  upsertFortniteStatsStmt.run({
    user_id: userId,
    strikes: Math.max(0, Number(strikes || 0)),
    last_action_at: Date.now()
  });

  return getFortniteStats(userId);
}

function addFortniteStrike(userId) {
  const current = getFortniteStats(userId);
  return setFortniteStrikes(userId, current.strikes + 1);
}

function clearFortniteStrikes(userId) {
  return setFortniteStrikes(userId, 0);
}

// ---------- FORTNITE DISCIPLINE / BAN HELPERS ----------

function getFortniteDiscipline(userId) {
  const row = getFortniteDisciplineStmt.get(userId);

  if (!row) {
    return {
      user_id: userId,
      ban_tier: 0,
      banned_until: null,
      blacklist_type: null,
      last_reason: null,
      updated_at: null
    };
  }

  return row;
}

function getFortniteBanLabel(banTier, blacklistType = null) {
  if (blacklistType === "appeal") return "Blacklisted with appeal";
  if (blacklistType === "no_appeal") return "Blacklisted with no appeal";

  switch (Number(banTier || 0)) {
    case 1:
      return "1 day ban";
    case 2:
      return "2 day ban";
    case 3:
      return "1 week ban";
    case 4:
      return "1 month ban";
    default:
      return "No ban";
  }
}

function getBanDurationMsForTier(banTier) {
  switch (Number(banTier || 0)) {
    case 1:
      return 1 * 24 * 60 * 60 * 1000;
    case 2:
      return 2 * 24 * 60 * 60 * 1000;
    case 3:
      return 7 * 24 * 60 * 60 * 1000;
    case 4:
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function setFortniteDiscipline(userId, banTier = 0, reason = null) {
  const now = Date.now();
  const numericTier = Math.max(0, Math.min(6, Number(banTier || 0)));

  let bannedUntil = null;
  let blacklistType = null;

  if (numericTier >= 5) {
    blacklistType = numericTier === 5 ? "appeal" : "no_appeal";
  } else {
    const duration = getBanDurationMsForTier(numericTier);
    bannedUntil = duration ? now + duration : null;
  }

  upsertFortniteDisciplineStmt.run({
    user_id: userId,
    ban_tier: numericTier,
    banned_until: bannedUntil,
    blacklist_type: blacklistType,
    last_reason: reason ? String(reason) : null,
    updated_at: now
  });

  return getFortniteDiscipline(userId);
}

function advanceFortniteBan(userId, reason = null) {
  const current = getFortniteDiscipline(userId);
  const nextTier = Math.min(6, Number(current.ban_tier || 0) + 1);
  return setFortniteDiscipline(userId, nextTier, reason);
}

function clearFortniteDiscipline(userId) {
  return setFortniteDiscipline(userId, 0, null);
}

function isFortniteBanned(userId) {
  const discipline = getFortniteDiscipline(userId);
  const now = Date.now();

  if (discipline.blacklist_type === "appeal" || discipline.blacklist_type === "no_appeal") {
    return {
      active: true,
      discipline,
      label: getFortniteBanLabel(discipline.ban_tier, discipline.blacklist_type)
    };
  }

  if (discipline.banned_until && Number(discipline.banned_until) > now) {
    return {
      active: true,
      discipline,
      label: getFortniteBanLabel(discipline.ban_tier, discipline.blacklist_type)
    };
  }

  return {
    active: false,
    discipline,
    label: "No ban"
  };
}

const listChecklistItemsStmt = db.prepare(`
  SELECT id, text, created_by, created_at, updated_at
  FROM checklist_items
  ORDER BY id ASC
`);

const createChecklistItemStmt = db.prepare(`
  INSERT INTO checklist_items (text, created_by, created_at, updated_at)
  VALUES (@text, @created_by, @created_at, @updated_at)
`);

const deleteChecklistItemStmt = db.prepare(`
  DELETE FROM checklist_items
  WHERE id = ?
`);

const getChecklistItemByIdStmt = db.prepare(`
  SELECT id, text, created_by, created_at, updated_at
  FROM checklist_items
  WHERE id = ?
`);

const upsertChecklistPanelStmt = db.prepare(`
  INSERT INTO checklist_panels (message_id, channel_id, guild_id, updated_at)
  VALUES (@message_id, @channel_id, @guild_id, @updated_at)
  ON CONFLICT(message_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    guild_id = excluded.guild_id,
    updated_at = excluded.updated_at
`);

const listChecklistPanelsStmt = db.prepare(`
  SELECT message_id, channel_id, guild_id, updated_at
  FROM checklist_panels
  ORDER BY updated_at DESC
`);

const deleteChecklistPanelStmt = db.prepare(`
  DELETE FROM checklist_panels
  WHERE message_id = ?
`);

function listChecklistItems() {
  return listChecklistItemsStmt.all();
}

function createChecklistItem(text, createdBy = null) {
  const now = Date.now();
  const info = createChecklistItemStmt.run({
    text: String(text || "").trim(),
    created_by: createdBy ? String(createdBy) : null,
    created_at: now,
    updated_at: now
  });
  return getChecklistItemByIdStmt.get(info.lastInsertRowid);
}

function deleteChecklistItem(id) {
  return deleteChecklistItemStmt.run(id);
}

function getChecklistItemById(id) {
  return getChecklistItemByIdStmt.get(id) || null;
}

function upsertChecklistPanel(panel = {}) {
  upsertChecklistPanelStmt.run({
    message_id: String(panel.message_id || ""),
    channel_id: String(panel.channel_id || ""),
    guild_id: panel.guild_id ? String(panel.guild_id) : null,
    updated_at: Date.now()
  });
}

function listChecklistPanels() {
  return listChecklistPanelsStmt.all();
}

function deleteChecklistPanel(messageId) {
  return deleteChecklistPanelStmt.run(String(messageId || ""));
}

// ---------- EXPORTS ----------

module.exports = {
  db,

  // user stats
  getUserStats,
  setUserStats,
  addStrike,
  clearUserStats,

  // user status
  getUserStatus,
  setUserStatus,
  clearUserStatus,

  // mod interest
  getModInterest,
  setModInterest,

  // role helpers
  userHasRole,
  userHasAnyRole,

  // tyrone cache
  normalizeQuestionKey,
  getTyroneCachedAnswer,
  setTyroneCachedAnswer,
  getTyroneCacheStats,
  listTyroneCache,
  clearTyroneCache,
  deleteTyroneCacheByKey,
  getTyroneSetting,
  listTyroneSettings,
  setTyroneSetting,
  setManyTyroneSettings,
  getAppSetting,
  listAppSettings,
  setAppSetting,
  setManyAppSettings,
  listTyroneFaq,
  getTyroneFaqById,
  createTyroneFaq,
  updateTyroneFaq,
  deleteTyroneFaq,
  countTyroneFaq,
  logTyroneEvent,
  listTyroneEvents,
  logTyroneSeenMessage,
  updateTyroneSeenMessageOutcome,
  listTyroneSeenMessages,
  getTyroneSeenMessageById,
  logTyroneResponse,
  listTyroneResponseLogs,
  getTyroneResponseLogById,
  findRecentTyroneResponseLog,
  listTyroneCorrections,
  getTyroneCorrectionById,
  createTyroneCorrection,
  updateTyroneCorrection,
  deleteTyroneCorrection,
  createTyroneReport,
  updateTyroneReport,
  listTyroneReports,
  getTyroneReportById,
  getPrivateVcByChannelId,
  listPrivateVcChannels,
  upsertPrivateVc,
  deletePrivateVcByChannelId,
  listChecklistItems,
  createChecklistItem,
  deleteChecklistItem,
  getChecklistItemById,
  upsertChecklistPanel,
  listChecklistPanels,
  deleteChecklistPanel,

  // fortnite links
  getFortniteLink,
  getFortniteLinkByEpic,
  setFortniteLink,
  acceptFortniteRules,
  verifyFortniteLink,
  unverifyFortniteLink,
  deleteFortniteLink,

  // fortnite queue
  isInFortniteQueue,
  addToFortniteQueue,
  removeFromFortniteQueue,
  clearFortniteQueue,
  listFortniteQueue,
  getNextFortniteQueueUser,
  addGuestToFortniteQueue,
  getGuestFortniteQueueEntryById,
  getGuestFortniteQueueEntryByName,
  removeGuestFromFortniteQueueById,
  removeGuestFromFortniteQueueByName,

  // fortnite queue state
  getFortniteQueueState,
  setFortniteQueueState,
  deleteFortniteQueueState,

  // fortnite strikes
  getFortniteStats,
  setFortniteStrikes,
  addFortniteStrike,
  clearFortniteStrikes,

  // fortnite discipline / bans
  getFortniteDiscipline,
  getFortniteBanLabel,
  setFortniteDiscipline,
  advanceFortniteBan,
  clearFortniteDiscipline,
  isFortniteBanned
};
