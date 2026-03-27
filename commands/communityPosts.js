const {
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js");

const OWNER_ROLE_ID = "1113158001604427966";
const SHOUTOUT_ROLE_ID = "1484176418693972019";
const SHOUTOUT_CHANNEL_KEY = "shoutout.channel_id";
const SHOUTOUT_GUILD_KEY = "shoutout.guild_id";
const SHOUTOUT_MODAL_PREFIX = "shoutout_setup_modal:";
const SHOUTOUT_USERS_INPUT_ID = "shoutout_users";
const SHOUTOUT_REASON_INPUT_ID = "shoutout_reason";
const SHOUTOUT_NOTES_INPUT_ID = "shoutout_notes";

function getStaffRoleIds() {
  return [
    OWNER_ROLE_ID,
    process.env.ADMIN_ROLE_ID || "",
    process.env.STAFF_ROLE_ID || "",
    ...(process.env.TICKET_CLAIM_ROLE_IDS || "").split(",").map(value => value.trim())
  ].filter(Boolean);
}

function memberHasAnyRole(member, roleIds) {
  return roleIds.some(roleId => member?.roles?.cache?.has(roleId));
}

function canManageCommunity(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageChannels)) return true;
  return memberHasAnyRole(member, getStaffRoleIds());
}

function getSettingValue(db, key) {
  return db.getAppSetting(key)?.value || null;
}

function buildShoutoutModal(selectedUserIds = []) {
  const encodedUserIds = selectedUserIds.join(",");
  return new ModalBuilder()
    .setCustomId(`${SHOUTOUT_MODAL_PREFIX}${encodedUserIds}`)
    .setTitle("Shoutout of the Day")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(SHOUTOUT_USERS_INPUT_ID)
          .setLabel("Mention the user(s) or paste their IDs")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(
            selectedUserIds.length
              ? "Optional, add more mentions if needed"
              : "Example: @user1 @user2"
          )
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(SHOUTOUT_REASON_INPUT_ID)
          .setLabel("What did they do?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(SHOUTOUT_NOTES_INPUT_ID)
          .setLabel("Extra notes (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
      )
    );
}

function parseMentionedUserIds(text) {
  const content = String(text || "");
  const ids = new Set();
  const mentionRegex = /<@!?(\d{17,20})>|(\d{17,20})/g;
  let match = null;
  while ((match = mentionRegex.exec(content))) {
    const id = match[1] || match[2];
    if (id) ids.add(id);
  }
  return [...ids];
}

async function resolveShoutoutMembers(guild, userIds) {
  const resolved = [];
  for (const userId of userIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      resolved.push(member);
    }
  }
  return resolved;
}

function buildShoutoutEmbed({ members, reason, extraNotes, actor }) {
  const mentionList = members.map(member => `<@${member.id}>`).join(", ");
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("Shoutout of the Day")
    .setDescription(`${mentionList}\n\n${reason}`)
    .setFooter({ text: `Posted by ${actor.tag} through Tyrone` })
    .setTimestamp(new Date());

  if (extraNotes) {
    embed.addFields({ name: "Extra Notes", value: extraNotes });
  }

  return embed;
}

async function validateShoutoutRoleAccess(guild) {
  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me) {
    return { ok: false, error: "I could not resolve my bot member state in this server." };
  }

  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, error: "I need the Manage Roles permission to rotate the shoutout role." };
  }

  const role = await guild.roles.fetch(SHOUTOUT_ROLE_ID).catch(() => null);
  if (!role) {
    return { ok: false, error: `I could not find the shoutout role (${SHOUTOUT_ROLE_ID}).` };
  }

  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return {
      ok: false,
      error: "My highest role must be above the Shoutout of the Day role to manage it."
    };
  }

  return { ok: true, role, me };
}

async function rotateShoutoutRole(guild, targetMembers) {
  const access = await validateShoutoutRoleAccess(guild);
  if (!access.ok) {
    console.error("[Shoutout] Permission failure:", access.error);
    return {
      ok: false,
      error: access.error,
      removed: [],
      added: []
    };
  }

  await guild.members.fetch().catch(() => null);

  const targetIds = new Set(targetMembers.map(member => member.id));
  const previousHolders = access.role.members.filter(member => !targetIds.has(member.id));
  const removed = [];
  const added = [];

  for (const member of previousHolders.values()) {
    try {
      await member.roles.remove(access.role, "Rotating Shoutout of the Day");
      removed.push(member.id);
    } catch (error) {
      console.error(
        "[Shoutout] Failed to remove role",
        JSON.stringify({ user_id: member.id, role_id: access.role.id, error: error.message })
      );
    }
  }

  for (const member of targetMembers) {
    if (member.roles.cache.has(access.role.id)) continue;
    try {
      await member.roles.add(access.role, "Assigned as Shoutout of the Day");
      added.push(member.id);
    } catch (error) {
      console.error(
        "[Shoutout] Failed to add role",
        JSON.stringify({ user_id: member.id, role_id: access.role.id, error: error.message })
      );
    }
  }

  console.log(
    "[Shoutout] Role rotation complete",
    JSON.stringify({
      removed_user_ids: removed,
      added_user_ids: added,
      target_user_ids: [...targetIds]
    })
  );

  return {
    ok: true,
    role: access.role,
    removed,
    added
  };
}

async function postShoutoutMessage(channel, payload) {
  const sent = await channel.send({
    content: payload.members.map(member => `<@${member.id}>`).join(" "),
    embeds: [
      buildShoutoutEmbed({
        members: payload.members,
        reason: payload.reason,
        extraNotes: payload.extraNotes,
        actor: payload.actor
      })
    ]
  });

  console.log(
    "[Shoutout] Channel post success",
    JSON.stringify({ channel_id: channel.id, message_id: sent.id, user_count: payload.members.length })
  );

  return sent;
}

async function handleInteraction(interaction, { db }) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === "setup-shoutout") {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (!canManageCommunity(interaction.member)) {
      await interaction.reply({
        content: "You do not have permission to manage Shoutout of the Day.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const configuredChannelId = getSettingValue(db, SHOUTOUT_CHANNEL_KEY);
    const requestedChannel = interaction.options.getChannel("channel");
    const targetChannel = requestedChannel || (configuredChannelId ? null : interaction.channel);

    if (requestedChannel || targetChannel) {
      const configChannel = requestedChannel || targetChannel;
      if (!configChannel?.isTextBased?.()) {
        await interaction.reply({
          content: "Choose a text channel for shoutouts.",
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      db.setManyAppSettings({
        [SHOUTOUT_CHANNEL_KEY]: configChannel.id,
        [SHOUTOUT_GUILD_KEY]: interaction.guildId
      });

      console.log(
        "[Shoutout] Setup updated",
        JSON.stringify({
          guild_id: interaction.guildId,
          channel_id: configChannel.id,
          actor_user_id: interaction.user.id
        })
      );
    }

    const selectedUserIds = [
      interaction.options.getUser("user")?.id,
      interaction.options.getUser("user_2")?.id,
      interaction.options.getUser("user_3")?.id
    ].filter(Boolean);

    if (!selectedUserIds.length && requestedChannel) {
      await interaction.reply({
        content:
          `Shoutout channel set to <#${requestedChannel.id}>. Run \`/setup-shoutout\` again with users, or mention users in the modal flow from the command without the channel option.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (!getSettingValue(db, SHOUTOUT_CHANNEL_KEY)) {
      await interaction.reply({
        content: "Set a shoutout channel first by running this command in the target channel or by using the channel option.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    console.log(
      "[Shoutout] Submission flow opened",
      JSON.stringify({
        guild_id: interaction.guildId,
        actor_user_id: interaction.user.id,
        preset_user_ids: selectedUserIds
      })
    );

    await interaction.showModal(buildShoutoutModal([...new Set(selectedUserIds)]));
    return true;
  }

  return false;
}

async function handleModalSubmit(interaction, { db }) {
  if (!interaction.isModalSubmit()) return false;
  if (!String(interaction.customId || "").startsWith(SHOUTOUT_MODAL_PREFIX)) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This form only works in the server.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!canManageCommunity(interaction.member)) {
    await interaction.reply({
      content: "You do not have permission to submit Shoutout of the Day.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const presetUserIds = String(interaction.customId.slice(SHOUTOUT_MODAL_PREFIX.length))
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  const typedUsers = interaction.fields.getTextInputValue(SHOUTOUT_USERS_INPUT_ID).trim();
  const reason = interaction.fields.getTextInputValue(SHOUTOUT_REASON_INPUT_ID).trim();
  const extraNotes = interaction.fields.getTextInputValue(SHOUTOUT_NOTES_INPUT_ID).trim();
  const userIds = [...new Set([...presetUserIds, ...parseMentionedUserIds(typedUsers)])];

  console.log(
    "[Shoutout] Modal submitted",
    JSON.stringify({
      guild_id: interaction.guildId,
      actor_user_id: interaction.user.id,
      target_user_ids: userIds,
      reason_length: reason.length,
      notes_length: extraNotes.length
    })
  );

  if (!userIds.length) {
    await interaction.reply({
      content: "Mention at least one user or choose them in the slash command.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channelId = getSettingValue(db, SHOUTOUT_CHANNEL_KEY);
  if (!channelId) {
    await interaction.editReply("No shoutout channel is configured yet.");
    return true;
  }

  const shoutoutChannel = await interaction.client.channels.fetch(channelId).catch(error => {
    console.error("[Shoutout] Failed to fetch configured channel:", error);
    return null;
  });

  if (!shoutoutChannel?.isTextBased?.()) {
    await interaction.editReply("The configured shoutout channel is missing or not text-based.");
    return true;
  }

  const members = await resolveShoutoutMembers(interaction.guild, userIds);
  if (!members.length) {
    await interaction.editReply("I could not resolve any of those users in this server.");
    return true;
  }

  try {
    await postShoutoutMessage(shoutoutChannel, {
      members,
      reason,
      extraNotes,
      actor: interaction.user
    });
  } catch (error) {
    console.error("[Shoutout] Channel post failed:", error);
    await interaction.editReply("I could not post the shoutout message in the configured channel.");
    return true;
  }

  const roleResult = await rotateShoutoutRole(interaction.guild, members);
  if (!roleResult.ok) {
    await interaction.editReply(
      `I posted the shoutout, but I could not rotate the role: ${roleResult.error}`
    );
    return true;
  }

  await interaction.editReply(
    `Shoutout of the Day posted in <#${channelId}> and the role was updated for ${members.length} user(s).`
  );
  return true;
}

module.exports = {
  handleInteraction,
  handleModalSubmit
};
