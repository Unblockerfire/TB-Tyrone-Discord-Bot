// commands/fortniteQueue.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require("discord.js");

// ---------- CONFIG ----------
const STAFF_ROLE_ID = "1112945506549768302";
const BOT_FORT_VERIFIED_ROLE_ID = "1480047339832873050";

// Channels
const FORT_LINK_CHANNEL_ID = "1480046500561293484";
const FORT_READY_CHANNEL_ID = "1480047279619706981";
const FORT_QUEUE_CHANNEL_ID = "1480047233494679646";
const HELP_TICKET_CHANNEL_ID = "1113525665065619527";

// Rotation
const ROTATION_MS = 20 * 60 * 1000; // 20 minutes

// State keys
const STATE_QUEUE_OPEN = "fort_queue_open";
const STATE_CURRENT_USER = "fort_current_user_id";
const STATE_CURRENT_STARTED_AT = "fort_current_started_at";
const STATE_DISPLAY_MESSAGE_ID = "fort_display_message_id";
const STATE_READY_PANEL_MESSAGE_ID = "fort_ready_panel_message_id";
const STATE_CURRENT_GROUP = "fort_current_group";
const STATE_CURRENT_GROUP_SIZE = "fort_current_group_size";

// Custom IDs
const BTN_VERIFY = "fort_verify_open_modal";
const BTN_READY_UP = "fort_ready_up";
const BTN_LEAVE_QUEUE = "fort_leave_queue";
const MODAL_VERIFY = "fort_verify_modal";
const INPUT_EPIC = "epic_username_input";

// ---------- HELPERS ----------
function isStaff(member) {
  return !!member?.roles?.cache?.has(STAFF_ROLE_ID);
}

function asBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function unixSeconds(ms) {
  return Math.floor(ms / 1000);
}

function clampGroupSize(value) {
  const num = Number(value) || 1;
  return Math.max(1, Math.min(10, Math.floor(num)));
}

function readCurrentGroup(db) {
  const raw = db.getFortniteQueueState(STATE_CURRENT_GROUP, "[]");

  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((id) => typeof id === "string" && id.length > 0);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function writeCurrentGroup(db, userIds) {
  const ids = Array.isArray(userIds)
    ? userIds.filter((id) => typeof id === "string" && id.length > 0)
    : [];

  if (ids.length === 0) {
    if (typeof db.deleteFortniteQueueState === "function") {
      db.deleteFortniteQueueState(STATE_CURRENT_GROUP);
    } else {
      db.setFortniteQueueState(STATE_CURRENT_GROUP, "[]");
    }

    if (typeof db.deleteFortniteQueueState === "function") {
      db.deleteFortniteQueueState(STATE_CURRENT_USER);
    } else {
      db.setFortniteQueueState(STATE_CURRENT_USER, "");
    }

    return;
  }

  db.setFortniteQueueState(STATE_CURRENT_GROUP, JSON.stringify(ids));
  db.setFortniteQueueState(STATE_CURRENT_USER, ids[0]);
}

function getConfiguredGroupSize(db) {
  return clampGroupSize(db.getFortniteQueueState(STATE_CURRENT_GROUP_SIZE, 1));
}

function setConfiguredGroupSize(db, size) {
  db.setFortniteQueueState(STATE_CURRENT_GROUP_SIZE, String(clampGroupSize(size)));
}

async function safeReply(interaction, options) {
  const payload = {
    ...options,
    flags: options?.flags ?? (options?.ephemeral ? MessageFlags.Ephemeral : undefined)
  };

  delete payload.ephemeral;

  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(payload);
    }

    return await interaction.reply(payload);
  } catch (err) {
    if (err?.code === 40060 || err?.code === 10062) {
      return null;
    }
    throw err;
  }
}

function getEpicUsername(db, userId) {
  return db.getFortniteLink(userId)?.epic_username || "Not linked";
}

function formatUserWithEpic(db, userId) {
  return `<@${userId}> - \`${getEpicUsername(db, userId)}\``;
}

function buildVerifyPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("🎮 Fortnite Verification")
    .setColor(0x3498db)
    .setDescription(
      `Press the button below to verify for the Fortnite queue.\n\n` +
      `You will be asked for your **actual Fortnite username**.\n\n` +
      `**NOTE:** This is **NOT** your display name. Use your real Fortnite username.\n\n` +
      `If you need help, make a ticket in <#${HELP_TICKET_CHANNEL_ID}>.`
    )
    .setFooter({ text: "Tyrone will give you the Fortnite verified role after submission." });
}

function buildReadyPanelEmbed(queueOpen) {
  return new EmbedBuilder()
    .setTitle("🎯 Ready Up")
    .setColor(queueOpen ? 0x2ecc71 : 0xe67e22)
    .setDescription(
      `Press **Ready Up** to join the Fortnite queue.\n` +
      `Press **Leave Queue** to remove yourself.\n\n` +
      `Queue status: **${queueOpen ? "ONLINE" : "OFFLINE"}**`
    );
}

function buildQueueEmbed(db) {
  const queueOpen = asBool(db.getFortniteQueueState(STATE_QUEUE_OPEN, false));
  const currentGroup = readCurrentGroup(db);
  const currentStartedAt = Number(db.getFortniteQueueState(STATE_CURRENT_STARTED_AT, 0) || 0);
  const queue = db.listFortniteQueue();
  const groupSize = getConfiguredGroupSize(db);

  const currentLine = currentGroup.length
    ? currentGroup.map((userId) => formatUserWithEpic(db, userId)).join("\n")
    : "Nobody currently up.";

  let timerLine = "No active timer.";
  if (currentGroup.length > 0 && currentStartedAt > 0) {
    const endsAt = currentStartedAt + ROTATION_MS;
    timerLine =
      `Started: <t:${unixSeconds(currentStartedAt)}:t>\n` +
      `Ends: <t:${unixSeconds(endsAt)}:t> (<t:${unixSeconds(endsAt)}:R>)`;
  }

  const queueLines = queue.length
    ? queue.map((entry, i) => `#${i + 1} ${formatUserWithEpic(db, entry.user_id)}`).join("\n")
    : "Queue is empty.";

  return new EmbedBuilder()
    .setTitle("🎮 Fortnite Queue")
    .setColor(queueOpen ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      {
        name: "Status",
        value: queueOpen ? "🟢 ONLINE" : "🔴 OFFLINE",
        inline: false
      },
      {
        name: "Current Party Size",
        value: String(groupSize),
        inline: false
      },
      {
        name: "Currently Up",
        value: currentLine,
        inline: false
      },
      {
        name: "Timer",
        value: timerLine,
        inline: false
      },
      {
        name: "Queue",
        value: queueLines,
        inline: false
      }
    )
    .setFooter({
      text: `Rotates every ${Math.floor(ROTATION_MS / 60000)} minutes`
    })
    .setTimestamp();
}

async function ensureQueueDisplay(guild, db) {
  const queueChannel = await guild.channels.fetch(FORT_QUEUE_CHANNEL_ID).catch(() => null);
  if (!queueChannel || !queueChannel.isTextBased()) {
    throw new Error("Fortnite queue channel is invalid.");
  }

  const embed = buildQueueEmbed(db);
  const existingMessageId = db.getFortniteQueueState(STATE_DISPLAY_MESSAGE_ID, null);

  let message = null;

  if (existingMessageId) {
    try {
      const fetched = await queueChannel.messages.fetch(existingMessageId).catch(() => null);

      if (fetched && typeof fetched.edit === "function") {
        message = fetched;
      } else {
        if (typeof db.deleteFortniteQueueState === "function") {
          db.deleteFortniteQueueState(STATE_DISPLAY_MESSAGE_ID);
        } else {
          db.setFortniteQueueState(STATE_DISPLAY_MESSAGE_ID, "");
        }
      }
    } catch {
      if (typeof db.deleteFortniteQueueState === "function") {
        db.deleteFortniteQueueState(STATE_DISPLAY_MESSAGE_ID);
      } else {
        db.setFortniteQueueState(STATE_DISPLAY_MESSAGE_ID, "");
      }
    }
  }

  if (message) {
    await message.edit({ embeds: [embed] });
  } else {
    const sent = await queueChannel.send({ embeds: [embed] });
    db.setFortniteQueueState(STATE_DISPLAY_MESSAGE_ID, sent.id);
    message = sent;
  }

  const recentMessages = await queueChannel.messages.fetch({ limit: 25 }).catch(() => null);
  if (recentMessages) {
    const duplicates = recentMessages.filter(
      (msg) =>
        msg.id !== message.id &&
        msg.author?.id === guild.client.user?.id &&
        msg.embeds?.[0]?.title === "🎮 Fortnite Queue"
    );

    for (const duplicate of duplicates.values()) {
      await duplicate.delete().catch(() => null);
    }
  }

  return message;
}

async function ensureReadyPanelDisplay(guild, db) {
  const readyChannel = await guild.channels.fetch(FORT_READY_CHANNEL_ID).catch(() => null);
  if (!readyChannel || !readyChannel.isTextBased()) {
    throw new Error("Fortnite ready channel is invalid.");
  }

  const queueOpen = asBool(db.getFortniteQueueState(STATE_QUEUE_OPEN, false));
  const embed = buildReadyPanelEmbed(queueOpen);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_READY_UP)
      .setLabel("Ready Up")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(BTN_LEAVE_QUEUE)
      .setLabel("Leave Queue")
      .setStyle(ButtonStyle.Secondary)
  );

  const existingMessageId = db.getFortniteQueueState(STATE_READY_PANEL_MESSAGE_ID, null);
  let message = null;

  if (existingMessageId) {
    const fetched = await readyChannel.messages.fetch(existingMessageId).catch(() => null);
    if (fetched && typeof fetched.edit === "function") {
      message = fetched;
    } else {
      if (typeof db.deleteFortniteQueueState === "function") {
        db.deleteFortniteQueueState(STATE_READY_PANEL_MESSAGE_ID);
      } else {
        db.setFortniteQueueState(STATE_READY_PANEL_MESSAGE_ID, "");
      }
    }
  }

  if (message) {
    await message.edit({ embeds: [embed], components: [row] });
  } else {
    const sent = await readyChannel.send({ embeds: [embed], components: [row] });
    db.setFortniteQueueState(STATE_READY_PANEL_MESSAGE_ID, sent.id);
    message = sent;
  }

  const recentMessages = await readyChannel.messages.fetch({ limit: 25 }).catch(() => null);
  if (recentMessages) {
    const duplicates = recentMessages.filter(
      (msg) =>
        msg.id !== message.id &&
        msg.author?.id === guild.client.user?.id &&
        msg.embeds?.[0]?.title === "🎯 Ready Up"
    );

    for (const duplicate of duplicates.values()) {
      await duplicate.delete().catch(() => null);
    }
  }

  return message;
}

async function announceInQueueChannel(guild, content) {
  const queueChannel = await guild.channels.fetch(FORT_QUEUE_CHANNEL_ID).catch(() => null);
  if (!queueChannel || !queueChannel.isTextBased()) return;
  await queueChannel.send({ content });
}

async function advanceQueue(guild, db, reasonText = "Queue advanced.", requestedCount = null) {
  const previousGroup = readCurrentGroup(db);
  const queue = db.listFortniteQueue();
  const count = clampGroupSize(requestedCount ?? getConfiguredGroupSize(db));
  const nextEntries = queue.slice(0, count);

  if (nextEntries.length === 0) {
    writeCurrentGroup(db, []);

    if (typeof db.deleteFortniteQueueState === "function") {
      db.deleteFortniteQueueState(STATE_CURRENT_STARTED_AT);
    } else {
      db.setFortniteQueueState(STATE_CURRENT_STARTED_AT, "");
    }

    await ensureQueueDisplay(guild, db);
    await ensureReadyPanelDisplay(guild, db);

    if (previousGroup.length > 0) {
      await announceInQueueChannel(
        guild,
        `⏱️ ${previousGroup.map((userId) => `<@${userId}>`).join(", ")}'s turn is over. Nobody else is in queue right now.`
      );
    }

    return {
      previousUserIds: previousGroup,
      nextUserIds: []
    };
  }

  const nextUserIds = nextEntries.map((entry) => entry.user_id);
  for (const userId of nextUserIds) {
    db.removeFromFortniteQueue(userId);
  }

  setConfiguredGroupSize(db, nextUserIds.length);
  writeCurrentGroup(db, nextUserIds);
  db.setFortniteQueueState(STATE_CURRENT_STARTED_AT, Date.now());

  await ensureQueueDisplay(guild, db);
  await ensureReadyPanelDisplay(guild, db);

  const previousMentions = previousGroup.map((userId) => `<@${userId}>`).join(", ");
  const nextMentions = nextUserIds.map((userId) => `<@${userId}>`).join(", ");

  if (previousGroup.length > 0) {
    await announceInQueueChannel(
      guild,
      `⏱️ ${previousMentions}'s turn is over.\n🎯 ${reasonText}\n✅ ${nextMentions} ${nextUserIds.length === 1 ? "is" : "are"} now up for ${Math.floor(
        ROTATION_MS / 60000
      )} minutes.`
    );
  } else {
    await announceInQueueChannel(
      guild,
      `✅ ${nextMentions} ${nextUserIds.length === 1 ? "is" : "are"} now up for ${Math.floor(
        ROTATION_MS / 60000
      )} minutes.`
    );
  }

  return {
    previousUserIds: previousGroup,
    nextUserIds
  };
}

async function maybeRotateQueue(client, db) {
  const queueOpen = asBool(db.getFortniteQueueState(STATE_QUEUE_OPEN, false));
  const guild = client.guilds.cache.first();

  if (!guild) return;
  if (!queueOpen) return;

  const currentGroup = readCurrentGroup(db);
  const currentStartedAt = Number(db.getFortniteQueueState(STATE_CURRENT_STARTED_AT, 0) || 0);

  if (currentGroup.length === 0) {
    if (db.listFortniteQueue().length > 0) {
      await advanceQueue(guild, db, "Queue auto-started.", getConfiguredGroupSize(db));
    } else {
      await ensureQueueDisplay(guild, db).catch(() => {});
    }
    return;
  }

  if (!currentStartedAt) {
    db.setFortniteQueueState(STATE_CURRENT_STARTED_AT, Date.now());
    await ensureQueueDisplay(guild, db).catch(() => {});
    return;
  }

  const expiresAt = currentStartedAt + ROTATION_MS;
  if (Date.now() >= expiresAt) {
    await advanceQueue(guild, db, "Rotation timer expired.", currentGroup.length);
  }
}

function startFortniteQueueTicker(client, { db }) {
  setInterval(async () => {
    try {
      await maybeRotateQueue(client, db);
    } catch (err) {
      console.error("[FortniteQueue] ticker error:", err);
    }
  }, 5 * 60 * 1000);
}

// ---------- BUTTON HANDLERS ----------
async function handleButton(interaction, { db }) {
  const id = interaction.customId || "";

  if (id === BTN_VERIFY) {
    const modal = new ModalBuilder()
      .setCustomId(MODAL_VERIFY)
      .setTitle("Fortnite Verification");

    const epicInput = new TextInputBuilder()
      .setCustomId(INPUT_EPIC)
      .setLabel("Please put your epic username here")
      .setPlaceholder("This is NOT your display name")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(32);

    const row = new ActionRowBuilder().addComponents(epicInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
    return true;
  }

  if (id === BTN_READY_UP) {
    if (interaction.channelId !== FORT_READY_CHANNEL_ID) {
      await safeReply(interaction, {
        content: `Use the Ready Up panel in <#${FORT_READY_CHANNEL_ID}>.`,
        ephemeral: true
      });
      return true;
    }

    if (!interaction.member.roles.cache.has(BOT_FORT_VERIFIED_ROLE_ID)) {
      await safeReply(interaction, {
        content: `You must verify first in <#${FORT_LINK_CHANNEL_ID}>.`,
        ephemeral: true
      });
      return true;
    }

    const queueOpen = asBool(db.getFortniteQueueState(STATE_QUEUE_OPEN, false));
    if (!queueOpen) {
      await safeReply(interaction, {
        content: "The queue is not online",
        ephemeral: true
      });
      return true;
    }

    const currentGroup = readCurrentGroup(db);
    if (currentGroup.includes(interaction.user.id)) {
      await safeReply(interaction, {
        content: "You are already currently up.",
        ephemeral: true
      });
      return true;
    }

    if (db.isInFortniteQueue(interaction.user.id)) {
      await safeReply(interaction, {
        content: "You are already in the queue.",
        ephemeral: true
      });
      return true;
    }

    db.addToFortniteQueue(interaction.user.id);
    await ensureQueueDisplay(interaction.guild, db);
    await ensureReadyPanelDisplay(interaction.guild, db);

    await safeReply(interaction, {
      content: "You have been added to the queue ✅",
      ephemeral: true
    });

    return true;
  }

  if (id === BTN_LEAVE_QUEUE) {
    const currentGroup = readCurrentGroup(db);

    if (currentGroup.includes(interaction.user.id)) {
      const nextGroup = currentGroup.filter((userId) => userId !== interaction.user.id);
      writeCurrentGroup(db, nextGroup);

      if (nextGroup.length === 0) {
        if (typeof db.deleteFortniteQueueState === "function") {
          db.deleteFortniteQueueState(STATE_CURRENT_STARTED_AT);
        } else {
          db.setFortniteQueueState(STATE_CURRENT_STARTED_AT, "");
        }
      }

      await ensureQueueDisplay(interaction.guild, db);
      await ensureReadyPanelDisplay(interaction.guild, db);

      await safeReply(interaction, {
        content: "You were removed from the current slot.",
        ephemeral: true
      });
      return true;
    }

    if (!db.isInFortniteQueue(interaction.user.id)) {
      await safeReply(interaction, {
        content: "You are not in the queue.",
        ephemeral: true
      });
      return true;
    }

    db.removeFromFortniteQueue(interaction.user.id);
    await ensureQueueDisplay(interaction.guild, db);
    await ensureReadyPanelDisplay(interaction.guild, db);

    await safeReply(interaction, {
      content: "You have been removed from the queue.",
      ephemeral: true
    });

    return true;
  }

  return false;
}

// ---------- MODAL HANDLER ----------
async function handleModalSubmit(interaction, { db }) {
  if (!interaction.isModalSubmit()) return false;
  if (interaction.customId !== MODAL_VERIFY) return false;

  if (interaction.channelId !== FORT_LINK_CHANNEL_ID) {
    await safeReply(interaction, {
      content: `Please verify in <#${FORT_LINK_CHANNEL_ID}>.`,
      ephemeral: true
    });
    return true;
  }

  const epic = interaction.fields.getTextInputValue(INPUT_EPIC)?.trim();

  if (!epic) {
    await safeReply(interaction, {
      content: "Please enter a valid Epic username.",
      ephemeral: true
    });
    return true;
  }

  const existingEpic = db.getFortniteLinkByEpic(epic);
  if (existingEpic && existingEpic.user_id !== interaction.user.id) {
    await safeReply(interaction, {
      content: "That Epic username is already linked to another user.",
      ephemeral: true
    });
    return true;
  }

  db.setFortniteLink(interaction.user.id, epic, true);

  const member = interaction.member;
  if (member) {
    await member.roles.add(
      BOT_FORT_VERIFIED_ROLE_ID,
      "Fortnite verification submitted through modal"
    ).catch(() => null);
  }

  await safeReply(interaction, {
    content:
      `You are now verified for the Fortnite queue as **${epic}** ✅\n\n` +
      `Go to <#${FORT_READY_CHANNEL_ID}> and press **Ready Up** when you want to join the queue.`,
    ephemeral: true
  });

  return true;
}

// ---------- SLASH COMMANDS ----------
async function handleInteraction(interaction, { db }) {
  if (!interaction.isChatInputCommand()) return false;

  const cmd = interaction.commandName;
  const isOurs = [
    "setup-fort-verify-panel",
    "setup-fort-ready-panel",
    "setup-fort-queue-display",
    "fort-queue-open",
    "fort-queue-close",
    "fort-queue-status",
    "fort-queue-next",
    "fort-queue-remove"
  ].includes(cmd);

  if (!isOurs) return false;
  if (!interaction.inGuild()) return true;

  const member = interaction.member;
  const guild = interaction.guild;

  if (cmd === "setup-fort-verify-panel") {
    if (!isStaff(member)) {
      await safeReply(interaction, { content: "No permission.", ephemeral: true });
      return true;
    }

    if (interaction.channelId !== FORT_LINK_CHANNEL_ID) {
      await safeReply(interaction, {
        content: `Run this in <#${FORT_LINK_CHANNEL_ID}>.`,
        ephemeral: true
      });
      return true;
    }

    const embed = buildVerifyPanelEmbed();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_VERIFY)
        .setLabel("Verify Fortnite")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });

    await safeReply(interaction, {
      content: "Fortnite verify panel posted ✅",
      ephemeral: true
    });
    return true;
  }

  if (cmd === "setup-fort-ready-panel") {
    if (!isStaff(member)) {
      await safeReply(interaction, { content: "No permission.", ephemeral: true });
      return true;
    }

    if (interaction.channelId !== FORT_READY_CHANNEL_ID) {
      await safeReply(interaction, {
        content: `Run this in <#${FORT_READY_CHANNEL_ID}>.`,
        ephemeral: true
      });
      return true;
    }

    await ensureReadyPanelDisplay(guild, db);

    await safeReply(interaction, {
      content: "Fortnite ready-up panel posted ✅",
      ephemeral: true
    });
    return true;
  }

  if (cmd === "setup-fort-queue-display") {
    if (!isStaff(member)) {
      await safeReply(interaction, { content: "No permission.", ephemeral: true });
      return true;
    }

    if (interaction.channelId !== FORT_QUEUE_CHANNEL_ID) {
      await safeReply(interaction, {
        content: `Run this in <#${FORT_QUEUE_CHANNEL_ID}>.`,
        ephemeral: true
      });
      return true;
    }

    await ensureQueueDisplay(guild, db);
    await ensureReadyPanelDisplay(guild, db);

    await safeReply(interaction, {
      content: "Fortnite queue display posted / refreshed ✅",
      ephemeral: true
    });
    return true;
  }

  if (cmd === "fort-queue-open") {
    if (!isStaff(member)) {
      await safeReply(interaction, { content: "No permission.", ephemeral: true });
      return true;
    }

    db.setFortniteQueueState(STATE_QUEUE_OPEN, "true");
    await ensureQueueDisplay(guild, db);
    await ensureReadyPanelDisplay(guild, db);

    await safeReply(interaction, {
      content: "Fortnite queue is now online ✅",
      ephemeral: true
    });
    return true;
  }

  if (cmd === "fort-queue-close") {
    if (!isStaff(member)) {
      await safeReply(interaction, { content: "No permission.", ephemeral: true });
      return true;
    }

    db.setFortniteQueueState(STATE_QUEUE_OPEN, "false");
    await ensureQueueDisplay(guild, db);
    await ensureReadyPanelDisplay(guild, db);

    await safeReply(interaction, {
      content: "Fortnite queue is now offline ✅",
      ephemeral: true
    });
    return true;
  }

  if (cmd === "fort-queue-status") {
    await safeReply(interaction, {
      embeds: [buildQueueEmbed(db)],
      ephemeral: true
    });
    return true;
  }

  if (cmd === "fort-queue-next") {
    if (!isStaff(member)) {
      await safeReply(interaction, { content: "No permission.", ephemeral: true });
      return true;
    }

    const queueLength = db.listFortniteQueue().length;
    const requestedCount = clampGroupSize(interaction.options.getInteger("count") || 1);
    const actualCount = Math.min(requestedCount, Math.max(queueLength, 1));

    setConfiguredGroupSize(db, actualCount);

    const result = await advanceQueue(guild, db, `Staff advanced the queue with party size ${actualCount}.`, actualCount);
    await ensureReadyPanelDisplay(guild, db);

    await safeReply(interaction, {
      content: result.nextUserIds.length
        ? `${result.nextUserIds.map((userId) => `<@${userId}>`).join(", ")} ${result.nextUserIds.length === 1 ? "is" : "are"} now up ✅`
        : "Queue advanced, but nobody is waiting right now.",
      ephemeral: true
    });
    return true;
  }

  if (cmd === "fort-queue-remove") {
    if (!isStaff(member)) {
      await safeReply(interaction, { content: "No permission.", ephemeral: true });
      return true;
    }

    const user = interaction.options.getUser("user");
    if (!user) {
      await safeReply(interaction, {
        content: "Please choose a user.",
        ephemeral: true
      });
      return true;
    }

    let changed = false;

    if (db.isInFortniteQueue(user.id)) {
      db.removeFromFortniteQueue(user.id);
      changed = true;
    }

    const currentGroup = readCurrentGroup(db);
    if (currentGroup.includes(user.id)) {
      const nextGroup = currentGroup.filter((userId) => userId !== user.id);
      writeCurrentGroup(db, nextGroup);

      if (nextGroup.length === 0) {
        if (typeof db.deleteFortniteQueueState === "function") {
          db.deleteFortniteQueueState(STATE_CURRENT_STARTED_AT);
        } else {
          db.setFortniteQueueState(STATE_CURRENT_STARTED_AT, "");
        }
      }

      changed = true;
    }

    await ensureQueueDisplay(guild, db);
    await ensureReadyPanelDisplay(guild, db);

    await safeReply(interaction, {
      content: changed
        ? `${user} was removed from the queue/current slot.`
        : `${user} was not in the queue.`,
      ephemeral: true
    });
    return true;
  }

  return false;
}

module.exports = {
  handleInteraction,
  handleButton,
  handleModalSubmit,
  startFortniteQueueTicker
};