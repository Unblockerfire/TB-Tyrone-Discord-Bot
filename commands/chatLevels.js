const {
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");

const OWNER_ROLE_ID = "1113158001604427966";
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";

const LEVEL_ROLE_IDS = {
  1: "1492001596966568037",
  2: "1492001688352198847",
  3: "1492001792643432458",
  4: "1492001842119577640",
  5: "1492001918367694969"
};

const BOOST_ROLE_IDS = {
  1: "1492339290099814420",
  2: "1492339403895607347",
  3: "1492339441010868366",
  4: "1492339471545405531",
  5: "1492339504218902719",
  6: "1492339527753269259",
  7: "1492339561236267108",
  8: "1492339591120818276",
  9: "1492339661908082699",
  10: "1492339698234818560"
};

const LEVEL_THRESHOLDS = [
  { level: 5, min: 321, max: Infinity },
  { level: 4, min: 226, max: 320 },
  { level: 3, min: 151, max: 225 },
  { level: 2, min: 51, max: 150 },
  { level: 1, min: 17, max: 50 }
];

const XP_PER_MESSAGE_BY_LEVEL = {
  1: 1,
  2: 0.8,
  3: 0.65,
  4: 0.5,
  5: 0.35
};

const LEVEL_TIER_NAMES = {
  0: "Unranked",
  1: "Bronze",
  2: "Silver",
  3: "Gold",
  4: "Platinum",
  5: "Diamond"
};

const LEVEL_SYNC_COMMAND = "sync-level-roles";
const RANKS_SETUP_COMMAND = "setup-ranks";
const RANKS_LEADERBOARD_REFRESH_COMMAND = "ranks-refresh";
const RANKS_LEADERBOARD_CHANNEL_ID = "1478919882463772846";
const RANKS_LEADERBOARD_CHANNEL_KEY = "chat_levels.ranks_leaderboard_channel_id";
const RANKS_LEADERBOARD_MESSAGE_KEY = "chat_levels.ranks_leaderboard_message_id";
const RANKS_LEADERBOARD_REFRESH_MS = 60 * 1000;
const RANK_PROGRESS_BAR_SEGMENTS = 12;
const SPAM_BYPASS_ROLE_ID = "1112945506549768302";
const LOW_EFFORT_WINDOW_MS = 10 * 1000;
const LOW_EFFORT_WARNING_COUNT = 6;
const SPAM_STATE_TTL_MS = 5 * 60 * 1000;
const SPAM_TIMEOUTS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000
];
const RANK_REPLY_DELETE_MS = 2 * 60 * 1000;
const spamStates = new Map();
let ranksLeaderboardTicker = null;

function canManageLevels(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
  return [OWNER_ROLE_ID, ADMIN_ROLE_ID].filter(Boolean).some(roleId => member.roles?.cache?.has?.(roleId));
}

function getLevelForXp(xpTotal) {
  const xp = Math.max(0, Number(xpTotal || 0));
  const match = LEVEL_THRESHOLDS.find(item => xp >= item.min && xp <= item.max);
  return match?.level || 0;
}

function formatLevelBand(level) {
  const band = LEVEL_THRESHOLDS.find(item => item.level === level);
  if (!band) return "0-16 XP";
  if (band.max === Infinity) return `${band.min}+ XP`;
  return `${band.min}-${band.max} XP`;
}

function getTierNameForLevel(level) {
  return LEVEL_TIER_NAMES[level] || LEVEL_TIER_NAMES[0];
}

function getNextLevelBand(xpTotal) {
  const currentLevel = getLevelForXp(xpTotal);
  return LEVEL_THRESHOLDS
    .filter(item => item.level > currentLevel)
    .sort((a, b) => a.min - b.min)[0] || null;
}

function buildXpProgressBar(xpTotal) {
  const xp = Math.max(0, Number(xpTotal || 0));
  const nextBand = getNextLevelBand(xp);

  if (!nextBand) {
    return {
      label: "Max tier reached",
      bar: `[${"#".repeat(RANK_PROGRESS_BAR_SEGMENTS)}]`,
      value: `${formatXp(xp)} XP`
    };
  }

  const progress = Math.max(0, Math.min(1, xp / nextBand.min));
  let filled = Math.max(0, Math.min(RANK_PROGRESS_BAR_SEGMENTS, Math.round(progress * RANK_PROGRESS_BAR_SEGMENTS)));
  if (progress > 0 && filled === 0) filled = 1;
  const empty = RANK_PROGRESS_BAR_SEGMENTS - filled;

  return {
    label: `Progress to ${getTierNameForLevel(nextBand.level)}`,
    bar: `[${"#".repeat(filled)}${"-".repeat(empty)}]`,
    value: `${formatXp(xp)} / ${formatXp(nextBand.min)} XP`
  };
}

function formatXp(value) {
  const xp = Math.max(0, Number(value || 0));
  return Number.isInteger(xp) ? String(xp) : xp.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function getCurrentXpRateLevel(xpTotal) {
  return Math.max(1, getLevelForXp(xpTotal));
}

function getXpAwardForCurrentLevel(xpTotal) {
  return XP_PER_MESSAGE_BY_LEVEL[getCurrentXpRateLevel(xpTotal)] || XP_PER_MESSAGE_BY_LEVEL[1];
}

function getLevelForMessageCount(messageCount) {
  return getLevelForXp(messageCount);
}

function getLevelRoleIds() {
  return Object.values(LEVEL_ROLE_IDS);
}

function hasSpamBypassRoleOrHigher(member) {
  if (!member?.roles?.cache) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;

  const bypassRole = member.guild?.roles?.cache?.get(SPAM_BYPASS_ROLE_ID);
  if (!bypassRole) return member.roles.cache.has(SPAM_BYPASS_ROLE_ID);

  return member.roles.cache.some(role => role.id === SPAM_BYPASS_ROLE_ID || role.comparePositionTo(bypassRole) >= 0);
}

function getBoostTierForCount(boostCount) {
  const count = Math.max(0, Number(boostCount || 0));
  if (count >= 10) return 10;
  return count;
}

function getXpMultiplierForBoostCount(boostCount) {
  const tier = getBoostTierForCount(boostCount);
  if (!tier) return 1;
  return 1 + Math.min(tier, 10) * 0.05;
}

function getBoostBonusPercent(boostCount) {
  return Math.round((getXpMultiplierForBoostCount(boostCount) - 1) * 100);
}

function getBoostRoleIds() {
  return Object.values(BOOST_ROLE_IDS).filter(Boolean);
}

function detectActiveBoostCount(member) {
  if (!member?.premiumSinceTimestamp) return 0;

  const roleDerivedTier = Object.entries(BOOST_ROLE_IDS)
    .filter(([, roleId]) => roleId && member.roles?.cache?.has(roleId))
    .map(([tier]) => Number(tier))
    .sort((a, b) => b - a)[0];

  return roleDerivedTier || 1;
}

function getBoostStateForMember(member) {
  const activeBoostCount = detectActiveBoostCount(member);
  const boostTier = getBoostTierForCount(activeBoostCount);
  return {
    activeBoostCount,
    boostTier,
    xpMultiplier: getXpMultiplierForBoostCount(activeBoostCount)
  };
}

async function syncBoosterMilestoneRole(member, activeBoostCount) {
  if (!member?.roles?.cache) return { added: [], removed: [], skipped: true };

  const targetTier = getBoostTierForCount(activeBoostCount);
  const targetRoleId = targetTier ? BOOST_ROLE_IDS[targetTier] : null;
  const allBoostRoleIds = getBoostRoleIds();
  const currentRoleIds = new Set(member.roles.cache.map(role => role.id));
  const rolesToRemove = allBoostRoleIds.filter(roleId => roleId !== targetRoleId && currentRoleIds.has(roleId));
  const rolesToAdd = targetRoleId && !currentRoleIds.has(targetRoleId) ? [targetRoleId] : [];

  if (!rolesToAdd.length && !rolesToRemove.length) {
    return { added: [], removed: [], skipped: false };
  }

  const me = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has?.(PermissionsBitField.Flags.ManageRoles)) {
    return { added: [], removed: [], skipped: true, reason: "missing_manage_roles" };
  }

  const manageableRoleIds = [];
  for (const roleId of [...rolesToRemove, ...rolesToAdd]) {
    const role = member.guild.roles.cache.get(roleId) || await member.guild.roles.fetch(roleId).catch(() => null);
    if (!role || me.roles.highest.comparePositionTo(role) <= 0) continue;
    manageableRoleIds.push(roleId);
  }

  const removable = rolesToRemove.filter(roleId => manageableRoleIds.includes(roleId));
  const addable = rolesToAdd.filter(roleId => manageableRoleIds.includes(roleId));

  if (removable.length) {
    await member.roles.remove(removable, "Tyrone active boost milestone sync").catch(error => {
      console.error("[Chat Levels] Failed to remove boost milestone roles:", error);
    });
  }

  if (addable.length) {
    await member.roles.add(addable, "Tyrone active boost milestone sync").catch(error => {
      console.error("[Chat Levels] Failed to add boost milestone role:", error);
    });
  }

  return {
    added: addable,
    removed: removable,
    skipped: false,
    blocked: [...rolesToRemove, ...rolesToAdd].filter(roleId => !manageableRoleIds.includes(roleId))
  };
}

async function buildRanksLeaderboardEmbed(guild, profiles) {
  const rows = [];

  for (const [index, profile] of profiles.entries()) {
    const member = await guild.members.fetch(profile.user_id).catch(() => null);
    const displayName = member?.displayName || `<@${profile.user_id}>`;
    const level = getLevelForXp(profile.xp_total);
    const bonusPercent = getBoostBonusPercent(profile.active_boost_count);
    const medal =
      index === 0 ? "🥇" :
      index === 1 ? "🥈" :
      index === 2 ? "🥉" :
      `#${index + 1}`;

    rows.push(
      `${medal} **${displayName}**\n` +
        `XP: **${formatXp(profile.xp_total)}** • **${getTierNameForLevel(level)}** (Lv. ${level || 0}) • ` +
        `Boosts: **${profile.active_boost_count || 0}** • Bonus: **+${bonusPercent}%**`
    );
  }

  return new EmbedBuilder()
    .setTitle("⚡ XP Rank Leaderboard")
    .setColor(0xff73fa)
    .setDescription(rows.join("\n\n") || "No XP data yet. Valid chat messages will start filling this leaderboard.")
    .setFooter({ text: "Tyrone XP ranks • refreshes about once per minute" })
    .setTimestamp();
}

async function refreshRanksLeaderboard(client, db, guildId = null) {
  const targetGuilds = guildId
    ? [await client.guilds.fetch(guildId).catch(() => null)].filter(Boolean)
    : [...client.guilds.cache.values()];

  for (const guild of targetGuilds) {
    const channelId = db.getAppSetting?.(RANKS_LEADERBOARD_CHANNEL_KEY)?.value || RANKS_LEADERBOARD_CHANNEL_ID;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      console.warn("[Chat Levels] Ranks leaderboard channel missing", JSON.stringify({ guild_id: guild.id, channel_id: channelId }));
      continue;
    }

    const profiles = db.listTopChatLevelProfilesByGuild?.(guild.id, 10) || [];
    const embed = await buildRanksLeaderboardEmbed(guild, profiles);
    let messageId = db.getAppSetting?.(RANKS_LEADERBOARD_MESSAGE_KEY)?.value || null;
    let message = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;

    if (message) {
      await message.edit({ embeds: [embed] });
    } else {
      const recentMessages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
      if (recentMessages) {
        for (const recent of recentMessages.values()) {
          const isRanksBoard = recent.author?.id === client.user?.id
            && recent.embeds?.some(recentEmbed => recentEmbed.title === "⚡ XP Rank Leaderboard");
          if (isRanksBoard) await recent.delete().catch(() => null);
        }
      }

      message = await channel.send({ embeds: [embed] });
      db.setAppSetting?.(RANKS_LEADERBOARD_CHANNEL_KEY, channelId);
      db.setAppSetting?.(RANKS_LEADERBOARD_MESSAGE_KEY, message.id);
      messageId = message.id;
    }

    console.log(
      "[Chat Levels] Ranks leaderboard refreshed",
      JSON.stringify({
        guild_id: guild.id,
        channel_id: channelId,
        message_id: messageId,
        profile_count: profiles.length
      })
    );
  }
}

function startRanksLeaderboardTicker(client, db) {
  if (ranksLeaderboardTicker) return;

  ranksLeaderboardTicker = setInterval(() => {
    refreshRanksLeaderboard(client, db).catch(error => {
      console.error("[Chat Levels] Ranks leaderboard ticker failed:", error);
    });
  }, RANKS_LEADERBOARD_REFRESH_MS);

  refreshRanksLeaderboard(client, db).catch(error => {
    console.error("[Chat Levels] Initial ranks leaderboard refresh failed:", error);
  });
}

function normalizeSpamText(content) {
  return String(content || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}\p{Emoji_Presentation}\p{Emoji}\?!.,]/gu, "");
}

function isStopIntentMessage(content) {
  const normalized = String(content || "").toLowerCase().trim().replace(/[^\p{L}\p{N}\s']/gu, "");
  if (!normalized) return false;

  const stopPhrases = [
    "sorry",
    "my bad",
    "mb",
    "i will stop",
    "ill stop",
    "i'll stop",
    "i stop",
    "i wont spam",
    "i won't spam",
    "wont spam",
    "won't spam",
    "not spamming anymore",
    "i am done",
    "im done",
    "i'm done",
    "ok sorry",
    "okay sorry"
  ];

  return stopPhrases.some(phrase => normalized === phrase || normalized.includes(phrase));
}

function isLowEffortSpamCandidate(content) {
  const normalized = normalizeSpamText(content);
  if (!normalized) return false;
  if (normalized.length === 1) return true;

  const repeatedChar = normalized.length <= 6 && /^(.)(\1)+$/u.test(normalized);
  if (repeatedChar) return true;

  return false;
}

function getSpamStateKey(message) {
  return `${message.guildId}:${message.author.id}`;
}

function getSpamState(message) {
  const key = getSpamStateKey(message);
  const existing = spamStates.get(key);
  const now = Date.now();

  if (!existing || now - Number(existing.lastSeenAt || 0) > SPAM_STATE_TTL_MS) {
    const fresh = {
      timestamps: [],
      warned: false,
      consequenceCount: 0,
      lastSeenAt: now
    };
    spamStates.set(key, fresh);
    return fresh;
  }

  existing.lastSeenAt = now;
  return existing;
}

function resetSpamState(message, reason) {
  spamStates.delete(getSpamStateKey(message));
  console.log(
    "[Chat Levels] Spam state reset",
    JSON.stringify({
      guild_id: message.guildId,
      user_id: message.author.id,
      reason
    })
  );
}

function formatSpamDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "1 minute";
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

async function warnSpamUser(message, state) {
  state.warned = true;
  console.log(
    "[Chat Levels] Low-effort spam warning",
    JSON.stringify({
      guild_id: message.guildId,
      user_id: message.author.id,
      channel_id: message.channelId,
      burst_count: state.timestamps.length
    })
  );

  await message.reply({
    content:
      `${message.author}, please stop sending repeated low-effort messages. ` +
      "If that was a mistake, say `sorry` or `my bad` and I will reset the spam counter.",
    allowedMentions: { users: [message.author.id], repliedUser: false }
  }).catch(error => {
    console.error("[Chat Levels] Failed to send spam warning:", error);
  });
}

async function applySpamConsequence(message, state) {
  const index = Math.min(state.consequenceCount, SPAM_TIMEOUTS_MS.length - 1);
  const durationMs = SPAM_TIMEOUTS_MS[index];
  state.consequenceCount += 1;

  await message.delete().catch(() => null);

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.moderatable) {
    console.warn(
      "[Chat Levels] Could not timeout spam user",
      JSON.stringify({
        guild_id: message.guildId,
        user_id: message.author.id,
        channel_id: message.channelId,
        consequence_count: state.consequenceCount,
        reason: "member_not_moderatable"
      })
    );
    await message.channel.send({
      content:
        `${message.author}, you are still sending repeated low-effort spam. ` +
        "I could not timeout you, but staff may review this.",
      allowedMentions: { users: [message.author.id] }
    }).catch(() => null);
    return;
  }

  try {
    await member.timeout(durationMs, "Tyrone low-effort spam burst");
    console.log(
      "[Chat Levels] Applied spam timeout",
      JSON.stringify({
        guild_id: message.guildId,
        user_id: message.author.id,
        channel_id: message.channelId,
        duration_ms: durationMs,
        consequence_count: state.consequenceCount
      })
    );
    await message.channel.send({
      content:
        `${message.author} was timed out for **${formatSpamDuration(durationMs)}** for continuing low-effort spam.`,
      allowedMentions: { users: [message.author.id] }
    }).catch(() => null);
  } catch (error) {
    console.error("[Chat Levels] Failed to apply spam timeout:", error);
  }
}

async function handleSpamDetection(message) {
  if (!message?.guildId || message.author?.bot) return false;
  if (hasSpamBypassRoleOrHigher(message.member)) {
    if (spamStates.has(getSpamStateKey(message))) resetSpamState(message, "bypass_role_or_higher");
    return false;
  }

  if (isStopIntentMessage(message.content)) {
    resetSpamState(message, "stop_intent");
    return false;
  }

  if (!isLowEffortSpamCandidate(message.content)) {
    const state = spamStates.get(getSpamStateKey(message));
    if (state) {
      state.timestamps = state.timestamps.filter(timestamp => Date.now() - timestamp <= LOW_EFFORT_WINDOW_MS);
      state.lastSeenAt = Date.now();
      if (!state.timestamps.length && !state.warned) spamStates.delete(getSpamStateKey(message));
    }
    return false;
  }

  const state = getSpamState(message);
  const now = Date.now();
  state.timestamps = state.timestamps
    .filter(timestamp => now - timestamp <= LOW_EFFORT_WINDOW_MS)
    .concat(now);

  if (state.timestamps.length < LOW_EFFORT_WARNING_COUNT) {
    return true;
  }

  if (!state.warned) {
    await warnSpamUser(message, state);
    return true;
  }

  await applySpamConsequence(message, state);
  return true;
}

async function syncMemberLevelRoles(member, xpTotal) {
  if (!member?.manageable) {
    return {
      level: getLevelForXp(xpTotal),
      added: [],
      removed: [],
      skipped: true
    };
  }

  const targetLevel = getLevelForXp(xpTotal);
  const targetRoleId = targetLevel ? LEVEL_ROLE_IDS[targetLevel] : null;
  const allLevelRoleIds = getLevelRoleIds();
  const currentRoleIds = new Set(member.roles?.cache?.map(role => role.id) || []);

  const rolesToRemove = allLevelRoleIds.filter(roleId => roleId !== targetRoleId && currentRoleIds.has(roleId));
  const rolesToAdd = targetRoleId && !currentRoleIds.has(targetRoleId) ? [targetRoleId] : [];

  if (!rolesToAdd.length && !rolesToRemove.length) {
    return { level: targetLevel, added: [], removed: [], skipped: false };
  }

  if (rolesToRemove.length) {
    await member.roles.remove(rolesToRemove, "Tyrone chat level role sync");
  }

  if (rolesToAdd.length) {
    await member.roles.add(rolesToAdd, "Tyrone chat level role sync");
  }

  return {
    level: targetLevel,
    added: rolesToAdd,
    removed: rolesToRemove,
    skipped: false
  };
}

async function syncSingleMemberByProfile(guild, profile, db = null) {
  if (!guild || !profile?.user_id) return null;
  const member = await guild.members.fetch(profile.user_id).catch(() => null);
  if (!member) {
    return {
      user_id: profile.user_id,
      level: getLevelForXp(profile.xp_total),
      missing_member: true,
      added: [],
      removed: []
    };
  }

  const boostState = getBoostStateForMember(member);
  db?.updateChatLevelBoostState?.(guild.id, member.id, boostState);
  const result = await syncMemberLevelRoles(member, profile.xp_total);
  await syncBoosterMilestoneRole(member, boostState.activeBoostCount).catch(error => {
    console.error("[Chat Levels] Failed to sync booster roles during level sync:", error);
  });
  return {
    user_id: profile.user_id,
    level: result.level,
    boost_state: boostState,
    missing_member: false,
    skipped: !!result.skipped,
    added: result.added,
    removed: result.removed
  };
}

function getRankForUser(profiles, userId) {
  const index = profiles.findIndex(profile => profile.user_id === userId);
  return index >= 0 ? index + 1 : null;
}

function buildRankEmbed(user, member, profile, rank, totalProfiles) {
  const xpTotal = Number(profile?.xp_total || 0);
  const messageCount = Number(profile?.message_count || 0);
  const boostCount = Number(profile?.active_boost_count || 0);
  const level = getLevelForXp(xpTotal);
  const boostBonus = getBoostBonusPercent(boostCount);
  const displayName = member?.displayName || user.username || user.tag || "Unknown user";
  const tierName = getTierNameForLevel(level);
  const progress = buildXpProgressBar(xpTotal);

  return new EmbedBuilder()
    .setTitle(`⚡ ${displayName} • ${tierName}`)
    .setColor(0xff73fa)
    .setDescription(
      `Server place: **${rank ? `#${rank} of ${totalProfiles}` : "Unranked"}** • ` +
      `Level: **${level || 0}** • ` +
      `XP: **${formatXp(xpTotal)}**\n` +
      `${progress.label}\n` +
      `\`${progress.bar}\` **${progress.value}**\n` +
      `Messages: **${messageCount}** • ` +
      `Boosts: **${boostCount}** • ` +
      `Bonus: **+${formatPercent(boostBonus)}**`
    )
    .setFooter({ text: "This rank card auto-deletes in 2 minutes." })
    .setTimestamp();
}

async function handleRanksCommand(message, { db }) {
  const raw = String(message.content || "").trim();
  if (!/^!ranks(?:\s|$)/i.test(raw)) return false;

  const targetUser = message.mentions.users.first() || message.author;
  const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
  const profiles = db.listChatLevelProfilesByGuild?.(message.guildId) || [];
  const profile = db.getChatLevelProfile?.(message.guildId, targetUser.id) || {
    guild_id: message.guildId,
    user_id: targetUser.id,
    message_count: 0,
    xp_total: 0,
    active_boost_count: targetMember ? getBoostStateForMember(targetMember).activeBoostCount : 0,
    boost_tier: 0,
    xp_multiplier: 1
  };

  if (targetMember && db.updateChatLevelBoostState) {
    const boostState = getBoostStateForMember(targetMember);
    profile.active_boost_count = boostState.activeBoostCount;
    profile.boost_tier = boostState.boostTier;
    profile.xp_multiplier = boostState.xpMultiplier;
    db.updateChatLevelBoostState(message.guildId, targetUser.id, boostState);
  }

  const rank = getRankForUser(profiles, targetUser.id);
  const embed = buildRankEmbed(targetUser, targetMember, profile, rank, profiles.length || 0);

  const rankReply = await message.reply({
    embeds: [embed],
    allowedMentions: { repliedUser: false }
  });

  setTimeout(() => {
    rankReply.delete().catch(() => null);
    message.delete().catch(() => null);
  }, RANK_REPLY_DELETE_MS);

  return true;
}

async function handleMessage(message, { db }) {
  if (!message?.guildId || message.author?.bot || !db?.incrementChatLevelProfile) return false;

  const handledRanks = await handleRanksCommand(message, { db });
  if (handledRanks) return true;

  const handledSpam = await handleSpamDetection(message);
  if (handledSpam) return false;

  const currentProfile = db.getChatLevelProfile?.(message.guildId, message.author.id) || {
    xp_total: 0,
    message_count: 0
  };
  const boostState = getBoostStateForMember(message.member);
  const baseXpAward = getXpAwardForCurrentLevel(currentProfile.xp_total);
  const xpAward = baseXpAward * boostState.xpMultiplier;
  const profile = db.incrementChatLevelProfile(message.guildId, message.author.id, xpAward, boostState);
  if (!profile || !message.member) return false;

  syncBoosterMilestoneRole(message.member, boostState.activeBoostCount).catch(error => {
    console.error("[Chat Levels] Failed to sync booster milestone role:", error);
  });

  const targetLevel = getLevelForXp(profile.xp_total);
  const targetRoleId = targetLevel ? LEVEL_ROLE_IDS[targetLevel] : null;
  const hasTargetRole = targetRoleId ? message.member.roles?.cache?.has?.(targetRoleId) : false;
  const hasWrongLevelRole = getLevelRoleIds().some(
    roleId => roleId !== targetRoleId && message.member.roles?.cache?.has?.(roleId)
  );

  if (hasTargetRole && !hasWrongLevelRole) {
    return false;
  }

  try {
    const result = await syncMemberLevelRoles(message.member, profile.xp_total);
    if (result.added.length || result.removed.length) {
      console.log(
        "[Chat Levels] Synced member",
        JSON.stringify({
          guild_id: message.guildId,
          user_id: message.author.id,
          message_count: profile.message_count,
          xp_total: profile.xp_total,
          base_xp_awarded: baseXpAward,
          xp_awarded: xpAward,
          active_boost_count: boostState.activeBoostCount,
          xp_multiplier: boostState.xpMultiplier,
          level: result.level,
          added: result.added,
          removed: result.removed
        })
      );
    }
  } catch (error) {
    console.error("[Chat Levels] Failed to sync member role:", error);
  }

  return false;
}

async function handleInteraction(interaction, { db }) {
  if (!interaction.isChatInputCommand()) return false;
  if (![LEVEL_SYNC_COMMAND, RANKS_SETUP_COMMAND, RANKS_LEADERBOARD_REFRESH_COMMAND].includes(interaction.commandName)) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return true;
  }

  if (!canManageLevels(interaction.member)) {
    await interaction.reply({ content: "You do not have permission to sync level roles.", ephemeral: true });
    return true;
  }

  if (interaction.commandName === RANKS_SETUP_COMMAND || interaction.commandName === RANKS_LEADERBOARD_REFRESH_COMMAND) {
    if (interaction.channelId !== RANKS_LEADERBOARD_CHANNEL_ID) {
      await interaction.reply({
        content: `Run this in <#${RANKS_LEADERBOARD_CHANNEL_ID}> so the XP ranks leaderboard stays in the leaderboard area.`,
        ephemeral: true
      });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });
    db.setAppSetting?.(RANKS_LEADERBOARD_CHANNEL_KEY, RANKS_LEADERBOARD_CHANNEL_ID);
    await refreshRanksLeaderboard(interaction.client, db, interaction.guildId);
    await interaction.editReply(
      interaction.commandName === RANKS_SETUP_COMMAND
        ? `XP ranks leaderboard is set up in <#${RANKS_LEADERBOARD_CHANNEL_ID}>.`
        : `XP ranks leaderboard refreshed in <#${RANKS_LEADERBOARD_CHANNEL_ID}>.`
    );
    return true;
  }

  const targetUser = interaction.options.getUser("user");

  await interaction.deferReply({ ephemeral: true });

  if (targetUser) {
    const profile = db.getChatLevelProfile(interaction.guildId, targetUser.id) || {
      guild_id: interaction.guildId,
      user_id: targetUser.id,
      message_count: 0,
      xp_total: 0
    };
    const result = await syncSingleMemberByProfile(interaction.guild, profile, db);
    await interaction.editReply(
      result?.missing_member
        ? `I could not find ${targetUser} in the server right now.`
        : `${targetUser} is now synced to **Level ${result.level || 0}** (${formatLevelBand(result.level || 0)}, ${formatXp(profile.xp_total)} XP total).`
    );
    return true;
  }

  const profiles = db.listChatLevelProfilesByGuild(interaction.guildId);
  let synced = 0;
  let missing = 0;

  for (const profile of profiles) {
    const result = await syncSingleMemberByProfile(interaction.guild, profile, db);
    if (!result) continue;
    if (result.missing_member) {
      missing += 1;
      continue;
    }
    synced += 1;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Chat Level Roles Synced")
    .addFields(
      { name: "Profiles checked", value: String(profiles.length), inline: true },
      { name: "Members synced", value: String(synced), inline: true },
      { name: "Missing members", value: String(missing), inline: true }
    )
    .setFooter({ text: "Tyrone level role sync" });

  await interaction.editReply({ embeds: [embed] });
  return true;
}

async function handleGuildMemberUpdate(oldMember, newMember, { db }) {
  if (!newMember?.guild?.id || !db?.updateChatLevelBoostState) return false;

  const oldBoostCount = detectActiveBoostCount(oldMember);
  const newBoostState = getBoostStateForMember(newMember);
  const oldBoostRoleSet = new Set(getBoostRoleIds().filter(roleId => oldMember?.roles?.cache?.has(roleId)));
  const newBoostRoleSet = new Set(getBoostRoleIds().filter(roleId => newMember?.roles?.cache?.has(roleId)));
  const boostRolesChanged = oldBoostRoleSet.size !== newBoostRoleSet.size
    || [...oldBoostRoleSet].some(roleId => !newBoostRoleSet.has(roleId));

  if (oldBoostCount === newBoostState.activeBoostCount && !boostRolesChanged) return false;

  db.updateChatLevelBoostState(newMember.guild.id, newMember.id, newBoostState);
  const roleResult = await syncBoosterMilestoneRole(newMember, newBoostState.activeBoostCount).catch(error => ({
    error: error.message
  }));

  console.log(
    "[Chat Levels] Boost state synced",
    JSON.stringify({
      guild_id: newMember.guild.id,
      user_id: newMember.id,
      old_boost_count: oldBoostCount,
      active_boost_count: newBoostState.activeBoostCount,
      boost_tier: newBoostState.boostTier,
      xp_multiplier: newBoostState.xpMultiplier,
      role_result: roleResult
    })
  );

  return true;
}

module.exports = {
  LEVEL_SYNC_COMMAND,
  RANKS_SETUP_COMMAND,
  RANKS_LEADERBOARD_REFRESH_COMMAND,
  getLevelForMessageCount,
  getLevelForXp,
  getBoostStateForMember,
  refreshRanksLeaderboard,
  startRanksLeaderboardTicker,
  handleMessage,
  handleInteraction,
  handleGuildMemberUpdate
};
