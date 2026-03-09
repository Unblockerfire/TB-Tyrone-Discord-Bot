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

// fortnite_queue: users currently queued for party rotation
db.prepare(`
  CREATE TABLE IF NOT EXISTS fortnite_queue (
    user_id TEXT PRIMARY KEY,
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

const trimOldestTyroneCacheStmt = db.prepare(`
  DELETE FROM tyrone_ai_cache
  WHERE question_key IN (
    SELECT question_key
    FROM tyrone_ai_cache
    ORDER BY last_used_at ASC
    LIMIT ?
  )
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

// Fortnite queue
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

const listFortniteQueueStmt = db.prepare(`
  SELECT user_id, queued_at
  FROM fortnite_queue
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
  return [];
}

function listFortniteQueue() {
  return listFortniteQueueStmt.all();
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