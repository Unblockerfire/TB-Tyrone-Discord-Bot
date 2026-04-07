const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const FORM_REVIEW_CHANNEL_ID = "1115806144384995399";
const VERIFIED_ROLE_ID = "1113560011193450536";
const OWNER_ROLE_ID = "1113158001604427966";
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";
const FORM_TIME_LIMIT_MS = 60 * 60 * 1000;
const FORM_TICK_MS = 60 * 1000;

const CREATE_FORM_COMMAND = "create-form";
const MANAGE_FORMS_COMMAND = "manage-forms";
const ADD_QUESTION_PREFIX = "form:editor:add:";
const REMOVE_SELECT_PREFIX = "form:editor:remove_select:";
const PREVIEW_PREFIX = "form:editor:preview:";
const BACK_TO_EDITOR_PREFIX = "form:editor:back:";
const PUBLISH_PREFIX = "form:editor:publish:";
const DELETE_PREFIX = "form:editor:delete:";
const REFRESH_EDITOR_PREFIX = "form:editor:refresh:";
const QUESTION_MODAL_PREFIX = "form:editor:add_modal:";
const MANAGE_SELECT_ID = "form:manage:select";

const START_PREFIX = "form:start:";
const CANCEL_PREFIX = "form:cancel:";
const SKIP_PREFIX = "form:skip:";
const TEXT_ANSWER_PREFIX = "form:answer:text:";
const CHOICE_ANSWER_PREFIX = "form:answer:choice:";

let formTickerStarted = false;

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "form";
}

function shortText(value, max = 100) {
  const text = String(value || "").trim();
  if (!text) return "None";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const units = [
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];
  let remaining = totalSeconds;
  const parts = [];
  for (const [label, size] of units) {
    const value = Math.floor(remaining / size);
    if (!value && label !== "second") continue;
    remaining -= value * size;
    if (value || (label === "second" && !parts.length)) {
      parts.push(`${value} ${label}${value === 1 ? "" : "s"}`);
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

function isFormManager(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
  return [OWNER_ROLE_ID, ADMIN_ROLE_ID].filter(Boolean).some(roleId => member.roles?.cache?.has?.(roleId));
}

function canFillForms(member) {
  if (!member) return false;
  if (isFormManager(member)) return true;
  return member.roles?.cache?.has?.(VERIFIED_ROLE_ID) || false;
}

function makeQuestionId(index) {
  return `q_${Date.now()}_${index}`;
}

function normalizeQuestionType(value) {
  const raw = String(value || "").trim().toLowerCase();
  const aliases = {
    short: "short_text",
    short_text: "short_text",
    shorttext: "short_text",
    paragraph: "paragraph",
    long: "paragraph",
    multiline: "paragraph",
    single: "single_choice",
    single_choice: "single_choice",
    singlechoice: "single_choice",
    choice: "single_choice",
    multiple: "multi_choice",
    multi: "multi_choice",
    multi_choice: "multi_choice",
    multichoice: "multi_choice"
  };
  return aliases[raw] || null;
}

function normalizeRequired(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ["yes", "y", "true", "required", "1"].includes(raw);
}

function renderQuestionType(type) {
  switch (type) {
    case "paragraph":
      return "Paragraph";
    case "single_choice":
      return "Single Choice";
    case "multi_choice":
      return "Multi Choice";
    default:
      return "Short Answer";
  }
}

function parseOptions(value) {
  return String(value || "")
    .split("\n")
    .map(option => option.trim())
    .filter(Boolean)
    .slice(0, 25);
}

function buildFormEditorEmbed(form) {
  const questionLines = (form.questions || []).map((question, index) => {
    const optionsNote = question.options?.length ? ` | ${question.options.length} options` : "";
    return `${index + 1}. **${shortText(question.label, 80)}**\n${renderQuestionType(question.type)} | ${question.required ? "Required" : "Optional"}${optionsNote}`;
  });

  return new EmbedBuilder()
    .setTitle(`Form Editor • ${form.title}`)
    .setColor(form.status === "published" ? 0x2ecc71 : 0x5865f2)
    .setDescription(
      `Status: **${form.status}**\n` +
      `Current questions: **${form.questions.length}**\n` +
      `Post channel: ${form.post_channel_id ? `<#${form.post_channel_id}>` : "Not set"}\n` +
      `Review channel: ${form.review_channel_id ? `<#${form.review_channel_id}>` : `<#${FORM_REVIEW_CHANNEL_ID}>`}`
    )
    .addFields({
      name: "Questions",
      value: questionLines.join("\n\n") || "No questions yet. Add your first one below."
    });
}

function buildFormEditorComponents(form) {
  const canAddMore = (form.questions || []).length < 20;
  const canPreview = Boolean(form.post_channel_id) && (form.questions || []).length >= 1;

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ADD_QUESTION_PREFIX}${form.id}`)
        .setLabel("Add Question")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canAddMore),
      new ButtonBuilder()
        .setCustomId(`${PREVIEW_PREFIX}${form.id}`)
        .setLabel("Preview")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canPreview),
      new ButtonBuilder()
        .setCustomId(`${REFRESH_EDITOR_PREFIX}${form.id}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DELETE_PREFIX}${form.id}`)
        .setLabel("Delete Draft")
        .setStyle(ButtonStyle.Danger)
    )
  ];

  if ((form.questions || []).length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${REMOVE_SELECT_PREFIX}${form.id}`)
          .setPlaceholder("Remove a question")
          .addOptions(
            form.questions.slice(0, 25).map((question, index) => ({
              label: shortText(`${index + 1}. ${question.label}`, 100),
              value: question.id || String(index),
              description: shortText(`${renderQuestionType(question.type)} • ${question.required ? "Required" : "Optional"}`, 100)
            }))
          )
      )
    );
  }

  return rows;
}

function buildManageFormsPayload(forms) {
  const embed = new EmbedBuilder()
    .setTitle("Manage Forms")
    .setColor(0x5865f2)
    .setDescription(
      forms.length
        ? "Choose a form to reopen its editor."
        : "No forms exist yet. Use `/create-form` first."
    );

  const components = [];
  if (forms.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(MANAGE_SELECT_ID)
          .setPlaceholder("Choose a form")
          .addOptions(
            forms.slice(0, 25).map(form => ({
              label: shortText(form.title, 100),
              value: String(form.id),
              description: shortText(
                `${form.status} • ${form.questions.length} question${form.questions.length === 1 ? "" : "s"} • ${form.post_channel_id ? `#${form.post_channel_id}` : "no channel"}`,
                100
              )
            }))
          )
      )
    );
  }

  return {
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral
  };
}

function buildFormPreviewEmbeds(form) {
  const questionSummary = (form.questions || [])
    .map((question, index) => {
      const options =
        question.options?.length
          ? `\nOptions: ${question.options.map(option => `• ${option}`).join(" ")}`
          : "";
      return `${index + 1}. **${question.label}**\n${renderQuestionType(question.type)} • ${question.required ? "Required" : "Optional"}${options}`;
    })
    .join("\n\n");

  return [
    new EmbedBuilder()
      .setTitle(`Preview • ${form.title}`)
      .setColor(0x1f6f63)
      .setDescription(
        "This is what users will see before they start filling out the form.\n\n" +
        `Post channel: ${form.post_channel_id ? `<#${form.post_channel_id}>` : "Not set"}`
      ),
    new EmbedBuilder()
      .setTitle("Question Preview")
      .setColor(0x34495e)
      .setDescription(questionSummary || "No questions yet.")
  ];
}

function buildFormPreviewComponents(form) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BACK_TO_EDITOR_PREFIX}${form.id}`)
        .setLabel("Back to Editor")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PUBLISH_PREFIX}${form.id}`)
        .setLabel(form.status === "published" ? "Re-publish Form" : "Publish Form")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!form.post_channel_id || !(form.questions || []).length),
      new ButtonBuilder()
        .setCustomId(`${DELETE_PREFIX}${form.id}`)
        .setLabel("Delete Draft")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function buildAddQuestionModal(formId) {
  return new ModalBuilder()
    .setCustomId(`${QUESTION_MODAL_PREFIX}${formId}`)
    .setTitle("Add Form Question")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("label")
          .setLabel("Question text")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("type")
          .setLabel("Type: short, paragraph, single, or multi")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("required")
          .setLabel("Required? yes or no")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("options")
          .setLabel("Options (one per line for choice questions)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
      )
    );
}

function buildFormPanelPayload(form) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(form.title)
        .setColor(0x1f6f63)
        .setDescription(
          "Click the button below to fill out this form.\n\n" +
          `Questions: **${form.questions.length}**`
        )
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${START_PREFIX}${form.id}`)
          .setLabel("Fill Out Form")
          .setStyle(ButtonStyle.Primary)
      )
    ]
  };
}

function isPublishedFormPanelMessage(message, botUserId) {
  if (!message) return false;
  if (botUserId && message.author?.id !== botUserId) return false;
  const hasButton = message.components?.some(row =>
    row.components?.some(component => String(component.customId || "").startsWith(START_PREFIX))
  );
  return Boolean(hasButton);
}

async function deleteExistingPublishedFormPanels(channel, currentMessageId, botUserId, formId = null) {
  if (!channel?.isTextBased?.()) return 0;
  let deleted = 0;
  const recentMessages = await channel.messages.fetch({ limit: 40 }).catch(() => null);
  if (!recentMessages) return 0;

  for (const message of recentMessages.values()) {
    if (currentMessageId && message.id === currentMessageId) continue;
    if (!isPublishedFormPanelMessage(message, botUserId)) continue;
    const matchesForm = message.components?.some(row =>
      row.components?.some(component => component.customId === `${START_PREFIX}${formId}`)
    );
    if (formId && !matchesForm) continue;
    await message.delete().catch(() => null);
    deleted += 1;
  }

  return deleted;
}

function buildTextQuestionPrompt(form, response, question) {
  const remaining = response.expires_at ? Math.max(0, response.expires_at - Date.now()) : 0;
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${TEXT_ANSWER_PREFIX}${response.id}`)
        .setLabel("Answer Question")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${CANCEL_PREFIX}${response.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger)
    )
  ];

  if (!question.required) {
    rows[0].addComponents(
      new ButtonBuilder()
        .setCustomId(`${SKIP_PREFIX}${response.id}`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(form.title)
        .setColor(0x5865f2)
        .setDescription(
          `Question **${response.current_question_index + 1} / ${form.questions.length}**\n\n` +
          `${question.label}\n\n` +
          `Type: **${renderQuestionType(question.type)}**\n` +
          `Required: **${question.required ? "Yes" : "No"}**\n` +
          `Time remaining: **${formatDuration(remaining)}**`
        )
    ],
    components: rows,
    flags: MessageFlags.Ephemeral
  };
}

function buildChoiceQuestionPrompt(form, response, question) {
  const remaining = response.expires_at ? Math.max(0, response.expires_at - Date.now()) : 0;
  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CHOICE_ANSWER_PREFIX}${response.id}`)
        .setPlaceholder(question.required ? "Choose your answer" : "Choose answer(s) or skip")
        .setMinValues(question.required ? 1 : 1)
        .setMaxValues(question.type === "multi_choice" ? Math.min(question.options.length, 25) : 1)
        .addOptions(
          (question.options || []).slice(0, 25).map((option, index) => ({
            label: shortText(option, 100),
            value: String(index)
          }))
        )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CANCEL_PREFIX}${response.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger)
    )
  ];

  if (!question.required) {
    rows[1].addComponents(
      new ButtonBuilder()
        .setCustomId(`${SKIP_PREFIX}${response.id}`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(form.title)
        .setColor(0x5865f2)
        .setDescription(
          `Question **${response.current_question_index + 1} / ${form.questions.length}**\n\n` +
          `${question.label}\n\n` +
          `Type: **${renderQuestionType(question.type)}**\n` +
          `Required: **${question.required ? "Yes" : "No"}**\n` +
          `Time remaining: **${formatDuration(remaining)}**`
        )
    ],
    components: rows,
    flags: MessageFlags.Ephemeral
  };
}

function buildAnswerModal(form, response, question) {
  return new ModalBuilder()
    .setCustomId(`${TEXT_ANSWER_PREFIX}${response.id}`)
    .setTitle(`${shortText(form.title, 40)} • Q${response.current_question_index + 1}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("answer")
          .setLabel(shortText(question.label, 45))
          .setStyle(question.type === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(question.required)
          .setMaxLength(4000)
      )
    );
}

function buildResponseReviewEmbed(form, response, user) {
  const embed = new EmbedBuilder()
    .setTitle(`Form Submission • ${form.title}`)
    .setColor(0x3498db)
    .addFields(
      { name: "User", value: `<@${user.id}>`, inline: true },
      { name: "User ID", value: user.id, inline: true },
      { name: "Submitted At", value: `<t:${Math.floor((response.submitted_at || Date.now()) / 1000)}:F>`, inline: false }
    )
    .setTimestamp(new Date());

  for (let index = 0; index < response.answers.length; index += 1) {
    const entry = response.answers[index];
    embed.addFields({
      name: `${index + 1}. ${shortText(entry.question, 256)}`,
      value: shortText(entry.answer, 1024),
      inline: false
    });
  }

  return embed;
}

async function renderEditorReply(interaction, db, formId, content = null) {
  const form = db.getFormConfigById(formId);
  if (!form) {
    const payload = { content: "That form no longer exists.", flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
    return interaction.reply(payload);
  }

  const payload = {
    content: content || undefined,
    embeds: [buildFormEditorEmbed(form)],
    components: buildFormEditorComponents(form),
    flags: MessageFlags.Ephemeral
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    await interaction.update({
      content: payload.content || null,
      embeds: payload.embeds,
      components: payload.components
    });
  } else {
    await interaction.reply(payload);
  }
}

async function renderPreviewReply(interaction, db, formId, content = null) {
  const form = db.getFormConfigById(formId);
  if (!form) {
    const payload = { content: "That form no longer exists.", flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
    return interaction.reply(payload);
  }

  const payload = {
    content: content || undefined,
    embeds: buildFormPreviewEmbeds(form),
    components: buildFormPreviewComponents(form),
    flags: MessageFlags.Ephemeral
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    await interaction.update({
      content: payload.content || null,
      embeds: payload.embeds,
      components: payload.components
    });
  } else {
    await interaction.reply(payload);
  }
}

async function postOrRefreshFormPanel(client, db, form, { reason = "manual_publish" } = {}) {
  const channel = await client.channels.fetch(form.post_channel_id).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error("Configured form post channel is missing or invalid.");
  }

  let currentMessage = null;
  if (form.panel_message_id) {
    currentMessage = await channel.messages.fetch(form.panel_message_id).catch(() => null);
  }

  if (currentMessage) {
    await currentMessage.edit(buildFormPanelPayload(form)).catch(() => null);
  } else {
    await deleteExistingPublishedFormPanels(channel, null, client.user?.id, form.id);
    currentMessage = await channel.send(buildFormPanelPayload(form));
  }

  const deletedCount = await deleteExistingPublishedFormPanels(
    channel,
    currentMessage.id,
    client.user?.id,
    form.id
  );

  const updated = db.updateFormConfig(form.id, {
    panel_message_id: currentMessage.id,
    status: "published"
  });

  console.log(
    "[Forms] Panel refreshed",
    JSON.stringify({
      form_id: form.id,
      reason,
      channel_id: currentMessage.channelId,
      message_id: currentMessage.id,
      deleted_previous_count: deletedCount
    })
  );

  return updated;
}

async function sendNextFormQuestion(interaction, db, responseId) {
  const response = db.getFormResponse(responseId);
  if (!response || response.status !== "in_progress") {
    await interaction.reply({
      content: "That form session is no longer active.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (response.expires_at && response.expires_at <= Date.now()) {
    db.updateFormResponse(response.id, { status: "expired" });
    await interaction.reply({
      content: "This form expired. Start again from the form button.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const form = db.getFormConfigById(response.form_id);
  if (!form || form.status !== "published") {
    await interaction.reply({
      content: "This form is no longer available.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const question = form.questions[response.current_question_index];
  if (!question) {
    await interaction.reply({
      content: "This form does not have a valid next question.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const payload =
    question.type === "single_choice" || question.type === "multi_choice"
      ? buildChoiceQuestionPrompt(form, response, question)
      : buildTextQuestionPrompt(form, response, question);

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    await interaction.reply(payload);
  } else {
    await interaction.reply(payload);
  }

  return true;
}

async function finalizeFormResponse(interaction, { client, db }, responseId) {
  const response = db.getFormResponse(responseId);
  if (!response) {
    await interaction.editReply("I could not find that form response anymore.");
    return true;
  }

  const form = db.getFormConfigById(response.form_id);
  if (!form) {
    await interaction.editReply("This form no longer exists.");
    return true;
  }

  const reviewChannel = await interaction.guild.channels.fetch(form.review_channel_id || FORM_REVIEW_CHANNEL_ID).catch(() => null);
  if (!reviewChannel?.isTextBased()) {
    await interaction.editReply("I could not post this form to the review channel.");
    return true;
  }

  const sent = await reviewChannel.send({
    embeds: [buildResponseReviewEmbed(form, response, interaction.user)]
  });

  db.updateFormResponse(response.id, {
    status: "submitted",
    submitted_at: Date.now(),
    review_channel_id: reviewChannel.id,
    review_message_id: sent.id
  });

  console.log(
    "[Forms] Response submitted",
    JSON.stringify({
      form_id: form.id,
      response_id: response.id,
      user_id: interaction.user.id,
      review_channel_id: reviewChannel.id,
      review_message_id: sent.id
    })
  );

  await interaction.editReply({
    content: "Your form has been submitted.",
    embeds: [],
    components: []
  });

  return true;
}

async function startFormTicker(client, db) {
  if (formTickerStarted) return;
  formTickerStarted = true;

  setInterval(async () => {
    try {
      const expired = db.expireDueFormResponses(Date.now());
      if (!expired.length) return;
      console.log(
        "[Forms] Expired responses",
        JSON.stringify({ count: expired.length, response_ids: expired.map(item => item.id) })
      );

      for (const response of expired) {
        const user = await client.users.fetch(response.user_id).catch(() => null);
        if (!user) continue;
        await user.send("Your form expired before you finished it. Start again from the form button if you still want to submit it.").catch(() => null);
      }
    } catch (error) {
      console.error("[Forms] Expiry ticker failed:", error);
    }
  }, FORM_TICK_MS);
}

async function refreshPublishedFormPanels(client, db, { reason = "manual_refresh" } = {}) {
  const forms = db.listPublishedFormConfigs();
  for (const form of forms) {
    try {
      await postOrRefreshFormPanel(client, db, form, { reason });
    } catch (error) {
      console.error("[Forms] Failed to refresh form panel:", error);
    }
  }
  return true;
}

async function handleInteraction(interaction, { db } = {}) {
  if (!interaction.isChatInputCommand()) return false;
  if (![CREATE_FORM_COMMAND, MANAGE_FORMS_COMMAND].includes(interaction.commandName)) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (!isFormManager(interaction.member)) {
    await interaction.reply({ content: "You do not have permission to create forms.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.commandName === MANAGE_FORMS_COMMAND) {
    const forms = db.listFormConfigsByGuild(interaction.guildId);
    await interaction.reply(buildManageFormsPayload(forms));
    return true;
  }

  const title = String(interaction.options.getString("title") || "").trim();
  const channel = interaction.options.getChannel("channel");

  if (!title || !channel?.isTextBased?.()) {
    await interaction.reply({ content: "I need a valid title and post channel.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const key = `${slugify(title)}-${Date.now()}`;
  const form = db.createFormConfig({
    key,
    guild_id: interaction.guildId,
    title,
    target_question_count: 20,
    questions: [],
    post_channel_id: channel.id,
    review_channel_id: FORM_REVIEW_CHANNEL_ID,
    status: "draft",
    created_by: interaction.user.id
  });

  console.log(
    "[Forms] Draft created",
    JSON.stringify({
      form_id: form.id,
      key: form.key,
      guild_id: interaction.guildId,
      user_id: interaction.user.id,
      post_channel_id: channel.id
    })
  );

  await interaction.reply({
    content: "Form draft created. Add your questions, then open Preview when you want to publish it.",
    embeds: [buildFormEditorEmbed(form)],
    components: buildFormEditorComponents(form),
    flags: MessageFlags.Ephemeral
  });

  return true;
}

async function handleButton(interaction, { client, db } = {}) {
  if (!interaction.isButton()) return false;
  const customId = interaction.customId || "";

  if (customId.startsWith(ADD_QUESTION_PREFIX)) {
    const formId = Number(customId.slice(ADD_QUESTION_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot edit that form.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if ((form.questions || []).length >= 20) {
      await interaction.reply({ content: "That form already has the max of 20 questions.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(buildAddQuestionModal(formId));
    return true;
  }

  if (customId.startsWith(PREVIEW_PREFIX)) {
    const formId = Number(customId.slice(PREVIEW_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot preview that form.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!(form.questions || []).length) {
      await interaction.reply({ content: "Add at least one question before previewing.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await renderPreviewReply(interaction, db, form.id);
    return true;
  }

  if (customId.startsWith(BACK_TO_EDITOR_PREFIX)) {
    const formId = Number(customId.slice(BACK_TO_EDITOR_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot edit that form.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await renderEditorReply(interaction, db, form.id);
    return true;
  }

  if (customId.startsWith(PUBLISH_PREFIX)) {
    const formId = Number(customId.slice(PUBLISH_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot publish that form.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!(form.questions || []).length) {
      await interaction.reply({ content: "Add at least one question before publishing.", flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const updated = await postOrRefreshFormPanel(client, db, form, { reason: "manual_publish" });
      await renderPreviewReply(interaction, db, updated.id, `Form published in <#${updated.post_channel_id}> ✅`);
    } catch (error) {
      console.error("[Forms] Publish failed:", error);
      await interaction.editReply({ content: "I could not publish that form.", embeds: [], components: [] });
    }
    return true;
  }

  if (customId.startsWith(DELETE_PREFIX)) {
    const formId = Number(customId.slice(DELETE_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot delete that form.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (form.panel_message_id && form.post_channel_id) {
      const channel = await client.channels.fetch(form.post_channel_id).catch(() => null);
      const message = channel?.isTextBased?.()
        ? await channel.messages.fetch(form.panel_message_id).catch(() => null)
        : null;
      if (message) await message.delete().catch(() => null);
    }

    db.deleteFormConfig(formId);
    await interaction.update({
      content: "Form deleted.",
      embeds: [],
      components: []
    });
    return true;
  }

  if (customId.startsWith(REFRESH_EDITOR_PREFIX)) {
    const formId = Number(customId.slice(REFRESH_EDITOR_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot view that form.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await renderEditorReply(interaction, db, formId);
    return true;
  }

  if (customId.startsWith(START_PREFIX)) {
    const formId = Number(customId.slice(START_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || form.status !== "published") {
      await interaction.reply({ content: "This form is not available right now.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!canFillForms(interaction.member)) {
      await interaction.reply({ content: "You need the verified role to fill out this form.", flags: MessageFlags.Ephemeral });
      return true;
    }

    let response = db.getActiveFormResponseForUser(formId, interaction.user.id, interaction.guildId);
    if (!response) {
      response = db.createFormResponse({
        form_id: form.id,
        user_id: interaction.user.id,
        guild_id: interaction.guildId,
        status: "in_progress",
        answers: [],
        current_question_index: 0,
        started_at: Date.now(),
        expires_at: Date.now() + FORM_TIME_LIMIT_MS
      });
      console.log(
        "[Forms] Response started",
        JSON.stringify({ form_id: form.id, response_id: response.id, user_id: interaction.user.id })
      );
    }

    await sendNextFormQuestion(interaction, db, response.id);
    return true;
  }

  if (customId.startsWith(CANCEL_PREFIX)) {
    const responseId = Number(customId.slice(CANCEL_PREFIX.length));
    const response = db.getFormResponse(responseId);
    if (!response || response.user_id !== interaction.user.id) {
      await interaction.reply({ content: "That form session is not yours.", flags: MessageFlags.Ephemeral });
      return true;
    }
    db.updateFormResponse(response.id, { status: "cancelled" });
    await interaction.reply({ content: "Form cancelled.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (customId.startsWith(SKIP_PREFIX)) {
    const responseId = Number(customId.slice(SKIP_PREFIX.length));
    const response = db.getFormResponse(responseId);
    if (!response || response.user_id !== interaction.user.id || response.status !== "in_progress") {
      await interaction.reply({ content: "That form session is not active.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const form = db.getFormConfigById(response.form_id);
    const question = form?.questions?.[response.current_question_index];
    if (!form || !question || question.required) {
      await interaction.reply({ content: "That question cannot be skipped.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const updated = db.updateFormResponse(response.id, {
      answers: [...response.answers, { question: question.label, answer: "Skipped" }],
      current_question_index: response.current_question_index + 1
    });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (updated.current_question_index >= form.questions.length) {
      await finalizeFormResponse(interaction, { client, db }, updated.id);
    } else {
      await sendNextFormQuestion(interaction, db, updated.id);
    }
    return true;
  }

  if (customId.startsWith(TEXT_ANSWER_PREFIX)) {
    const responseId = Number(customId.slice(TEXT_ANSWER_PREFIX.length));
    const response = db.getFormResponse(responseId);
    if (!response || response.user_id !== interaction.user.id || response.status !== "in_progress") {
      await interaction.reply({ content: "That form session is not active.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const form = db.getFormConfigById(response.form_id);
    const question = form?.questions?.[response.current_question_index];
    if (!form || !question) {
      await interaction.reply({ content: "That question is no longer available.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(buildAnswerModal(form, response, question));
    return true;
  }

  return false;
}

async function handleSelectMenu(interaction, { client, db } = {}) {
  if (!(interaction.isStringSelectMenu() || interaction.isChannelSelectMenu())) return false;
  const customId = interaction.customId || "";

  if (customId === MANAGE_SELECT_ID) {
    const formId = Number(interaction.values?.[0] || 0);
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot manage that form.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (form.status === "published") {
      await renderPreviewReply(interaction, db, form.id);
    } else {
      await renderEditorReply(interaction, db, form.id);
    }
    return true;
  }

  if (customId.startsWith(REMOVE_SELECT_PREFIX)) {
    const formId = Number(customId.slice(REMOVE_SELECT_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot edit that form.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const removeId = interaction.values?.[0];
    const nextQuestions = (form.questions || []).filter(question => String(question.id) !== String(removeId));
    db.updateFormConfig(form.id, { questions: nextQuestions });
    await renderEditorReply(interaction, db, form.id);
    return true;
  }

  if (customId.startsWith(CHOICE_ANSWER_PREFIX)) {
    const responseId = Number(customId.slice(CHOICE_ANSWER_PREFIX.length));
    const response = db.getFormResponse(responseId);
    if (!response || response.user_id !== interaction.user.id || response.status !== "in_progress") {
      await interaction.reply({ content: "That form session is not active.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const form = db.getFormConfigById(response.form_id);
    const question = form?.questions?.[response.current_question_index];
    if (!form || !question) {
      await interaction.reply({ content: "That question is no longer available.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const selectedValues = (interaction.values || []).map(value => question.options?.[Number(value)]).filter(Boolean);
    if (!selectedValues.length && question.required) {
      await interaction.reply({ content: "Choose at least one answer.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const updated = db.updateFormResponse(response.id, {
      answers: [...response.answers, { question: question.label, answer: selectedValues.join(", ") || "Skipped" }],
      current_question_index: response.current_question_index + 1
    });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (updated.current_question_index >= form.questions.length) {
      await finalizeFormResponse(interaction, { client, db }, updated.id);
    } else {
      await sendNextFormQuestion(interaction, db, updated.id);
    }
    return true;
  }

  return false;
}

async function handleModalSubmit(interaction, { client, db } = {}) {
  if (!interaction.isModalSubmit()) return false;
  const customId = interaction.customId || "";

  if (customId.startsWith(QUESTION_MODAL_PREFIX)) {
    const formId = Number(customId.slice(QUESTION_MODAL_PREFIX.length));
    const form = db.getFormConfigById(formId);
    if (!form || !isFormManager(interaction.member)) {
      await interaction.reply({ content: "You cannot edit that form.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const label = interaction.fields.getTextInputValue("label").trim();
    const type = normalizeQuestionType(interaction.fields.getTextInputValue("type"));
    const required = normalizeRequired(interaction.fields.getTextInputValue("required"));
    const options = parseOptions(interaction.fields.getTextInputValue("options"));

    if (!label || !type) {
      await interaction.reply({
        content: "Question text and a valid type are required. Use: short, paragraph, single, or multi.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if ((type === "single_choice" || type === "multi_choice") && options.length < 2) {
      await interaction.reply({
        content: "Choice questions need at least two options, one per line.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const questions = [...(form.questions || [])];
    questions.push({
      id: makeQuestionId(questions.length),
      label,
      type,
      required,
      options: type === "single_choice" || type === "multi_choice" ? options : []
    });

    db.updateFormConfig(form.id, { questions });
    await renderEditorReply(interaction, db, form.id, "Question added.");
    return true;
  }

  if (customId.startsWith(TEXT_ANSWER_PREFIX)) {
    const responseId = Number(customId.slice(TEXT_ANSWER_PREFIX.length));
    const response = db.getFormResponse(responseId);
    if (!response || response.user_id !== interaction.user.id || response.status !== "in_progress") {
      await interaction.reply({ content: "That form session is not active.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const form = db.getFormConfigById(response.form_id);
    const question = form?.questions?.[response.current_question_index];
    if (!form || !question) {
      await interaction.reply({ content: "That question is no longer available.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const answer = interaction.fields.getTextInputValue("answer").trim();
    if (!answer && question.required) {
      await interaction.reply({ content: "That question requires an answer.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const updated = db.updateFormResponse(response.id, {
      answers: [...response.answers, { question: question.label, answer: answer || "Skipped" }],
      current_question_index: response.current_question_index + 1
    });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (updated.current_question_index >= form.questions.length) {
      await finalizeFormResponse(interaction, { client, db }, updated.id);
    } else {
      await sendNextFormQuestion(interaction, db, updated.id);
    }
    return true;
  }

  return false;
}

module.exports = {
  handleInteraction,
  handleButton,
  handleSelectMenu,
  handleModalSubmit,
  startFormTicker,
  refreshPublishedFormPanels
};
