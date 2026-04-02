const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const tickets = require("./tickets");

const APPLICATION_CHANNEL_ID = "1113094456242081832";
const VERIFIED_ROLE_ID = "1113560011193450536";
const OWNER_ROLE_ID = "1113158001604427966";
const TIMEOUT_TRACK_ROLE_ID = "1113813941852831845";
const APPLICATION_PANEL_MESSAGE_ID_KEY = "applications.panel.message_id";
const APPLICATION_PANEL_CHANNEL_ID_KEY = "applications.panel.channel_id";
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIME_LIMIT_MS = 60 * 60 * 1000;
const APPLICATION_TICK_MS = 60 * 1000;
const START_BUTTON_ID = "application:start";
const TYPE_SELECT_ID = "application:type_select";
const ADMIN_TYPE_SELECT_ID = "application:admin:type_select";
const CHANNEL_SELECT_PREFIX = "application:admin:review_channel:";
const CONFIRM_PREFIX = "application:confirm:";
const RESUME_PREFIX = "application:resume:";
const CANCEL_PREFIX = "application:cancel:";
const QUESTION_PREFIX = "application:question:";
const HELP_PREFIX = "application:help:";
const QUESTION_MODAL_PREFIX = "application:answer:";
const REVIEW_ACCEPT_PREFIX = "application:review:accept:";
const REVIEW_DENY_PREFIX = "application:review:deny:";
const REVIEW_MOREINFO_PREFIX = "application:review:moreinfo:";
const REVIEW_MOREINFO_MODAL_PREFIX = "application:review:moreinfo_modal:";
const ADMIN_ACTION_PREFIX = "application:admin:";
const ADMIN_EDIT_QUESTIONS_PREFIX = "edit_questions:";
const ADMIN_EDIT_MESSAGES_PREFIX = "edit_messages:";
const ADMIN_EDIT_ROLES_A_PREFIX = "edit_roles_a:";
const ADMIN_EDIT_ROLES_B_PREFIX = "edit_roles_b:";
const ADMIN_EDIT_TIMING_PREFIX = "edit_timing:";
const HELP_PAUSE_MS = 2 * 60 * 60 * 1000;
let applicationTickerStarted = false;

function getDefaultManagerRoles() {
  return [OWNER_ROLE_ID, process.env.ADMIN_ROLE_ID || ""].filter(Boolean);
}

function getDefaultPingRoles() {
  return [process.env.ADMIN_ROLE_ID || "", OWNER_ROLE_ID].filter(Boolean);
}

function getDefaultReviewChannelId() {
  return process.env.REQUEST_CHANNEL_ID || APPLICATION_CHANNEL_ID;
}

function getBlacklistRoleId() {
  return process.env.APPLICATION_BLACKLIST_ROLE_ID || process.env.BLACKLIST_ROLE_ID || "";
}

function uniq(list = []) {
  return [...new Set(list.filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
}

function parseRoleIdsInput(value) {
  return uniq(
    String(value || "")
      .match(/\d{17,20}/g) || []
  );
}

function parseQuestionList(value) {
  return String(value || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

function parseDurationInput(value, fallbackMs) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallbackMs;

  const units = {
    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000
  };

  let total = 0;
  let matched = false;
  const regex = /(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b/g;
  let match = null;
  while ((match = regex.exec(raw))) {
    matched = true;
    total += Number(match[1]) * units[match[2]];
  }

  if (!matched && /^\d+$/.test(raw)) {
    total = Number(raw) * 60 * 1000;
    matched = true;
  }

  return matched ? total : fallbackMs;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];
  const parts = [];
  let remaining = totalSeconds;
  for (const [label, size] of units) {
    if (remaining < size && parts.length === 0 && label !== "second") continue;
    const value = Math.floor(remaining / size);
    if (!value && label !== "second") continue;
    remaining -= value * size;
    if (value || (label === "second" && parts.length === 0)) {
      parts.push(`${value} ${label}${value === 1 ? "" : "s"}`);
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

function shortText(value, max = 1024) {
  const text = String(value || "").trim();
  if (text.length <= max) return text || "No answer provided.";
  return `${text.slice(0, max - 3)}...`;
}

function templateMessage(text, context) {
  return String(text || "")
    .replaceAll("{{user}}", `<@${context.userId}>`)
    .replaceAll("{{application}}", context.applicationName || "application")
    .replaceAll("{{reviewer}}", context.reviewerId ? `<@${context.reviewerId}>` : "staff")
    .replaceAll("{{note}}", context.note || "");
}

function getApplicationDefaults() {
  const reviewChannelId = getDefaultReviewChannelId();
  const pingRoles = getDefaultPingRoles();
  const managerRoles = getDefaultManagerRoles();
  const blacklistRoleId = getBlacklistRoleId();
  const baseRestricted = uniq([TIMEOUT_TRACK_ROLE_ID, blacklistRoleId]);

  return [
    {
      key: "admin",
      display_name: "Admin Application",
      open: false,
      questions: [
        "Basic Information",
        "Experience",
        "Motivation",
        "Availability",
        "Rule Understanding",
        "Handling Staff Misbehavior",
        "Conflict Resolution",
        "Teamwork and Communication",
        "References / Final Notes"
      ],
      confirmation_message:
        "Are you sure you want to apply?\nOnce you start the application I will send you a series of questions. You will have a limited amount of time to complete the application. If you do not complete the application in time, you will have to restart. If you wish to stop the application, you may cancel at any time.",
      completion_message: "Your application has been submitted.",
      accepted_message:
        "Hey {{user}}, your {{application}} has been accepted. Welcome aboard.",
      denied_message:
        "Hey {{user}}, your {{application}} was denied this time. Thank you for applying.",
      required_roles: uniq([process.env.STAFF_ROLE_ID || ""]),
      restricted_roles: uniq([...(process.env.ADMIN_ROLE_ID ? [process.env.ADMIN_ROLE_ID] : []), OWNER_ROLE_ID, ...baseRestricted]),
      accepted_roles: uniq([process.env.ADMIN_ROLE_ID || ""]),
      denied_roles: [],
      accepted_removal_roles: [],
      denied_removal_roles: [],
      ping_roles: pingRoles,
      manager_roles: managerRoles,
      review_channel_id: reviewChannelId,
      cooldown_ms: DEFAULT_COOLDOWN_MS,
      time_limit_ms: DEFAULT_TIME_LIMIT_MS,
      staff_thread_enabled: false
    },
    {
      key: "discord_mod",
      display_name: "Discord Mod Application",
      open: false,
      questions: [
        "Basic Information",
        "Prior Moderation Experience",
        "Motivation",
        "Availability",
        "Understanding of Rules",
        "Handling Problem Members",
        "Conflict Resolution",
        "Teamwork and Communication",
        "References / Final Notes"
      ],
      confirmation_message:
        "Are you sure you want to apply?\nOnce you start the application I will send you a series of questions. You will have a limited amount of time to complete the application. If you do not complete the application in time, you will have to restart. If you wish to stop the application, you may cancel at any time.",
      completion_message: "Your application has been submitted.",
      accepted_message:
        "Hey {{user}}, your {{application}} has been accepted. Welcome to the team.",
      denied_message:
        "Hey {{user}}, your {{application}} was denied this time. Thank you for applying.",
      required_roles: [VERIFIED_ROLE_ID],
      restricted_roles: uniq([process.env.STAFF_ROLE_ID || "", process.env.ADMIN_ROLE_ID || "", OWNER_ROLE_ID, ...baseRestricted]),
      accepted_roles: uniq([process.env.STAFF_ROLE_ID || ""]),
      denied_roles: [],
      accepted_removal_roles: [],
      denied_removal_roles: [],
      ping_roles: pingRoles,
      manager_roles: managerRoles,
      review_channel_id: reviewChannelId,
      cooldown_ms: DEFAULT_COOLDOWN_MS,
      time_limit_ms: DEFAULT_TIME_LIMIT_MS,
      staff_thread_enabled: false
    },
    {
      key: "staff_support",
      display_name: "Staff Support Team Application",
      open: false,
      questions: [
        "Basic Information",
        "Motivation",
        "Availability",
        "Understanding of Rules",
        "Support / Conflict Handling",
        "Teamwork and Communication",
        "Additional Information",
        "References",
        "Questions for Staff"
      ],
      confirmation_message:
        "Are you sure you want to apply?\nOnce you start the application I will send you a series of questions. You will have a limited amount of time to complete the application. If you do not complete the application in time, you will have to restart. If you wish to stop the application, you may cancel at any time.",
      completion_message: "Your application has been submitted.",
      accepted_message:
        "Hey {{user}}, your {{application}} has been accepted. Welcome to the support team.",
      denied_message:
        "Hey {{user}}, your {{application}} was denied this time. Thank you for applying.",
      required_roles: [VERIFIED_ROLE_ID],
      restricted_roles: uniq([...(process.env.TICKET_CLAIM_ROLE_IDS || "").split(","), process.env.ADMIN_ROLE_ID || "", OWNER_ROLE_ID, ...baseRestricted]),
      accepted_roles: uniq([(process.env.TICKET_CLAIM_ROLE_IDS || "").split(",")[0] || ""]),
      denied_roles: [],
      accepted_removal_roles: [],
      denied_removal_roles: [],
      ping_roles: pingRoles,
      manager_roles: managerRoles,
      review_channel_id: reviewChannelId,
      cooldown_ms: DEFAULT_COOLDOWN_MS,
      time_limit_ms: DEFAULT_TIME_LIMIT_MS,
      staff_thread_enabled: false
    },
    {
      key: "tiktok_mod",
      display_name: "TikTok Mod Application",
      open: false,
      questions: [
        "Basic Information",
        "Prior Experience",
        "Availability During Streams",
        "Moderation Skills",
        "Handling Spam / Toxic Chat",
        "Team Communication",
        "References",
        "Final Thoughts"
      ],
      confirmation_message:
        "Are you sure you want to apply?\nOnce you start the application I will send you a series of questions. You will have a limited amount of time to complete the application. If you do not complete the application in time, you will have to restart. If you wish to stop the application, you may cancel at any time.",
      completion_message: "Your application has been submitted.",
      accepted_message:
        "Hey {{user}}, your {{application}} has been accepted.",
      denied_message:
        "Hey {{user}}, your {{application}} was denied this time. Thank you for applying.",
      required_roles: [VERIFIED_ROLE_ID],
      restricted_roles: baseRestricted,
      accepted_roles: [],
      denied_roles: [],
      accepted_removal_roles: [],
      denied_removal_roles: [],
      ping_roles: pingRoles,
      manager_roles: managerRoles,
      review_channel_id: reviewChannelId,
      cooldown_ms: DEFAULT_COOLDOWN_MS,
      time_limit_ms: DEFAULT_TIME_LIMIT_MS,
      staff_thread_enabled: false
    }
  ];
}

function ensureApplicationDefaults(db) {
  const defaults = getApplicationDefaults();
  for (const config of defaults) {
    if (!db.getApplicationConfig(config.key)) {
      db.upsertApplicationConfig(config);
    }
  }
  return db.listApplicationConfigs();
}

function getConfigMap(db) {
  return Object.fromEntries(ensureApplicationDefaults(db).map(config => [config.key, config]));
}

function isHeadAdmin(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  return !!member.roles?.cache?.has?.(OWNER_ROLE_ID);
}

function canUseApplicationPanel(member) {
  if (!member) return false;
  if (isHeadAdmin(member)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.ManageRoles)) return true;
  return !!member.roles?.cache?.has?.(VERIFIED_ROLE_ID);
}

function canReviewApplications(member, config) {
  if (!member || !config) return false;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  const defaultManagerRoles = getDefaultManagerRoles();
  return uniq([...defaultManagerRoles, ...(config.manager_roles || [])]).some(roleId =>
    member.roles?.cache?.has?.(roleId)
  );
}

function buildApplicationPanel() {
  const embed = new EmbedBuilder()
    .setTitle("Staff Applications")
    .setColor(0x5865f2)
    .setDescription(
      "Use the button below to start an application for this server.\n\n" +
      "You must be verified to apply. Tyrone will guide you through the questions and send your submission to staff for review."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(START_BUTTON_ID)
      .setLabel("Start Application")
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

function buildTypeSelect(configs) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TYPE_SELECT_ID)
      .setPlaceholder("Choose an application type")
      .addOptions(
        configs.map(config => ({
          label: config.display_name,
          value: config.key,
          description: config.open ? "Currently open" : "Currently closed"
        }))
      )
  );
}

function buildConfirmationRow(typeKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_PREFIX}${typeKey}`)
      .setLabel("Start Now")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CANCEL_PREFIX}new`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildResumeRow(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RESUME_PREFIX}${submissionId}`)
      .setLabel("Resume")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${CANCEL_PREFIX}${submissionId}`)
      .setLabel("Cancel Application")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildQuestionRow(submissionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${QUESTION_PREFIX}${submissionId}`)
      .setLabel("Answer Question")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${HELP_PREFIX}${submissionId}`)
      .setLabel("Help")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${CANCEL_PREFIX}${submissionId}`)
      .setLabel("Cancel Application")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildQuestionPrompt(config, submission) {
  const questionIndex = submission.current_question_index;
  const questionText = config.questions[questionIndex] || "Question";
  const remaining = submission.expires_at ? Math.max(0, submission.expires_at - Date.now()) : 0;
  return {
    content:
      `**${config.display_name}**\n` +
      `Question **${questionIndex + 1} / ${config.questions.length}**\n\n` +
      `${questionText}\n\n` +
      `Time remaining: **${formatDuration(remaining)}**`,
    components: [buildQuestionRow(submission.id)],
    flags: MessageFlags.Ephemeral
  };
}

function buildReviewComponents(submissionId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${REVIEW_ACCEPT_PREFIX}${submissionId}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${REVIEW_DENY_PREFIX}${submissionId}`)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${REVIEW_MOREINFO_PREFIX}${submissionId}`)
        .setLabel("Request More Info")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildApplicationEmbed(config, submission, user) {
  const embed = new EmbedBuilder()
    .setTitle(config.display_name)
    .setColor(0x2b8a3e)
    .addFields(
      { name: "Applicant", value: `<@${user.id}>`, inline: true },
      { name: "User ID", value: user.id, inline: true },
      { name: "Status", value: submission.status, inline: true },
      { name: "Submitted At", value: `<t:${Math.floor((submission.submitted_at || Date.now()) / 1000)}:F>`, inline: false }
    )
    .setTimestamp(new Date());

  for (let index = 0; index < submission.answers.length; index += 1) {
    const entry = submission.answers[index];
    embed.addFields({
      name: `${index + 1}. ${shortText(entry.question, 256)}`,
      value: shortText(entry.answer, 1024),
      inline: false
    });
  }

  return embed;
}

function buildReviewUpdatedEmbed(originalEmbed, statusText, reviewerId, note = null) {
  const embed = EmbedBuilder.from(originalEmbed);
  const fields = embed.data.fields || [];
  const updatedFields = fields.map(field =>
    field.name === "Status"
      ? { name: "Status", value: statusText, inline: true }
      : field
  );

  const reviewLine = reviewerId ? `Handled by <@${reviewerId}>` : "Handled by staff";
  if (note) {
    updatedFields.push({ name: "Staff Note", value: shortText(note, 1024), inline: false });
  }
  embed.setFields(updatedFields);
  embed.setFooter({ text: reviewLine });
  return embed;
}

function buildAdminTypeSelect(configs, selectedKey) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ADMIN_TYPE_SELECT_ID)
      .setPlaceholder("Manage an application type")
      .addOptions(
        configs.map(config => ({
          label: config.display_name,
          value: config.key,
          description: config.key === selectedKey ? "Currently selected" : (config.open ? "Open" : "Closed")
        }))
      )
  );
}

function summarizeRoles(roleIds) {
  return roleIds?.length ? roleIds.map(roleId => `<@&${roleId}>`).join(", ") : "None";
}

function buildAdminEmbed(config) {
  return new EmbedBuilder()
    .setTitle(`${config.display_name} Settings`)
    .setColor(config.open ? 0x2ecc71 : 0xe74c3c)
    .setDescription(`Status: **${config.open ? "Open" : "Closed"}**`)
    .addFields(
      { name: "Review Channel", value: config.review_channel_id ? `<#${config.review_channel_id}>` : "Not set", inline: true },
      { name: "Cooldown", value: formatDuration(config.cooldown_ms), inline: true },
      { name: "Time Limit", value: formatDuration(config.time_limit_ms), inline: true },
      { name: "Required Roles", value: summarizeRoles(config.required_roles), inline: false },
      { name: "Restricted Roles", value: summarizeRoles(config.restricted_roles), inline: false },
      { name: "Accepted Roles", value: summarizeRoles(config.accepted_roles), inline: false },
      { name: "Denied Roles", value: summarizeRoles(config.denied_roles), inline: false },
      { name: "Accepted Removal Roles", value: summarizeRoles(config.accepted_removal_roles), inline: false },
      { name: "Denied Removal Roles", value: summarizeRoles(config.denied_removal_roles), inline: false },
      { name: "Ping Roles", value: summarizeRoles(config.ping_roles), inline: false },
      { name: "Application Manager Roles", value: summarizeRoles(config.manager_roles), inline: false },
      { name: "Staff Threads", value: config.staff_thread_enabled ? "Enabled" : "Disabled", inline: true },
      { name: "Questions", value: config.questions.map((question, index) => `${index + 1}. ${question}`).join("\n") || "No questions configured", inline: false }
    );
}

function buildAdminRows(configs, selectedKey) {
  return [
    buildAdminTypeSelect(configs, selectedKey),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ADMIN_ACTION_PREFIX}toggle_open:${selectedKey}`)
        .setLabel("Open / Close")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_QUESTIONS_PREFIX}${selectedKey}`)
        .setLabel("Edit Questions")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_MESSAGES_PREFIX}${selectedKey}`)
        .setLabel("Edit Messages")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_TIMING_PREFIX}${selectedKey}`)
        .setLabel("Edit Timing")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_A_PREFIX}${selectedKey}`)
        .setLabel("Edit Role Rules")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_B_PREFIX}${selectedKey}`)
        .setLabel("Edit Result Roles")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${ADMIN_ACTION_PREFIX}toggle_threads:${selectedKey}`)
        .setLabel("Toggle Threads")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${ADMIN_ACTION_PREFIX}pick_review_channel:${selectedKey}`)
        .setLabel("Set Review Channel")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildAdminMessage(configs, selectedKey) {
  const selectedConfig = configs.find(config => config.key === selectedKey) || configs[0];
  return {
    embeds: [buildAdminEmbed(selectedConfig)],
    components: buildAdminRows(configs, selectedConfig.key),
    flags: MessageFlags.Ephemeral
  };
}

function buildAnswerModal(config, submission) {
  const index = submission.current_question_index;
  const questionText = config.questions[index] || "Question";
  return new ModalBuilder()
    .setCustomId(`${QUESTION_MODAL_PREFIX}${submission.id}`)
    .setTitle(`${config.display_name} Q${index + 1}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("answer")
          .setLabel(`Answer question ${index + 1}`)
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(shortText(questionText, 100))
          .setRequired(true)
          .setMaxLength(4000)
      )
    );
}

function buildMoreInfoModal(submissionId) {
  return new ModalBuilder()
    .setCustomId(`${REVIEW_MOREINFO_MODAL_PREFIX}${submissionId}`)
    .setTitle("Request More Info")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("What extra info do you need?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
}

function buildEditQuestionsModal(config) {
  return new ModalBuilder()
    .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_QUESTIONS_PREFIX}${config.key}`)
    .setTitle(`Questions: ${config.display_name}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("questions")
          .setLabel("One question per line")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue((config.questions || []).join("\n"))
          .setMaxLength(4000)
      )
    );
}

function buildEditMessagesModal(config) {
  return new ModalBuilder()
    .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_MESSAGES_PREFIX}${config.key}`)
    .setTitle(`Messages: ${config.display_name}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("confirmation_message")
          .setLabel("Confirmation message")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(shortText(config.confirmation_message, 4000))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("completion_message")
          .setLabel("Completion message")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(shortText(config.completion_message, 4000))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("accepted_message")
          .setLabel("Accepted message")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(shortText(config.accepted_message, 4000))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("denied_message")
          .setLabel("Denied message")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(shortText(config.denied_message, 4000))
      )
    );
}

function buildEditRolesAModal(config) {
  return new ModalBuilder()
    .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_A_PREFIX}${config.key}`)
    .setTitle(`Role Rules: ${config.display_name}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("required_roles")
          .setLabel("Required role IDs")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue((config.required_roles || []).join(", "))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("restricted_roles")
          .setLabel("Restricted role IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue((config.restricted_roles || []).join(", "))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("manager_roles")
          .setLabel("Application manager role IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue((config.manager_roles || []).join(", "))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("ping_roles")
          .setLabel("Ping role IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue((config.ping_roles || []).join(", "))
      )
    );
}

function buildEditRolesBModal(config) {
  return new ModalBuilder()
    .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_B_PREFIX}${config.key}`)
    .setTitle(`Result Roles: ${config.display_name}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("accepted_roles")
          .setLabel("Accepted role IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue((config.accepted_roles || []).join(", "))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("denied_roles")
          .setLabel("Denied role IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue((config.denied_roles || []).join(", "))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("accepted_removal_roles")
          .setLabel("Accepted removal role IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue((config.accepted_removal_roles || []).join(", "))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("denied_removal_roles")
          .setLabel("Denied removal role IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue((config.denied_removal_roles || []).join(", "))
      )
    );
}

function buildEditTimingModal(config) {
  return new ModalBuilder()
    .setCustomId(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_TIMING_PREFIX}${config.key}`)
    .setTitle(`Timing: ${config.display_name}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("cooldown")
          .setLabel("Cooldown (e.g. 24h)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(formatDuration(config.cooldown_ms))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("time_limit")
          .setLabel("Time limit (e.g. 60m)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(formatDuration(config.time_limit_ms))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("review_channel_id")
          .setLabel("Review channel ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config.review_channel_id || "")
      )
    );
}

async function renderAdminPanel(interaction, db, selectedKey) {
  const configs = ensureApplicationDefaults(db);
  const payload = buildAdminMessage(configs, selectedKey || configs[0]?.key);
  if (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isChannelSelectMenu?.()) {
    await interaction.update({
      embeds: payload.embeds,
      components: payload.components
    });
    return true;
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return true;
  }
  await interaction.reply(payload);
  return true;
}

function getEligibilityFailure(member, config, latestSubmission) {
  if (!config.open) {
    return `${config.display_name} is currently closed.`;
  }

  if ((config.required_roles || []).length && !(config.required_roles || []).some(roleId => member.roles?.cache?.has?.(roleId))) {
    return "You are missing the required role for that application.";
  }

  if ((config.restricted_roles || []).some(roleId => member.roles?.cache?.has?.(roleId))) {
    return "You currently have a restricted role for that application.";
  }

  if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
    return "You cannot apply while timed out.";
  }

  if (latestSubmission) {
    const latestAt = latestSubmission.submitted_at || latestSubmission.started_at || 0;
    const remaining = latestAt + config.cooldown_ms - Date.now();
    if (remaining > 0) {
      return `You are on cooldown for this application. Try again in **${formatDuration(remaining)}**.`;
    }
  }

  return null;
}

async function createReviewArtifacts({ client, db, guild, user, config, submission }) {
  const reviewChannel = await guild.channels.fetch(config.review_channel_id).catch(() => null);
  if (!reviewChannel?.isTextBased?.()) {
    throw new Error("Configured review channel is missing or not text-based.");
  }

  const mentionRoles = uniq(config.ping_roles || []);
  const mentionContent = mentionRoles.length
    ? `${mentionRoles.map(roleId => `<@&${roleId}>`).join(" ")} New ${config.display_name} from <@${user.id}>`
    : `New ${config.display_name} from <@${user.id}>`;

  const sent = await reviewChannel.send({
    content: mentionContent,
    embeds: [buildApplicationEmbed(config, submission, user)],
    components: buildReviewComponents(submission.id),
    allowedMentions: { roles: mentionRoles, users: [user.id] }
  });

  let threadId = null;
  if (config.staff_thread_enabled && typeof sent.startThread === "function") {
    try {
      const thread = await sent.startThread({
        name: `${config.key}-${user.username || user.id}`.slice(0, 100),
        autoArchiveDuration: 1440
      });
      threadId = thread.id;
      await thread.send(`Private review thread for <@${user.id}>.`);
    } catch (error) {
      console.error("[Applications] Failed to create review thread:", error);
    }
  }

  db.updateApplicationSubmission(submission.id, {
    status: "submitted",
    submitted_at: Date.now(),
    review_channel_id: reviewChannel.id,
    review_message_id: sent.id,
    review_thread_id: threadId
  });

  console.log(
    "[Applications] Submission posted",
    JSON.stringify({
      submission_id: submission.id,
      application_key: config.key,
      review_channel_id: reviewChannel.id,
      review_message_id: sent.id,
      review_thread_id: threadId
    })
  );
}

async function updateReviewMessage(client, submission, reviewerId, statusText, note = null, keepButtons = false) {
  if (!submission.review_channel_id || !submission.review_message_id) return;
  const channel = await client.channels.fetch(submission.review_channel_id).catch(() => null);
  const message = channel?.messages
    ? await channel.messages.fetch(submission.review_message_id).catch(() => null)
    : null;
  if (!message?.embeds?.length) return;
  await message.edit({
    embeds: [buildReviewUpdatedEmbed(message.embeds[0], statusText, reviewerId, note)],
    components: keepButtons ? buildReviewComponents(submission.id) : []
  }).catch(error => {
    console.error("[Applications] Failed to update review message:", error);
  });
}

async function applyRoleChanges(member, addRoleIds = [], removeRoleIds = []) {
  const me = member.guild.members.me || (await member.guild.members.fetchMe().catch(() => null));
  const result = { added: [], removed: [], errors: [] };
  if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    result.errors.push("I need Manage Roles to update application roles.");
    return result;
  }

  for (const roleId of uniq(removeRoleIds)) {
    const role = await member.guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      result.errors.push(`Cannot remove role ${roleId} because it is above my highest role.`);
      continue;
    }
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, "Application review role update").catch(error => {
        result.errors.push(`Failed to remove role ${role.id}: ${error.message}`);
      });
      result.removed.push(role.id);
    }
  }

  for (const roleId of uniq(addRoleIds)) {
    const role = await member.guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      result.errors.push(`Cannot add role ${roleId} because it is above my highest role.`);
      continue;
    }
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, "Application review role update").catch(error => {
        result.errors.push(`Failed to add role ${role.id}: ${error.message}`);
      });
      result.added.push(role.id);
    }
  }

  return result;
}

async function handleReviewDecision(interaction, { client, db }, submissionId, action) {
  const submission = db.getApplicationSubmission(submissionId);
  if (!submission) {
    await interaction.reply({ content: "That application could not be found.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const config = db.getApplicationConfig(submission.application_key);
  if (!config) {
    await interaction.reply({ content: "That application config could not be found.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (!canReviewApplications(interaction.member, config)) {
    await interaction.reply({ content: "You do not have permission to review this application.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (!["submitted", "needs_more_info"].includes(submission.status)) {
    await interaction.reply({ content: `This application is already ${submission.status}.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  const applicant = await interaction.guild.members.fetch(submission.user_id).catch(() => null);
  let roleResult = { added: [], removed: [], errors: [] };
  if (applicant) {
    roleResult = await applyRoleChanges(
      applicant,
      action === "accept" ? config.accepted_roles : config.denied_roles,
      action === "accept" ? config.accepted_removal_roles : config.denied_removal_roles
    );
  }

  const newStatus = action === "accept" ? "accepted" : "denied";
  const reviewAction = action === "accept" ? "accept" : "deny";
  const updated = db.updateApplicationSubmission(submission.id, {
    status: newStatus,
    reviewer_user_id: interaction.user.id,
    review_action: reviewAction,
    review_notes: roleResult.errors.join("\n") || submission.review_notes || null
  });

  await updateReviewMessage(
    client,
    updated,
    interaction.user.id,
    action === "accept" ? "Accepted" : "Denied"
  );

  if (applicant) {
    const message = templateMessage(
      action === "accept" ? config.accepted_message : config.denied_message,
      {
        userId: applicant.id,
        applicationName: config.display_name,
        reviewerId: interaction.user.id
      }
    );
    await applicant.send({ content: message }).catch(() => null);
  }

  await interaction.reply({
    content:
      `${action === "accept" ? "Accepted" : "Denied"} **${config.display_name}** for <@${submission.user_id}>.` +
      (roleResult.errors.length ? `\nRole warnings:\n- ${roleResult.errors.join("\n- ")}` : ""),
    flags: MessageFlags.Ephemeral,
    allowedMentions: { users: [submission.user_id] }
  });
  return true;
}

async function expireSubmissionIfNeeded(db, submission) {
  if (!submission || submission.status !== "in_progress") return null;
  if (!submission.expires_at || submission.expires_at > Date.now()) return submission;
  return db.updateApplicationSubmission(submission.id, { status: "expired" });
}

async function sendNextQuestion(interaction, db, submission) {
  const config = db.getApplicationConfig(submission.application_key);
  if (!config) {
    await interaction.reply({ content: "That application type no longer exists.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const freshSubmission = await expireSubmissionIfNeeded(db, submission);
  if (freshSubmission?.status === "expired") {
    await interaction.reply({
      content: "Your application expired before you finished it. Please start again.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(buildQuestionPrompt(config, freshSubmission));
  } else {
    await interaction.reply(buildQuestionPrompt(config, freshSubmission));
  }
  return true;
}

async function postApplicationPanel(interaction, db) {
  const existingChannelId = db.getAppSetting(APPLICATION_PANEL_CHANNEL_ID_KEY)?.value || null;
  const existingMessageId = db.getAppSetting(APPLICATION_PANEL_MESSAGE_ID_KEY)?.value || null;

  if (existingChannelId && existingMessageId) {
    const oldChannel = await interaction.guild.channels.fetch(existingChannelId).catch(() => null);
    const oldMessage = oldChannel?.messages
      ? await oldChannel.messages.fetch(existingMessageId).catch(() => null)
      : null;
    if (oldMessage) {
      await oldMessage.delete().catch(() => null);
    }
  }

  const sent = await interaction.channel.send(buildApplicationPanel());
  db.setManyAppSettings({
    [APPLICATION_PANEL_CHANNEL_ID_KEY]: interaction.channelId,
    [APPLICATION_PANEL_MESSAGE_ID_KEY]: sent.id
  });

  console.log(
    "[Applications] Panel setup",
    JSON.stringify({ channel_id: interaction.channelId, message_id: sent.id, actor_user_id: interaction.user.id })
  );
}

async function refreshApplicationPanel(client, db, { reason = "manual_refresh" } = {}) {
  const existingChannelId = db.getAppSetting(APPLICATION_PANEL_CHANNEL_ID_KEY)?.value || null;
  const existingMessageId = db.getAppSetting(APPLICATION_PANEL_MESSAGE_ID_KEY)?.value || null;
  const targetChannelId = existingChannelId || APPLICATION_CHANNEL_ID;
  const channel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  if (existingMessageId) {
    const oldMessage = await channel.messages.fetch(existingMessageId).catch(() => null);
    if (oldMessage) {
      await oldMessage.delete().catch(() => null);
    }
  }

  const sent = await channel.send(buildApplicationPanel());
  db.setManyAppSettings({
    [APPLICATION_PANEL_CHANNEL_ID_KEY]: channel.id,
    [APPLICATION_PANEL_MESSAGE_ID_KEY]: sent.id
  });

  console.log(
    "[Applications] Panel refreshed",
    JSON.stringify({ reason, channel_id: channel.id, message_id: sent.id })
  );
  return true;
}

async function handleInteraction(interaction, { db }) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === "setup-applacation") {
    if (!interaction.inGuild() || interaction.channelId !== APPLICATION_CHANNEL_ID) {
      await interaction.reply({
        content: `Run this in <#${APPLICATION_CHANNEL_ID}>.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({
        content: "Only Head Admin can run this command.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    ensureApplicationDefaults(db);
    await postApplicationPanel(interaction, db);
    await interaction.reply({
      content: "Application panel posted.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (interaction.commandName === "application-info") {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can use this command.", flags: MessageFlags.Ephemeral });
      return true;
    }

    ensureApplicationDefaults(db);
    await renderAdminPanel(interaction, db, "admin");
    return true;
  }

  return false;
}

async function handleButton(interaction, { client, db }) {
  const customId = String(interaction.customId || "");

  if (customId === START_BUTTON_ID) {
    ensureApplicationDefaults(db);
    if (!canUseApplicationPanel(interaction.member)) {
      await interaction.reply({
        content: "You must be verified before you can start an application.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const activeSubmission = await expireSubmissionIfNeeded(
      db,
      db.getActiveApplicationSubmissionForUser(interaction.user.id, interaction.guildId)
    );

    if (activeSubmission && activeSubmission.status === "in_progress") {
      const config = db.getApplicationConfig(activeSubmission.application_key);
      await interaction.reply({
        content:
          `You already have a **${config?.display_name || activeSubmission.application_key}** in progress.\n` +
          `Use the buttons below to resume it or cancel it.`,
        components: [buildResumeRow(activeSubmission.id)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (activeSubmission && activeSubmission.status === "paused_help") {
      const config = db.getApplicationConfig(activeSubmission.application_key);
      await interaction.reply({
        content:
          `Your **${config?.display_name || activeSubmission.application_key}** is paused while Tyrone support helps you.\n` +
          `You can resume it within **${formatDuration(Math.max(0, (activeSubmission.expires_at || 0) - Date.now()))}** or cancel it.`,
        components: [buildResumeRow(activeSubmission.id)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.reply({
      content: "Choose which application you want to start:",
      components: [buildTypeSelect(ensureApplicationDefaults(db))],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (customId.startsWith(CONFIRM_PREFIX)) {
    const applicationKey = customId.slice(CONFIRM_PREFIX.length);
    const config = db.getApplicationConfig(applicationKey);
    if (!config) {
      await interaction.reply({ content: "That application type no longer exists.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const latest = db.getLatestApplicationSubmissionForUserType(
      interaction.user.id,
      interaction.guildId,
      config.key
    );
    const failure = getEligibilityFailure(interaction.member, config, latest);
    if (failure) {
      await interaction.reply({ content: failure, flags: MessageFlags.Ephemeral });
      return true;
    }

    const submission = db.createApplicationSubmission({
      application_key: config.key,
      user_id: interaction.user.id,
      guild_id: interaction.guildId,
      status: "in_progress",
      answers: [],
      current_question_index: 0,
      started_at: Date.now(),
      expires_at: Date.now() + Number(config.time_limit_ms || DEFAULT_TIME_LIMIT_MS)
    });

    console.log(
      "[Applications] Submission started",
      JSON.stringify({ submission_id: submission.id, application_key: config.key, user_id: interaction.user.id })
    );

    await interaction.reply(buildQuestionPrompt(config, submission));
    return true;
  }

  if (customId.startsWith(RESUME_PREFIX)) {
    const submissionId = Number(customId.slice(RESUME_PREFIX.length));
    let submission = await expireSubmissionIfNeeded(db, db.getApplicationSubmission(submissionId));
    if (!submission || submission.user_id !== interaction.user.id) {
      await interaction.reply({ content: "That application could not be resumed.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (submission.status === "expired") {
      await interaction.reply({ content: "That application expired. Please start again.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (submission.status === "paused_help") {
      const config = db.getApplicationConfig(submission.application_key);
      submission = db.updateApplicationSubmission(submission.id, {
        status: "in_progress",
        expires_at: Date.now() + Number(config?.time_limit_ms || DEFAULT_TIME_LIMIT_MS)
      });
      console.log(
        "[Applications] Submission resumed from help",
        JSON.stringify({ submission_id: submission.id, user_id: interaction.user.id })
      );
    }
    await interaction.reply(buildQuestionPrompt(db.getApplicationConfig(submission.application_key), submission));
    return true;
  }

  if (customId.startsWith(CANCEL_PREFIX)) {
    const target = customId.slice(CANCEL_PREFIX.length);
    if (target === "new") {
      await interaction.reply({ content: "Application cancelled.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const submissionId = Number(target);
    const submission = db.getApplicationSubmission(submissionId);
    if (!submission || submission.user_id !== interaction.user.id) {
      await interaction.reply({ content: "That application could not be cancelled.", flags: MessageFlags.Ephemeral });
      return true;
    }

    db.updateApplicationSubmission(submissionId, { status: "cancelled" });
    await interaction.reply({ content: "Your application has been cancelled.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (customId.startsWith(QUESTION_PREFIX)) {
    const submissionId = Number(customId.slice(QUESTION_PREFIX.length));
    const submission = await expireSubmissionIfNeeded(db, db.getApplicationSubmission(submissionId));
    if (!submission || submission.user_id !== interaction.user.id || submission.status !== "in_progress") {
      await interaction.reply({ content: "That application is no longer active.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const config = db.getApplicationConfig(submission.application_key);
    await interaction.showModal(buildAnswerModal(config, submission));
    return true;
  }

  if (customId.startsWith(HELP_PREFIX)) {
    const submissionId = Number(customId.slice(HELP_PREFIX.length));
    const submission = await expireSubmissionIfNeeded(db, db.getApplicationSubmission(submissionId));
    if (!submission || submission.user_id !== interaction.user.id || submission.status !== "in_progress") {
      await interaction.reply({ content: "That application is no longer active.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const config = db.getApplicationConfig(submission.application_key);
    const currentQuestion = config?.questions?.[submission.current_question_index] || "Unknown question";
    const helpSummary =
      `Application help requested for ${config?.display_name || submission.application_key}. ` +
      `Paused on question ${submission.current_question_index + 1}/${config?.questions?.length || 0}.`;
    const answeredSummary = submission.answers.length
      ? submission.answers.map((entry, index) => `${index + 1}. ${entry.question}: ${shortText(entry.answer, 180)}`).join("\n")
      : "No answers yet.";

    const ticketResult = await tickets.createStructuredSupportTicket({
      guild: interaction.guild,
      opener: interaction.user,
      source: "application_help",
      category: `${config?.display_name || "Application"} Help`,
      issueText:
        `Application: ${config?.display_name || submission.application_key}\n` +
        `Current question: ${currentQuestion}\n\n` +
        `Saved answers:\n${answeredSummary}`,
      summary: helpSummary,
      introMessage:
        `Hi <@${interaction.user.id}>, Tyrone created this ticket because you requested help while filling out your **${config?.display_name || "application"}**. ` +
        `Your progress is saved for 2 hours.`,
      awaitingIssueText: false
    });

    if (!ticketResult.ok) {
      await interaction.reply({
        content: ticketResult.error || "I couldn't create a help ticket right now.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    db.updateApplicationSubmission(submission.id, {
      status: "paused_help",
      expires_at: Date.now() + HELP_PAUSE_MS,
      review_notes:
        `Paused for help at question ${submission.current_question_index + 1}. Support ticket: ${ticketResult.channelId}`
    });

    console.log(
      "[Applications] Submission paused for help",
      JSON.stringify({
        submission_id: submission.id,
        application_key: submission.application_key,
        user_id: interaction.user.id,
        ticket_channel_id: ticketResult.channelId
      })
    );

    await interaction.reply({
      content:
        `I saved your application for **2 hours** and opened a Tyrone support ticket for you: <#${ticketResult.channelId}>.\n` +
        `When you're ready, click **Start Application** again and use **Resume**.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (customId.startsWith(REVIEW_ACCEPT_PREFIX)) {
    return handleReviewDecision(interaction, { client, db }, Number(customId.slice(REVIEW_ACCEPT_PREFIX.length)), "accept");
  }

  if (customId.startsWith(REVIEW_DENY_PREFIX)) {
    return handleReviewDecision(interaction, { client, db }, Number(customId.slice(REVIEW_DENY_PREFIX.length)), "deny");
  }

  if (customId.startsWith(REVIEW_MOREINFO_PREFIX)) {
    const submission = db.getApplicationSubmission(Number(customId.slice(REVIEW_MOREINFO_PREFIX.length)));
    const config = submission ? db.getApplicationConfig(submission.application_key) : null;
    if (!submission || !config || !canReviewApplications(interaction.member, config)) {
      await interaction.reply({ content: "You do not have permission to do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(buildMoreInfoModal(submission.id));
    return true;
  }

  if (customId.startsWith(`${ADMIN_ACTION_PREFIX}toggle_open:`)) {
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const key = customId.split(":").pop();
    const config = db.getApplicationConfig(key);
    db.upsertApplicationConfig({ ...config, open: !config.open });
    await renderAdminPanel(interaction, db, key);
    return true;
  }

  if (customId.startsWith(`${ADMIN_ACTION_PREFIX}toggle_threads:`)) {
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const key = customId.split(":").pop();
    const config = db.getApplicationConfig(key);
    db.upsertApplicationConfig({ ...config, staff_thread_enabled: !config.staff_thread_enabled });
    await renderAdminPanel(interaction, db, key);
    return true;
  }

  if (customId.startsWith(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_QUESTIONS_PREFIX}`)) {
    const key = customId.slice(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_QUESTIONS_PREFIX}`.length);
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(buildEditQuestionsModal(db.getApplicationConfig(key)));
    return true;
  }

  if (customId.startsWith(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_MESSAGES_PREFIX}`)) {
    const key = customId.slice(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_MESSAGES_PREFIX}`.length);
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(buildEditMessagesModal(db.getApplicationConfig(key)));
    return true;
  }

  if (customId.startsWith(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_A_PREFIX}`)) {
    const key = customId.slice(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_A_PREFIX}`.length);
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(buildEditRolesAModal(db.getApplicationConfig(key)));
    return true;
  }

  if (customId.startsWith(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_B_PREFIX}`)) {
    const key = customId.slice(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_B_PREFIX}`.length);
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(buildEditRolesBModal(db.getApplicationConfig(key)));
    return true;
  }

  if (customId.startsWith(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_TIMING_PREFIX}`)) {
    const key = customId.slice(`${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_TIMING_PREFIX}`.length);
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(buildEditTimingModal(db.getApplicationConfig(key)));
    return true;
  }

  if (customId.startsWith(`${ADMIN_ACTION_PREFIX}pick_review_channel:`)) {
    const key = customId.split(":").pop();
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({
      content: "Choose the review channel for this application type:",
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${CHANNEL_SELECT_PREFIX}${key}`)
            .setPlaceholder("Choose a review channel")
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}

async function handleSelectMenu(interaction, { db }) {
  const customId = String(interaction.customId || "");

  if (customId === TYPE_SELECT_ID) {
    const key = interaction.values?.[0];
    const config = db.getApplicationConfig(key);
    if (!config) {
      await interaction.reply({ content: "That application type no longer exists.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const latest = db.getLatestApplicationSubmissionForUserType(interaction.user.id, interaction.guildId, key);
    const failure = getEligibilityFailure(interaction.member, config, latest);
    if (failure) {
      await interaction.update({ content: failure, components: [] });
      return true;
    }

    await interaction.update({
      content: config.confirmation_message,
      components: [buildConfirmationRow(key)]
    });
    return true;
  }

  if (customId === ADMIN_TYPE_SELECT_ID) {
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.update(buildAdminMessage(ensureApplicationDefaults(db), interaction.values?.[0]));
    return true;
  }

  if (customId.startsWith(CHANNEL_SELECT_PREFIX)) {
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const key = customId.slice(CHANNEL_SELECT_PREFIX.length);
    const config = db.getApplicationConfig(key);
    db.upsertApplicationConfig({ ...config, review_channel_id: interaction.values?.[0] || null });
    await interaction.update(buildAdminMessage(ensureApplicationDefaults(db), key));
    return true;
  }

  return false;
}

async function handleModalSubmit(interaction, { client, db }) {
  const customId = String(interaction.customId || "");

  if (customId.startsWith(QUESTION_MODAL_PREFIX)) {
    const submissionId = Number(customId.slice(QUESTION_MODAL_PREFIX.length));
    const submission = await expireSubmissionIfNeeded(db, db.getApplicationSubmission(submissionId));
    if (!submission || submission.user_id !== interaction.user.id || submission.status !== "in_progress") {
      await interaction.reply({ content: "That application is no longer active.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const config = db.getApplicationConfig(submission.application_key);
    const answer = interaction.fields.getTextInputValue("answer");
    const answers = [...submission.answers, {
      question: config.questions[submission.current_question_index] || `Question ${submission.current_question_index + 1}`,
      answer
    }];
    const nextIndex = submission.current_question_index + 1;

    const updated = db.updateApplicationSubmission(submission.id, {
      answers,
      current_question_index: nextIndex
    });

    if (nextIndex < config.questions.length) {
      await interaction.reply(buildQuestionPrompt(config, updated));
      return true;
    }

    try {
      await createReviewArtifacts({
        client,
        db,
        guild: interaction.guild,
        user: interaction.user,
        config,
        submission: updated
      });
    } catch (error) {
      console.error("[Applications] Failed to post review:", error);
      await interaction.reply({
        content: "I could not submit your application to the staff review channel. Please contact staff.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    console.log(
      "[Applications] Submission completed",
      JSON.stringify({ submission_id: updated.id, application_key: config.key, user_id: interaction.user.id })
    );

    await interaction.reply({
      content: config.completion_message,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (customId.startsWith(REVIEW_MOREINFO_MODAL_PREFIX)) {
    const submissionId = Number(customId.slice(REVIEW_MOREINFO_MODAL_PREFIX.length));
    const submission = db.getApplicationSubmission(submissionId);
    const config = submission ? db.getApplicationConfig(submission.application_key) : null;
    if (!submission || !config || !canReviewApplications(interaction.member, config)) {
      await interaction.reply({ content: "You do not have permission to do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const note = interaction.fields.getTextInputValue("note");
    const updated = db.updateApplicationSubmission(submission.id, {
      status: "needs_more_info",
      reviewer_user_id: interaction.user.id,
      review_action: "request_more_info",
      review_notes: note
    });
    await updateReviewMessage(client, updated, interaction.user.id, "More info requested", note, true);
    const applicant = await interaction.guild.members.fetch(updated.user_id).catch(() => null);
    if (applicant) {
      await applicant.send({
        content:
          `Hey <@${applicant.id}>, staff requested more info for your **${config.display_name}**.\n\n` +
          `${note}`
      }).catch(() => null);
    }
    await interaction.reply({ content: "Requested more info from the applicant.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const adminEditHandlers = [
    {
      prefix: `${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_QUESTIONS_PREFIX}`,
      run: (config) => ({
        ...config,
        questions: parseQuestionList(interaction.fields.getTextInputValue("questions"))
      })
    },
    {
      prefix: `${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_MESSAGES_PREFIX}`,
      run: (config) => ({
        ...config,
        confirmation_message: interaction.fields.getTextInputValue("confirmation_message"),
        completion_message: interaction.fields.getTextInputValue("completion_message"),
        accepted_message: interaction.fields.getTextInputValue("accepted_message"),
        denied_message: interaction.fields.getTextInputValue("denied_message")
      })
    },
    {
      prefix: `${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_A_PREFIX}`,
      run: (config) => ({
        ...config,
        required_roles: parseRoleIdsInput(interaction.fields.getTextInputValue("required_roles")),
        restricted_roles: parseRoleIdsInput(interaction.fields.getTextInputValue("restricted_roles")),
        manager_roles: parseRoleIdsInput(interaction.fields.getTextInputValue("manager_roles")),
        ping_roles: parseRoleIdsInput(interaction.fields.getTextInputValue("ping_roles"))
      })
    },
    {
      prefix: `${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_ROLES_B_PREFIX}`,
      run: (config) => ({
        ...config,
        accepted_roles: parseRoleIdsInput(interaction.fields.getTextInputValue("accepted_roles")),
        denied_roles: parseRoleIdsInput(interaction.fields.getTextInputValue("denied_roles")),
        accepted_removal_roles: parseRoleIdsInput(interaction.fields.getTextInputValue("accepted_removal_roles")),
        denied_removal_roles: parseRoleIdsInput(interaction.fields.getTextInputValue("denied_removal_roles"))
      })
    },
    {
      prefix: `${ADMIN_ACTION_PREFIX}${ADMIN_EDIT_TIMING_PREFIX}`,
      run: (config) => ({
        ...config,
        cooldown_ms: parseDurationInput(interaction.fields.getTextInputValue("cooldown"), config.cooldown_ms),
        time_limit_ms: parseDurationInput(interaction.fields.getTextInputValue("time_limit"), config.time_limit_ms),
        review_channel_id: String(interaction.fields.getTextInputValue("review_channel_id") || "").trim() || null
      })
    }
  ];

  for (const handler of adminEditHandlers) {
    if (!customId.startsWith(handler.prefix)) continue;
    if (!isHeadAdmin(interaction.member)) {
      await interaction.reply({ content: "Only Head Admin can do that.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const key = customId.slice(handler.prefix.length);
    const current = db.getApplicationConfig(key);
    const next = handler.run(current);
    db.upsertApplicationConfig(next);
    await renderAdminPanel(interaction, db, key);
    return true;
  }

  return false;
}

function startApplicationTicker(client, db) {
  if (applicationTickerStarted) return;
  applicationTickerStarted = true;

  const tick = async () => {
    const expired = db.expireDueApplicationSubmissions(Date.now());
    if (!expired.length) return;

    console.log(
      "[Applications] Expired submissions",
      JSON.stringify({ count: expired.length, submission_ids: expired.map(item => item.id) })
    );

    for (const submission of expired) {
      const user = await client.users.fetch(submission.user_id).catch(() => null);
      if (user) {
        const wasPausedForHelp = String(submission.review_notes || "").includes("Paused for help");
        await user.send(
          wasPausedForHelp
            ? "Your paused application expired after 2 hours. You can start again from the applications panel."
            : "Your application expired before you finished it. You can start again from the applications panel."
        ).catch(() => null);
      }
    }
  };

  tick().catch(error => console.error("[Applications] Initial expiry tick failed:", error));
  setInterval(() => {
    tick().catch(error => console.error("[Applications] Expiry tick failed:", error));
  }, APPLICATION_TICK_MS);
}

module.exports = {
  handleInteraction,
  handleButton,
  handleSelectMenu,
  handleModalSubmit,
  startApplicationTicker,
  refreshApplicationPanel
};
