// commands/songs.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const { searchTrack, addTrackToPlaylist } = require("./spotify");

// sanity check so we can see in logs if Fly is loading this correctly
console.log("[Songs] typeof searchTrack:", typeof searchTrack);
console.log("[Songs] typeof addTrackToPlaylist:", typeof addTrackToPlaylist);

// hardcoded admin review channel for approved requests
const ADMIN_REVIEW_CHANNEL_ID = "1477155955505500261";

// pending request memory
// key = user id
// value = {
//   originalQuery,
//   songName,
//   artist,
//   stage: "confirm" | "awaiting_edit",
//   sourceMessageUrl
// }
const pendingSongRequests = new Map();

function userHasAnyRole(member, roleIds) {
  return roleIds.some(id => member?.roles?.cache?.has(id));
}

function buildUserConfirmEmbed(songName, artist, originalQuery) {
  return new EmbedBuilder()
    .setTitle("Confirm Song Request")
    .setColor(0x1db954)
    .setDescription("Is this the correct song request?")
    .addFields(
      { name: "Song Name", value: songName || "Unknown", inline: false },
      { name: "Artist", value: artist || "Unknown", inline: false },
      { name: "Original Input", value: originalQuery || "None", inline: false }
    )
    .setTimestamp(new Date());
}

function buildAdminEmbed(userId, songName, artist, sourceMessageUrl) {
  return new EmbedBuilder()
    .setTitle("Song Request")
    .setColor(0x1db954)
    .addFields(
      { name: "Song Name", value: songName || "Unknown", inline: false },
      { name: "Artist", value: artist || "Unknown", inline: false },
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
        name: "Channel message",
        value: sourceMessageUrl ? `[Jump to message](${sourceMessageUrl})` : "N/A",
        inline: false
      }
    )
    .setTimestamp(new Date());
}

function buildConfirmButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("songconfirm_yes")
      .setLabel("Yes")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("songconfirm_edit")
      .setLabel("No / Edit")
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

// ---------- MESSAGE HANDLER ----------

async function handleMessage(message) {
  const recommendChannelId = process.env.SONG_RECOMMEND_CHANNEL_ID;

  if (!recommendChannelId) return;
  if (message.author.bot) return;
  if (message.channelId !== recommendChannelId) return;

  const content = (message.content || "").trim();
  const lower = content.toLowerCase();

  // 1) Initial command
  if (lower.startsWith("!rqsong")) {
    const query = content.slice("!rqsong".length).trim();

    if (!query) {
      return message.reply(
        "Please provide a song request, like: `!rqsong Song Name - Artist`"
      );
    }

    // Basic parser: split on " - " first, fallback unknown artist
    let songName = query;
    let artist = "Unknown";

    if (query.includes(" - ")) {
      const parts = query.split(" - ");
      songName = parts[0]?.trim() || "Unknown";
      artist = parts.slice(1).join(" - ").trim() || "Unknown";
    }

    pendingSongRequests.set(message.author.id, {
      originalQuery: query,
      songName,
      artist,
      stage: "confirm",
      sourceMessageUrl: message.url
    });

    const embed = buildUserConfirmEmbed(songName, artist, query);

    await message.reply({
      embeds: [embed],
      components: [buildConfirmButtons()]
    });

    return;
  }

  // 2) Edit follow-up
  const pending = pendingSongRequests.get(message.author.id);
  if (!pending) return;

  if (pending.stage === "awaiting_edit") {
    // expected format: Song Name | Artist Name
    if (!content.includes("|")) {
      await message.reply(
        "Please reply in this format: `Song Name | Artist Name`"
      );
      return;
    }

    const [songRaw, artistRaw] = content.split("|");
    const songName = songRaw?.trim();
    const artist = artistRaw?.trim();

    if (!songName || !artist) {
      await message.reply(
        "I need both parts. Use this format: `Song Name | Artist Name`"
      );
      return;
    }

    pending.songName = songName;
    pending.artist = artist;
    pending.stage = "confirm";

    pendingSongRequests.set(message.author.id, pending);

    const embed = buildUserConfirmEmbed(
      pending.songName,
      pending.artist,
      pending.originalQuery
    );

    await message.reply({
      content: "Got it. Please confirm this updated request.",
      embeds: [embed],
      components: [buildConfirmButtons()]
    });

    return;
  }
}

// ---------- BUTTON HANDLER ----------
// Returns true if handled, false otherwise.

async function handleButton(interaction) {
  const customId = interaction.customId || "";

  // ---------- USER CONFIRM BUTTONS ----------
  if (customId === "songconfirm_yes" || customId === "songconfirm_edit") {
    const pending = pendingSongRequests.get(interaction.user.id);

    if (!pending) {
      await interaction.reply({
        content: "I do not have a pending song request for you right now.",
        ephemeral: true
      });
      return true;
    }

    if (customId === "songconfirm_edit") {
      pending.stage = "awaiting_edit";
      pendingSongRequests.set(interaction.user.id, pending);

      await interaction.reply({
        content:
          "Alright, send the corrected info in this channel like this:\n`Song Name | Artist Name`",
        ephemeral: true
      });

      return true;
    }

    // YES path → send to admin review channel
    const adminChannel = await interaction.guild.channels
      .fetch(ADMIN_REVIEW_CHANNEL_ID)
      .catch(() => null);

    if (!adminChannel || !adminChannel.isTextBased()) {
      await interaction.reply({
        content: "Admin review channel is invalid or missing.",
        ephemeral: true
      });
      return true;
    }

    const requestId = `${Date.now()}_${interaction.user.id}`;

    const embed = buildAdminEmbed(
      interaction.user.id,
      pending.songName,
      pending.artist,
      pending.sourceMessageUrl
    );

    await adminChannel.send({
      content: `New song request from <@${interaction.user.id}>`,
      embeds: [embed],
      components: [buildAdminButtons(requestId)]
    });

    pendingSongRequests.delete(interaction.user.id);

    await interaction.reply({
      content: "Your song request has been sent to the admin review channel.",
      ephemeral: true
    });

    return true;
  }

  // ---------- ADMIN APPROVE / DECLINE ----------
  const [action] = customId.split("_");

  if (action !== "songapprove" && action !== "songdecline") {
    return false;
  }

  const approverRoleIds = (process.env.APPROVER_ROLE_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const playlistId = process.env.SPOTIFY_PLAYLIST_ID;

  const member = interaction.member;
  if (!userHasAnyRole(member, approverRoleIds)) {
    await interaction.reply({
      content: "You do not have permission to approve or decline song requests.",
      ephemeral: true
    });
    return true;
  }

  if (
    !interaction.message ||
    !interaction.message.embeds ||
    interaction.message.embeds.length === 0
  ) {
    await interaction.reply({
      content: "This song request has no data attached.",
      ephemeral: true
    });
    return true;
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const fields = embed.data.fields || [];

  const songField = fields.find(f => f.name === "Song Name");
  const artistField = fields.find(f => f.name === "Artist");
  const statusField = fields.find(f => f.name === "Status");

  const songName = songField ? songField.value : null;
  const artist = artistField ? artistField.value : null;

  if (!songName) {
    await interaction.reply({
      content: "Could not find the song info on this request.",
      ephemeral: true
    });
    return true;
  }

  if (statusField && statusField.value !== "Pending approval") {
    await interaction.reply({
      content: `This song request is already processed. Current status: **${statusField.value}**`,
      ephemeral: true
    });
    return true;
  }

  // Decline path
  if (action === "songdecline") {
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

    await interaction.followUp({
      content: "Song request declined.",
      ephemeral: true
    });

    return true;
  }

  // Approve path
  let resultText = "";
  const searchQuery =
    artist && artist !== "Unknown" ? `${songName} - ${artist}` : songName;

  try {
    if (!playlistId) {
      resultText = "Spotify playlist is not configured on the bot.";
    } else {
      const track = await searchTrack(searchQuery);

      if (!track) {
        resultText = "Could not find that song on Spotify.";
      } else {
        await addTrackToPlaylist(playlistId, track.uri);
        const artists = track.artists.join(", ");
        resultText =
          `Added **${track.name}** by **${artists}** to the stream playlist.\n` +
          (track.url ? track.url : "");
      }
    }
  } catch (err) {
    console.error("Spotify add track error:", err);
    resultText = "Failed to add song to Spotify playlist. Check logs and credentials.";
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

  await interaction.followUp({
    content: resultText,
    ephemeral: true
  });

  return true;
}

module.exports = {
  handleMessage,
  handleButton
};


