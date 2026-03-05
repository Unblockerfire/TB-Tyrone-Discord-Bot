// commands/roleSelect.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

// ------ CONFIG ------

// Where the panel should be posted (optional, but recommended)
const ROLE_PANEL_CHANNEL_ID = process.env.ROLE_PANEL_CHANNEL_ID || null;

// Who can post the panel
const OWNER_ROLE_ID = "1113158001604427966";

// Notification roles (your IDs from earlier)
const ROLE_LIVE = "1477879260860387340";
const ROLE_CHAT = "1477879653342646434";
const ROLE_GIVEAWAYS = "1477879786285305887";
const ROLE_ANNOUNCEMENTS = "1477879887007187125";

const NOTIFY_CONFIG = {
  live: { roleId: ROLE_LIVE, label: "Live Notifications", emoji: "🔴" },
  chat: { roleId: ROLE_CHAT, label: "Chat Revive", emoji: "🟠" },
  giveaways: { roleId: ROLE_GIVEAWAYS, label: "Giveaways", emoji: "🟢" },
  announcements: { roleId: ROLE_ANNOUNCEMENTS, label: "Announcements", emoji: "🔵" }
};

// ------ SLASH COMMAND: /setup-role-panel ------
async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "setup-role-panel") return;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }

  const member = interaction.member;
  if (!member?.roles?.cache?.has(OWNER_ROLE_ID)) {
    await interaction.reply({ content: "You do not have permission to run this command.", ephemeral: true });
    return;
  }

  if (ROLE_PANEL_CHANNEL_ID && interaction.channelId !== ROLE_PANEL_CHANNEL_ID) {
    await interaction.reply({
      content: `Run this in <#${ROLE_PANEL_CHANNEL_ID}> so the panel stays in the right place.`,
      ephemeral: true
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Notification Roles")
    .setColor(0x3498db)
    .setDescription(
      "Pick what you want to be pinged for.\n" +
      "You can add or remove roles anytime using the buttons below."
    )
    .addFields(
      { name: "🔴 Live Notifications", value: "Pinged when we go live.", inline: false },
      { name: "🟠 Chat Revive", value: "Pinged when the server needs activity.", inline: false },
      { name: "🟢 Giveaways", value: "Pinged when giveaways start.", inline: false },
      { name: "🔵 Announcements", value: "Pinged for important announcements.", inline: false }
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("notify_toggle_live").setLabel("🔴 Live").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("notify_toggle_chat").setLabel("🟠 Chat").setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("notify_toggle_giveaways").setLabel("🟢 Giveaways").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("notify_toggle_announcements").setLabel("🔵 Announcements").setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({ embeds: [embed], components: [row1, row2] });

  await interaction.reply({ content: "Role panel posted ✅", ephemeral: true });
}

// ------ BUTTON HANDLER ------
async function handleButton(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("notify_toggle_")) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This button only works inside the server.", ephemeral: true });
    return true;
  }

  const key = id.replace("notify_toggle_", "");
  const cfg = NOTIFY_CONFIG[key];
  if (!cfg) return false;

  const member = interaction.member;
  if (!member?.roles?.cache) {
    await interaction.reply({ content: "Could not find your member data.", ephemeral: true });
    return true;
  }

  const hasRole = member.roles.cache.has(cfg.roleId);

  try {
    if (hasRole) {
      await member.roles.remove(cfg.roleId, "User toggled off via role panel");
      await interaction.reply({ content: `Removed **${cfg.label}** ✅`, ephemeral: true });
    } else {
      await member.roles.add(cfg.roleId, "User toggled on via role panel");
      await interaction.reply({ content: `Added **${cfg.label}** ✅`, ephemeral: true });
    }
  } catch (err) {
    console.error("[roleSelect] toggle error:", err);
    await interaction.reply({
      content: "I couldn’t update roles. Carson needs to check my role permissions.",
      ephemeral: true
    });
  }

  return true;
}

module.exports = {
  handleInteraction,
  handleButton
};