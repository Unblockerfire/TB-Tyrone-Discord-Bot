// commands/moderation.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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

// ---------- MAIN INTERACTION HANDLER ----------

async function handleInteraction(interaction, { client, db }) {
  const commandName = interaction.commandName;

  if (commandName === "warn") {
    return handleWarn(interaction, { client, db });
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

  if (!sourceChannel?.isTextBased?.()) {
    return { ok: false, error: "Cleanup only works in a text channel." };
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

    const lower = (m.content || "").toLowerCase();
    const mentionsTyrone = m.mentions?.users?.has(tyroneId) || false;
    const isTyrone = m.author.id === tyroneId;
    const startsWithCommand = lower.startsWith("!tyrone");

    return isTyrone || mentionsTyrone || startsWithCommand;
  });

  if (filtered.length === 0) {
    return { ok: false, error: "There are no Tyrone messages to clean up in this channel." };
  }

  filtered.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

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

  await archiveChannel.send({ content: text });

  try {
    await sourceChannel.bulkDelete(filtered, true);
  } catch (err) {
    console.error("[Tyrone cleanup] bulkDelete error:", err);
  }

  return {
    ok: true,
    deletedCount: filtered.length,
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



