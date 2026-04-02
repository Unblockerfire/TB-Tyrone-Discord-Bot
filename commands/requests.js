const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const tyrone = require("./tyrone");
const tickets = require("./tickets");

const REQUEST_SETUP_CHANNEL_ID = "1484185860269281390";
const REQUEST_ALERT_CHANNEL_ID = "1119473863902896248";
const VERIFIED_ROLE_ID = "1113560011193450536";
const OWNER_ROLE_ID = "1113158001604427966";
const REQUEST_PANEL_CHANNEL_KEY = "requests.panel.channel_id";
const REQUEST_PANEL_MESSAGE_KEY = "requests.panel.message_id";

const REQUEST_SELECT_ID = "tyrone_request_select";
const REQUEST_OTHER_MODAL_ID = "tyrone_request_other_modal";
const REQUEST_OTHER_INPUT_ID = "tyrone_request_other_text";

const STAFF_BYPASS_ROLE_IDS = [
  OWNER_ROLE_ID,
  process.env.ADMIN_ROLE_ID || "",
  process.env.STAFF_ROLE_ID || "",
  ...(process.env.TICKET_CLAIM_ROLE_IDS || "").split(",").map(value => value.trim())
].filter(Boolean);

const REQUEST_OPTIONS = [
  {
    value: "role_access_help",
    label: "Role / Access Help",
    description: "Verification, missing roles, and access guidance.",
    mode: "faq",
    summary: "User needs role or access guidance.",
    answer:
      "For most role and access issues, start by checking the rules/verify area so Tyrone can give you the verified role. " +
      "If you already verified and still cannot see the channels or role you need, choose **Other** so Tyrone can check whether staff help is needed."
  },
  {
    value: "bot_system_help",
    label: "Bot / System Help",
    description: "Bot commands, panels, or systems acting weird.",
    mode: "faq",
    summary: "User needs bot or system guidance.",
    answer:
      "If a bot feature seems weird, try the command again and make sure you are using it in the right channel. " +
      "If it still looks broken or permissions are missing, choose **Other** so Tyrone can decide whether to answer directly or open a staff ticket."
  },
  {
    value: "server_question",
    label: "Server Question",
    description: "Rules, where to apply, and general server questions.",
    mode: "faq",
    summary: "User asked a general server question.",
    answer:
      "For common server questions: use <#1113094456242081832> and click **Start Application** for staff applications, keep self promo in **#self-promo**, and check the rules/verify area for access. " +
      "If your question is more specific, choose **Other** and Tyrone will try to answer it directly."
  },
  {
    value: "report_problem",
    label: "Report a Problem",
    description: "Report something broken or something staff should review.",
    mode: "ticket",
    summary: "User selected Report a Problem from the request panel."
  },
  {
    value: "ticket_support_help",
    label: "Ticket / Support Help",
    description: "Questions about support tickets or staff help.",
    mode: "faq",
    summary: "User needs support ticket guidance.",
    answer:
      "Use the support panel when you need staff help. If you are not sure whether your issue needs a ticket, choose **Other** here and Tyrone will either answer directly or open the ticket for you."
  },
  {
    value: "other",
    label: "Other",
    description: "Explain your issue in detail and let Tyrone decide.",
    mode: "modal",
    summary: "User needs custom help through the Other flow."
  }
];

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x1f6f63)
    .setTitle("Tyrone Requests")
    .setDescription(
      "**Need a quick guide or help but not sure whether a ticket is necessary?**\n" +
      "Choose from the dropdown below. If your issue is not listed, choose **Other**."
    );
}

function buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(REQUEST_SELECT_ID)
        .setPlaceholder("Choose a help or request category")
        .addOptions(
          REQUEST_OPTIONS.map(option => ({
            label: option.label,
            description: option.description,
            value: option.value
          }))
        )
    )
  ];
}

function buildPanelPayload() {
  return {
    embeds: [buildPanelEmbed()],
    components: buildPanelComponents()
  };
}

function isRequestPanelMessage(message, botUserId) {
  if (!message) return false;
  if (botUserId && message.author?.id !== botUserId) return false;

  const hasMatchingEmbed = message.embeds?.some(embed => embed.title === "Tyrone Requests");
  const hasMatchingSelect = message.components?.some(row =>
    row.components?.some(component => component.customId === REQUEST_SELECT_ID)
  );

  return Boolean(hasMatchingEmbed && hasMatchingSelect);
}

async function deleteExistingRequestPanels(channel, botUserId) {
  if (!channel?.isTextBased?.()) return 0;

  let deleted = 0;
  const recentMessages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!recentMessages) return 0;

  for (const message of recentMessages.values()) {
    if (!isRequestPanelMessage(message, botUserId)) continue;
    await message.delete().catch(() => null);
    deleted += 1;
  }

  return deleted;
}

function getOptionConfig(value) {
  return REQUEST_OPTIONS.find(option => option.value === value) || null;
}

function memberHasAnyRole(member, roleIds) {
  return roleIds.some(roleId => member?.roles?.cache?.has(roleId));
}

function canSetupRequests(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionsBitField.Flags.ManageChannels)) return true;
  if (member.permissions?.has(PermissionsBitField.Flags.ManageGuild)) return true;
  return memberHasAnyRole(member, STAFF_BYPASS_ROLE_IDS);
}

function canUseRequestPanel(member) {
  if (!member) return false;
  if (canSetupRequests(member)) return true;
  return member.roles?.cache?.has(VERIFIED_ROLE_ID) || false;
}

function buildFaqReply(option) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(option.label)
    .setDescription(option.answer);
}

function buildOtherModal() {
  return new ModalBuilder()
    .setCustomId(REQUEST_OTHER_MODAL_ID)
    .setTitle("Explain Your Issue")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(REQUEST_OTHER_INPUT_ID)
          .setLabel("In as much detail as possible, please explain your issue.")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
}

async function sendStaffAlert(client, payload = {}) {
  const alertChannel = await client.channels.fetch(REQUEST_ALERT_CHANNEL_ID).catch(() => null);
  if (!alertChannel?.isTextBased()) {
    console.error("[Requests] Staff alert channel missing or invalid:", REQUEST_ALERT_CHANNEL_ID);
    return false;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("Tyrone Request Alert")
    .addFields(
      { name: "User", value: `<@${payload.user.id}>`, inline: true },
      { name: "Username", value: `${payload.user.tag}\n${payload.user.id}`, inline: true },
      { name: "Request Type", value: payload.requestType || "Unknown", inline: true },
      { name: "Summary", value: payload.summary || "No summary provided.", inline: false },
      { name: "Ticket Created", value: payload.ticketChannelId ? "Yes" : "No", inline: true },
      {
        name: "Ticket",
        value: payload.ticketChannelId ? `<#${payload.ticketChannelId}>` : "No ticket created",
        inline: true
      }
    )
    .setTimestamp(new Date());

  await alertChannel.send({ embeds: [embed] });
  console.log(
    "[Requests] Staff alert sent",
    JSON.stringify({
      user_id: payload.user.id,
      request_type: payload.requestType,
      ticket_channel_id: payload.ticketChannelId || null
    })
  );
  return true;
}

async function createRequestTicket({ interaction, option, summary, issueText, awaitingIssueText = false }) {
  const introMessage = awaitingIssueText
    ? `Hi <@${interaction.user.id}>, a Tyrone support ticket was created from the request hub. Please explain your issue in more detail here. It may take up to 2 hours to be claimed.`
    : `Hi <@${interaction.user.id}>, a Tyrone support ticket was created from the request hub. Please allow up to 2 hours for it to be claimed.`;

  const result = await tickets.createStructuredSupportTicket({
    guild: interaction.guild,
    opener: interaction.user,
    source: "request_panel",
    category: option.label,
    issueText,
    summary,
    introMessage,
    awaitingIssueText
  });

  if (!result.ok) {
    console.error("[Requests] Ticket creation failed:", result.error);
    return result;
  }

  console.log(
    "[Requests] Ticket created",
    JSON.stringify({
      user_id: interaction.user.id,
      request_type: option.value,
      channel_id: result.channelId
    })
  );

  await sendStaffAlert(interaction.client, {
    user: interaction.user,
    requestType: option.label,
    summary,
    ticketChannelId: result.channelId
  });

  return result;
}

async function handleInteraction(interaction, { db } = {}) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "setup-requests") return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!canSetupRequests(interaction.member)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (interaction.channelId !== REQUEST_SETUP_CHANNEL_ID) {
    await interaction.reply({
      content: `Run this in <#${REQUEST_SETUP_CHANNEL_ID}> so the request panel stays in the right place.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const deletedCount = await deleteExistingRequestPanels(interaction.channel, interaction.client.user?.id);

  const posted = await interaction.channel.send(buildPanelPayload());
  db?.setManyAppSettings?.({
    [REQUEST_PANEL_CHANNEL_KEY]: posted.channelId,
    [REQUEST_PANEL_MESSAGE_KEY]: posted.id
  });

  console.log(
    "[Requests] Panel setup",
    JSON.stringify({
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      user_id: interaction.user.id,
      deleted_previous_count: deletedCount
    })
  );

  await interaction.reply({
    content: "Request panel posted ✅",
    flags: MessageFlags.Ephemeral
  });

  return true;
}

async function handleSelectMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return false;
  if (interaction.customId !== REQUEST_SELECT_ID) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This menu only works inside the server.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!canUseRequestPanel(interaction.member)) {
    await interaction.reply({
      content: "You need the verified role to use this request menu.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const selected = interaction.values?.[0];
  const option = getOptionConfig(selected);
  if (!option) {
    await interaction.reply({
      content: "That request option was not recognized.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  console.log(
    "[Requests] Dropdown used",
    JSON.stringify({
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      user_id: interaction.user.id,
      option: option.value
    })
  );

  if (option.mode === "modal") {
    await interaction.showModal(buildOtherModal());
    return true;
  }

  if (option.mode === "faq") {
    console.log("[Requests] FAQ answered directly", JSON.stringify({ user_id: interaction.user.id, option: option.value }));
    await interaction.reply({
      embeds: [buildFaqReply(option)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ticketResult = await createRequestTicket({
    interaction,
    option,
    summary: option.summary,
    issueText: null,
    awaitingIssueText: true
  });

  if (!ticketResult.ok) {
    await interaction.editReply("I could not create the support ticket right now.");
    return true;
  }

  await interaction.editReply(
    `I sent this to staff and created a support ticket for you: <#${ticketResult.channelId}>`
  );
  return true;
}

async function handleModalSubmit(interaction, { db }) {
  if (!interaction.isModalSubmit()) return false;
  if (interaction.customId !== REQUEST_OTHER_MODAL_ID) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This form only works inside the server.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!canUseRequestPanel(interaction.member)) {
    await interaction.reply({
      content: "You need the verified role to use this request menu.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const issueText = interaction.fields.getTextInputValue(REQUEST_OTHER_INPUT_ID).trim();
  console.log(
    "[Requests] Modal submitted",
    JSON.stringify({
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      user_id: interaction.user.id,
      issue_length: issueText.length
    })
  );

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const triage = await tyrone.triageHelpRequest(db, {
    query: issueText,
    userId: interaction.user.id,
    username: interaction.user.username
  });

  if (!triage.needsStaff) {
    console.log(
      "[Requests] FAQ answered directly",
      JSON.stringify({ user_id: interaction.user.id, path: triage.path })
    );
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("Tyrone Help")
          .setDescription(triage.reply || "Tyrone did not have a reply.")
      ]
    });
    return true;
  }

  const option = getOptionConfig("other");
  const summary = triage.summary || "Tyrone thinks this needs staff review.";
  const ticketResult = await createRequestTicket({
    interaction,
    option,
    summary,
    issueText,
    awaitingIssueText: false
  });

  if (!ticketResult.ok) {
    await interaction.editReply("I could not create the support ticket right now.");
    return true;
  }

  await interaction.editReply(
    `This looks like it needs staff help, so I alerted staff and created a support ticket: <#${ticketResult.channelId}>`
  );
  return true;
}

module.exports = {
  handleInteraction,
  handleSelectMenu,
  handleModalSubmit,
  refreshRequestPanel: async (client, db, { reason = "manual_refresh" } = {}) => {
    const storedChannelId = db?.getAppSetting?.(REQUEST_PANEL_CHANNEL_KEY)?.value || REQUEST_SETUP_CHANNEL_ID;
    const channel = await client.channels.fetch(storedChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) return false;
    const deletedCount = await deleteExistingRequestPanels(channel, client.user?.id);

    const posted = await channel.send(buildPanelPayload());
    db?.setManyAppSettings?.({
      [REQUEST_PANEL_CHANNEL_KEY]: posted.channelId,
      [REQUEST_PANEL_MESSAGE_KEY]: posted.id
    });

    console.log(
      "[Requests] Panel refreshed",
      JSON.stringify({
        reason,
        channel_id: posted.channelId,
        message_id: posted.id,
        deleted_previous_count: deletedCount
      })
    );
    return true;
  }
};
