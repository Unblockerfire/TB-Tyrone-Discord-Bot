const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const ADMIN_REVIEW_CHANNEL_ID = "1477155955505500261";
const RQSONG_PANEL_CHANNEL_KEY = "songs.panel.channel_id";
const RQSONG_PANEL_MESSAGE_KEY = "songs.panel.message_id";

const RQSONG_OPEN_BUTTON_ID = "rqsong_open_modal";
const RQSONG_MODAL_ID = "rqsong_request_modal";
const RQSONG_SONG_INPUT_ID = "rqsong_song_input";
const RQSONG_ARTIST_INPUT_ID = "rqsong_artist_input";
const RQSONG_CONFIRM_ID = "songconfirm_yes";
const RQSONG_EDIT_ID = "songconfirm_edit";

const pendingSongRequests = new Map();

function userHasAnyRole(member, roleIds) {
  return roleIds.some(id => member?.roles?.cache?.has(id));
}

function canSetupSongPanel(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageChannels)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
  return false;
}

function buildPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Song Requests")
        .setColor(0x1db954)
        .setDescription(
          "Click the button below to request a song.\n" +
          "Tyrone will collect the song name and artist, then let you confirm it before it gets submitted."
        )
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(RQSONG_OPEN_BUTTON_ID)
          .setLabel("Request a Song")
          .setStyle(ButtonStyle.Primary)
      )
    ]
  };
}

function isSongPanelMessage(message, botUserId) {
  if (!message) return false;
  if (botUserId && message.author?.id !== botUserId) return false;

  const hasMatchingEmbed = message.embeds?.some(embed => embed.title === "Song Requests");
  const hasMatchingButton = message.components?.some(row =>
    row.components?.some(component => component.customId === RQSONG_OPEN_BUTTON_ID)
  );

  return Boolean(hasMatchingEmbed && hasMatchingButton);
}

async function deleteExistingSongPanels(channel, botUserId) {
  if (!channel?.isTextBased?.()) return 0;

  let deleted = 0;
  const recentMessages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!recentMessages) return 0;

  for (const message of recentMessages.values()) {
    if (!isSongPanelMessage(message, botUserId)) continue;
    await message.delete().catch(() => null);
    deleted += 1;
  }

  return deleted;
}

function buildSongRequestModal(defaults = {}) {
  return new ModalBuilder()
    .setCustomId(RQSONG_MODAL_ID)
    .setTitle("Request a Song")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(RQSONG_SONG_INPUT_ID)
          .setLabel("Song")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(150)
          .setValue(defaults.song || "")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(RQSONG_ARTIST_INPUT_ID)
          .setLabel("Artist")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(150)
          .setValue(defaults.artist || "")
      )
    );
}

function buildUserConfirmEmbed(pending) {
  return new EmbedBuilder()
    .setTitle("Confirm Song Request")
    .setColor(0x1db954)
    .setDescription("Is this the correct song request?")
    .addFields(
      { name: "Song Name", value: pending.songInput || "Unknown", inline: false },
      { name: "Artist", value: pending.artistInput || "Unknown", inline: false }
    )
    .setTimestamp(new Date());
}

function buildAdminEmbed(userId, pending) {
  return new EmbedBuilder()
    .setTitle("Song Request")
    .setColor(0x1db954)
    .addFields(
      { name: "Song Name", value: pending.songInput || "Unknown", inline: false },
      { name: "Artist", value: pending.artistInput || "Unknown", inline: false },
      {
        name: "Requested by",
        value: `<@${userId}> (${userId})`,
        inline: false
      },
      {
        name: "Status",
        value: "Pending approval",
        inline: true
      },
      {
        name: "Submitted From",
        value: "Tyrone song request panel",
        inline: false
      }
    )
    .setTimestamp(new Date());
}

function buildConfirmButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(RQSONG_CONFIRM_ID)
      .setLabel("Submit")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(RQSONG_EDIT_ID)
      .setLabel("Edit Search")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildAdminButtons(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`songapprove_${requestId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`songdecline_${requestId}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
  );
}

async function handleInteraction(interaction, { db } = {}) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "setup-rqsong") return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!canSetupSongPanel(interaction.member)) {
    await interaction.reply({
      content: "You do not have permission to post the song request panel.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const deletedCount = await deleteExistingSongPanels(interaction.channel, interaction.client.user?.id);
  const posted = await interaction.channel.send(buildPanelPayload());
  db?.setManyAppSettings?.({
    [RQSONG_PANEL_CHANNEL_KEY]: posted.channelId,
    [RQSONG_PANEL_MESSAGE_KEY]: posted.id
  });

  console.log(
    "[Songs] Panel setup",
    JSON.stringify({
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      user_id: interaction.user.id,
      deleted_previous_count: deletedCount
    })
  );

  await interaction.reply({
    content: "Song request panel posted ✅",
    flags: MessageFlags.Ephemeral
  });

  return true;
}

async function handleMessage() {
  return false;
}

async function handleButton(interaction) {
  const customId = interaction.customId || "";

  if (customId === RQSONG_OPEN_BUTTON_ID) {
    await interaction.showModal(buildSongRequestModal());
    return true;
  }

  if (customId === RQSONG_CONFIRM_ID || customId === RQSONG_EDIT_ID) {
    const pending = pendingSongRequests.get(interaction.user.id);

    if (!pending) {
      await interaction.reply({
        content: "I do not have a pending song request for you right now.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (customId === RQSONG_EDIT_ID) {
      await interaction.showModal(
        buildSongRequestModal({
          song: pending.songInput,
          artist: pending.artistInput
        })
      );
      return true;
    }

    const adminChannel = await interaction.guild.channels
      .fetch(ADMIN_REVIEW_CHANNEL_ID)
      .catch(() => null);

    if (!adminChannel || !adminChannel.isTextBased()) {
      await interaction.reply({
        content: "Admin review channel is invalid or missing.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const requestId = `${Date.now()}_${interaction.user.id}`;
    const embed = buildAdminEmbed(interaction.user.id, pending);

    await adminChannel.send({
      content: `New song request from <@${interaction.user.id}>`,
      embeds: [embed],
      components: [buildAdminButtons(requestId)]
    });

    pendingSongRequests.delete(interaction.user.id);

    await interaction.reply({
      content: "Your song request has been sent to the admin review channel.",
      flags: MessageFlags.Ephemeral
    });

    return true;
  }

  const [action] = customId.split("_");
  if (action !== "songapprove" && action !== "songdecline") {
    return false;
  }

  const approverRoleIds = (process.env.APPROVER_ROLE_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const member = interaction.member;

  if (!userHasAnyRole(member, approverRoleIds)) {
    await interaction.reply({
      content: "You do not have permission to approve or decline song requests.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!interaction.message?.embeds?.length) {
    await interaction.reply({
      content: "This song request has no data attached.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const fields = embed.data.fields || [];
  const songField = fields.find(field => field.name === "Song Name");
  const artistField = fields.find(field => field.name === "Artist");
  const statusField = fields.find(field => field.name === "Status");

  const songName = songField ? songField.value : null;
  const artist = artistField ? artistField.value : null;

  if (!songName) {
    await interaction.reply({
      content: "Could not find the song info on this request.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (statusField && statusField.value !== "Pending approval") {
    await interaction.reply({
      content: `This song request is already processed. Current status: **${statusField.value}**`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === "songdecline") {
    embed.setFields(
      fields.map(field => {
        if (field.name === "Status") {
          return {
            name: "Status",
            value: `Declined by <@${interaction.user.id}>`,
            inline: field.inline
          };
        }
        return field;
      })
    );

    await interaction.update({
      content: interaction.message.content,
      embeds: [embed],
      components: []
    });

    await interaction.followUp({
      content: "Song request declined.",
      flags: MessageFlags.Ephemeral
    });

    return true;
  }

  embed.setFields(
    fields.map(field => {
      if (field.name === "Status") {
        return {
          name: "Status",
          value: `Approved by <@${interaction.user.id}>`,
          inline: field.inline
        };
      }
      return field;
    })
  );

  await interaction.update({
    content: interaction.message.content,
    embeds: [embed],
    components: []
  });

  await interaction.followUp({
    content: `Approved **${songName}** by **${artist || "Unknown"}**.`,
    flags: MessageFlags.Ephemeral
  });

  return true;
}

async function handleModalSubmit(interaction) {
  if (!interaction.isModalSubmit()) return false;
  if (interaction.customId !== RQSONG_MODAL_ID) return false;

  const songInput = interaction.fields.getTextInputValue(RQSONG_SONG_INPUT_ID).trim();
  const artistInput = interaction.fields.getTextInputValue(RQSONG_ARTIST_INPUT_ID).trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const pending = {
    songInput,
    artistInput
  };

  pendingSongRequests.set(interaction.user.id, pending);

  await interaction.editReply({
    embeds: [buildUserConfirmEmbed(pending)],
    components: [buildConfirmButtons()]
  });

  return true;
}

async function refreshSongPanel(client, db, { reason = "manual_refresh" } = {}) {
  const channelId = db?.getAppSetting?.(RQSONG_PANEL_CHANNEL_KEY)?.value || process.env.SONG_RECOMMEND_CHANNEL_ID;
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const deletedCount = await deleteExistingSongPanels(channel, client.user?.id);
  const posted = await channel.send(buildPanelPayload());
  db?.setManyAppSettings?.({
    [RQSONG_PANEL_CHANNEL_KEY]: posted.channelId,
    [RQSONG_PANEL_MESSAGE_KEY]: posted.id
  });

  console.log(
    "[Songs] Panel refreshed",
    JSON.stringify({
      reason,
      channel_id: posted.channelId,
      message_id: posted.id,
      deleted_previous_count: deletedCount
    })
  );

  return true;
}

module.exports = {
  handleInteraction,
  handleMessage,
  handleButton,
  handleModalSubmit,
  refreshSongPanel
};
