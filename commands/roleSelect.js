// commands/roleSelect.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require("discord.js");

// ------ CONFIG ------

// Where the panels should be posted (optional, but recommended)
const ROLE_PANEL_CHANNEL_ID = process.env.ROLE_PANEL_CHANNEL_ID || null;
const ROLE_SELECT_CHANNEL_ID = "1114408119569756160";

// Who can post the panels
const OWNER_ROLE_ID = "1113158001604427966";
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";

// Notification roles
const ROLE_LIVE = "1477879260860387340";
const ROLE_CHAT = "1477879653342646434";
const ROLE_GIVEAWAYS = "1477879786285305887";
const ROLE_ANNOUNCEMENTS = "1477879887007187125";
const SERVER_CONFIG = {
  nae: { roleId: "1491999942653251584", label: "NAE", emoji: "🗽" },
  naw: { roleId: "1491999996843790436", label: "NAW", emoji: "🌄" },
  nac: { roleId: "1492000052133236866", label: "NAC", emoji: "🌪️" },
  oce: { roleId: "1492000393205514240", label: "OCE", emoji: "🌊" },
  eu: { roleId: "1492000445382529055", label: "EU", emoji: "🏰" },
  asia: { roleId: "1492000504904028160", label: "ASIA", emoji: "🐉" },
  brazil: { roleId: "1492000582133874809", label: "Brazil", emoji: "🌴" },
  middle_east: { roleId: "1492000638798663731", label: "Middle East", emoji: "🏜️" }
};

const PLAYER_TYPE_CONFIG = {
  comp_player: { roleId: "1492000994060537967", label: "Comp Player", emoji: "🏆" },
  casual_player: { roleId: "1492001077992620143", label: "Casual Player", emoji: "🎮" },
  creative_warrior: { roleId: "1492001124545331220", label: "Creative Warrior", emoji: "🛠️" },
  zone_wars_grinder: { roleId: "1492001206929981521", label: "Zone Wars Grinder", emoji: "⚔️" },
  box_fight_demon: { roleId: "1492001303369351168", label: "Box Fight Demon", emoji: "🥊" },
  scrim_player: { roleId: "1492001409338441768", label: "Scrim Player", emoji: "📋" },
  tournament_player: { roleId: "1492001506923384984", label: "Tournament Player", emoji: "🎯" }
};

const NOTIFY_CONFIG = {
  live: { roleId: ROLE_LIVE, label: "Live Notifications", emoji: "🔴" },
  chat: { roleId: ROLE_CHAT, label: "Chat Revive", emoji: "🟠" },
  giveaways: { roleId: ROLE_GIVEAWAYS, label: "Giveaways", emoji: "🟢" },
  announcements: { roleId: ROLE_ANNOUNCEMENTS, label: "Announcements", emoji: "🔵" }
};

const TOGGLE_BUTTON_PREFIX = "role_toggle_";

// ------ EMBEDS ------

function buildPanelEmbed(kind) {
  const base = new EmbedBuilder().setColor(0x3498db);

  if (kind === "live") {
    return base
      .setTitle("🚨 Live Alerts")
      .setDescription(
        "Be first in chat when the stream goes live.\n\n" +
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
      .setTitle("💬 Chat Revive")
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
      .setTitle("🎁 Giveaways")
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
      .setTitle("📣 Announcements")
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

  if (kind === "servers") {
    return base
      .setColor(0x5865f2)
      .setTitle("🌍 Fortnite Servers")
      .setDescription(
        "Pick every region you actively play on.\n\n" +
          "Tap any button below to toggle that server role on or off."
      )
      .addFields({
        name: "🌍 Servers",
        value:
          "• NAE\n" +
          "• NAW\n" +
          "• NAC\n" +
          "• OCE\n" +
          "• EU\n" +
          "• ASIA\n" +
          "• Brazil\n" +
          "• Middle East",
        inline: false
      });
  }

  if (kind === "player-types") {
    return base
      .setColor(0xf1c40f)
      .setTitle("🎯 What Player Are You?")
      .setDescription(
        "Show people how you like to play.\n\n" +
          "Tap any button below to toggle that player type on or off."
      )
      .addFields({
        name: "🎯 Player Types",
        value:
          "• Comp Player\n" +
          "• Casual Player\n" +
          "• Creative Warrior\n" +
          "• Zone Wars Grinder\n" +
          "• Box Fight Demon\n" +
          "• Scrim Player\n" +
          "• Tournament Player",
        inline: false
      });
  }

  if (kind === "notify-main") {
    return base
      .setColor(0x2ecc71)
      .setTitle("🌟 Stay In The Loop")
      .setDescription(
        "Choose the pings you actually want for the main high-activity updates.\n\n" +
          "Tap any button below to toggle these roles on or off anytime."
      )
      .addFields(
        { name: "🚨 Live Alerts", value: "Pinged when we go live.", inline: false },
        { name: "💬 Chat Revive", value: "Pinged when the server needs activity.", inline: false },
        { name: "🎁 Giveaways", value: "Pinged when giveaways start.", inline: false }
      );
  }

  // notify-all
  return base
    .setTitle("🌟 Stay In The Loop")
    .setDescription(
      "Choose the pings you actually want.\n\n" +
        "Tap any button below to toggle these roles on or off anytime.\n\n" +
        "If you want the lowest-noise option, only pick **Announcements**."
    )
    .addFields(
      { name: "🚨 Live Alerts", value: "Pinged when we go live.", inline: false },
      { name: "💬 Chat Revive", value: "Pinged when the server needs activity.", inline: false },
      { name: "🎁 Giveaways", value: "Pinged when giveaways start.", inline: false },
      { name: "📣 Announcements", value: "Pinged for important updates only.", inline: false }
    );
}

// ------ BUTTON ROWS ------

function buildComponentsFor(kind) {
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

  const makeToggle = (prefix, key, cfg) =>
    new ButtonBuilder()
      .setCustomId(`${prefix}${key}`)
      .setLabel(cfg.label)
      .setEmoji(cfg.emoji)
      .setStyle(ButtonStyle.Secondary);

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

  if (kind === "servers") {
    return [
      new ActionRowBuilder().addComponents(
        ...Object.entries(SERVER_CONFIG).slice(0, 4).map(([key, cfg]) =>
          makeToggle(TOGGLE_BUTTON_PREFIX, `server:${key}`, cfg)
        )
      ),
      new ActionRowBuilder().addComponents(
        ...Object.entries(SERVER_CONFIG).slice(4).map(([key, cfg]) =>
          makeToggle(TOGGLE_BUTTON_PREFIX, `server:${key}`, cfg)
        )
      )
    ];
  }

  if (kind === "player-types") {
    return [
      new ActionRowBuilder().addComponents(
        ...Object.entries(PLAYER_TYPE_CONFIG).slice(0, 4).map(([key, cfg]) =>
          makeToggle(TOGGLE_BUTTON_PREFIX, `player:${key}`, cfg)
        )
      ),
      new ActionRowBuilder().addComponents(
        ...Object.entries(PLAYER_TYPE_CONFIG).slice(4).map(([key, cfg]) =>
          makeToggle(TOGGLE_BUTTON_PREFIX, `player:${key}`, cfg)
        )
      )
    ];
  }

  if (kind === "notify-main") {
    return [
      new ActionRowBuilder().addComponents(
        ...["live", "chat", "giveaways"].map(key =>
          makeToggle(TOGGLE_BUTTON_PREFIX, `notify:${key}`, NOTIFY_CONFIG[key])
        )
      )
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      ...["live", "chat", "giveaways"].map(key =>
        makeToggle(TOGGLE_BUTTON_PREFIX, `notify:${key}`, NOTIFY_CONFIG[key])
      )
    ),
    new ActionRowBuilder().addComponents(
      ...["announcements"].map(key =>
        makeToggle(TOGGLE_BUTTON_PREFIX, `notify:${key}`, NOTIFY_CONFIG[key])
      )
    )
  ];
}

function isManagePanelMember(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
  return [OWNER_ROLE_ID, ADMIN_ROLE_ID].filter(Boolean).some(roleId => member.roles?.cache?.has?.(roleId));
}

function getPanelSweepTitles(kind) {
  if (kind === "role-select") {
    return new Set(["🎮 Fortnite Role Select", "🌍 Fortnite Servers", "🎯 What Player Are You?"]);
  }

  if (kind === "servers") {
    return new Set(["🎮 Fortnite Role Select", "🌍 Fortnite Servers"]);
  }

  if (kind === "player-types") {
    return new Set(["🎮 Fortnite Role Select", "🎯 What Player Are You?"]);
  }

  if (kind === "notify-main") {
    return new Set([
      "🌟 Stay In The Loop",
      "Notification Roles",
      "🚨 Live Alerts",
      "💬 Chat Revive",
      "🎁 Giveaways"
    ]);
  }

  if (kind === "notify-all") {
    return new Set([
      "🌟 Stay In The Loop",
      "Notification Roles",
      "🚨 Live Alerts",
      "💬 Chat Revive",
      "🎁 Giveaways",
      "📣 Announcements",
      "🔴 Live Notifications",
      "🟠 Chat Revive",
      "🟢 Giveaways",
      "🔵 Announcements"
    ]);
  }

  return new Set([buildPanelEmbed(kind).data?.title].filter(Boolean));
}

async function deleteExistingPanels(channel, botUserId, kind) {
  if (!channel?.isTextBased?.()) return 0;
  const titles = getPanelSweepTitles(kind);
  const recentMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recentMessages) return 0;

  let deleted = 0;
  for (const message of recentMessages.values()) {
    if (botUserId && message.author?.id !== botUserId) continue;
    const hasMatchingTitle = (message.embeds || []).some(embed => titles.has(embed.title));
    if (!hasMatchingTitle) continue;
    await message.delete().catch(() => null);
    deleted += 1;
  }
  return deleted;
}

// ------ SLASH COMMANDS ------
// /role-select, /setup-notis, plus legacy setup commands

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const cmd = interaction.commandName;
  const isOurs = [
    "role-select1",
    "role-select2",
    "setup-notis",
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
  if (!isManagePanelMember(member)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return true;
  }

  if ((cmd === "role-select1" || cmd === "role-select2") && interaction.channelId !== ROLE_SELECT_CHANNEL_ID) {
    await interaction.reply({
      content: `Run this in <#${ROLE_SELECT_CHANNEL_ID}> so the role select stays in the right place.`,
      ephemeral: true
    });
    return true;
  }

  if (cmd === "setup-notis" && ROLE_PANEL_CHANNEL_ID && interaction.channelId !== ROLE_PANEL_CHANNEL_ID) {
    await interaction.reply({
      content: `Run this in <#${ROLE_PANEL_CHANNEL_ID}> so the notification panel stays in the right place.`,
      ephemeral: true
    });
    return true;
  }

  const kind =
    cmd === "role-select1"
      ? "servers"
      : cmd === "role-select2"
        ? "player-types"
        : cmd === "setup-notis"
          ? "notify-all"
        : cmd === "setup-live"
      ? "live"
        : cmd === "setup-chat"
        ? "chat"
        : cmd === "setup-giveaways"
          ? "giveaways"
          : cmd === "setup-announcements"
            ? "announcements"
            : "notify-all";

  const embed = buildPanelEmbed(kind);
  const components = buildComponentsFor(kind);

  const deletedCount = await deleteExistingPanels(interaction.channel, interaction.client.user?.id, kind);
  await interaction.channel.send({ embeds: [embed], components });

  await interaction.reply({
    content:
      kind === "role-select"
        ? `Role select updated ✅ Deleted ${deletedCount} older panel(s).`
        : kind === "servers" || kind === "player-types"
          ? `Role section updated ✅ Deleted ${deletedCount} older panel(s).`
          : kind === "notify-all" || kind === "notify-main" || kind === "notify-extra"
            ? `Notifications updated ✅ Deleted ${deletedCount} older panel(s).`
          : "Panel posted ✅",
      ephemeral: true
  });

  return true;
}

// ------ BUTTON HANDLER ------

async function handleButton(interaction) {
  const id = interaction.customId || "";
  const isNotifyButton = id.startsWith("notify_add_") || id.startsWith("notify_remove_");
  const isToggleButton = id.startsWith(TOGGLE_BUTTON_PREFIX);
  if (!isNotifyButton && !isToggleButton) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This button only works inside the server.", ephemeral: true });
    return true;
  }

  const action = id.startsWith("notify_add_") ? "add" : "remove";
  let cfg = null;

  if (isToggleButton) {
    const rawKey = id.replace(TOGGLE_BUTTON_PREFIX, "");
    const [group, key] = rawKey.split(":");
    if (group === "player") cfg = PLAYER_TYPE_CONFIG[key];
    if (group === "server") cfg = SERVER_CONFIG[key];
    if (group === "notify") cfg = NOTIFY_CONFIG[key];
  } else {
    const key = id.replace(action === "add" ? "notify_add_" : "notify_remove_", "");
    cfg = NOTIFY_CONFIG[key];
  }

  if (!cfg) return false;

  const member = interaction.member;
  if (!member?.roles?.cache) {
    await interaction.reply({ content: "Could not find your member data.", ephemeral: true });
    return true;
  }

  const hasRole = member.roles.cache.has(cfg.roleId);

  try {
    if (isToggleButton) {
      if (hasRole) {
        await member.roles.remove(cfg.roleId, "User removed via role toggle panel");
        await interaction.reply({ content: `Removed **${cfg.label}** ✅`, ephemeral: true });
        return true;
      }

      await member.roles.add(cfg.roleId, "User added via role toggle panel");
      await interaction.reply({ content: `Added **${cfg.label}** ✅`, ephemeral: true });
      return true;
    }

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

async function handleSelectMenu(interaction) {
  const id = interaction.customId || "";
  const configMap =
    id === "roles_servers"
      ? SERVER_CONFIG
      : id === "roles_player_types"
        ? PLAYER_TYPE_CONFIG
        : id === "roles_notifications" || id === "roles_notifications_main" || id === "roles_notifications_extra"
          ? NOTIFY_CONFIG
        : null;

  if (!configMap) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This menu only works inside the server.", ephemeral: true });
    return true;
  }

  const member = interaction.member;
  if (!member?.roles?.cache) {
    await interaction.reply({ content: "Could not find your member data.", ephemeral: true });
    return true;
  }

  const selectedKeys = new Set(interaction.values || []);
  const allRoleIds = Object.values(configMap).map(cfg => cfg.roleId);
  const roleIdsToAdd = [];
  const roleIdsToRemove = [];

  for (const [key, cfg] of Object.entries(configMap)) {
    const hasRole = member.roles.cache.has(cfg.roleId);
    if (selectedKeys.has(key) && !hasRole) roleIdsToAdd.push(cfg.roleId);
    if (!selectedKeys.has(key) && hasRole) roleIdsToRemove.push(cfg.roleId);
  }

  try {
    if (roleIdsToRemove.length) {
      await member.roles.remove(roleIdsToRemove, "User updated roles via role select");
    }

    if (roleIdsToAdd.length) {
      await member.roles.add(roleIdsToAdd, "User updated roles via role select");
    }

    const selectedLabels = Object.entries(configMap)
      .filter(([key]) => selectedKeys.has(key))
      .map(([, cfg]) => `${cfg.emoji} ${cfg.label}`);

    await interaction.reply({
      content: selectedLabels.length
        ? `Updated your roles ✅\n${selectedLabels.join("\n")}`
        : "Cleared all roles from this section ✅",
      ephemeral: true
    });
    return true;
  } catch (err) {
    console.error("[roleSelect] select menu update error:", err);
    await interaction.reply({
      content: "I couldn’t update those roles. Carson needs to check my role permissions.",
      ephemeral: true
    });
    return true;
  }
}

module.exports = {
  handleInteraction,
  handleButton,
  handleSelectMenu
};
