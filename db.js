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
// ---------- TEXT COMMAND HANDLER (Tyrone maintenance) ----------

async function handleMessage(message, { client }) {
  // Ignore bots
  if (message.author.bot) return;

  const content = (message.content || "").trim();
  const lower = content.toLowerCase();

  // We only care about these two text commands here
  const isCleanup = lower.startsWith("!tyrone-cleanup");
  const isStaffLogs = lower.startsWith("!tyrone-staff-logs");

  if (!isCleanup && !isStaffLogs) return;

  // Only allow in the configured maintenance channel
  if (message.channelId !== TYRONE_MAINTENANCE_CHANNEL_ID) {
    return;
  }

  // Only allow certain roles to run these commands
  const member = message.member;
  if (!userHasAnyRole(member, TYRONE_MAINTENANCE_ALLOWED_ROLE_IDS)) {
    await message.reply("You do not have permission to use this command.");
    return;
  }

  if (isCleanup) {
    await runTyroneCleanup(message, { client });
  } else if (isStaffLogs) {
    await runStaffLogsExport(message, { client });
  }
}

// ---------- HELP: split array into chunks ----------

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------- IMPLEMENTATION: !tyrone-cleanup (existing behavior stub) ----------
// NOTE: If you already have a more advanced cleanup implementation, you can
// merge that logic into here. This version just shows a minimal placeholder.

async function runTyroneCleanup(message, { client }) {
  const archiveChannel = await client.channels
    .fetch(TYRONE_ARCHIVE_CHANNEL_ID)
    .catch(() => null);

  if (!archiveChannel || !archiveChannel.isTextBased()) {
    await message.reply(
      "Tyrone archive channel is invalid or missing. Ask the owner to fix it."
    );
    return;
  }

  await message.reply("Starting Tyrone cleanup. This may take a bit.");

  const sourceChannel = message.channel;
  const tyroneMessages = [];

  let lastId = null;
  let done = false;
  let loops = 0;

  while (!done && loops < 20) {
    loops += 1;
    const batch = await sourceChannel.messages.fetch({
      limit: 100,
      before: lastId || undefined
    });

    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      // Messages either sent by Tyrone (the bot),
      // or messages that used !tyrone / !tytest in this channel
      const isFromTyrone = msg.author.id === client.user.id;
      const isTyroneCommand =
        (msg.content || "").toLowerCase().startsWith("!tyrone") ||
        (msg.content || "").toLowerCase().startsWith("!tytest");

      if (isFromTyrone || isTyroneCommand) {
        tyroneMessages.push(msg);
      }
    }

    lastId = batch.last().id;
    if (batch.size < 100) {
      done = true;
    }
  }

  tyroneMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  await archiveChannel.send(
    `Tyrone cleanup run by <@${message.author.id}> in <#${sourceChannel.id}>.\n` +
      `Total messages moved: **${tyroneMessages.length}**`
  );

  const chunks = chunkArray(tyroneMessages, 15);
  for (const chunk of chunks) {
    const lines = chunk.map(m => {
      const ts = `<t:${Math.floor(m.createdTimestamp / 1000)}:f>`;
      const content =
        m.content && m.content.length > 0
          ? m.content
          : "[no text content / embed / attachment]";
      return `**${m.author.tag}** (${m.author.id}) at ${ts}:\n${content}`;
    });

    await archiveChannel.send(lines.join("\n\n"));
  }

  // Optionally delete original messages (comment out if you do NOT want this)
  try {
    await sourceChannel.bulkDelete(
      tyroneMessages.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000), // Discord hard limit 14 days
      true
    );
  } catch (err) {
    console.error("Tyrone cleanup bulkDelete error:", err);
  }

  await message.channel.send(
    `Tyrone cleanup finished. Moved **${tyroneMessages.length}** messages to <#${TYRONE_ARCHIVE_CHANNEL_ID}>.`
  );
}

// ---------- IMPLEMENTATION: !tyrone-staff-logs ----------

async function runStaffLogsExport(message, { client }) {
  const sourceChannel = message.channel;

  const logChannel = await client.channels
    .fetch(STAFF_LOG_ARCHIVE_CHANNEL_ID)
    .catch(() => null);

  if (!logChannel || !logChannel.isTextBased()) {
    await message.reply(
      "Staff log channel is invalid or missing. Ask the owner to fix it."
    );
    return;
  }

  await message.reply(
    "Starting staff log export for this channel. This may take a bit."
  );

  const staffMessages = [];
  let lastId = null;
  let done = false;
  let loops = 0;

  // Walk backwards through channel history
  while (!done && loops < 20) {
    loops += 1;
    const batch = await sourceChannel.messages.fetch({
      limit: 100,
      before: lastId || undefined
    });

    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      const member = msg.member;
      if (
        member &&
        member.roles &&
        member.roles.cache.has(STAFF_LOG_ROLE_ID)
      ) {
        staffMessages.push(msg);
      }
    }

    lastId = batch.last().id;
    if (batch.size < 100) {
      done = true;
    }
  }

  staffMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  await logChannel.send(
    `Staff log export run by <@${message.author.id}> from <#${sourceChannel.id}>.\n` +
      `Total staff messages found: **${staffMessages.length}**`
  );

  const chunks = chunkArray(staffMessages, 20);

  for (const chunk of chunks) {
    const lines = chunk.map(m => {
      const ts = `<t:${Math.floor(m.createdTimestamp / 1000)}:f>`;
      const content =
        m.content && m.content.length > 0
          ? m.content
          : "[no text content / embed / attachment]";

      return `**${m.author.tag}** (${m.author.id}) at ${ts}:\n"${content}"`;
    });

    await logChannel.send(lines.join("\n\n"));
  }

  await message.channel.send(
    `Staff log export finished. Copied **${staffMessages.length}** messages to <#${STAFF_LOG_ARCHIVE_CHANNEL_ID}>.`
  );
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
  userHasAnyRole
};

