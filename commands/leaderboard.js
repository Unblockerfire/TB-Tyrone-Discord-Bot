// commands/leaderboard.js
const fs = require("fs");
const path = require("path");
const { EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");

// ---------- CONFIG ----------
const SETUP_CHANNEL_ID = "1479295934646059069";
const DISPLAY_CHANNEL_ID = "1478919882463772846";
const OWNER_ROLE_ID = "1113158001604427966";
const HEAD_ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";
const LEADERBOARD_MANAGER_ROLE_ID = "1113090317592309800";

const COIN_RANK_ROLE_IDS = {
  1: "1491999232259788870",
  2: "1491999293953802270",
  3: "1491999359913689109"
};

const LIKE_RANK_ROLE_IDS = {
  1: "1491998984674345032",
  2: "1491999068707360850",
  3: "1491999128148905984"
};

const DATA_PATH = path.join(__dirname, "..", "leaderboard-data.json");
const DATA_BACKUP_PATH = path.join(__dirname, "..", "leaderboard-data.backup.json");
const DATA_TEMP_PATH = path.join(__dirname, "..", "leaderboard-data.tmp.json");
const SETUP_MESSAGE_SETTING_KEY = "leaderboard.setup_message_id";
const DISPLAY_MESSAGE_SETTING_KEY = "leaderboard.display_message_id";
const LEGACY_JSON_IMPORT_SETTING_KEY = "leaderboard.legacy_json_imported_at";

function normalizeDataShape(parsed = {}) {
  return {
    setupMessageId: parsed.setupMessageId || null,
    displayMessageId: parsed.displayMessageId || null,
    entries: Array.isArray(parsed.entries) ? parsed.entries : []
  };
}

function tryReadData(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizeDataShape(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

// ---------- DATA ----------
function loadJsonData() {
  const primary = tryReadData(DATA_PATH);
  if (primary) return primary;

  const backup = tryReadData(DATA_BACKUP_PATH);
  if (backup) {
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(backup, null, 2));
    } catch {}
    return backup;
  }

  return { setupMessageId: null, displayMessageId: null, entries: [] };
}

function loadData(dbStore = null) {
  if (dbStore?.listLeaderboardEntries && dbStore?.getAppSetting) {
    const legacyImported = dbStore.getAppSetting(LEGACY_JSON_IMPORT_SETTING_KEY);
    let entries = dbStore.listLeaderboardEntries();

    if (!legacyImported) {
      const legacy = loadJsonData();
      if (legacy.entries.length && dbStore.importLeaderboardEntries) {
        const importedCount = dbStore.importLeaderboardEntries(legacy.entries);
        console.log(
          "[Leaderboard] Imported legacy JSON entries into SQLite",
          JSON.stringify({ imported_count: importedCount })
        );
        entries = dbStore.listLeaderboardEntries();
      }

      if (legacy.setupMessageId && !dbStore.getAppSetting(SETUP_MESSAGE_SETTING_KEY)) {
        dbStore.setAppSetting(SETUP_MESSAGE_SETTING_KEY, legacy.setupMessageId);
      }

      if (legacy.displayMessageId && !dbStore.getAppSetting(DISPLAY_MESSAGE_SETTING_KEY)) {
        dbStore.setAppSetting(DISPLAY_MESSAGE_SETTING_KEY, legacy.displayMessageId);
      }

      dbStore.setAppSetting(LEGACY_JSON_IMPORT_SETTING_KEY, String(Date.now()));
    }

    return {
      setupMessageId: dbStore.getAppSetting(SETUP_MESSAGE_SETTING_KEY)?.value || null,
      displayMessageId: dbStore.getAppSetting(DISPLAY_MESSAGE_SETTING_KEY)?.value || null,
      entries
    };
  }

  return loadJsonData();
}

function saveData(data, dbStore = null) {
  const normalized = normalizeDataShape(data);

  if (dbStore?.replaceLeaderboardEntries && dbStore?.setAppSetting) {
    dbStore.replaceLeaderboardEntries(normalized.entries);
    if (normalized.setupMessageId) dbStore.setAppSetting(SETUP_MESSAGE_SETTING_KEY, normalized.setupMessageId);
    if (normalized.displayMessageId) dbStore.setAppSetting(DISPLAY_MESSAGE_SETTING_KEY, normalized.displayMessageId);
    return;
  }

  const payload = JSON.stringify(normalized, null, 2);

  if (fs.existsSync(DATA_PATH)) {
    try {
      fs.copyFileSync(DATA_PATH, DATA_BACKUP_PATH);
    } catch {}
  }

  fs.writeFileSync(DATA_TEMP_PATH, payload);
  fs.renameSync(DATA_TEMP_PATH, DATA_PATH);
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if ((b.coins || 0) !== (a.coins || 0)) {
      return (b.coins || 0) - (a.coins || 0);
    }

    if ((b.likes || 0) !== (a.likes || 0)) {
      return (b.likes || 0) - (a.likes || 0);
    }

    return String(a.userId || "").localeCompare(String(b.userId || ""));
  });
}

function sortEntriesByMetric(entries, metric) {
  return [...entries].sort((a, b) => {
    if ((b?.[metric] || 0) !== (a?.[metric] || 0)) {
      return (b?.[metric] || 0) - (a?.[metric] || 0);
    }
    if ((b?.coins || 0) !== (a?.coins || 0)) {
      return (b?.coins || 0) - (a?.coins || 0);
    }
    if ((b?.likes || 0) !== (a?.likes || 0)) {
      return (b?.likes || 0) - (a?.likes || 0);
    }
    return String(a.userId || "").localeCompare(String(b.userId || ""));
  });
}

function findEntry(entries, userId) {
  return entries.find(e => e.userId === userId) || null;
}

function ensureEntry(entries, userId) {
  let entry = findEntry(entries, userId);

  if (!entry) {
    entry = {
      userId,
      coins: 0,
      likes: 0
    };
    entries.push(entry);
  }

  if (!Number.isInteger(entry.coins)) entry.coins = Number(entry.coins || 0);
  if (!Number.isInteger(entry.likes)) entry.likes = Number(entry.likes || 0);

  return entry;
}

function progressBar(value, max) {
  const size = 10;
  const safeMax = max > 0 ? max : 1;
  const filled = Math.max(0, Math.min(size, Math.round((value / safeMax) * size)));
  return "█".repeat(filled) + "░".repeat(size - filled);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function canManageLeaderboard(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
  return [OWNER_ROLE_ID, HEAD_ADMIN_ROLE_ID].filter(Boolean).some(roleId => member.roles?.cache?.has(roleId));
}

function canAddToLeaderboard(member) {
  return canManageLeaderboard(member) || !!member?.roles?.cache?.has(LEADERBOARD_MANAGER_ROLE_ID);
}

function canRunLeaderboardCommand(member, commandName) {
  if (canManageLeaderboard(member)) return true;

  return (
    canAddToLeaderboard(member) &&
    (commandName === "leaderboard-add" || commandName === "leaderboard-add-likes")
  );
}

function isLeaderboardDisplayMessage(message, botUserId) {
  if (!message) return false;
  if (botUserId && message.author?.id !== botUserId) return false;
  return message.embeds?.some(embed => embed.title === "🏆 Live Stream Leaderboard") || false;
}

function isLeaderboardSetupMessage(message, botUserId) {
  if (!message) return false;
  if (botUserId && message.author?.id !== botUserId) return false;
  return message.embeds?.some(embed => embed.title === "🛠 Leaderboard Control Panel") || false;
}

async function deleteDuplicateLeaderboardMessages(channel, currentMessageId, matcher, botUserId) {
  if (!channel?.isTextBased?.()) return 0;

  let deleted = 0;
  const recentMessages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!recentMessages) return 0;

  for (const message of recentMessages.values()) {
    if (currentMessageId && message.id === currentMessageId) continue;
    if (!matcher(message, botUserId)) continue;
    await message.delete().catch(() => null);
    deleted += 1;
  }

  return deleted;
}

async function syncRankGroupRoles(guild, rankedEntries, roleIdMap, metricLabel) {
  const roleAssignments = Object.entries(roleIdMap).map(([rank, roleId]) => ({
    rank: Number(rank),
    roleId,
    targetUserId: rankedEntries[Number(rank) - 1]?.userId || null
  }));

  const allMembers = await guild.members.fetch().catch(() => null);
  const guildMembers = allMembers ? [...allMembers.values()] : [];
  const summary = [];

  for (const assignment of roleAssignments) {
    const role = guild.roles.cache.get(assignment.roleId);
    if (!role) {
      summary.push({ metric: metricLabel, rank: assignment.rank, role_missing: true, role_id: assignment.roleId });
      continue;
    }

    let removed = 0;
    let added = 0;

    for (const member of guildMembers) {
      if (!member.roles.cache.has(role.id)) continue;
      if (assignment.targetUserId && member.id === assignment.targetUserId) continue;
      if (!member.manageable) continue;
      await member.roles.remove(role.id, `Leaderboard ${metricLabel} rank sync`).catch(() => null);
      removed += 1;
    }

    if (assignment.targetUserId) {
      const targetMember = guildMembers.find(member => member.id === assignment.targetUserId)
        || await guild.members.fetch(assignment.targetUserId).catch(() => null);
      if (targetMember && targetMember.manageable && !targetMember.roles.cache.has(role.id)) {
        await targetMember.roles.add(role.id, `Leaderboard ${metricLabel} rank sync`).catch(() => null);
        added += 1;
      }
    }

    summary.push({
      metric: metricLabel,
      rank: assignment.rank,
      role_id: assignment.roleId,
      target_user_id: assignment.targetUserId,
      added,
      removed
    });
  }

  return summary;
}

async function syncLeaderboardRankRoles(guild, entries) {
  const coinRanking = sortEntriesByMetric(entries, "coins").filter(entry => Number(entry.coins || 0) > 0);
  const likeRanking = sortEntriesByMetric(entries, "likes").filter(entry => Number(entry.likes || 0) > 0);

  const coinSummary = await syncRankGroupRoles(guild, coinRanking, COIN_RANK_ROLE_IDS, "coins");
  const likeSummary = await syncRankGroupRoles(guild, likeRanking, LIKE_RANK_ROLE_IDS, "likes");

  console.log(
    "[Leaderboard] Rank roles synced",
    JSON.stringify({
      coin_summary: coinSummary,
      like_summary: likeSummary
    })
  );

  return {
    coinSummary,
    likeSummary
  };
}

// ---------- EMBEDS ----------
function buildDisplayEmbed(entries) {
  const sorted = sortEntries(entries).slice(0, 10);
  const maxCoins = sorted[0]?.coins || 1;

  const lines = sorted.map((e, i) => {
    const medal =
      i === 0 ? "🥇" :
      i === 1 ? "🥈" :
      i === 2 ? "🥉" :
      `#${i + 1}`;

    return (
      `${medal} <@${e.userId}>\n` +
      `${progressBar(e.coins || 0, maxCoins)}\n` +
      `🪙 **${formatNumber(e.coins)} coins**\n` +
      `❤️ **${formatNumber(e.likes)} likes**`
    );
  });

  return new EmbedBuilder()
    .setTitle("🏆 Live Stream Leaderboard")
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n\n") || "No leaderboard data yet.")
    .setFooter({ text: "Public leaderboard • auto updates" })
    .setTimestamp();
}

function buildSetupEmbed(entries) {
  const sorted = sortEntries(entries).slice(0, 10);

  const lines = sorted.map((e, i) =>
    `#${i + 1} <@${e.userId}> — 🪙 ${formatNumber(e.coins)} | ❤️ ${formatNumber(e.likes)}`
  );

  return new EmbedBuilder()
    .setTitle("🛠 Leaderboard Control Panel")
    .setColor(0x3498db)
    .setDescription(
      `Edit the leaderboard from this channel.\n\n` +
      `**Coins commands**\n` +
      `• \`/leaderboard-add\`\n` +
      `• \`/leaderboard-set\`\n` +
      `• \`/leaderboard-remove\`\n\n` +
      `**Likes commands**\n` +
      `• \`/leaderboard-add-likes\`\n` +
      `• \`/leaderboard-set-likes\`\n\n` +
      `**Other**\n` +
      `• \`/leaderboard-reset\`\n` +
      `• \`/leaderboard-update\`\n\n` +
      `Public leaderboard updates automatically.`
    )
    .addFields({
      name: "Preview",
      value: lines.join("\n") || "No entries yet."
    })
    .setFooter({ text: "Edit here • display updates there" })
    .setTimestamp();
}

// ---------- SYNC ----------
async function syncLeaderboard(guild, dbStore = null) {
  const data = loadData(dbStore);

  const setupChannel = await guild.channels.fetch(SETUP_CHANNEL_ID).catch(() => null);
  const displayChannel = await guild.channels.fetch(DISPLAY_CHANNEL_ID).catch(() => null);

  if (!setupChannel || !setupChannel.isTextBased()) {
    throw new Error("Setup leaderboard channel is invalid or missing.");
  }

  if (!displayChannel || !displayChannel.isTextBased()) {
    throw new Error("Display leaderboard channel is invalid or missing.");
  }

  const setupEmbed = buildSetupEmbed(data.entries);
  const displayEmbed = buildDisplayEmbed(data.entries);

  let setupMsg = null;
  if (data.setupMessageId) {
    setupMsg = await setupChannel.messages.fetch(data.setupMessageId).catch(() => null);
  }

  if (setupMsg) {
    await setupMsg.edit({ embeds: [setupEmbed] });
  } else {
    await deleteDuplicateLeaderboardMessages(
      setupChannel,
      null,
      isLeaderboardSetupMessage,
      guild.client.user?.id
    );
    setupMsg = await setupChannel.send({ embeds: [setupEmbed] });
    data.setupMessageId = setupMsg.id;
  }

  let displayMsg = null;
  if (data.displayMessageId) {
    displayMsg = await displayChannel.messages.fetch(data.displayMessageId).catch(() => null);
  }

  if (displayMsg) {
    await displayMsg.edit({ embeds: [displayEmbed] });
  } else {
    await deleteDuplicateLeaderboardMessages(
      displayChannel,
      null,
      isLeaderboardDisplayMessage,
      guild.client.user?.id
    );
    displayMsg = await displayChannel.send({ embeds: [displayEmbed] });
    data.displayMessageId = displayMsg.id;
  }

  const deletedSetupDuplicates = await deleteDuplicateLeaderboardMessages(
    setupChannel,
    setupMsg?.id || null,
    isLeaderboardSetupMessage,
    guild.client.user?.id
  );
  const deletedDisplayDuplicates = await deleteDuplicateLeaderboardMessages(
    displayChannel,
    displayMsg?.id || null,
    isLeaderboardDisplayMessage,
    guild.client.user?.id
  );

  const rankRoleSync = await syncLeaderboardRankRoles(guild, data.entries).catch(error => {
    console.error("[Leaderboard] Rank role sync failed:", error);
    return null;
  });

  saveData(data, dbStore);
  console.log(
    "[Leaderboard] Sync complete",
    JSON.stringify({
      setup_message_id: data.setupMessageId,
      display_message_id: data.displayMessageId,
      deleted_setup_duplicates: deletedSetupDuplicates,
      deleted_display_duplicates: deletedDisplayDuplicates,
      rank_role_sync_ok: !!rankRoleSync,
      entry_count: data.entries.length
    })
  );
}

// ---------- COMMAND HANDLER ----------
async function handleInteraction(interaction, { db } = {}) {
  if (!interaction.isChatInputCommand()) return false;

  const cmd = interaction.commandName;

  if (![
    "setup-leaderboard",
    "leaderboard-add",
    "leaderboard-set",
    "leaderboard-remove",
    "leaderboard-add-likes",
    "leaderboard-set-likes",
    "leaderboard-reset",
    "leaderboard-update",
    "leaderboard-sync-roles"
  ].includes(cmd)) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true
    });
    return true;
  }

  if (!canRunLeaderboardCommand(interaction.member, cmd)) {
    await interaction.reply({
      content: "No permission.",
      ephemeral: true
    });
    return true;
  }

  if (interaction.channelId !== SETUP_CHANNEL_ID) {
    await interaction.reply({
      content: `Run this in <#${SETUP_CHANNEL_ID}>`,
      ephemeral: true
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const data = loadData(db);

  // setup
  if (cmd === "setup-leaderboard") {
    await syncLeaderboard(interaction.guild, db);

    await interaction.editReply("Leaderboard control panel + public display are now linked.");
    return true;
  }

  // add coins
  if (cmd === "leaderboard-add") {
    const user = interaction.options.getUser("user");
    const coins = interaction.options.getInteger("coins");

    if (!user || !Number.isInteger(coins) || coins <= 0) {
      await interaction.editReply("Provide a valid user and a positive coin amount.");
      return true;
    }

    const entry = ensureEntry(data.entries, user.id);
    entry.coins += coins;

    saveData(data, db);
    await syncLeaderboard(interaction.guild, db);

    await interaction.editReply(`Added **${formatNumber(coins)} coins** to ${user}\nNew total: **${formatNumber(entry.coins)} coins**`);

    return true;
  }

  // set coins
  if (cmd === "leaderboard-set") {
    const user = interaction.options.getUser("user");
    const coins = interaction.options.getInteger("coins");

    if (!user || !Number.isInteger(coins) || coins < 0) {
      await interaction.editReply("Provide a valid user and a coin total of 0 or more.");
      return true;
    }

    const entry = ensureEntry(data.entries, user.id);
    entry.coins = coins;

    // If both become 0, remove the entry
    if ((entry.coins || 0) === 0 && (entry.likes || 0) === 0) {
      data.entries = data.entries.filter(e => e.userId !== user.id);
    }

    saveData(data, db);
    await syncLeaderboard(interaction.guild, db);

    await interaction.editReply(`${user} now has **${formatNumber(coins)} coins**`);

    return true;
  }

  // remove coins
  if (cmd === "leaderboard-remove") {
    const user = interaction.options.getUser("user");
    const coins = interaction.options.getInteger("coins");

    if (!user || !Number.isInteger(coins) || coins <= 0) {
      await interaction.editReply("Provide a valid user and a positive coin amount to remove.");
      return true;
    }

    const entry = findEntry(data.entries, user.id);

    if (!entry) {
      await interaction.editReply("User not found.");
      return true;
    }

    entry.coins = Math.max(0, (entry.coins || 0) - coins);

    if ((entry.coins || 0) === 0 && (entry.likes || 0) === 0) {
      data.entries = data.entries.filter(e => e.userId !== user.id);
    }

    saveData(data, db);
    await syncLeaderboard(interaction.guild, db);

    await interaction.editReply(`Removed **${formatNumber(coins)} coins** from ${user}\nNew total: **${formatNumber(entry.coins || 0)} coins**`);

    return true;
  }

  // add likes
  if (cmd === "leaderboard-add-likes") {
    const user = interaction.options.getUser("user");
    const likes = interaction.options.getInteger("likes");

    if (!user || !Number.isInteger(likes) || likes <= 0) {
      await interaction.editReply("Provide a valid user and a positive like amount.");
      return true;
    }

    const entry = ensureEntry(data.entries, user.id);
    entry.likes += likes;

    saveData(data, db);
    await syncLeaderboard(interaction.guild, db);

    await interaction.editReply(`Added **${formatNumber(likes)} likes** to ${user}\nNew total: **${formatNumber(entry.likes)} likes**`);

    return true;
  }

  // set likes
  if (cmd === "leaderboard-set-likes") {
    const user = interaction.options.getUser("user");
    const likes = interaction.options.getInteger("likes");

    if (!user || !Number.isInteger(likes) || likes < 0) {
      await interaction.editReply("Provide a valid user and a like total of 0 or more.");
      return true;
    }

    const entry = ensureEntry(data.entries, user.id);
    entry.likes = likes;

    if ((entry.coins || 0) === 0 && (entry.likes || 0) === 0) {
      data.entries = data.entries.filter(e => e.userId !== user.id);
    }

    saveData(data, db);
    await syncLeaderboard(interaction.guild, db);

    await interaction.editReply(`${user} now has **${formatNumber(likes)} likes**`);

    return true;
  }

  // reset
  if (cmd === "leaderboard-reset") {
    const user = interaction.options.getUser("user");

    if (user) {
      const before = data.entries.length;
      data.entries = data.entries.filter(e => e.userId !== user.id);

      if (data.entries.length === before) {
        await interaction.editReply("User not found.");
        return true;
      }

      saveData(data, db);
      await syncLeaderboard(interaction.guild, db);

      await interaction.editReply(`Reset ${user} and removed them from the leaderboard.`);
      return true;
    }

    data.entries = [];
    saveData(data, db);
    await syncLeaderboard(interaction.guild, db);

    await interaction.editReply("Leaderboard reset.");

    return true;
  }

  // update
  if (cmd === "leaderboard-update") {
    await syncLeaderboard(interaction.guild, db);

    await interaction.editReply("Leaderboard refreshed.");

    return true;
  }

  if (cmd === "leaderboard-sync-roles") {
    const result = await syncLeaderboardRankRoles(interaction.guild, data.entries);
    await interaction.editReply(
      `Leaderboard rank roles synced ✅\n` +
        `Coins tracked: **${result.coinSummary.length}**\n` +
        `Likes tracked: **${result.likeSummary.length}**`
    );
    return true;
  }

  return false;
}

module.exports = {
  handleInteraction,
  syncLeaderboard,
  syncLeaderboardRankRoles
};
