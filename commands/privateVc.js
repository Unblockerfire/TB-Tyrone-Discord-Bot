const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} = require("discord.js");

const PRIVATE_VC_CATEGORY_ID = process.env.PRIVATE_VC_CATEGORY_ID || null;
const PRIVATE_VC_CREATE_CHANNEL_ID =
  process.env.PRIVATE_VC_CREATE_CHANNEL_ID || "1484035753502703676";
const PRIVATE_VC_INVITE_CHANNEL_ID =
  process.env.PRIVATE_VC_INVITE_CHANNEL_ID || "1484039510588129462";
const PRIVATE_VC_EMPTY_DELETE_MINUTES = Number(process.env.PRIVATE_VC_EMPTY_DELETE_MINUTES || "15");
const PRIVATE_VC_BYPASS_ROLE_IDS = (process.env.PRIVATE_VC_BYPASS_ROLE_IDS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const PRIVATE_VC_TIMEZONE = process.env.PRIVATE_VC_TIMEZONE || "America/Phoenix";
const PRIVATE_VC_PANEL_CHANNEL_KEY = "private_vc.panel.channel_id";
const PRIVATE_VC_PANEL_MESSAGE_KEY = "private_vc.panel.message_id";

const pendingLockRequests = new Map();
let janitorStarted = false;
let lastMidnightSweepKey = null;

function createPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("private_vc_create")
        .setLabel("Make Private VC")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("private_vc_manage_sessions")
        .setLabel("Edit Sessions")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildPrivateVcPanelPayload() {
  return {
    content:
      "**Private VC Panel**\n" +
      "Click the button below to make your own private VC. Tyrone will create it, move you if possible, and let you invite people.",
    components: createPanelComponents()
  };
}

function isPrivateVcPanelMessage(message, botUserId) {
  if (!message) return false;
  if (botUserId && message.author?.id !== botUserId) return false;

  const hasMatchingContent = String(message.content || "").includes("**Private VC Panel**");
  const hasCreateButton = message.components?.some(row =>
    row.components?.some(component => component.customId === "private_vc_create")
  );

  return Boolean(hasMatchingContent && hasCreateButton);
}

async function deleteExistingPrivateVcPanels(channel, botUserId) {
  if (!channel?.isTextBased?.()) return 0;

  let deleted = 0;
  const recentMessages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!recentMessages) return 0;

  for (const message of recentMessages.values()) {
    if (!isPrivateVcPanelMessage(message, botUserId)) continue;
    await message.delete().catch(() => null);
    deleted += 1;
  }

  return deleted;
}

async function refreshPrivateVcPanel(client, db, { reason = "manual_refresh" } = {}) {
  const targetChannelId = db?.getAppSetting?.(PRIVATE_VC_PANEL_CHANNEL_KEY)?.value || PRIVATE_VC_CREATE_CHANNEL_ID;
  const channel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const deletedCount = await deleteExistingPrivateVcPanels(channel, client.user?.id);

  const posted = await channel.send(buildPrivateVcPanelPayload());
  db?.setManyAppSettings?.({
    [PRIVATE_VC_PANEL_CHANNEL_KEY]: posted.channelId,
    [PRIVATE_VC_PANEL_MESSAGE_KEY]: posted.id
  });

  console.log(
    "[Private VC] Panel refreshed",
    JSON.stringify({ reason, channel_id: posted.channelId, message_id: posted.id, deleted_previous_count: deletedCount })
  );
  return true;
}

function buildPrivateVcStatusLines(db) {
  const channels = db.listPrivateVcChannels();
  if (!channels.length) {
    return ["No tracked private VCs right now."];
  }

  return channels.slice(0, 20).map(record => {
    const invited = record.invited_user_ids.length
      ? record.invited_user_ids.map(userId => `<@${userId}>`).join(", ")
      : "none";
    const emptyState = record.last_empty_at
      ? `empty since ${new Date(Number(record.last_empty_at)).toLocaleString()}`
      : "not empty";

    return (
      `• <#${record.channel_id}>` +
      ` | owner <@${record.owner_id}>` +
      ` | private: ${record.is_private ? "yes" : "no"}` +
      ` | invited: ${invited}` +
      ` | ${emptyState}`
    );
  });
}

function getOwnedSessions(db, guildId, userId) {
  return db
    .listPrivateVcChannels()
    .filter(record => record.guild_id === guildId && record.owner_id === userId);
}

function buildManageMessage(record) {
  const invited = record.invited_user_ids.length
    ? record.invited_user_ids.map(userId => `<@${userId}>`).join(", ")
    : "none";
  return (
    `**Managing Private VC**\n` +
    `VC: <#${record.channel_id}>\n` +
    `Owner: <@${record.owner_id}>\n` +
    `Private: ${record.is_private ? "yes" : "no"}\n` +
    `Invited: ${invited}\n\n` +
    "Use the selector below to add people, or the buttons to update the VC."
  );
}

function buildManageComponents(record, ownedSessions = []) {
  const components = [];

  components.push(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`private_vc_invite_select:${record.channel_id}`)
        .setPlaceholder("Invite or add people to this VC")
        .setMinValues(1)
        .setMaxValues(10)
    )
  );

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`private_vc_make_private:${record.channel_id}`)
        .setLabel("Make Private")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`private_vc_unlock:${record.channel_id}`)
        .setLabel("Unlock VC")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`private_vc_delete:${record.channel_id}`)
        .setLabel("Delete VC")
        .setStyle(ButtonStyle.Danger)
    )
  );

  if (ownedSessions.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("private_vc_session_select")
          .setPlaceholder("Switch to another session you own")
          .addOptions(
            ownedSessions.slice(0, 25).map(session => ({
              label: session.name || session.channel_id,
              value: session.channel_id,
              description: session.is_private ? "Private VC" : "Unlocked VC"
            }))
          )
      )
    );
  }

  return components;
}

function sanitizeVoiceChannelName(name) {
  const safe = String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 90);
  return safe || "private-vc";
}

function displayVoiceChannelName(user) {
  const base = `${user.username}'s Private VC`;
  return base.slice(0, 95);
}

function getNowMidnightKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PRIVATE_VC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const data = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    dateKey: `${data.year}-${data.month}-${data.day}`,
    hour: Number(data.hour),
    minute: Number(data.minute)
  };
}

function memberHasBypassRole(member) {
  if (!member?.roles?.cache) return false;
  return PRIVATE_VC_BYPASS_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

function canManagePrivateVc(member, ownerId) {
  if (!member) return false;
  if (member.id === ownerId) return true;
  if (member.permissions?.has(PermissionsBitField.Flags.ManageChannels)) return true;
  return memberHasBypassRole(member);
}

function parseChannelReference(guild, raw) {
  if (!guild || !raw) return null;
  const trimmed = String(raw).trim();
  const mentionMatch = trimmed.match(/^<#(\d+)>$/);
  const id = mentionMatch ? mentionMatch[1] : trimmed.match(/^\d+$/)?.[0];

  if (id) {
    return guild.channels.cache.get(id) || null;
  }

  const lowered = trimmed.toLowerCase();
  return guild.channels.cache.find(
    channel => channel.type === ChannelType.GuildVoice && channel.name.toLowerCase() === lowered
  ) || null;
}

function parseMentionedUser(message) {
  const mentioned = message.mentions.users.first();
  if (!mentioned) return null;
  if (mentioned.id === message.author.id) return null;
  return mentioned;
}

function getPendingLock(ownerId) {
  const pending = pendingLockRequests.get(ownerId);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    pendingLockRequests.delete(ownerId);
    return null;
  }
  return pending;
}

function setPendingLock(ownerId, channelId, textChannelId) {
  pendingLockRequests.set(ownerId, {
    channelId,
    textChannelId,
    createdAt: Date.now()
  });
}

function clearPendingLock(ownerId) {
  pendingLockRequests.delete(ownerId);
}

function toInviteList(record, extraUserIds = []) {
  const set = new Set([...(record?.invited_user_ids || []), ...extraUserIds].filter(Boolean));
  return [...set];
}

function buildPermissionOverwrites(guild, ownerId, invitedUserIds, isPrivate) {
  const overwrites = [];

  if (isPrivate) {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.Connect
      ]
    });
  } else {
    overwrites.push({
      id: guild.roles.everyone.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.Connect
      ]
    });
  }

  overwrites.push({
    id: ownerId,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.Connect,
      PermissionsBitField.Flags.Speak,
      PermissionsBitField.Flags.Stream
    ]
  });

  for (const userId of invitedUserIds) {
    overwrites.push({
      id: userId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
        PermissionsBitField.Flags.Stream
      ]
    });
  }

  for (const roleId of PRIVATE_VC_BYPASS_ROLE_IDS) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak
      ]
    });
  }

  return overwrites;
}

async function applyPrivateVcAccess(channel, record) {
  const overwrites = buildPermissionOverwrites(
    channel.guild,
    record.owner_id,
    record.invited_user_ids || [],
    record.is_private
  );
  await channel.permissionOverwrites.set(overwrites, "Sync private VC access");
}

async function announceInvite(textChannel, owner, targetUser, voiceChannel) {
  const guild = voiceChannel?.guild || textChannel?.guild || null;
  const destination =
    (guild && await guild.channels.fetch(PRIVATE_VC_INVITE_CHANNEL_ID).catch(() => null)) ||
    textChannel;

  if (!destination?.isTextBased?.()) return;

  await destination.send({
    content:
      `Hey <@${targetUser.id}> | @ for help, <@${owner.id}> invited you to join ${voiceChannel.name} in <#${voiceChannel.id}>.`,
    allowedMentions: { users: [targetUser.id, owner.id] }
  });
}

async function deletePrivateVcChannel(client, db, record, reason) {
  const channel = await client.channels.fetch(record.channel_id).catch(() => null);
  if (channel) {
    await channel.delete(reason || "Private VC cleanup").catch(() => null);
  }
  db.deletePrivateVcByChannelId(record.channel_id);
}

async function refreshTrackedChannelState(client, db, record) {
  const channel = await client.channels.fetch(record.channel_id).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    db.deletePrivateVcByChannelId(record.channel_id);
    return null;
  }

  const memberCount = channel.members.filter(member => !member.user.bot).size;
  if (memberCount === 0 && !record.last_empty_at) {
    return db.upsertPrivateVc({
      ...record,
      name: channel.name,
      last_empty_at: Date.now()
    });
  }

  if (memberCount > 0 && record.last_empty_at) {
    return db.upsertPrivateVc({
      ...record,
      name: channel.name,
      last_empty_at: null
    });
  }

  return db.upsertPrivateVc({
    ...record,
    name: channel.name
  });
}

async function cleanupPrivateVcChannels(client, db, { midnightSweep = false } = {}) {
  const now = Date.now();
  const maxEmptyMs = Math.max(1, PRIVATE_VC_EMPTY_DELETE_MINUTES) * 60 * 1000;

  for (const record of db.listPrivateVcChannels()) {
    const updated = await refreshTrackedChannelState(client, db, record);
    if (!updated) continue;

    const channel = await client.channels.fetch(updated.channel_id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      db.deletePrivateVcByChannelId(updated.channel_id);
      continue;
    }

    const memberCount = channel.members.filter(member => !member.user.bot).size;
    if (memberCount > 0) continue;

    if (midnightSweep) {
      await deletePrivateVcChannel(client, db, updated, "Private VC midnight cleanup");
      continue;
    }

    if (updated.last_empty_at && now - Number(updated.last_empty_at) >= maxEmptyMs) {
      await deletePrivateVcChannel(client, db, updated, "Private VC empty cleanup");
    }
  }
}

async function ensureVoiceChannelForOwner(message, db) {
  const voiceChannel = message.member?.voice?.channel || null;
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await message.reply("Join a voice channel first, then run that command.");
    return null;
  }

  const existing = db.getPrivateVcByChannelId(voiceChannel.id);
  if (existing && existing.owner_id !== message.author.id && !canManagePrivateVc(message.member, existing.owner_id)) {
    await message.reply("That private VC already belongs to someone else.");
    return null;
  }

  return voiceChannel;
}

async function createTrackedPrivateVc({ interaction, db }) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This only works inside a server.", ephemeral: true });
    return true;
  }

  if (interaction.channelId !== PRIVATE_VC_CREATE_CHANNEL_ID) {
    await interaction.reply({
      content: `Private VC creation only works in <#${PRIVATE_VC_CREATE_CHANNEL_ID}>.`,
      ephemeral: true
    });
    return true;
  }

  const member = interaction.member;
  const guild = interaction.guild;
  const categoryId = PRIVATE_VC_CATEGORY_ID || interaction.channel?.parentId || null;
  const voiceChannel = await guild.channels.create({
    name: sanitizeVoiceChannelName(displayVoiceChannelName(interaction.user)),
    type: ChannelType.GuildVoice,
    parent: categoryId,
    permissionOverwrites: buildPermissionOverwrites(guild, interaction.user.id, [], true),
    reason: `Private VC created for ${interaction.user.tag}`
  });

  const record = db.upsertPrivateVc({
    channel_id: voiceChannel.id,
    guild_id: guild.id,
    owner_id: interaction.user.id,
    text_channel_id: interaction.channelId,
    category_id: categoryId,
    name: voiceChannel.name,
    invited_user_ids: [],
    is_private: true,
    auto_delete_enabled: true,
    last_empty_at: member?.voice?.channel ? null : Date.now()
  });

  if (member?.voice?.channel) {
    await member.voice.setChannel(voiceChannel).catch(() => null);
  }

  setPendingLock(interaction.user.id, voiceChannel.id, interaction.channelId);
  const ownedSessions = getOwnedSessions(db, guild.id, interaction.user.id);

  await interaction.reply({
    content:
      `Private VC created: <#${voiceChannel.id}>.\n` +
      "Pick who you want to invite below, or use the edit controls.",
    components: buildManageComponents(record, ownedSessions),
    ephemeral: true
  });

  return record;
}

async function handleInteraction(interaction, { db }) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === "private-vc-status") {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
      await interaction.reply({
        content: "You need Manage Channels to view private VC status.",
        ephemeral: true
      });
      return true;
    }

    await interaction.reply({
      content: `**Private VC Status**\n${buildPrivateVcStatusLines(db).join("\n")}`,
      ephemeral: true
    });
    return true;
  }

  if (interaction.commandName !== "setup-private-vc-panel") return false;

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
    await interaction.reply({
      content: "You need Manage Channels to post the private VC panel.",
      ephemeral: true
    });
    return true;
  }

  if (interaction.channelId !== PRIVATE_VC_CREATE_CHANNEL_ID) {
    await interaction.reply({
      content: `Post the private VC panel in <#${PRIVATE_VC_CREATE_CHANNEL_ID}> only.`,
      ephemeral: true
    });
    return true;
  }

  await deleteExistingPrivateVcPanels(interaction.channel, interaction.client.user?.id);

  const posted = await interaction.channel.send(buildPrivateVcPanelPayload());
  db?.setManyAppSettings?.({
    [PRIVATE_VC_PANEL_CHANNEL_KEY]: posted.channelId,
    [PRIVATE_VC_PANEL_MESSAGE_KEY]: posted.id
  });

  await interaction.reply({
    content: "Private VC panel posted.",
    ephemeral: true
  });
  return true;
}

async function handleButton(interaction, { db }) {
  const [baseId, channelId] = String(interaction.customId || "").split(":");

  if (baseId === "private_vc_create") {
    await createTrackedPrivateVc({ interaction, db });
    return true;
  }

  if (baseId === "private_vc_manage_sessions") {
    if (interaction.channelId !== PRIVATE_VC_CREATE_CHANNEL_ID) {
      await interaction.reply({
        content: `Private VC session editing only works from <#${PRIVATE_VC_CREATE_CHANNEL_ID}>.`,
        ephemeral: true
      });
      return true;
    }

    const ownedSessions = getOwnedSessions(db, interaction.guildId, interaction.user.id);
    if (!ownedSessions.length) {
      await interaction.reply({
        content: "You do not own any tracked private VCs right now.",
        ephemeral: true
      });
      return true;
    }

    const first = ownedSessions[0];
    await interaction.reply({
      content: buildManageMessage(first),
      components: buildManageComponents(first, ownedSessions),
      ephemeral: true
    });
    return true;
  }

  if (!["private_vc_make_private", "private_vc_unlock", "private_vc_delete"].includes(baseId)) {
    return false;
  }

  const record = db.getPrivateVcByChannelId(channelId);
  if (!record) {
    await interaction.reply({ content: "That private VC could not be found.", ephemeral: true });
    return true;
  }

  const member = interaction.member;
  if (!canManagePrivateVc(member, record.owner_id)) {
    await interaction.reply({ content: "You do not own that private VC.", ephemeral: true });
    return true;
  }

  const channel = await interaction.guild.channels.fetch(record.channel_id).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    db.deletePrivateVcByChannelId(record.channel_id);
    await interaction.reply({ content: "That VC no longer exists.", ephemeral: true });
    return true;
  }

  if (baseId === "private_vc_delete") {
    await deletePrivateVcChannel(interaction.client, db, record, "Private VC deleted from management view");
    await interaction.update({
      content: `Deleted private VC **${record.name || channel.name}**.`,
      components: []
    });
    return true;
  }

  const updated = db.upsertPrivateVc({
    ...record,
    name: channel.name,
    is_private: baseId === "private_vc_make_private"
  });
  await applyPrivateVcAccess(channel, updated);

  const ownedSessions = getOwnedSessions(db, interaction.guildId, interaction.user.id);
  await interaction.update({
    content: buildManageMessage(updated),
    components: buildManageComponents(updated, ownedSessions)
  });
  return true;
}

async function handleSelectMenu(interaction, { db }) {
  if (interaction.isStringSelectMenu() && interaction.customId === "private_vc_session_select") {
    const selectedChannelId = interaction.values[0];
    const record = db.getPrivateVcByChannelId(selectedChannelId);
    if (!record) {
      await interaction.update({
        content: "That private VC no longer exists.",
        components: []
      });
      return true;
    }

    const ownedSessions = getOwnedSessions(db, interaction.guildId, interaction.user.id);
    await interaction.update({
      content: buildManageMessage(record),
      components: buildManageComponents(record, ownedSessions)
    });
    return true;
  }

  if (interaction.isUserSelectMenu()) {
    const [baseId, channelId] = String(interaction.customId || "").split(":");
    if (baseId !== "private_vc_invite_select") return false;

    const record = db.getPrivateVcByChannelId(channelId);
    if (!record) {
      await interaction.update({
        content: "That private VC could not be found.",
        components: []
      });
      return true;
    }

    if (!canManagePrivateVc(interaction.member, record.owner_id)) {
      await interaction.reply({
        content: "You do not own that private VC.",
        ephemeral: true
      });
      return true;
    }

    const channel = await interaction.guild.channels.fetch(record.channel_id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      db.deletePrivateVcByChannelId(record.channel_id);
      await interaction.update({
        content: "That VC no longer exists.",
        components: []
      });
      return true;
    }

    const invitedUserIds = toInviteList(record, interaction.values);
    const updated = db.upsertPrivateVc({
      ...record,
      name: channel.name,
      invited_user_ids: invitedUserIds,
      is_private: true
    });
    await applyPrivateVcAccess(channel, updated);

    for (const userId of interaction.values) {
      const targetUser = await interaction.client.users.fetch(userId).catch(() => null);
      if (targetUser) {
        await announceInvite(interaction.channel, interaction.user, targetUser, channel);
      }
    }

    const ownedSessions = getOwnedSessions(db, interaction.guildId, interaction.user.id);
    await interaction.update({
      content: buildManageMessage(updated),
      components: buildManageComponents(updated, ownedSessions)
    });
    return true;
  }

  return false;
}

async function handleLockCommand(message, db) {
  const voiceChannel = await ensureVoiceChannelForOwner(message, db);
  if (!voiceChannel) return true;

  setPendingLock(message.author.id, voiceChannel.id, message.channelId);
  db.upsertPrivateVc({
    channel_id: voiceChannel.id,
    guild_id: message.guildId,
    owner_id: message.author.id,
    text_channel_id: message.channelId,
    category_id: voiceChannel.parentId,
    name: voiceChannel.name,
    is_private: db.getPrivateVcByChannelId(voiceChannel.id)?.is_private || false,
    invited_user_ids: db.getPrivateVcByChannelId(voiceChannel.id)?.invited_user_ids || [],
    auto_delete_enabled: true,
    last_empty_at: voiceChannel.members.filter(member => !member.user.bot).size ? null : Date.now()
  });

  await message.reply(
    `Hi <@${message.author.id}>, who would you like to lock this VC to?\n` +
    "Please run: `!tyrone-lock @user`"
  );
  return true;
}

async function inviteUserToPrivateVc(message, db, { makePrivate }) {
  const targetUser = parseMentionedUser(message);
  if (!targetUser) {
    await message.reply("Mention the user you want to invite, like `!tyrone-lock @user`.");
    return true;
  }

  const pending = getPendingLock(message.author.id);
  const voiceChannel =
    (pending?.channelId && message.guild.channels.cache.get(pending.channelId)) ||
    message.member?.voice?.channel ||
    null;

  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await message.reply("I could not find the VC you want me to manage. Join it or run `!lockvc` first.");
    return true;
  }

  const existing = db.getPrivateVcByChannelId(voiceChannel.id);
  if (existing && !canManagePrivateVc(message.member, existing.owner_id)) {
    await message.reply("You do not own that private VC.");
    return true;
  }

  const record = db.upsertPrivateVc({
    channel_id: voiceChannel.id,
    guild_id: message.guildId,
    owner_id: existing?.owner_id || message.author.id,
    text_channel_id: pending?.textChannelId || message.channelId,
    category_id: voiceChannel.parentId,
    name: voiceChannel.name,
    invited_user_ids: toInviteList(existing, [targetUser.id]),
    is_private: makePrivate ? true : (existing?.is_private ?? true),
    auto_delete_enabled: true,
    last_empty_at: voiceChannel.members.filter(member => !member.user.bot).size ? null : Date.now()
  });

  await applyPrivateVcAccess(voiceChannel, record);
  clearPendingLock(message.author.id);
  await message.reply(
    `${makePrivate ? "Locked" : "Updated"} **${voiceChannel.name}** for <@${targetUser.id}>.`
  );
  await announceInvite(message.channel, message.author, targetUser, voiceChannel);
  return true;
}

async function unlockPrivateVc(message, db) {
  const voiceChannel = await ensureVoiceChannelForOwner(message, db);
  if (!voiceChannel) return true;

  const existing = db.getPrivateVcByChannelId(voiceChannel.id);
  if (!existing) {
    await message.reply("That VC is not tracked as a private VC yet.");
    return true;
  }

  if (!canManagePrivateVc(message.member, existing.owner_id)) {
    await message.reply("You do not own that private VC.");
    return true;
  }

  const record = db.upsertPrivateVc({
    ...existing,
    name: voiceChannel.name,
    is_private: false
  });
  await applyPrivateVcAccess(voiceChannel, record);
  await message.reply(`Unlocked **${voiceChannel.name}** for everyone.`);
  return true;
}

async function privateCurrentVc(message, db) {
  const voiceChannel = await ensureVoiceChannelForOwner(message, db);
  if (!voiceChannel) return true;

  const existing = db.getPrivateVcByChannelId(voiceChannel.id);
  const record = db.upsertPrivateVc({
    channel_id: voiceChannel.id,
    guild_id: message.guildId,
    owner_id: existing?.owner_id || message.author.id,
    text_channel_id: message.channelId,
    category_id: voiceChannel.parentId,
    name: voiceChannel.name,
    invited_user_ids: existing?.invited_user_ids || [],
    is_private: true,
    auto_delete_enabled: true,
    last_empty_at: voiceChannel.members.filter(member => !member.user.bot).size ? null : Date.now()
  });
  await applyPrivateVcAccess(voiceChannel, record);
  await message.reply(
    `Made **${voiceChannel.name}** private. Run \`!vcinvite @user\` or \`!tyrone-lock @user\` to invite someone.`
  );
  return true;
}

async function deletePrivateVcFromMessage(message, db, { manualSweep = false } = {}) {
  if (manualSweep) {
    if (!canManagePrivateVc(message.member, null)) {
      await message.reply("You need Manage Channels to run VC cleanup.");
      return true;
    }
    await cleanupPrivateVcChannels(message.client, db, { midnightSweep: true });
    await message.reply("Ran private VC cleanup.");
    return true;
  }

  const arg = message.content.trim().split(/\s+/).slice(1).join(" ");
  const targetChannel = parseChannelReference(message.guild, arg) || message.member?.voice?.channel || null;

  if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
    await message.reply("Use `!deletevc` while in the VC, or provide a voice channel mention, ID, or exact name.");
    return true;
  }

  const record = db.getPrivateVcByChannelId(targetChannel.id);
  if (!record) {
    await message.reply("That VC is not tracked as a private VC.");
    return true;
  }

  if (!canManagePrivateVc(message.member, record.owner_id)) {
    await message.reply("You do not have permission to delete that private VC.");
    return true;
  }

  await deletePrivateVcChannel(message.client, db, record, "Private VC manually deleted");
  await message.reply(`Deleted private VC **${targetChannel.name}**.`);
  return true;
}

async function transferPrivateVcOwner(message, db) {
  const targetUser = parseMentionedUser(message);
  if (!targetUser) {
    await message.reply("Mention the new owner, like `!vcowner @user`.");
    return true;
  }

  const voiceChannel = message.member?.voice?.channel || null;
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await message.reply("Join the tracked private VC first.");
    return true;
  }

  const record = db.getPrivateVcByChannelId(voiceChannel.id);
  if (!record) {
    await message.reply("That VC is not tracked as a private VC.");
    return true;
  }

  if (!canManagePrivateVc(message.member, record.owner_id)) {
    await message.reply("You do not have permission to transfer that private VC.");
    return true;
  }

  const updated = db.upsertPrivateVc({
    ...record,
    owner_id: targetUser.id,
    invited_user_ids: toInviteList(record, [message.author.id])
  });
  await applyPrivateVcAccess(voiceChannel, updated);
  await message.reply(`Transferred **${voiceChannel.name}** to <@${targetUser.id}>.`);
  return true;
}

async function handleMessage(message, { db }) {
  if (!message.inGuild() || message.author.bot) return false;

  const lower = (message.content || "").trim().toLowerCase();
  if (!lower.startsWith("!")) return false;

  if (lower === "!lockvc") {
    return handleLockCommand(message, db);
  }

  if (lower.startsWith("!tyrone-lock")) {
    return inviteUserToPrivateVc(message, db, { makePrivate: true });
  }

  if (lower.startsWith("!vcinvite")) {
    return inviteUserToPrivateVc(message, db, { makePrivate: false });
  }

  if (lower === "!unlockvc") {
    return unlockPrivateVc(message, db);
  }

  if (lower === "!vcprivate") {
    return privateCurrentVc(message, db);
  }

  if (lower.startsWith("!deletevc")) {
    return deletePrivateVcFromMessage(message, db);
  }

  if (lower === "!vccleanup") {
    return deletePrivateVcFromMessage(message, db, { manualSweep: true });
  }

  if (lower.startsWith("!vcowner")) {
    return transferPrivateVcOwner(message, db);
  }

  return false;
}

async function handleVoiceStateUpdate(oldState, newState, { client, db }) {
  const impactedIds = [oldState.channelId, newState.channelId].filter(Boolean);
  for (const channelId of impactedIds) {
    const record = db.getPrivateVcByChannelId(channelId);
    if (!record) continue;
    await refreshTrackedChannelState(client, db, record);
  }
}

function startPrivateVcJanitor(client, { db }) {
  if (janitorStarted) return;
  janitorStarted = true;

  setInterval(async () => {
    try {
      const time = getNowMidnightKey();
      const shouldRunMidnightSweep =
        time.hour === 0 &&
        time.minute < 10 &&
        lastMidnightSweepKey !== time.dateKey;

      await cleanupPrivateVcChannels(client, db, {
        midnightSweep: shouldRunMidnightSweep
      });

      if (shouldRunMidnightSweep) {
        lastMidnightSweepKey = time.dateKey;
      }
    } catch (error) {
      console.error("[privateVc] janitor error:", error);
    }
  }, 60 * 1000);
}

module.exports = {
  handleInteraction,
  handleButton,
  handleSelectMenu,
  handleMessage,
  handleVoiceStateUpdate,
  startPrivateVcJanitor,
  refreshPrivateVcPanel
};
