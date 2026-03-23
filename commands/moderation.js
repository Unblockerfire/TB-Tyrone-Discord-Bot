// commands/moderation.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require("discord.js");

// ---------- TEMP DISPUTE STORAGE ----------
const pendingStrikeDisputes = new Map();

// ---------- CONSTANTS FOR TYRONE CLEANUP ----------

// We no longer restrict to a single source channel.
// Cleanup runs in whichever channel you type the command in.
const TYRONE_CLEANUP_ARCHIVE_CHANNEL_ID = "1477817611168518267";
const TYRONE_CLEANUP_ROLE_IDS = [
  "1113158001604427966",
  "1112945506549768302"
];
const TYRONE_CLEANUP_PANEL_CHANNEL_ID = "1477817040931782707";
const TIMEOUT_TRACK_ROLE_ID = "1113813941852831845";
const TIMEOUT_LOG_CHANNEL_ID = "1113814028385529888";
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

// ---------- LOCAL HELPERS ----------

function getActionForStrikeCount(strikes) {
  switch (strikes) {
    case 1:
      return "a written warning";
    case 2:
      return "a 1 hour mute";
    case 3:
      return "a 3 hour mute";
    case 4:
      return "a ban with appeal";
    case 5:
      return "a permanent ban";
    default:
      return "no further action configured";
  }
}

function getNextActionText(currentStrikes) {
  const nextStrikes = currentStrikes + 1;
  const action = getActionForStrikeCount(nextStrikes);
  if (nextStrikes <= 5) {
    return `If you reach strike ${nextStrikes}, the action will be ${action}.`;
  }
  return "You are already at the maximum punishment level.";
}

async function applyMute(member, durationMs, reason) {
  const mutedRoleId = process.env.MUTED_ROLE_ID;
  if (!mutedRoleId) {
    throw new Error("MUTED_ROLE_ID not configured");
  }

  if (member.roles.cache.has(mutedRoleId)) {
    return;
  }

  await member.roles.add(mutedRoleId, reason || "Auto mute from strike system");

  setTimeout(async () => {
    try {
      const freshMember = await member.guild.members
        .fetch(member.id)
        .catch(() => null);

      if (freshMember && freshMember.roles.cache.has(mutedRoleId)) {
        await freshMember.roles.remove(mutedRoleId, "Mute duration expired");
      }
    } catch (err) {
      console.error("Failed to remove muted role:", err);
    }
  }, durationMs);
}

function userHasRole(member, roleId) {
  return !!member?.roles?.cache?.has(roleId);
}

function userHasAnyRole(member, roleIds) {
  return roleIds.some(id => member?.roles?.cache?.has(id));
}

function canUseTimeout(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ModerateMembers)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;

  const allowedRoleIds = [
    process.env.STAFF_ROLE_ID || "",
    process.env.ADMIN_ROLE_ID || "",
    "1113158001604427966"
  ].filter(Boolean);

  return userHasAnyRole(member, allowedRoleIds);
}

function parseTimeoutDuration(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return 0;

  const unitMap = {
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000
  };

  let total = 0;
  let matched = false;
  const regex = /(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)\b/g;
  let match = null;

  while ((match = regex.exec(raw))) {
    matched = true;
    total += Number(match[1]) * unitMap[match[2]];
  }

  if (!matched && /^\d+$/.test(raw)) {
    total = Number(raw) * 60 * 1000;
    matched = true;
  }

  if (!matched) return 0;
  return Math.min(total, MAX_TIMEOUT_MS);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];

  let remaining = totalSeconds;
  const parts = [];
  for (const [label, size] of units) {
    if (remaining < size && parts.length === 0 && label !== "second") continue;
    const value = Math.floor(remaining / size);
    if (!value && label !== "second") continue;
    remaining -= value * size;
    if (value || label === "second" && parts.length === 0) {
      parts.push(`${value} ${label}${value === 1 ? "" : "s"}`);
    }
    if (parts.length === 2) break;
  }

  return parts.join(" ");
}

function formatOrdinal(value) {
  const number = Number(value || 0);
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return `${number}st`;
  if (mod10 === 2 && mod100 !== 12) return `${number}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${number}rd`;
  return `${number}th`;
}

async function scheduleTimeoutRoleRemoval(guild, memberId, roleId, expiresAt) {
  const remaining = Math.max(0, Number(expiresAt || 0) - Date.now());
  if (!remaining) return;

  const nextDelay = Math.min(remaining, 12 * 60 * 60 * 1000);
  setTimeout(async () => {
    try {
      const freshMember = await guild.members.fetch(memberId).catch(() => null);
      if (!freshMember) return;

      const disabledUntil = Number(freshMember.communicationDisabledUntilTimestamp || 0);
      if (disabledUntil > Date.now() + 5000) {
        scheduleTimeoutRoleRemoval(guild, memberId, roleId, disabledUntil);
        return;
      }

      if (freshMember.roles.cache.has(roleId)) {
        await freshMember.roles.remove(roleId, "Timeout expired");
      }
    } catch (error) {
      console.error("[Timeout] Failed to remove timeout role:", error);
    }
  }, nextDelay);
}

async function addTimeoutRole(member, expiresAt) {
  const me = member.guild.members.me || (await member.guild.members.fetchMe().catch(() => null));
  if (!me) {
    return { ok: false, error: "I could not resolve my member state." };
  }

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, error: "I need Manage Roles to apply the timeout tracking role." };
  }

  const role = await member.guild.roles.fetch(TIMEOUT_TRACK_ROLE_ID).catch(() => null);
  if (!role) {
    return { ok: false, error: `Timeout role ${TIMEOUT_TRACK_ROLE_ID} was not found.` };
  }

  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return { ok: false, error: "My highest role must be above the timeout tracking role." };
  }

  await member.roles.add(role, "Timed out by staff");
  scheduleTimeoutRoleRemoval(member.guild, member.id, role.id, expiresAt);
  return { ok: true, role };
}

async function postTimeoutLog(guild, payload) {
  const logChannel = await guild.channels.fetch(TIMEOUT_LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel?.isTextBased?.()) {
    console.error("[Timeout] Log channel missing or invalid:", TIMEOUT_LOG_CHANNEL_ID);
    return false;
  }

  const embed = new EmbedBuilder()
    .setTitle("Tyrone Timeout")
    .setColor(0xe67e22)
    .addFields(
      { name: "User", value: `<@${payload.targetUser.id}> (${payload.targetUser.id})`, inline: false },
      { name: "Timed out by", value: `<@${payload.staffUser.id}>`, inline: true },
      { name: "Offence Number", value: formatOrdinal(payload.offenceNumber), inline: true },
      { name: "Time Total", value: payload.totalTimeText, inline: true },
      { name: "Remaining Time", value: payload.remainingTimeText, inline: true },
      { name: "Reason", value: payload.reason.slice(0, 1024), inline: false }
    )
    .setTimestamp(new Date());

  await logChannel.send({ embeds: [embed] });
  return true;
}

function isCleanupEligibleTyroneMessage(message, tyroneId) {
  if (!message) return false;

  const lower = (message.content || "").toLowerCase();
  const mentionsTyrone = message.mentions?.users?.has(tyroneId) || false;
  const startsWithCommand = lower.startsWith("!tyrone");

  if (message.author.id !== tyroneId) {
    return mentionsTyrone || startsWithCommand;
  }

  const hasInteractiveUi = (message.components?.length || 0) > 0;
  const hasEmbeds = (message.embeds?.length || 0) > 0;
  if (hasInteractiveUi || hasEmbeds) return false;

  return (
    lower.includes("i hope that answered your question") ||
    lower.includes("use !tyrone so i don’t spam chats") ||
    lower.includes("use !tyrone so i don't spam chats") ||
    lower.startsWith("hey <@") ||
    lower.startsWith("tytest is working")
  );
}

function buildCleanupSummary(sourceChannel, filtered, tyroneId) {
  const toMessages = filtered.filter(m => m.author.id !== tyroneId);
  const fromMessages = filtered.filter(m => m.author.id === tyroneId);
  const pairsCount = Math.max(toMessages.length, fromMessages.length);
  const lines = [];

  lines.push(`Summary for #${sourceChannel.name}:`);
  lines.push(`Messages To: ${toMessages.length}`);
  lines.push(`Messages Out: ${fromMessages.length}`);
  lines.push("");

  for (let i = 0; i < pairsCount; i++) {
    const userMsg = toMessages[i];
    const botMsg = fromMessages[i];

    if (userMsg) {
      lines.push(`**${userMsg.author.tag}**: ${userMsg.content || "(no content)"}`);
    }
    if (botMsg) {
      lines.push(`**Tyrone**: ${botMsg.content || "(no content)"}`);
    }
    if (userMsg || botMsg) {
      lines.push("");
    }
  }

  let text = lines.join("\n");
  if (text.length > 1950) {
    text = text.slice(0, 1950) + "\n...(truncated)";
  }
  return text;
}

async function cleanupSingleChannel({ client, guild, sourceChannel, archiveChannel, skipMessageId = null }) {
  if (!sourceChannel?.isTextBased?.() || typeof sourceChannel.messages?.fetch !== "function") {
    return { ok: false, deletedCount: 0 };
  }

  const tyroneId = client.user.id;
  let allFetched = [];
  let lastId = undefined;

  while (true) {
    const batch = await sourceChannel.messages
      .fetch({ limit: 100, before: lastId })
      .catch(() => null);

    if (!batch || batch.size === 0) break;

    allFetched.push(...batch.values());
    lastId = batch.last().id;

    if (allFetched.length >= 500) break;
  }

  const filtered = allFetched.filter(m => {
    if (skipMessageId && m.id === skipMessageId) return false;
    return isCleanupEligibleTyroneMessage(m, tyroneId);
  });

  if (!filtered.length) {
    return { ok: false, deletedCount: 0 };
  }

  filtered.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  await archiveChannel.send({ content: buildCleanupSummary(sourceChannel, filtered, tyroneId) });

  try {
    await sourceChannel.bulkDelete(filtered, true);
  } catch (err) {
    console.error("[Tyrone cleanup] bulkDelete error:", err);
  }

  return {
    ok: true,
    deletedCount: filtered.length,
    channelId: sourceChannel.id,
    channelName: sourceChannel.name
  };
}

// ---------- MAIN INTERACTION HANDLER ----------

async function handleInteraction(interaction, { client, db }) {
  const commandName = interaction.commandName;

  if (commandName === "warn") {
    return handleWarn(interaction, { client, db });
  }

  if (commandName === "timeout") {
    return handleTimeout(interaction, { client, db });
  }

  if (commandName === "strikes") {
    return handleStrikes(interaction, { client, db });
  }

  if (commandName === "request-kick") {
    return handleRequestKick(interaction, { client, db });
  }

  if (commandName === "mod-interest-panel") {
    return handleModInterestPanel(interaction, { client, db });
  }

  if (commandName === "autofill") {
    return handleAutofill(interaction, { client, db });
  }

  if (commandName === "revokestrike") {
    return handleRevokeStrike(interaction, { client, db });
  }
}

// ---------- BUTTON HANDLER ----------

async function handleButton(interaction, { client, db }) {
  const customId = interaction.customId || "";

  if (customId === "mod_yes" || customId === "mod_no") {
    await handleModInterestButtons(interaction, { client, db });
    return true;
  }

  if (customId === "strike_wrong") {
    await handleStrikeWrongButton(interaction, { client, db });
    return true;
  }

  const [action] = customId.split("_");
  if (["approve", "decline", "view"].includes(action)) {
    await handleKickButtons(interaction, { client, db });
    return true;
  }

  return false;
}

// ---------- MESSAGE HANDLER (for !tyrone-cleanup) ----------

async function handleMessage(message, { client }) {
  try {
    if (message.author.bot) return;

    const content = (message.content || "").trim().toLowerCase();

    if (content !== "!tyrone-cleanup") return;
    await message.reply(
      `Use **/tyrone-cleanup-setup** in <#${TYRONE_CLEANUP_PANEL_CHANNEL_ID}> and click the cleanup button instead.`
    );
  } catch (err) {
    console.error("[Tyrone cleanup] handleMessage error:", err);
  }
}

async function runTyroneCleanup({ client, guild, sourceChannel, skipMessageId = null }) {
  if (!guild) {
    return { ok: false, error: "This command can only be used in a server." };
  }

  const archiveChannel = await guild.channels
    .fetch(TYRONE_CLEANUP_ARCHIVE_CHANNEL_ID)
    .catch(() => null);

  if (!archiveChannel || !archiveChannel.isTextBased()) {
    return {
      ok: false,
      error: "Cleanup archive channel is invalid or missing. Please check the config."
    };
  }

  const targetChannels = sourceChannel
    ? [sourceChannel]
    : guild.channels.cache.filter(
      channel =>
        channel &&
        channel.isTextBased?.() &&
        typeof channel.messages?.fetch === "function"
    ).map(channel => channel);

  let deletedCount = 0;
  let channelsTouched = 0;

  for (const channel of targetChannels) {
    const result = await cleanupSingleChannel({
      client,
      guild,
      sourceChannel: channel,
      archiveChannel,
      skipMessageId: sourceChannel && channel.id === sourceChannel.id ? skipMessageId : null
    });

    if (result.ok) {
      deletedCount += result.deletedCount;
      channelsTouched += 1;
    }
  }

  if (!deletedCount) {
    return {
      ok: false,
      error: sourceChannel
        ? "There are no Tyrone messages to clean up in this channel."
        : "There are no Tyrone conversation messages to clean up server-wide."
    };
  }

  return {
    ok: true,
    deletedCount,
    channelsTouched,
    archivedTo: archiveChannel.id
  };
}

// ---------- /warn IMPLEMENTATION ----------

async function handleWarn(interaction, { db }) {
  const staffRoleId = process.env.STAFF_ROLE_ID;

  if (!staffRoleId) {
    return interaction.reply({
      content: "Bot is not configured correctly, missing STAFF_ROLE_ID.",
      ephemeral: true
    });
  }

  const member = interaction.member;
  if (!userHasRole(member, staffRoleId)) {
    return interaction.reply({
      content: "You do not have permission to use this command.",
      ephemeral: true
    });
  }

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);

  const targetMember = await interaction.guild.members
    .fetch(targetUser.id)
    .catch(() => null);

  const stats = db.getUserStats(targetUser.id);
  const newStrikes = stats.strikes + 1;
  const newWarnings = stats.warnings + 1;

  db.setUserStats(targetUser.id, newStrikes, newWarnings);

  const currentAction = getActionForStrikeCount(newStrikes);
  const nextAction = getNextActionText(newStrikes);

  await interaction.reply({
    content:
      `<@${targetUser.id}> has received strike ${newStrikes} for: **${reason}**.\n` +
      `Current action: ${currentAction}.\n` +
      `Next: ${nextAction}`,
    allowedMentions: { users: [targetUser.id] }
  });

  // Store latest strike info in memory so /autofill can use it later
  pendingStrikeDisputes.set(targetUser.id, {
    strikeReason: reason,
    strikeCount: newStrikes,
    warnings: newWarnings,
    issuedBy: interaction.user.id,
    timestamp: Date.now()
  });

  const dmText =
    `You have received a warning: ${reason}\n` +
    `This is your ONE and ONLY verbal warning you will receive.\n` +
    `The next action taken on your account will be: ${nextAction}\n\n` +
    `Please refer back to our rules and strike policy channels for more information.\n\n` +
    `If you believe this strike is wrong, click the button below.`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("strike_wrong")
      .setLabel("This strike is wrong")
      .setStyle(ButtonStyle.Danger)
  );

  try {
    await targetUser.send({
      content: dmText,
      components: [row]
    });
  } catch {
    // DMs closed, ignore
  }

  if (!targetMember) {
    return;
  }

  if (newStrikes === 1) {
    return;
  }

  try {
    if (newStrikes === 2) {
      await applyMute(
        targetMember,
        60 * 60 * 1000,
        `Strike 2: 1 hour mute - ${reason}`
      );
    } else if (newStrikes === 3) {
      await applyMute(
        targetMember,
        3 * 60 * 60 * 1000,
        `Strike 3: 3 hour mute - ${reason}`
      );
    } else if (newStrikes === 4) {
      await targetMember.ban({
        reason: `Strike 4 - ban with appeal: ${reason}`
      });
    } else if (newStrikes >= 5) {
      await targetMember.ban({
        reason: `Strike 5 - permanent ban: ${reason}`
      });
    }
  } catch (err) {
    console.error("Punishment error:", err);
  }
}

async function handleTimeout(interaction, { db }) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true
    });
  }

  if (!canUseTimeout(interaction.member)) {
    return interaction.reply({
      content: "You do not have permission to use /timeout.",
      ephemeral: true
    });
  }

  const targetUser = interaction.options.getUser("user", true);
  const durationInput = interaction.options.getString("duration", true);
  const reason = interaction.options.getString("reason", true);
  const durationMs = parseTimeoutDuration(durationInput);

  if (!durationMs) {
    return interaction.reply({
      content: "Use a valid duration like `10m`, `1h`, `2h 30m`, or `1d`.",
      ephemeral: true
    });
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.reply({
      content: "I could not find that member in this server.",
      ephemeral: true
    });
  }

  const expiresAt = Date.now() + durationMs;
  const stats = db.getUserStats(targetUser.id);
  const offenceNumber = Number(stats.strikes || 0) + 1;

  try {
    await targetMember.timeout(durationMs, `${reason} | timed out by ${interaction.user.tag}`);
  } catch (error) {
    console.error("[Timeout] Failed to apply Discord timeout:", error);
    return interaction.reply({
      content: "I could not timeout that member. Check my Moderate Members permission and role position.",
      ephemeral: true
    });
  }

  db.setUserStats(targetUser.id, offenceNumber, Number(stats.warnings || 0) + 1);

  const roleResult = await addTimeoutRole(targetMember, expiresAt).catch(error => ({
    ok: false,
    error: error.message
  }));

  await postTimeoutLog(interaction.guild, {
    targetUser,
    staffUser: interaction.user,
    offenceNumber,
    totalTimeText: formatDuration(durationMs),
    remainingTimeText: formatDuration(expiresAt - Date.now()),
    reason
  }).catch(error => {
    console.error("[Timeout] Failed to post timeout log:", error);
  });

  const roleNote = roleResult?.ok
    ? ` and gave them <@&${TIMEOUT_TRACK_ROLE_ID}>`
    : roleResult?.error
      ? `, but I could not apply the timeout role: ${roleResult.error}`
      : "";

  return interaction.reply({
    content:
      `Timed out <@${targetUser.id}> for **${formatDuration(durationMs)}**${roleNote}.\n` +
      `This is their **${formatOrdinal(offenceNumber)}** recorded offence.\n` +
      `Reason: ${reason}`,
    allowedMentions: { users: [targetUser.id], roles: roleResult?.ok ? [TIMEOUT_TRACK_ROLE_ID] : [] }
  });
}

// ---------- /strikes IMPLEMENTATION ----------

async function handleStrikes(interaction, { db }) {
  const targetUser = interaction.options.getUser("user", true);
  const stats = db.getUserStats(targetUser.id);

  const embed = new EmbedBuilder()
    .setTitle("User Strikes")
    .setColor(0x3498db)
    .addFields(
      {
        name: "User",
        value: `<@${targetUser.id}> (${targetUser.id})`,
        inline: false
      },
      { name: "Strikes", value: `${stats.strikes}`, inline: true },
      { name: "Warnings", value: `${stats.warnings}`, inline: true }
    )
    .setTimestamp(new Date());

  await interaction.reply({ embeds: [embed] });
}

// ---------- /request-kick IMPLEMENTATION ----------

async function handleRequestKick(interaction, { client, db }) {
  const staffRoleId = process.env.STAFF_ROLE_ID;
  const requestChannelId = process.env.REQUEST_CHANNEL_ID;

  if (!staffRoleId || !requestChannelId) {
    return interaction.reply({
      content:
        "Bot is not configured correctly, missing STAFF_ROLE_ID or REQUEST_CHANNEL_ID.",
      ephemeral: true
    });
  }

  const member = interaction.member;
  if (!userHasRole(member, staffRoleId)) {
    return interaction.reply({
      content: "You do not have permission to use this command.",
      ephemeral: true
    });
  }

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);

  const stats = db.getUserStats(targetUser.id);
  const requestId = `${Date.now()}_${targetUser.id}_${interaction.user.id}`;

  const embed = new EmbedBuilder()
    .setTitle("Kick Request")
    .setColor(0xffa500)
    .addFields(
      {
        name: "Target",
        value: `<@${targetUser.id}> (${targetUser.id})`,
        inline: false
      },
      {
        name: "Requested by",
        value: `<@${interaction.user.id}> (${interaction.user.id})`,
        inline: false
      },
      {
        name: "Reason",
        value: reason.slice(0, 1024),
        inline: false
      },
      {
        name: "Strikes / Warnings",
        value: `Strikes: **${stats.strikes}**\nWarnings: **${stats.warnings}**`,
        inline: true
      },
      { name: "Status", value: "Pending approval", inline: true }
    )
    .setTimestamp(new Date());

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_${requestId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`decline_${requestId}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`view_${requestId}`)
      .setLabel("View")
      .setStyle(ButtonStyle.Secondary)
  );

  const requestChannel = await client.channels.fetch(requestChannelId);
  if (!requestChannel || !requestChannel.isTextBased()) {
    return interaction.reply({
      content: "Configured requests channel is invalid.",
      ephemeral: true
    });
  }

  await requestChannel.send({
    content: `New kick request from <@${interaction.user.id}> for <@${targetUser.id}>`,
    embeds: [embed],
    components: [buttons]
  });

  await interaction.reply({
    content: `Kick request created in ${requestChannel}.`,
    ephemeral: true
  });
}

// ---------- /mod-interest-panel IMPLEMENTATION ----------

async function handleModInterestPanel(interaction) {
  const approverRoleIds = (process.env.APPROVER_ROLE_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (!userHasAnyRole(interaction.member, approverRoleIds)) {
    return interaction.reply({
      content: "You do not have permission to post the mod interest panel.",
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("Future Staff Interest")
    .setColor(0x8e44ad)
    .setDescription(
      "Would you ever be interested in being considered for higher roles or staff in the future?\n\n" +
        "This does not guarantee anything, it just lets us know you might want to be considered later."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("mod_yes")
      .setLabel("Yes, maybe in the future")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("mod_no")
      .setLabel("No thanks")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: "Mod interest panel posted.",
    ephemeral: true
  });

  await interaction.channel.send({
    embeds: [embed],
    components: [row]
  });
}

// ---------- /autofill IMPLEMENTATION ----------

async function handleAutofill(interaction) {
  const dispute = pendingStrikeDisputes.get(interaction.user.id);
  const adminRoleId = process.env.ADMIN_ROLE_ID;

  if (!dispute) {
    return interaction.reply({
      content:
        "I do not have a recent strike challenge saved for you right now. If this is about a new strike, click the **This strike is wrong** button in your DM first.",
      ephemeral: true
    });
  }

  const adminPing = adminRoleId ? `<@&${adminRoleId}> ` : "";

  await interaction.reply({
    content:
      `${adminPing}<@${interaction.user.id}> would like to challenge their strike.\n\n` +
      `**Strike reason:** ${dispute.strikeReason}\n` +
      `**Current strike count:** ${dispute.strikeCount}\n` +
      `**Warnings on account:** ${dispute.warnings}\n` +
      `**Issued by:** <@${dispute.issuedBy}>\n\n` +
      `An admin can review this and use \`/revokestrike\` if needed.`,
    allowedMentions: {
      roles: adminRoleId ? [adminRoleId] : [],
      users: [interaction.user.id, dispute.issuedBy]
    }
  });
}

// ---------- /revokestrike IMPLEMENTATION ----------

async function handleRevokeStrike(interaction, { db }) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;

  if (!adminRoleId) {
    return interaction.reply({
      content: "Bot is missing ADMIN_ROLE_ID in the environment.",
      ephemeral: true
    });
  }

  if (!userHasRole(interaction.member, adminRoleId)) {
    return interaction.reply({
      content: "Only admins can use /revokestrike.",
      ephemeral: true
    });
  }

  const targetUser = interaction.options.getUser("user", true);
  const amount = interaction.options.getInteger("number", true);
  const reason = interaction.options.getString("reason") || "No reason provided";

  if (amount <= 0) {
    return interaction.reply({
      content: "The number of strikes to revoke must be at least 1.",
      ephemeral: true
    });
  }

  const current = db.getUserStats(targetUser.id);

  const newStrikes = Math.max(0, current.strikes - amount);
  const newWarnings = Math.max(0, current.warnings - amount);

  db.setUserStats(targetUser.id, newStrikes, newWarnings);

  try {
    await targetUser.send(
      `An admin has revoked **${amount} strike${amount === 1 ? "" : "s"}** from your account.\n` +
        `Reason: ${reason}\n\n` +
        `You now have **${newStrikes} strike${newStrikes === 1 ? "" : "s"}** and **${newWarnings} warning${newWarnings === 1 ? "" : "s"}**.`
    );
  } catch {
    // DMs closed, ignore
  }

  return interaction.reply({
    content:
      `Revoked **${amount} strike${amount === 1 ? "" : "s"}** from <@${targetUser.id}>.\n` +
      `They now have **${newStrikes} strike${newStrikes === 1 ? "" : "s"}** and **${newWarnings} warning${newWarnings === 1 ? "" : "s"}**.\n` +
      `Reason: ${reason}`,
    allowedMentions: { users: [targetUser.id] }
  });
}

// ---------- MOD INTEREST BUTTONS ----------

async function handleModInterestButtons(interaction, { db }) {
  const interested = interaction.customId === "mod_yes";

  db.setModInterest(interaction.user.id, interested);

  const logChannelId = process.env.MOD_INTEREST_LOG_CHANNEL_ID;
  if (logChannelId) {
    try {
      const logChannel = await interaction.guild.channels.fetch(logChannelId);
      if (logChannel && logChannel.isTextBased()) {
        await logChannel.send(
          `<@${interaction.user.id}> set mod interest to: **${interested ? "YES" : "NO"}**`
        );
      }
    } catch (err) {
      console.error("Mod interest log error:", err);
    }
  }

  return interaction.reply({
    content: `Got it, your preference is recorded as: **${interested ? "Yes" : "No"}**.`,
    ephemeral: true
  });
}

// ---------- STRIKE DISPUTE BUTTON ----------

async function handleStrikeWrongButton(interaction) {
  const existing = pendingStrikeDisputes.get(interaction.user.id);

  if (!existing) {
    return interaction.reply({
      content:
        "I do not have a recent strike saved for you right now. If this was an older strike, open a ticket in **#✨tickets✨** and explain it manually.",
      ephemeral: true
    });
  }

  return interaction.reply({
    content:
      "Got it. Go to **#✨tickets✨**, create a ticket through MEE6, then run **/autofill** in that ticket so I can post your strike challenge for admins.",
    ephemeral: true
  });
}

// ---------- KICK BUTTON HANDLER ----------

async function handleKickButtons(interaction) {
  const approverRoleIds = (process.env.APPROVER_ROLE_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "This button only works inside a server.",
      ephemeral: true
    });
  }

  if (
    !interaction.message ||
    !interaction.message.embeds ||
    interaction.message.embeds.length === 0
  ) {
    return interaction.reply({
      content: "This request has no data attached.",
      ephemeral: true
    });
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const fields = embed.data.fields || [];
  const targetField = fields.find(f => f.name === "Target");
  const statusField = fields.find(f => f.name === "Status");
  const targetMatch = targetField && targetField.value.match(/\((\d+)\)/);
  const targetId = targetMatch ? targetMatch[1] : null;

  if (!targetId) {
    return interaction.reply({
      content: "Could not find target user for this request.",
      ephemeral: true
    });
  }

  const member = interaction.member;
  const [action] = interaction.customId.split("_");

  if (action === "view") {
    return interaction.reply({
      content: `Kick request for <@${targetId}>:\nStatus: **${statusField ? statusField.value : "Unknown"}**`,
      ephemeral: true
    });
  }

  if (!userHasAnyRole(member, approverRoleIds)) {
    return interaction.reply({
      content: "You do not have permission to approve or decline this request.",
      ephemeral: true
    });
  }

  if (statusField && statusField.value !== "Pending approval") {
    return interaction.reply({
      content: `This request is already processed. Current status: **${statusField.value}**`,
      ephemeral: true
    });
  }

  if (action === "approve") {
    let resultText = "";

    try {
      const guildMember = await interaction.guild.members
        .fetch(targetId)
        .catch(() => null);

      if (!guildMember) {
        resultText = "User is no longer in the server. Nothing to kick.";
      } else {
        const reasonField = fields.find(f => f.name === "Reason");
        const reason = reasonField ? reasonField.value : "No reason provided";
        await guildMember.kick(`Approved kick request: ${reason}`);
        resultText = `User <@${targetId}> has been kicked.`;
      }
    } catch (err) {
      console.error("Kick error:", err);
      resultText = "Failed to kick user. Check bot permissions and role position.";
    }

    const newFields = fields.map(f => {
      if (f.name === "Status") {
        return {
          name: "Status",
          value: `Approved by <@${interaction.user.id}>`,
          inline: f.inline
        };
      }
      return f;
    });

    embed.setFields(newFields);

    await interaction.update({
      content: interaction.message.content,
      embeds: [embed],
      components: []
    });

    return interaction.followUp({
      content: resultText,
      ephemeral: true
    });
  }

  if (action === "decline") {
    const newFields = fields.map(f => {
      if (f.name === "Status") {
        return {
          name: "Status",
          value: `Declined by <@${interaction.user.id}>`,
          inline: f.inline
        };
      }
      return f;
    });

    embed.setFields(newFields);

    await interaction.update({
      content: interaction.message.content,
      embeds: [embed],
      components: []
    });

    return interaction.followUp({
      content: "Kick request declined.",
      ephemeral: true
    });
  }
}

module.exports = {
  handleInteraction,
  handleButton,
  handleMessage,
  runTyroneCleanup,
  TYRONE_CLEANUP_PANEL_CHANNEL_ID,
  TYRONE_CLEANUP_ROLE_IDS
};



