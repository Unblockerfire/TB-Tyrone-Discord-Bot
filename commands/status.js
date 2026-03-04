// commands/status.js
const { EmbedBuilder } = require("discord.js");

// hard lock: only this user can change the status
const OWNER_USER_ID = "796968805196627978";

// ---------- INTERACTION HANDLER ----------

async function handleInteraction(interaction, { db }) {
  const commandName = interaction.commandName;

  if (commandName === "set-status") {
    return handleSetStatus(interaction, { db });
  }

  if (commandName === "clear-status") {
    return handleClearStatus(interaction, { db });
  }
}

// ---------- MESSAGE HANDLER ----------

async function handleMessage(message, { db }) {
  if (message.author.bot) return;

  const mentioned = message.mentions.users;
  if (!mentioned || mentioned.size === 0) return;

  // only react when they ping you
  if (!mentioned.has(OWNER_USER_ID)) return;

  const statusRow = db.getUserStatus(OWNER_USER_ID);
  if (!statusRow) return;

  const status = statusRow.status;
  const note = statusRow.note;
  const updatedAt = new Date(statusRow.updated_at);

  // optional extra text field for when the status should clear
  const clearAt = statusRow.clear_at || null;

  const embed = new EmbedBuilder()
    .setTitle("Status")
    .setColor(0x2ecc71)
    .setDescription(
      `<@${OWNER_USER_ID}> is currently **${status}**.` +
        (note ? `\nNote: ${note}` : "") +
        (clearAt ? `\nExpected clear: ${clearAt}` : "")
    )
    .setFooter({ text: `Last updated: ${updatedAt.toLocaleString()}` });

  await message.reply({ embeds: [embed] });
}

// ---------- /set-status IMPLEMENTATION ----------

async function handleSetStatus(interaction, { db }) {
  // only allow the owner to run this
  if (interaction.user.id !== OWNER_USER_ID) {
    return interaction.reply({
      content: "Only Carson can change this status.",
      ephemeral: true
    });
  }

  const status = interaction.options.getString("status", true);
  const note = interaction.options.getString("note") || null;

  // New optional field: manual clear text
  // Examples: "9:30 PM MST", "after stream", "tomorrow morning"
  const clearAt = interaction.options.getString("clearat") || null;

  // Always save status under the owner ID
  db.setUserStatus(OWNER_USER_ID, status, note, clearAt);

  let replyText = `Your status has been set to **${status}**`;
  if (note) replyText += ` with note: ${note}`;
  if (clearAt) replyText += `\nExpected clear: ${clearAt}`;
  replyText += ".";

  await interaction.reply({
    content: replyText,
    ephemeral: true
  });
}

// ---------- /clear-status IMPLEMENTATION ----------

async function handleClearStatus(interaction, { db }) {
  // only allow the owner to run this
  if (interaction.user.id !== OWNER_USER_ID) {
    return interaction.reply({
      content: "Only Carson can clear this status.",
      ephemeral: true
    });
  }

  db.clearUserStatus(OWNER_USER_ID);

  await interaction.reply({
    content: "Your status has been cleared.",
    ephemeral: true
  });
}

module.exports = {
  handleInteraction,
  handleMessage
};


