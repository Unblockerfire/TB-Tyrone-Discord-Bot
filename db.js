// db.js
const Database = require("better-sqlite3");

// Create / open the database file
const db = new Database("tbsbot.db");

// ---------- TABLE SETUP ----------

// user_stats: strikes and warnings
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
  // Ignore duplicate-column errors, which means the column already exists.
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

// ---------- TYRONE AI CACHE TABLE ----------
db.prepare(`
  CREATE TABLE IF NOT EXISTS tyrone_ai_cache (
    question_key TEXT PRIMARY KEY,
    answer TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 0
  )
`).run();

// ---------- PREPARED STATEMENTS ----------

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

// ---------- TYRONE CACHE STATEMENTS ----------

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

// New signature supports clearAt too
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

// Returns string answer or null
function getTyroneCachedAnswer(question, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  const key = normalizeQuestionKey(question);
  if (!key) return null;

  const row = getTyroneCacheStmt.get(key);
  if (!row) return null;

  const now = Date.now();
  if (now - row.created_at > maxAgeMs) {
    // expired
    try {
      deleteTyroneCacheStmt.run(key);
    } catch {}
    return null;
  }

  // update usage stats
  try {
    touchTyroneCacheStmt.run(now, key);
  } catch {}

  return row.answer || null;
}

// Saves answer and trims table if needed
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

  // Trim cache if it grows too big
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
  setTyroneCachedAnswer
};