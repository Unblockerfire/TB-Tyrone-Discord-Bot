const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const moderation = require("./moderation");

const OWNER_ROLE_ID = "1113158001604427966";
const TYRONE_CLEANUP_ALLOWED_ROLE_ID = "1112945506549768302";
const CHECKLIST_EMPTY_TEXT = "Nothing needs done at this time";
const CHECKLIST_CUSTOM_ID_ADD = "checklist_add_item";
const CHECKLIST_CUSTOM_ID_REMOVE = "checklist_remove_item";
const CHECKLIST_CUSTOM_ID_REFRESH = "checklist_refresh";
const CHECKLIST_CUSTOM_ID_REMOVE_SELECT = "checklist_remove_select";
const CHECKLIST_ADD_MODAL_ID = "checklist_add_modal";
const CHECKLIST_ADD_MODAL_INPUT_ID = "checklist_add_modal_text";
const TYRONE_CLEANUP_BUTTON_ID = "tyrone_cleanup_run";

let checklistTickerStarted = false;

function getStaffRoleIds() {
  return [
    OWNER_ROLE_ID,
    TYRONE_CLEANUP_ALLOWED_ROLE_ID,
    process.env.STAFF_ROLE_ID || "",
    process.env.ADMIN_ROLE_ID || "",
    ...(process.env.TICKET_CLAIM_ROLE_IDS || "").split(",").map(value => value.trim())
  ].filter(Boolean);
}

function memberHasAnyRole(member, roleIds) {
  return roleIds.some(roleId => member?.roles?.cache?.has(roleId));
}

function canManageStaffPanels(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageChannels)) return true;
  return memberHasAnyRole(member, getStaffRoleIds());
}

function canUseCleanup(member) {
  if (!member) return false;
  if (member.roles?.cache?.has(TYRONE_CLEANUP_ALLOWED_ROLE_ID)) return true;
  return memberHasAnyRole(member, getStaffRoleIds());
}

function buildCleanupEmbed() {
  return new EmbedBuilder()
    .setColor(0xc0392b)
    .setTitle("Tyrone Cleanup")
    .setDescription(
      "Use the button below to archive and remove Tyrone conversation messages from this channel."
    );
}

function buildCleanupComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(TYRONE_CLEANUP_BUTTON_ID)
        .setLabel("Cleanup")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function buildChecklistEmbed(db) {
  const items = db.listChecklistItems();
  const description = items.length
    ? items.map((item, index) => `${index + 1}. ${item.text}`).join("\n")
    : CHECKLIST_EMPTY_TEXT;

  return new EmbedBuilder()
    .setColor(0x1f6f63)
    .setTitle("Staff Checklist")
    .setDescription(description)
    .setFooter({ text: "Updates every minute. Staff can add or remove items anytime." })
    .setTimestamp(new Date());
}

function buildChecklistComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CHECKLIST_CUSTOM_ID_ADD)
        .setLabel("Add Item")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(CHECKLIST_CUSTOM_ID_REMOVE)
        .setLabel("Remove Item")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CHECKLIST_CUSTOM_ID_REFRESH)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildChecklistAddModal() {
  return new ModalBuilder()
    .setCustomId(CHECKLIST_ADD_MODAL_ID)
    .setTitle("Add Checklist Item")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(CHECKLIST_ADD_MODAL_INPUT_ID)
          .setLabel("What needs done?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300)
      )
    );
}

function buildChecklistRemoveMenu(db) {
  const items = db.listChecklistItems().slice(0, 25);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CHECKLIST_CUSTOM_ID_REMOVE_SELECT)
      .setPlaceholder("Select a checklist item to remove")
      .addOptions(
        items.map(item => ({
          label: item.text.slice(0, 100),
          value: String(item.id),
          description: `Added #${item.id}`
        }))
      )
  );
}

async function refreshChecklistPanels(client, db) {
  const panels = db.listChecklistPanels();
  if (!panels.length) return;

  for (const panel of panels) {
    try {
      const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
      if (!channel?.isTextBased?.()) {
        db.deleteChecklistPanel(panel.message_id);
        continue;
      }

      const message = await channel.messages.fetch(panel.message_id).catch(() => null);
      if (!message) {
        db.deleteChecklistPanel(panel.message_id);
        continue;
      }

      await message.edit({
        embeds: [buildChecklistEmbed(db)],
        components: buildChecklistComponents()
      });
    } catch (err) {
      console.error("[Checklist] refresh error:", err);
    }
  }
}

function startChecklistTicker(client, db) {
  if (checklistTickerStarted) return;
  checklistTickerStarted = true;

  setInterval(() => {
    refreshChecklistPanels(client, db).catch(err => {
      console.error("[Checklist] ticker error:", err);
    });
  }, 60 * 1000);
}

async function handleInteraction(interaction, { client, db }) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === "tyrone-cleanup-setup") {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Server-only command.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!canUseCleanup(interaction.member)) {
      await interaction.reply({
        content: "You do not have permission to set up the cleanup panel.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (interaction.channelId !== moderation.TYRONE_CLEANUP_PANEL_CHANNEL_ID) {
      await interaction.reply({
        content: `Run this in <#${moderation.TYRONE_CLEANUP_PANEL_CHANNEL_ID}>.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.channel.send({
      embeds: [buildCleanupEmbed()],
      components: buildCleanupComponents()
    });

    await interaction.reply({
      content: "Tyrone cleanup panel posted ✅",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (interaction.commandName === "checklist-setup") {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Server-only command.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!canManageStaffPanels(interaction.member)) {
      await interaction.reply({
        content: "You do not have permission to set up the checklist.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const posted = await interaction.channel.send({
      embeds: [buildChecklistEmbed(db)],
      components: buildChecklistComponents()
    });

    db.upsertChecklistPanel({
      message_id: posted.id,
      channel_id: posted.channelId,
      guild_id: interaction.guildId
    });

    await interaction.reply({
      content: "Checklist panel posted ✅",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}

async function handleButton(interaction, { client, db }) {
  const id = interaction.customId || "";

  if (id === TYRONE_CLEANUP_BUTTON_ID) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Server-only action.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (interaction.channelId !== moderation.TYRONE_CLEANUP_PANEL_CHANNEL_ID) {
      await interaction.reply({
        content: `Cleanup only runs in <#${moderation.TYRONE_CLEANUP_PANEL_CHANNEL_ID}>.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (!canUseCleanup(interaction.member)) {
      await interaction.reply({
        content: `You need <@&${TYRONE_CLEANUP_ALLOWED_ROLE_ID}> to use this cleanup.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await moderation.runTyroneCleanup({
      client,
      guild: interaction.guild,
      sourceChannel: interaction.channel,
      skipMessageId: interaction.message?.id || null
    });

    await interaction.editReply(
      result.ok
        ? `Cleanup complete ✅ Archived to <#${result.archivedTo}> and deleted ${result.deletedCount} message(s).`
        : (result.error || "Cleanup failed.")
    );
    return true;
  }

  if ([CHECKLIST_CUSTOM_ID_ADD, CHECKLIST_CUSTOM_ID_REMOVE, CHECKLIST_CUSTOM_ID_REFRESH].includes(id)) {
    if (!canManageStaffPanels(interaction.member)) {
      await interaction.reply({
        content: "You do not have permission to manage the checklist.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (id === CHECKLIST_CUSTOM_ID_ADD) {
      await interaction.showModal(buildChecklistAddModal());
      return true;
    }

    if (id === CHECKLIST_CUSTOM_ID_REMOVE) {
      const items = db.listChecklistItems();
      if (!items.length) {
        await interaction.reply({
          content: "There is nothing on the checklist right now.",
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      await interaction.reply({
        content: "Choose an item to remove:",
        components: [buildChecklistRemoveMenu(db)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await refreshChecklistPanels(client, db);
    await interaction.reply({
      content: "Checklist refreshed ✅",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}

async function handleSelectMenu(interaction, { client, db }) {
  if (!interaction.isStringSelectMenu()) return false;
  if (interaction.customId !== CHECKLIST_CUSTOM_ID_REMOVE_SELECT) return false;

  if (!canManageStaffPanels(interaction.member)) {
    await interaction.reply({
      content: "You do not have permission to manage the checklist.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const itemId = Number(interaction.values?.[0]);
  const item = db.getChecklistItemById(itemId);
  if (!item) {
    await interaction.reply({
      content: "That checklist item no longer exists.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  db.deleteChecklistItem(itemId);
  await refreshChecklistPanels(client, db);
  await interaction.update({
    content: `Removed checklist item: ${item.text}`,
    components: []
  });
  return true;
}

async function handleModalSubmit(interaction, { client, db }) {
  if (!interaction.isModalSubmit()) return false;
  if (interaction.customId !== CHECKLIST_ADD_MODAL_ID) return false;

  if (!canManageStaffPanels(interaction.member)) {
    await interaction.reply({
      content: "You do not have permission to manage the checklist.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const text = interaction.fields.getTextInputValue(CHECKLIST_ADD_MODAL_INPUT_ID).trim();
  if (!text) {
    await interaction.reply({
      content: "Checklist item text is required.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  db.createChecklistItem(text, interaction.user.id);
  await refreshChecklistPanels(client, db);
  await interaction.reply({
    content: `Added checklist item: ${text}`,
    flags: MessageFlags.Ephemeral
  });
  return true;
}

module.exports = {
  handleInteraction,
  handleButton,
  handleSelectMenu,
  handleModalSubmit,
  startChecklistTicker
};
