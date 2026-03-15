// commands/tyrone.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const DEFAULT_OWNER_USER_ID = "796968805196627978";
const DEFAULTS = {
  enabled: true,
  channel_id: process.env.TYRONE_CHANNEL_ID || null,
  allowed_role_id: process.env.TYRONE_ALLOWED_ROLE_ID || null,
  issues_channel_id: process.env.TYRONE_ISSUES_CHANNEL_ID || null,
  owner_user_id: process.env.OWNER_USER_ID || DEFAULT_OWNER_USER_ID,
  ignore_owner_messages: true,
  openai_model: "gpt-4.1-mini",
  system_prompt:
    "You are Tyrone, the helper bot for the TB Server (a Discord community). " +
    "You talk in a friendly, direct way. " +
    "If the question is about this specific server, prefer these rules when relevant:\n" +
    "- Mod applications: /apply command DMs the user with the topic.\n" +
    "- Strike system: 1 = warning, 2 = 1 hour mute, 3 = 3 hour mute, 4 = temp ban (appeal allowed), 5 = perm ban.\n" +
    "- Self-promo must stay in the #self-promo channel.\n" +
    "- Streaming schedule is currently informal: usually around 6/7 PM MST to 9/9:30 PM MST.\n" +
    "If the user asks something unrelated to the server, answer like a normal helpful assistant.",
  outro_template:
    "{{answer}}\n\nI hope that answered your question ✅ If not, run **!tyrone <follow-up>** or use **/report-issue** if I acted weird.",
  cache_max_age_ms: 30 * 24 * 60 * 60 * 1000,
  cache_max_entries: 500,
  approval_window_ms: 2 * 60 * 1000,
  nag_cooldown_ms: 60 * 1000,
  auto_nag_delay_ms: 2 * 60 * 1000,
  soft_intercept_enabled: true,
  soft_intercept_message_template:
    "Hey <@{{userId}}>, I can help with that, but use **!tyrone** so I don’t spam chats.\n\n" +
    "Option A: copy/paste this:\n`!tyrone {{content}}`\n\n" +
    "Option B: type **!tyrone-approve** and I’ll answer your last question.",
  ignore_keywords: [],
  direct_command_enabled: true,
  mention_reply_enabled: true
};

const DEFAULT_FAQ_ENTRIES = [
  {
    label: "Mod applications",
    match_type: "includes",
    pattern: [
      "how become mod",
      "how to become mod",
      "mod app",
      "mod application",
      "be staff",
      "be a mod"
    ].join("\n"),
    answer:
      "To become a mod, use the `/apply` command. It should DM you with the application topic and info you need to fill out.",
    enabled: 1,
    sort_order: 10
  },
  {
    label: "Strike policy",
    match_type: "includes",
    pattern: [
      "strike policy",
      "what is the strike policy",
      "how does the strike system work",
      "moderation system"
    ].join("\n"),
    answer:
      "Strike System:\n" +
      "• 1 Strike → warning\n" +
      "• 2 Strikes → 1-hour mute\n" +
      "• 3 Strikes → 3-hour mute\n" +
      "• 4 Strikes → temp ban (appeal allowed)\n" +
      "• 5 Strikes → permanent ban (no appeal)\n\n" +
      "Strikes are issued at staff discretion.",
    enabled: 1,
    sort_order: 20
  },
  {
    label: "Stream schedule",
    match_type: "includes",
    pattern: [
      "stream schedule",
      "when do you stream",
      "what time do you stream",
      "go live"
    ].join("\n"),
    answer:
      "I do not have a fixed schedule yet since I’m new to streaming, but currently I try to stream around **6/7 PM MST** to around **9/9:30 PM MST**.",
    enabled: 1,
    sort_order: 30
  },
  {
    label: "Self promo",
    match_type: "includes",
    pattern: [
      "self promo",
      "self-promo",
      "self promotion",
      "promote my channel",
      "promote my tiktok",
      "promote my youtube"
    ].join("\n"),
    answer:
      "Keep any self promo in the **#self-promo** channel. Posting your stuff outside that channel may get removed or warned.",
    enabled: 1,
    sort_order: 40
  }
];

const followUpContext = new Map();
const pendingApprovals = new Map();
const nagCooldown = new Map();
const delayedNagTimers = new Map();
const FOLLOW_UP_WINDOW_MS = 60 * 1000;

let initialized = false;

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return fallback;
}

function normalizeNullableString(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function normalizeNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  return fallback;
}

function parseStoredValue(raw) {
  if (raw === null || raw === undefined) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function renderTemplate(template, values) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = values[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function parseFaqPatterns(patternText) {
  return String(patternText || "")
    .split(/\r?\n|,/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function hydrateFaqRows(rows) {
  return (rows || []).map(row => ({
    ...row,
    enabled: !!row.enabled,
    sort_order: Number(row.sort_order || 0),
    patterns: parseFaqPatterns(row.pattern)
  }));
}

function initializeAdminState(db) {
  if (initialized) return;

  const existingSettings = db.listTyroneSettings();
  const existingKeys = new Set(existingSettings.map(row => row.key));
  const missingDefaults = {};

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!existingKeys.has(key)) {
      missingDefaults[key] = value;
    }
  }

  if (Object.keys(missingDefaults).length) {
    db.setManyTyroneSettings(missingDefaults);
  }

  if (!db.countTyroneFaq()) {
    for (const entry of DEFAULT_FAQ_ENTRIES) {
      db.createTyroneFaq(entry);
    }
  }

  initialized = true;
}

function getRuntimeSettings(db) {
  initializeAdminState(db);

  const rows = db.listTyroneSettings();
  const stored = {};

  for (const row of rows) {
    stored[row.key] = parseStoredValue(row.value);
  }

  return {
    enabled: normalizeBoolean(stored.enabled, DEFAULTS.enabled),
    channel_id: normalizeNullableString(stored.channel_id, DEFAULTS.channel_id),
    allowed_role_id: normalizeNullableString(stored.allowed_role_id, DEFAULTS.allowed_role_id),
    issues_channel_id: normalizeNullableString(stored.issues_channel_id, DEFAULTS.issues_channel_id),
    owner_user_id: normalizeNullableString(stored.owner_user_id, DEFAULTS.owner_user_id),
    ignore_owner_messages: normalizeBoolean(stored.ignore_owner_messages, DEFAULTS.ignore_owner_messages),
    openai_model: normalizeNullableString(stored.openai_model, DEFAULTS.openai_model),
    system_prompt: normalizeNullableString(stored.system_prompt, DEFAULTS.system_prompt),
    outro_template: normalizeNullableString(stored.outro_template, DEFAULTS.outro_template),
    cache_max_age_ms: Math.max(0, normalizeNumber(stored.cache_max_age_ms, DEFAULTS.cache_max_age_ms)),
    cache_max_entries: Math.max(1, normalizeNumber(stored.cache_max_entries, DEFAULTS.cache_max_entries)),
    approval_window_ms: Math.max(1000, normalizeNumber(stored.approval_window_ms, DEFAULTS.approval_window_ms)),
    nag_cooldown_ms: Math.max(0, normalizeNumber(stored.nag_cooldown_ms, DEFAULTS.nag_cooldown_ms)),
    auto_nag_delay_ms: Math.max(0, normalizeNumber(stored.auto_nag_delay_ms, DEFAULTS.auto_nag_delay_ms)),
    soft_intercept_enabled: normalizeBoolean(stored.soft_intercept_enabled, DEFAULTS.soft_intercept_enabled),
    soft_intercept_message_template: normalizeNullableString(
      stored.soft_intercept_message_template,
      DEFAULTS.soft_intercept_message_template
    ),
    ignore_keywords: normalizeStringArray(stored.ignore_keywords, DEFAULTS.ignore_keywords),
    direct_command_enabled: normalizeBoolean(stored.direct_command_enabled, DEFAULTS.direct_command_enabled),
    mention_reply_enabled: normalizeBoolean(stored.mention_reply_enabled, DEFAULTS.mention_reply_enabled)
  };
}

function getFaqEntries(db) {
  initializeAdminState(db);
  return hydrateFaqRows(db.listTyroneFaq());
}

function setFollowUpContext(userId, topic) {
  followUpContext.set(userId, { topic, timestamp: Date.now() });
}

function getFollowUpContext(userId) {
  const data = followUpContext.get(userId);
  if (!data) return null;

  if (Date.now() - data.timestamp > FOLLOW_UP_WINDOW_MS) {
    followUpContext.delete(userId);
    return null;
  }

  return data;
}

function setPendingApproval(userId, questionText, channelId, messageId) {
  pendingApprovals.set(userId, {
    questionText,
    channelId,
    messageId,
    timestamp: Date.now()
  });
}

function getPendingApproval(userId, settings) {
  const data = pendingApprovals.get(userId);
  if (!data) return null;

  if (Date.now() - data.timestamp > settings.approval_window_ms) {
    pendingApprovals.delete(userId);
    return null;
  }

  return data;
}

function canNag(userId, settings) {
  const last = nagCooldown.get(userId);
  if (!last) return true;
  return Date.now() - last > settings.nag_cooldown_ms;
}

function markNag(userId) {
  nagCooldown.set(userId, Date.now());
}

function getActionForStrikeCount(strikes) {
  switch (strikes) {
    case 1: return "a written warning";
    case 2: return "a 1-hour mute";
    case 3: return "a 3-hour mute";
    case 4: return "a temp ban with appeal allowed";
    case 5: return "a permanent ban";
    default: return "no further action configured";
  }
}

function isSelfStrikeLookup(loweredQuery) {
  const asksHowMany =
    loweredQuery.includes("how many") ||
    loweredQuery.includes("check") ||
    loweredQuery.includes("show");

  const mentionsStrikes =
    loweredQuery.includes("strike") ||
    loweredQuery.includes("strikes") ||
    loweredQuery.includes("warning") ||
    loweredQuery.includes("warnings");

  const mentionsSelf =
    loweredQuery.includes("i have") ||
    loweredQuery.includes("do i have") ||
    loweredQuery.includes("my account") ||
    loweredQuery.includes("on my account") ||
    loweredQuery.includes("my acc") ||
    loweredQuery.includes("for me");

  return asksHowMany && mentionsStrikes && mentionsSelf;
}

function isStrikeCountFollowUp(loweredQuery, priorContext) {
  if (!priorContext || priorContext.topic !== "strike_lookup") return false;

  return (
    loweredQuery.includes("what happens at") ||
    loweredQuery.includes("what about") ||
    loweredQuery.includes("at ") ||
    loweredQuery === "3" ||
    loweredQuery === "4" ||
    loweredQuery === "5" ||
    loweredQuery === "2" ||
    loweredQuery === "1"
  );
}

function extractStrikeNumber(loweredQuery) {
  const match = loweredQuery.match(/\b([1-9]|10)\b/);
  if (!match) return null;

  const n = Number(match[1]);
  if (!Number.isInteger(n)) return null;
  return n;
}

function looksLikeTyroneQuestion(lowered, faqs) {
  if (!lowered) return false;
  if (lowered.startsWith("!")) return false;
  if (lowered.length < 6) return false;

  const hasQuestionMark = lowered.includes("?");
  const startsLikeQuestion =
    lowered.startsWith("hey") ||
    lowered.startsWith("yo") ||
    lowered.startsWith("can ") ||
    lowered.startsWith("how ") ||
    lowered.startsWith("what ") ||
    lowered.startsWith("when ") ||
    lowered.startsWith("where ") ||
    lowered.startsWith("why ") ||
    lowered.startsWith("do ") ||
    lowered.startsWith("does ");

  const serverKeywords =
    lowered.includes("strike") ||
    lowered.includes("mod") ||
    lowered.includes("staff") ||
    lowered.includes("self promo") ||
    lowered.includes("self-promo") ||
    lowered.includes("schedule") ||
    lowered.includes("stream");

  if (matchFaqEntry(lowered, faqs)) return true;

  return (hasQuestionMark && serverKeywords) || (startsLikeQuestion && serverKeywords);
}

function stripBotMention(content, botId) {
  if (!content || !botId) return content || "";
  return content
    .replace(new RegExp(`<@!?${botId}>`, "g"), "")
    .trim();
}

function looksLikeBadAiFallback(text) {
  const t = (text || "").toLowerCase();
  return (
    !t ||
    t.includes("ai is not configured") ||
    t.includes("having issues talking to the ai backend") ||
    t.includes("did not get a valid response") ||
    t.includes("try again later") ||
    t.includes("ran into an error")
  );
}

function applyOutro(answerText, settings) {
  return renderTemplate(settings.outro_template, {
    answer: answerText
  });
}

function matchFaqEntry(lowerContent, faqEntries) {
  for (const entry of faqEntries) {
    if (!entry.enabled) continue;

    for (const pattern of entry.patterns) {
      if (!pattern) continue;

      if (entry.match_type === "exact") {
        if (lowerContent === pattern) return entry;
      } else if (lowerContent.includes(pattern)) {
        return entry;
      }
    }
  }

  return null;
}

async function askOpenAIAsTyrone(query, author, settings) {
  const apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    return "AI is not configured yet. Please tell the server owner to set OPENAI_API_KEY.";
  }

  const body = {
    model: settings.openai_model || DEFAULTS.openai_model,
    messages: [
      { role: "system", content: settings.system_prompt },
      {
        role: "user",
        content: `User: ${author.username}#${author.discriminator || ""} (ID ${author.id}) says: ${query}`
      }
    ],
    max_tokens: 350
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("OpenAI API error:", res.status, text);
    return "Tyrone is having issues talking to the AI backend right now. Try again later.";
  }

  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;

  if (!content) {
    return "I did not get a valid response from the AI. Try again in a bit.";
  }

  return content.trim();
}

async function answerQuestion(query, message, db, options = {}) {
  const settings = options.settings || getRuntimeSettings(db);
  const faqEntries = options.faqEntries || getFaqEntries(db);
  const loweredQuery = (query || "").toLowerCase().trim();
  const author = message.author;
  const mention = `<@${author.id}>`;

  if (settings.ignore_keywords.some(k => loweredQuery.includes(k.toLowerCase()))) {
    return {
      reply: null,
      path: "ignored"
    };
  }

  const priorContext = getFollowUpContext(author.id);

  if (isSelfStrikeLookup(loweredQuery)) {
    const stats = db.getUserStats(author.id);
    setFollowUpContext(author.id, "strike_lookup");

    const txt =
      `Hey ${mention}, you currently have **${stats.strikes} strike${stats.strikes === 1 ? "" : "s"}** ` +
      `and **${stats.warnings} warning${stats.warnings === 1 ? "" : "s"}** on your account.`;

    return {
      reply: applyOutro(txt, settings),
      path: "strike_lookup"
    };
  }

  if (isStrikeCountFollowUp(loweredQuery, priorContext)) {
    const strikeNum = extractStrikeNumber(loweredQuery);
    if (strikeNum !== null) {
      const action = getActionForStrikeCount(strikeNum);
      setFollowUpContext(author.id, "strike_lookup");
      return {
        reply: applyOutro(
          `Hey ${mention}, at **${strikeNum} strike${strikeNum === 1 ? "" : "s"}**, the action is **${action}**.`,
          settings
        ),
        path: "strike_follow_up"
      };
    }
  }

  const faqEntry = matchFaqEntry(loweredQuery, faqEntries);
  if (faqEntry) {
    if (
      loweredQuery.includes("strike policy") ||
      loweredQuery.includes("how does the strike system work") ||
      loweredQuery.includes("moderation system")
    ) {
      setFollowUpContext(author.id, "strike_policy");
    }

    return {
      reply: applyOutro(`Hey ${mention}, ${faqEntry.answer}`, settings),
      path: "faq",
      faqId: faqEntry.id || null
    };
  }

  if (priorContext && (priorContext.topic === "strike_lookup" || priorContext.topic === "strike_policy")) {
    const strikeNum = extractStrikeNumber(loweredQuery);
    if (strikeNum !== null) {
      const action = getActionForStrikeCount(strikeNum);
      setFollowUpContext(author.id, priorContext.topic);
      return {
        reply: applyOutro(
          `Hey ${mention}, at **${strikeNum} strike${strikeNum === 1 ? "" : "s"}**, the action is **${action}**.`,
          settings
        ),
        path: "strike_policy_follow_up"
      };
    }
  }

  try {
    if (db.getTyroneCachedAnswer) {
      const cached = db.getTyroneCachedAnswer(query, settings.cache_max_age_ms);
      if (cached) {
        return {
          reply: applyOutro(`Hey ${mention}, ${cached}`, settings),
          path: "cache"
        };
      }
    }
  } catch (err) {
    console.error("[Tyrone cache] get error:", err);
  }

  let responseFromAi;
  try {
    responseFromAi = await askOpenAIAsTyrone(query, author, settings);
  } catch (err) {
    console.error("Tyrone AI error:", err);
    responseFromAi = "Tyrone ran into an error trying to answer that. Try again later.";
  }

  if (!responseFromAi) {
    responseFromAi = "I did not get a useful answer back. Try asking in a different way.";
  }

  try {
    if (db.setTyroneCachedAnswer && !looksLikeBadAiFallback(responseFromAi)) {
      db.setTyroneCachedAnswer(query, responseFromAi, settings.cache_max_entries);
    }
  } catch (err) {
    console.error("[Tyrone cache] set error:", err);
  }

  return {
    reply: applyOutro(`Hey ${mention}, ${responseFromAi}`, settings),
    path: "ai"
  };
}

async function handleInteraction(interaction, { db }) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "report-issue") return;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }

  const settings = getRuntimeSettings(db);
  if (!settings.issues_channel_id) {
    await interaction.reply({
      content: "Issue logging isn’t configured yet (missing Tyrone issues channel setting). Tell Carson to set it in the dashboard.",
      ephemeral: true
    });
    return;
  }

  const details = interaction.options.getString("details") || "No extra details provided.";
  const guild = interaction.guild;
  const issuesChannel = await guild.channels.fetch(settings.issues_channel_id).catch(() => null);

  if (!issuesChannel || !issuesChannel.isTextBased()) {
    await interaction.reply({
      content: "The Tyrone issues channel is invalid or not a text channel. Fix the dashboard setting.",
      ephemeral: true
    });
    return;
  }

  const text =
    `🧾 **Tyrone Issue Report**\n` +
    `User: <@${interaction.user.id}> (${interaction.user.tag})\n` +
    `Channel: <#${interaction.channelId}>\n\n` +
    `Details:\n${details}`;

  await issuesChannel.send({ content: text, allowedMentions: { parse: [] } });
  await interaction.reply({
    content: "Got it ✅ I sent your issue report to staff.",
    ephemeral: true
  });
}

async function handleMessage(message, { db }) {
  if (message.author.bot) return;

  const settings = getRuntimeSettings(db);
  const faqEntries = getFaqEntries(db);

  if (!settings.enabled) return;
  if (settings.ignore_owner_messages && message.author.id === settings.owner_user_id) return;

  const raw = message.content || "";
  const content = raw.trim();
  const lower = content.toLowerCase();

  const botId = message.client?.user?.id || null;
  const mentionsTyrone = botId ? message.mentions.users.has(botId) : false;

  if (settings.channel_id && message.channelId !== settings.channel_id) return;

  if (settings.allowed_role_id) {
    const member = message.member;
    if (!member || !member.roles.cache.has(settings.allowed_role_id)) return;
  }

  if (lower.startsWith("!tytest")) {
    await message.reply("tytest is working ✅");
    return;
  }

  if (lower === "!tyrone-approve") {
    const pending = getPendingApproval(message.author.id, settings);
    if (!pending) {
      await message.reply(
        `Hey <@${message.author.id}>, I don't have a recent question queued. Use **!tyrone <your question>** instead.`
      );
      return;
    }

    if (pending.channelId !== message.channelId) {
      await message.reply(
        `Hey <@${message.author.id}>, approve that in the same channel where you asked it.`
      );
      return;
    }

    const result = await answerQuestion(pending.questionText, message, db, { settings, faqEntries });
    pendingApprovals.delete(message.author.id);

    if (result.reply) await message.reply(result.reply);
    return;
  }

  if (settings.direct_command_enabled && lower.startsWith("!tyrone")) {
    const query = content.slice("!tyrone".length).trim();

    if (!query) {
      await message.reply(`Hey <@${message.author.id}>, how can I help?`);
      return;
    }

    const result = await answerQuestion(query, message, db, { settings, faqEntries });
    if (result.reply) await message.reply(result.reply);
    return;
  }

  if (settings.mention_reply_enabled && mentionsTyrone) {
    const query = stripBotMention(content, botId);

    if (!query) {
      await message.reply(`Hey <@${message.author.id}>, how can I help?`);
      return;
    }

    const result = await answerQuestion(query, message, db, { settings, faqEntries });
    if (result.reply) await message.reply(result.reply);
    return;
  }

  if (!settings.soft_intercept_enabled) return;

  if (looksLikeTyroneQuestion(lower, faqEntries)) {
    if (!canNag(message.author.id, settings)) return;
    if (delayedNagTimers.has(message.id)) return;

    const timer = setTimeout(async () => {
      delayedNagTimers.delete(message.id);

      try {
        const original = await message.channel.messages.fetch(message.id).catch(() => null);
        if (!original) return;

        setPendingApproval(message.author.id, content, message.channelId, message.id);
        markNag(message.author.id);

        const notice = renderTemplate(settings.soft_intercept_message_template, {
          userId: message.author.id,
          content
        });

        await message.reply(notice);
      } catch (err) {
        console.error("[Tyrone delayed nag] error:", err);
      }
    }, settings.auto_nag_delay_ms);

    delayedNagTimers.set(message.id, timer);
  }
}

function sanitizeSettingsInput(payload = {}) {
  return {
    enabled: normalizeBoolean(payload.enabled, DEFAULTS.enabled),
    channel_id: normalizeNullableString(payload.channel_id, null),
    allowed_role_id: normalizeNullableString(payload.allowed_role_id, null),
    issues_channel_id: normalizeNullableString(payload.issues_channel_id, null),
    owner_user_id: normalizeNullableString(payload.owner_user_id, DEFAULTS.owner_user_id),
    ignore_owner_messages: normalizeBoolean(payload.ignore_owner_messages, DEFAULTS.ignore_owner_messages),
    openai_model: normalizeNullableString(payload.openai_model, DEFAULTS.openai_model),
    system_prompt: normalizeNullableString(payload.system_prompt, DEFAULTS.system_prompt),
    outro_template: normalizeNullableString(payload.outro_template, DEFAULTS.outro_template),
    cache_max_age_ms: Math.max(0, normalizeNumber(payload.cache_max_age_ms, DEFAULTS.cache_max_age_ms)),
    cache_max_entries: Math.max(1, normalizeNumber(payload.cache_max_entries, DEFAULTS.cache_max_entries)),
    approval_window_ms: Math.max(1000, normalizeNumber(payload.approval_window_ms, DEFAULTS.approval_window_ms)),
    nag_cooldown_ms: Math.max(0, normalizeNumber(payload.nag_cooldown_ms, DEFAULTS.nag_cooldown_ms)),
    auto_nag_delay_ms: Math.max(0, normalizeNumber(payload.auto_nag_delay_ms, DEFAULTS.auto_nag_delay_ms)),
    soft_intercept_enabled: normalizeBoolean(payload.soft_intercept_enabled, DEFAULTS.soft_intercept_enabled),
    soft_intercept_message_template: normalizeNullableString(
      payload.soft_intercept_message_template,
      DEFAULTS.soft_intercept_message_template
    ),
    ignore_keywords: normalizeStringArray(payload.ignore_keywords, DEFAULTS.ignore_keywords),
    direct_command_enabled: normalizeBoolean(payload.direct_command_enabled, DEFAULTS.direct_command_enabled),
    mention_reply_enabled: normalizeBoolean(payload.mention_reply_enabled, DEFAULTS.mention_reply_enabled)
  };
}

function sanitizeFaqInput(payload = {}) {
  return {
    label: normalizeNullableString(payload.label, null),
    match_type: payload.match_type === "exact" ? "exact" : "includes",
    pattern: String(payload.pattern || "").trim(),
    answer: String(payload.answer || "").trim(),
    enabled: normalizeBoolean(payload.enabled, true),
    sort_order: normalizeNumber(payload.sort_order, 0)
  };
}

function getAdminState(db) {
  const settings = getRuntimeSettings(db);
  const faqs = getFaqEntries(db).map(entry => ({
    id: entry.id,
    label: entry.label,
    match_type: entry.match_type,
    pattern: entry.pattern,
    answer: entry.answer,
    enabled: entry.enabled,
    sort_order: entry.sort_order,
    updated_at: entry.updated_at
  }));
  const cacheStats = db.getTyroneCacheStats();
  const cacheEntries = db.listTyroneCache(20);
  const events = db.listTyroneEvents(20);

  return {
    settings,
    faqs,
    cache: {
      ...cacheStats,
      entries: cacheEntries
    },
    events,
    overview: {
      openai_configured: !!process.env.OPENAI_API_KEY,
      faq_count: faqs.length
    }
  };
}

async function runAdminTest(db, payload = {}) {
  const settings = getRuntimeSettings(db);
  const faqEntries = getFaqEntries(db);
  const query = String(payload.query || "").trim();
  const fakeMessage = {
    author: {
      id: String(payload.userId || "123456789012345678"),
      username: String(payload.username || "DashboardUser"),
      discriminator: "0000"
    }
  };

  const result = query
    ? await answerQuestion(query, fakeMessage, db, { settings, faqEntries })
    : { reply: null, path: "empty" };

  db.logTyroneEvent("admin_test", {
    path: result.path,
    query,
    userId: fakeMessage.author.id
  });

  return {
    query,
    path: result.path,
    reply: result.reply,
    settings
  };
}

module.exports = {
  DEFAULTS,
  DEFAULT_FAQ_ENTRIES,
  initializeAdminState,
  getRuntimeSettings,
  getFaqEntries,
  sanitizeSettingsInput,
  sanitizeFaqInput,
  getAdminState,
  runAdminTest,
  handleMessage,
  handleInteraction
};
