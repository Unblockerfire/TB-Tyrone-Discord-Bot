// commands/roleSelect.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

// ------ CONFIG ------

// Where the panels should be posted (optional, but recommended)
const ROLE_PANEL_CHANNEL_ID = process.env.ROLE_PANEL_CHANNEL_ID || null;

// Who can post the panels
const OWNER_ROLE_ID = "1113158001604427966";

// Notification roles
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

// ------ EMBEDS ------

function buildPanelEmbed(kind) {
  const base = new EmbedBuilder().setColor(0x3498db);

  if (kind === "live") {
    return base
      .setTitle("🔴 Live Notifications")
      .setDescription(
        "Get pinged when we go live.\n\n" +
          "Use the buttons below to add or remove the role anytime."
      )
      .addFields({
        name: "What you get",
        value:
          "• Go-live pings\n" +
          "• Stream announcements tied to going live\n\n" +
          "If you only want major updates, use **Announcements** instead.",
        inline: false
      });
  }

  if (kind === "chat") {
    return base
      .setTitle("🟠 Chat Revive")
      .setDescription(
        "Get pinged when the server needs activity (chat revive).\n\n" +
          "Use the buttons below to add or remove the role anytime."
      )
      .addFields({
        name: "What you get",
        value:
          "• Pings when chat is dead\n" +
          "• Community events that need people talking\n\n" +
          "If you hate pings, don’t enable this one.",
        inline: false
      });
  }

  if (kind === "giveaways") {
    return base
      .setTitle("🟢 Giveaways")
      .setDescription(
        "Get pinged when giveaways start or when winners are announced.\n\n" +
          "Use the buttons below to add or remove the role anytime."
      )
      .addFields({
        name: "What you get",
        value:
          "• Giveaway start pings\n" +
          "• Winner announcements (when relevant)\n\n" +
          "If you only care about big news, use **Announcements** instead.",
        inline: false
      });
  }

  if (kind === "announcements") {
    return base
      .setTitle("🔵 Announcements")
      .setDescription(
        "Get pinged for important server updates only.\n\n" +
          "Use the buttons below to add or remove the role anytime."
      )
      .addFields({
        name: "What you get",
        value:
          "• Rule updates\n" +
          "• Major server changes\n" +
          "• Important updates\n\n" +
          "This is the lowest-noise option.",
        inline: false
      });
  }

  // notify-all
  return base
    .setTitle("Notification Roles")
    .setDescription(
      "Pick what you want to be pinged for.\n" +
        "You can add or remove roles anytime using the buttons below.\n\n" +
        "Tip: If you want low spam, only choose **Announcements**."
    )
    .addFields(
      { name: "🔴 Live Notifications", value: "Pinged when we go live.", inline: false },
      { name: "🟠 Chat Revive", value: "Pinged when the server needs activity.", inline: false },
      { name: "🟢 Giveaways", value: "Pinged when giveaways start.", inline: false },
      { name: "🔵 Announcements", value: "Pinged for important updates only.", inline: false }
    );
}

// ------ BUTTON ROWS ------

function buildButtonsFor(kind) {
  const makeAdd = (key, label) =>
    new ButtonBuilder()
      .setCustomId(`notify_add_${key}`)
      .setLabel(`Add ${label}`)
      .setStyle(ButtonStyle.Success);

  const makeRemove = (key, label) =>
    new ButtonBuilder()
      .setCustomId(`notify_remove_${key}`)
      .setLabel(`Remove ${label}`)
      .setStyle(ButtonStyle.Danger);

  if (kind === "live") {
    return [
      new ActionRowBuilder().addComponents(
        makeAdd("live", "Live"),
        makeRemove("live", "Live")
      )
    ];
  }

  if (kind === "chat") {
    return [
      new ActionRowBuilder().addComponents(
        makeAdd("chat", "Chat Revive"),
        makeRemove("chat", "Chat Revive")
      )
    ];
  }

  if (kind === "giveaways") {
    return [
      new ActionRowBuilder().addComponents(
        makeAdd("giveaways", "Giveaways"),
        makeRemove("giveaways", "Giveaways")
      )
    ];
  }

  if (kind === "announcements") {
    return [
      new ActionRowBuilder().addComponents(
        makeAdd("announcements", "Announcements"),
        makeRemove("announcements", "Announcements")
      )
    ];
  }

  // notify-all (8 buttons, split into 2 rows)
  const row1 = new ActionRowBuilder().addComponents(
    makeAdd("live", "Live"),
    makeRemove("live", "Live"),
    makeAdd("chat", "Chat Revive"),
    makeRemove("chat", "Chat Revive")
  );

  const row2 = new ActionRowBuilder().addComponents(
    makeAdd("giveaways", "Giveaways"),
    makeRemove("giveaways", "Giveaways"),
    makeAdd("announcements", "Announcements"),
    makeRemove("announcements", "Announcements")
  );

  return [row1, row2];
}

// ------ SLASH COMMANDS ------
// /setup-live, /setup-chat, /setup-giveaways, /setup-announcements, /setup-notify-all

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const cmd = interaction.commandName;
  const isOurs = [
    "setup-live",
    "setup-chat",
    "setup-giveaways",
    "setup-announcements",
    "setup-notify-all"
  ].includes(cmd);

  if (!isOurs) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true
    });
    return true;
  }

  const member = interaction.member;
  if (!member?.roles?.cache?.has(OWNER_ROLE_ID)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return true;
  }

  if (ROLE_PANEL_CHANNEL_ID && interaction.channelId !== ROLE_PANEL_CHANNEL_ID) {
    await interaction.reply({
      content: `Run this in <#${ROLE_PANEL_CHANNEL_ID}> so the panels stay in the right place.`,
      ephemeral: true
    });
    return true;
  }

  const kind =
    cmd === "setup-live"
      ? "live"
      : cmd === "setup-chat"
        ? "chat"
        : cmd === "setup-giveaways"
          ? "giveaways"
          : cmd === "setup-announcements"
            ? "announcements"
            : "notify-all";

  const embed = buildPanelEmbed(kind);
  const components = buildButtonsFor(kind);

  await interaction.channel.send({ embeds: [embed], components });

  await interaction.reply({
    content: kind === "notify-all" ? "All notification role panels posted ✅" : "Panel posted ✅",
    ephemeral: true
  });

  return true;
}

// ------ BUTTON HANDLER ------

async function handleButton(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("notify_add_") && !id.startsWith("notify_remove_")) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This button only works inside the server.", ephemeral: true });
    return true;
  }

  const action = id.startsWith("notify_add_") ? "add" : "remove";
  const key = id.replace(action === "add" ? "notify_add_" : "notify_remove_", "");
  const cfg = NOTIFY_CONFIG[key];
  if (!cfg) return false;

  const member = interaction.member;
  if (!member?.roles?.cache) {
    await interaction.reply({ content: "Could not find your member data.", ephemeral: true });
    return true;
  }

  const hasRole = member.roles.cache.has(cfg.roleId);

  try {
    if (action === "add") {
      if (hasRole) {
        await interaction.reply({ content: `You already have **${cfg.label}** ✅`, ephemeral: true });
        return true;
      }
      await member.roles.add(cfg.roleId, "User added via role panel");
      await interaction.reply({ content: `Added **${cfg.label}** ✅`, ephemeral: true });
      return true;
    }

    // remove
    if (!hasRole) {
      await interaction.reply({ content: `You don’t have **${cfg.label}** right now.`, ephemeral: true });
      return true;
    }
    await member.roles.remove(cfg.roleId, "User removed via role panel");
    await interaction.reply({ content: `Removed **${cfg.label}** ✅`, ephemeral: true });
    return true;
  } catch (err) {
    console.error("[roleSelect] role update error:", err);
    await interaction.reply({
      content: "I couldn’t update roles. Carson needs to check my role permissions.",
      ephemeral: true
    });
    return true;
  }
}

module.exports = {
  handleInteraction,
  handleButton
};