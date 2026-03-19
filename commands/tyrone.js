// commands/tyrone.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const DEFAULT_OWNER_USER_ID = "796968805196627978";
const FOLLOW_UP_WINDOW_MS = 60 * 1000;
const feedbackDmRequests = new Map();
const followUpContext = new Map();
const pendingApprovals = new Map();
const nagCooldown = new Map();
const delayedNagTimers = new Map();

let initialized = false;

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
    return value.map(v => String(v || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map(v => v.trim())
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

function getStoredSettingsMap(db) {
  initializeAdminState(db);
  const stored = {};
  for (const row of db.listTyroneSettings()) {
    stored[row.key] = parseStoredValue(row.value);
  }
  return stored;
}

function chooseRuntimeValue(storedValue, fallbackValue, normalizer) {
  const normalizedStored = normalizer(storedValue, null);
  if (
    normalizedStored !== null &&
    normalizedStored !== undefined &&
    normalizedStored !== "" &&
    !(Array.isArray(normalizedStored) && !normalizedStored.length)
  ) {
    return normalizedStored;
  }
  return normalizer(fallbackValue, null);
}

function getRuntimeSettings(db) {
  const stored = getStoredSettingsMap(db);

  return {
    enabled: normalizeBoolean(stored.enabled, DEFAULTS.enabled),
    channel_id: chooseRuntimeValue(stored.channel_id, DEFAULTS.channel_id, normalizeNullableString),
    allowed_role_id: chooseRuntimeValue(stored.allowed_role_id, DEFAULTS.allowed_role_id, normalizeNullableString),
    issues_channel_id: chooseRuntimeValue(stored.issues_channel_id, DEFAULTS.issues_channel_id, normalizeNullableString),
    owner_user_id: chooseRuntimeValue(stored.owner_user_id, DEFAULTS.owner_user_id, normalizeNullableString),
    ignore_owner_messages: normalizeBoolean(stored.ignore_owner_messages, DEFAULTS.ignore_owner_messages),
    openai_model: chooseRuntimeValue(stored.openai_model, DEFAULTS.openai_model, normalizeNullableString),
    system_prompt: chooseRuntimeValue(stored.system_prompt, DEFAULTS.system_prompt, normalizeNullableString),
    outro_template: chooseRuntimeValue(stored.outro_template, DEFAULTS.outro_template, normalizeNullableString),
    cache_max_age_ms: Math.max(0, normalizeNumber(stored.cache_max_age_ms, DEFAULTS.cache_max_age_ms)),
    cache_max_entries: Math.max(1, normalizeNumber(stored.cache_max_entries, DEFAULTS.cache_max_entries)),
    approval_window_ms: Math.max(1000, normalizeNumber(stored.approval_window_ms, DEFAULTS.approval_window_ms)),
    nag_cooldown_ms: Math.max(0, normalizeNumber(stored.nag_cooldown_ms, DEFAULTS.nag_cooldown_ms)),
    auto_nag_delay_ms: Math.max(0, normalizeNumber(stored.auto_nag_delay_ms, DEFAULTS.auto_nag_delay_ms)),
    soft_intercept_enabled: normalizeBoolean(stored.soft_intercept_enabled, DEFAULTS.soft_intercept_enabled),
    soft_intercept_message_template: chooseRuntimeValue(
      stored.soft_intercept_message_template,
      DEFAULTS.soft_intercept_message_template,
      normalizeNullableString
    ),
    ignore_keywords: normalizeStringArray(stored.ignore_keywords, DEFAULTS.ignore_keywords),
    direct_command_enabled: normalizeBoolean(stored.direct_command_enabled, DEFAULTS.direct_command_enabled),
    mention_reply_enabled: normalizeBoolean(stored.mention_reply_enabled, DEFAULTS.mention_reply_enabled)
  };
}

function getStoredSettingOrigins(db) {
  const stored = getStoredSettingsMap(db);
  const origins = {};

  for (const key of Object.keys(DEFAULTS)) {
    const raw = stored[key];
    if (
      raw === undefined ||
      raw === null ||
      raw === "" ||
      (Array.isArray(raw) && raw.length === 0)
    ) {
      origins[key] = "fallback";
    } else {
      origins[key] = "stored";
    }
  }

  return origins;
}

function getFaqEntries(db) {
  initializeAdminState(db);
  return hydrateFaqRows(db.listTyroneFaq());
}

function getCorrections(db) {
  return db.listTyroneCorrections().map(row => ({
    ...row,
    trigger_key: db.normalizeQuestionKey(row.trigger_text)
  }));
}

function getRuntimeMemorySnapshot() {
  const now = Date.now();

  const serializeMap = (map, transform) =>
    [...map.entries()].map(([key, value]) => transform(key, value, now));

  return {
    follow_up_context: serializeMap(followUpContext, (userId, value) => ({
      user_id: userId,
      topic: value.topic,
      age_ms: now - value.timestamp
    })),
    pending_approvals: serializeMap(pendingApprovals, (userId, value) => ({
      user_id: userId,
      channel_id: value.channelId,
      message_id: value.messageId,
      question_text: value.questionText,
      age_ms: now - value.timestamp
    })),
    nag_cooldowns: serializeMap(nagCooldown, (userId, value) => ({
      user_id: userId,
      age_ms: now - value
    })),
    pending_dm_feedback: serializeMap(feedbackDmRequests, (userId, value) => ({
      user_id: userId,
      report_id: value.reportId,
      age_ms: now - value.createdAt
    }))
  };
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
    ["1", "2", "3", "4", "5"].includes(loweredQuery)
  );
}

function extractStrikeNumber(loweredQuery) {
  const match = loweredQuery.match(/\b([1-9]|10)\b/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

function stripBotMention(content, botId) {
  if (!content || !botId) return content || "";
  return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
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

function looksLikeTyroneQuestion(lowered, faqs) {
  if (!lowered || lowered.startsWith("!") || lowered.length < 6) return false;
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
  if (matchCorrectionRule(lowered, [])) return true;
  return (hasQuestionMark && serverKeywords) || (startsLikeQuestion && serverKeywords);
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

function matchCorrectionRule(lowerContent, corrections) {
  const normalized = lowerContent.trim().toLowerCase();
  for (const correction of corrections) {
    if (!correction.enabled) continue;
    const key = correction.trigger_key || normalized;
    if (!key) continue;
    if (normalized === key || normalized.includes(key)) {
      return correction;
    }
  }
  return null;
}

function applyOutro(answerText, settings) {
  return renderTemplate(settings.outro_template, { answer: answerText });
}

async function askOpenAI(messages, model) {
  const apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || DEFAULTS.openai_model,
      messages,
      max_tokens: 400
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from OpenAI.");
  }
  return content.trim();
}

async function askOpenAIAsTyrone(query, author, settings) {
  const apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    return "AI is not configured yet. Please tell the server owner to set OPENAI_API_KEY.";
  }

  try {
    return await askOpenAI(
      [
        { role: "system", content: settings.system_prompt },
        {
          role: "user",
          content: `User: ${author.username}#${author.discriminator || ""} (ID ${author.id}) says: ${query}`
        }
      ],
      settings.openai_model || DEFAULTS.openai_model
    );
  } catch (err) {
    console.error("OpenAI API error:", err);
    return "Tyrone is having issues talking to the AI backend right now. Try again later.";
  }
}

async function rewriteDiscordText(text, purpose, settings) {
  const apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) return text;

  try {
    return await askOpenAI(
      [
        {
          role: "system",
          content:
            "Rewrite text to be Discord-friendly, concise, clear, and usable as bot/admin text. " +
            "Keep formatting lightweight and preserve intent. Return only the rewritten text."
        },
        {
          role: "user",
          content: `Purpose: ${purpose}\n\nText:\n${text}`
        }
      ],
      settings.openai_model || DEFAULTS.openai_model
    );
  } catch (err) {
    console.error("[Tyrone rewrite] error:", err);
    return text;
  }
}

async function guessReportIssue(questionText, responseText, settings) {
  const apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    return "Tyrone likely answered incorrectly, answered when he should not have, or missed the user’s intent.";
  }

  try {
    return await askOpenAI(
      [
        {
          role: "system",
          content:
            "You review Discord bot mistakes. Based on the user message and the bot response, briefly guess what likely went wrong. " +
            "Be specific and concise. One short paragraph."
        },
        {
          role: "user",
          content: `User message:\n${questionText || "(unknown)"}\n\nTyrone response:\n${responseText || "(none)"}`
        }
      ],
      settings.openai_model || DEFAULTS.openai_model
    );
  } catch (err) {
    console.error("[Tyrone guess report] error:", err);
    return "Tyrone likely answered incorrectly or should not have answered this message.";
  }
}

async function classifyHelpRequest(query, draftedReply, settings) {
  const lower = String(query || "").toLowerCase();
  const fallbackNeedsStaff =
    lower.includes("bug") ||
    lower.includes("broken") ||
    lower.includes("not working") ||
    lower.includes("can't") ||
    lower.includes("cannot") ||
    lower.includes("appeal") ||
    lower.includes("ban") ||
    lower.includes("mute") ||
    lower.includes("hack") ||
    lower.includes("report") ||
    lower.includes("scam") ||
    lower.includes("access issue") ||
    lower.includes("missing role") ||
    lower.includes("permission");

  const apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    return {
      needsStaff: fallbackNeedsStaff,
      summary: fallbackNeedsStaff
        ? "This looks like an issue that likely needs staff review."
        : "This looks simple enough for Tyrone to answer directly."
    };
  }

  try {
    const result = await askOpenAI(
      [
        {
          role: "system",
          content:
            "You triage Discord server help requests. Decide whether the bot can answer directly or whether staff help is needed. " +
            "Reply in exactly two lines:\n" +
            "DECISION: DIRECT or STAFF\n" +
            "SUMMARY: one short sentence"
        },
        {
          role: "user",
          content:
            `Request:\n${query}\n\n` +
            `Tyrone draft answer:\n${draftedReply || "(none)"}`
        }
      ],
      settings.openai_model || DEFAULTS.openai_model
    );

    const lines = String(result || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const decisionLine = lines.find(line => line.toUpperCase().startsWith("DECISION:")) || "";
    const summaryLine = lines.find(line => line.toUpperCase().startsWith("SUMMARY:")) || "";
    const decision = decisionLine.split(":").slice(1).join(":").trim().toUpperCase();
    const summary = summaryLine.split(":").slice(1).join(":").trim();

    return {
      needsStaff: decision === "STAFF",
      summary: summary || (decision === "STAFF"
        ? "This request likely needs staff help."
        : "This request can likely be answered directly.")
    };
  } catch (err) {
    console.error("[Tyrone help triage] error:", err);
    return {
      needsStaff: fallbackNeedsStaff,
      summary: fallbackNeedsStaff
        ? "This looks like an issue that likely needs staff review."
        : "This looks simple enough for Tyrone to answer directly."
    };
  }
}

function buildContextSnapshot(settings, corrections) {
  return {
    settings: {
      enabled: settings.enabled,
      channel_id: settings.channel_id,
      allowed_role_id: settings.allowed_role_id,
      issues_channel_id: settings.issues_channel_id,
      ignore_owner_messages: settings.ignore_owner_messages,
      direct_command_enabled: settings.direct_command_enabled,
      mention_reply_enabled: settings.mention_reply_enabled,
      soft_intercept_enabled: settings.soft_intercept_enabled
    },
    runtime_memory: getRuntimeMemorySnapshot(),
    corrections_count: corrections.length
  };
}

function buildAuthor(author = {}) {
  return {
    id: String(author.id || "123456789012345678"),
    username: String(author.username || "DashboardUser"),
    discriminator: author.discriminator || "0000"
  };
}

async function answerQuestion(query, message, db, options = {}) {
  const settings = options.settings || getRuntimeSettings(db);
  const faqEntries = options.faqEntries || getFaqEntries(db);
  const corrections = options.corrections || getCorrections(db);
  const loweredQuery = (query || "").toLowerCase().trim();
  const author = buildAuthor(message.author);
  const mention = options.mention === false ? "" : `<@${author.id}>`;
  const prefix = mention ? `Hey ${mention}, ` : "";

  if (settings.ignore_keywords.some(k => loweredQuery.includes(k.toLowerCase()))) {
    return {
      reply: null,
      path: "ignored",
      memory: buildContextSnapshot(settings, corrections)
    };
  }

  const priorContext = getFollowUpContext(author.id);

  if (isSelfStrikeLookup(loweredQuery)) {
    const stats = db.getUserStats(author.id);
    setFollowUpContext(author.id, "strike_lookup");
    const txt =
      `${prefix}you currently have **${stats.strikes} strike${stats.strikes === 1 ? "" : "s"}** ` +
      `and **${stats.warnings} warning${stats.warnings === 1 ? "" : "s"}** on your account.`;
    return {
      reply: applyOutro(txt, settings),
      path: "strike_lookup",
      memory: buildContextSnapshot(settings, corrections)
    };
  }

  if (isStrikeCountFollowUp(loweredQuery, priorContext)) {
    const strikeNum = extractStrikeNumber(loweredQuery);
    if (strikeNum !== null) {
      const action = getActionForStrikeCount(strikeNum);
      setFollowUpContext(author.id, "strike_lookup");
      return {
        reply: applyOutro(
          `${prefix}at **${strikeNum} strike${strikeNum === 1 ? "" : "s"}**, the action is **${action}**.`,
          settings
        ),
        path: "strike_follow_up",
        memory: buildContextSnapshot(settings, corrections)
      };
    }
  }

  const correction = matchCorrectionRule(loweredQuery, corrections);
  if (correction) {
    return {
      reply: applyOutro(`${prefix}${correction.response_text}`, settings),
      path: "correction",
      correctionId: correction.id,
      memory: buildContextSnapshot(settings, corrections)
    };
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
      reply: applyOutro(`${prefix}${faqEntry.answer}`, settings),
      path: "faq",
      faqId: faqEntry.id || null,
      memory: buildContextSnapshot(settings, corrections)
    };
  }

  if (priorContext && (priorContext.topic === "strike_lookup" || priorContext.topic === "strike_policy")) {
    const strikeNum = extractStrikeNumber(loweredQuery);
    if (strikeNum !== null) {
      const action = getActionForStrikeCount(strikeNum);
      setFollowUpContext(author.id, priorContext.topic);
      return {
        reply: applyOutro(
          `${prefix}at **${strikeNum} strike${strikeNum === 1 ? "" : "s"}**, the action is **${action}**.`,
          settings
        ),
        path: "strike_policy_follow_up",
        memory: buildContextSnapshot(settings, corrections)
      };
    }
  }

  try {
    const cached = db.getTyroneCachedAnswer(query, settings.cache_max_age_ms);
    if (cached) {
      return {
        reply: applyOutro(`${prefix}${cached}`, settings),
        path: "cache",
        memory: buildContextSnapshot(settings, corrections)
      };
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
    if (!looksLikeBadAiFallback(responseFromAi)) {
      db.setTyroneCachedAnswer(query, responseFromAi, settings.cache_max_entries);
    }
  } catch (err) {
    console.error("[Tyrone cache] set error:", err);
  }

  return {
    reply: applyOutro(`${prefix}${responseFromAi}`, settings),
    path: "ai",
    memory: buildContextSnapshot(settings, corrections)
  };
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

function sanitizeCorrectionInput(payload = {}) {
  return {
    label: normalizeNullableString(payload.label, null),
    trigger_text: String(payload.trigger_text || "").trim(),
    response_text: String(payload.response_text || "").trim(),
    notes: normalizeNullableString(payload.notes, null),
    enabled: normalizeBoolean(payload.enabled, true),
    sort_order: normalizeNumber(payload.sort_order, 0),
    source_response_log_id: payload.source_response_log_id ? Number(payload.source_response_log_id) : null
  };
}

function getAdminState(db) {
  const settings = getRuntimeSettings(db);
  const origins = getStoredSettingOrigins(db);
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
  const corrections = db.listTyroneCorrections().map(entry => ({
    ...entry,
    enabled: !!entry.enabled
  }));
  const cacheStats = db.getTyroneCacheStats();
  const cacheEntries = db.listTyroneCache(20);
  const events = db.listTyroneEvents(30);
  const seenMessages = db.listTyroneSeenMessages(80);
  const responses = db.listTyroneResponseLogs(80);
  const reports = db.listTyroneReports(80);

  return {
    settings,
    setting_origins: origins,
    stored_settings: getStoredSettingsMap(db),
    faqs,
    corrections,
    cache: {
      ...cacheStats,
      entries: cacheEntries
    },
    events,
    seen_messages: seenMessages,
    response_logs: responses,
    reports,
    memory: getRuntimeMemorySnapshot(),
    overview: {
      openai_configured: !!process.env.OPENAI_API_KEY,
      faq_count: faqs.length,
      corrections_count: corrections.length,
      reports_pending: reports.filter(r => r.status === "pending").length
    }
  };
}

async function runDashboardChat(db, payload = {}) {
  const settings = getRuntimeSettings(db);
  const faqEntries = getFaqEntries(db);
  const corrections = getCorrections(db);
  const query = String(payload.query || "").trim();
  const author = buildAuthor({
    id: payload.userId || "dashboard-admin",
    username: payload.username || "DashboardAdmin"
  });

  if (!query) {
    return {
      query,
      reply: "",
      path: "empty",
      memory: getRuntimeMemorySnapshot()
    };
  }

  const fakeMessage = { author };
  const result = await answerQuestion(query, fakeMessage, db, {
    settings,
    faqEntries,
    corrections,
    mention: false
  });

  const responseLog = db.logTyroneResponse({
    source_type: "dashboard",
    source_ref: "admin_chat",
    channel_id: null,
    guild_id: null,
    user_id: author.id,
    username: author.username,
    prompt_text: query,
    response_text: result.reply || "",
    path: result.path,
    detail: {
      memory: result.memory,
      faq_id: result.faqId || null,
      correction_id: result.correctionId || null
    }
  });

  db.logTyroneEvent("dashboard_chat", {
    response_log_id: responseLog.id,
    path: result.path
  });

  return {
    query,
    reply: result.reply,
    path: result.path,
    faqId: result.faqId || null,
    correctionId: result.correctionId || null,
    memory: result.memory,
    responseLogId: responseLog.id
  };
}

async function runAdminTest(db, payload = {}) {
  return runDashboardChat(db, payload);
}

async function rewriteAdminText(db, payload = {}) {
  const settings = getRuntimeSettings(db);
  const purpose = String(payload.purpose || "dashboard text").trim();
  const text = String(payload.text || "").trim();
  const rewritten = await rewriteDiscordText(text, purpose, settings);
  db.logTyroneEvent("admin_rewrite", { purpose });
  return { rewritten };
}

async function triageHelpRequest(db, payload = {}) {
  const settings = getRuntimeSettings(db);
  const faqEntries = getFaqEntries(db);
  const corrections = getCorrections(db);
  const query = String(payload.query || "").trim();
  const author = buildAuthor({
    id: payload.userId || "request-panel-user",
    username: payload.username || "RequestPanelUser"
  });

  if (!query) {
    return {
      query,
      reply: "",
      path: "empty",
      needsStaff: false,
      summary: "No request text was provided.",
      memory: getRuntimeMemorySnapshot()
    };
  }

  const fakeMessage = { author };
  const result = await answerQuestion(query, fakeMessage, db, {
    settings,
    faqEntries,
    corrections,
    mention: false
  });

  const directPaths = new Set([
    "faq",
    "correction",
    "cache",
    "strike_lookup",
    "strike_follow_up",
    "strike_policy_follow_up"
  ]);

  let needsStaff = false;
  let summary = "Tyrone can likely answer this directly.";

  if (directPaths.has(result.path)) {
    needsStaff = false;
    summary = `Answered directly through Tyrone's ${result.path} path.`;
  } else if (looksLikeBadAiFallback(result.reply)) {
    needsStaff = true;
    summary = "Tyrone could not produce a reliable direct answer.";
  } else {
    const decision = await classifyHelpRequest(query, result.reply, settings);
    needsStaff = !!decision.needsStaff;
    summary = decision.summary;
  }

  return {
    query,
    reply: result.reply || "",
    path: result.path,
    faqId: result.faqId || null,
    correctionId: result.correctionId || null,
    needsStaff,
    summary,
    memory: result.memory
  };
}

async function createReportGuess(db, responseLog, reportType) {
  const settings = getRuntimeSettings(db);
  return guessReportIssue(responseLog?.prompt_text || "", responseLog?.response_text || "", settings)
    .then(guess => ({ guess, reportType }))
    .catch(() => ({
      guess: "Tyrone likely answered incorrectly or should not have answered this message.",
      reportType
    }));
}

function buildReportButtons(reportId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tyrone_report_dm:${reportId}`)
        .setLabel("DM")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`tyrone_report_ticket:${reportId}`)
        .setLabel("Ticket")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tyrone_report_none:${reportId}`)
        .setLabel("No feedback")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

async function openFeedbackTicket({ interaction, summary, responseLog, report }) {
  const tickets = require("./tickets");
  if (!tickets || typeof tickets.createTyroneFeedbackTicket !== "function") {
    return { ok: false, error: "Ticket helper is not available." };
  }

  return tickets.createTyroneFeedbackTicket({
    guild: interaction.guild,
    reporter: interaction.user,
    summary,
    responseLog,
    report
  });
}

async function handleInteraction(interaction, { db }) {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "report-issue") {
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
    const issuesChannel = await interaction.guild.channels.fetch(settings.issues_channel_id).catch(() => null);
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
    return;
  }

  if (interaction.commandName !== "report") return;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }

  const reportType = interaction.options.getString("type", true);
  const responseLog = db.findRecentTyroneResponseLog(interaction.user.id, interaction.channelId) ||
    db.findRecentTyroneResponseLog(interaction.user.id, null);

  if (!responseLog) {
    await interaction.reply({
      content: "I could not find a recent Tyrone response to attach to this report. Use the command right after Tyrone responds.",
      ephemeral: true
    });
    return;
  }

  const { guess } = await createReportGuess(db, responseLog, reportType);
  const report = db.createTyroneReport({
    reporter_user_id: interaction.user.id,
    reporter_username: interaction.user.tag,
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    report_type: reportType,
    feedback_mode: "pending",
    source_response_log_id: responseLog.id,
    question_text: responseLog.prompt_text,
    response_text: responseLog.response_text,
    tyrone_guess: guess,
    detail: {
      source_path: responseLog.path
    }
  });

  await interaction.reply({
    content:
      "How should I handle this Tyrone feedback?\n\n" +
      "**DM**: I’ll ask you privately what I should do differently.\n" +
      "**Ticket**: I’ll open a support ticket with a summary.\n" +
      "**No feedback**: I’ll log it for dashboard review only.",
    components: buildReportButtons(report.id),
    ephemeral: true
  });
}

async function handleButton(interaction, { db }) {
  const [baseId, reportIdRaw] = String(interaction.customId || "").split(":");
  if (!["tyrone_report_dm", "tyrone_report_ticket", "tyrone_report_none"].includes(baseId)) {
    return false;
  }

  const reportId = Number(reportIdRaw);
  const report = db.getTyroneReportById(reportId);
  if (!report) {
    await interaction.reply({ content: "That report could not be found.", ephemeral: true });
    return true;
  }

  const responseLog = report.source_response_log_id
    ? db.getTyroneResponseLogById(report.source_response_log_id)
    : null;

  if (baseId === "tyrone_report_dm") {
    feedbackDmRequests.set(interaction.user.id, {
      reportId,
      createdAt: Date.now()
    });

    try {
      await interaction.user.send(
        "Tyrone feedback received. What should I have done differently? " +
        "Reply with plain text. If you don’t want to add anything, you can ignore this DM."
      );
      db.updateTyroneReport(reportId, {
        feedback_mode: "dm",
        status: "awaiting_dm_feedback"
      });
      await interaction.reply({
        content: "I sent you a DM asking what I should do differently.",
        ephemeral: true
      });
    } catch (err) {
      console.error("[Tyrone report DM] error:", err);
      await interaction.reply({
        content: "I couldn’t DM you. Your DMs might be closed.",
        ephemeral: true
      });
    }

    return true;
  }

  if (baseId === "tyrone_report_ticket") {
    const summary =
      `Tyrone feedback report from <@${interaction.user.id}>.\n\n` +
      `Issue type: ${report.report_type}\n` +
      `Summary: ${report.tyrone_guess || "Tyrone likely handled this badly."}`;

    const ticketResult = await openFeedbackTicket({
      interaction,
      summary,
      responseLog,
      report
    });

    if (!ticketResult.ok) {
      await interaction.reply({
        content: ticketResult.error || "I couldn’t create the ticket.",
        ephemeral: true
      });
      return true;
    }

    db.updateTyroneReport(reportId, {
      feedback_mode: "ticket",
      status: "ticket_opened",
      detail: {
        ...(report.detail || {}),
        ticket_channel_id: ticketResult.channelId
      }
    });

    await interaction.reply({
      content:
        "Hi <@" + interaction.user.id + "> I’m so sorry that I responded incorrectly. " +
        "I’ve created a ticket for you. Please allow up to 2 hours for it to be claimed.",
      ephemeral: true
    });
    return true;
  }

  db.updateTyroneReport(reportId, {
    feedback_mode: "none",
    status: "pending_review"
  });

  await interaction.reply({
    content: "Saved for dashboard review. You don’t need to give more feedback unless you want to.",
    ephemeral: true
  });
  return true;
}

async function handleDmFeedback(message, { db }) {
  const pending = feedbackDmRequests.get(message.author.id);
  if (!pending) return false;

  const report = db.getTyroneReportById(pending.reportId);
  if (!report) {
    feedbackDmRequests.delete(message.author.id);
    return false;
  }

  const feedback = (message.content || "").trim();
  db.updateTyroneReport(report.id, {
    user_feedback: feedback || null,
    status: feedback ? "pending_review" : "pending_review"
  });
  db.logTyroneEvent("report_dm_feedback", {
    report_id: report.id
  });
  feedbackDmRequests.delete(message.author.id);

  await message.reply("Thanks. I saved your feedback for review.");
  return true;
}

async function handleMessage(message, { db }) {
  if (message.author.bot) return;

  if (!message.inGuild()) {
    await handleDmFeedback(message, { db });
    return;
  }

  const settings = getRuntimeSettings(db);
  const faqEntries = getFaqEntries(db);
  const corrections = getCorrections(db);

  const seenLog = db.logTyroneSeenMessage({
    message_id: message.id,
    channel_id: message.channelId,
    guild_id: message.guildId,
    user_id: message.author.id,
    username: message.author.tag,
    content: message.content || "",
    outcome: "seen",
    detail: {}
  });

  if (!settings.enabled) {
    db.updateTyroneSeenMessageOutcome(seenLog.id, "disabled", {});
    return;
  }

  const raw = message.content || "";
  const content = raw.trim();
  const lower = content.toLowerCase();
  const botId = message.client?.user?.id || null;
  const mentionsTyrone = botId ? message.mentions.users.has(botId) : false;

  if (settings.channel_id && message.channelId !== settings.channel_id) {
    db.updateTyroneSeenMessageOutcome(seenLog.id, "ignored_channel_gate", {});
    return;
  }

  if (settings.allowed_role_id) {
    const member = message.member;
    if (!member || !member.roles.cache.has(settings.allowed_role_id)) {
      db.updateTyroneSeenMessageOutcome(seenLog.id, "ignored_role_gate", {});
      return;
    }
  }

  if (lower.startsWith("!tytest")) {
    await message.reply("tytest is working ✅");
    db.updateTyroneSeenMessageOutcome(seenLog.id, "tytest", {});
    return;
  }

  if (lower === "!tyrone-approve") {
    const pending = getPendingApproval(message.author.id, settings);
    if (!pending) {
      await message.reply(
        `Hey <@${message.author.id}>, I don't have a recent question queued. Use **!tyrone <your question>** instead.`
      );
      db.updateTyroneSeenMessageOutcome(seenLog.id, "no_pending_approval", {});
      return;
    }

    if (pending.channelId !== message.channelId) {
      await message.reply(
        `Hey <@${message.author.id}>, approve that in the same channel where you asked it.`
      );
      db.updateTyroneSeenMessageOutcome(seenLog.id, "approval_channel_mismatch", {});
      return;
    }

    const result = await answerQuestion(pending.questionText, message, db, {
      settings,
      faqEntries,
      corrections
    });
    pendingApprovals.delete(message.author.id);

    if (result.reply) {
      await message.reply(result.reply);
      const responseLog = db.logTyroneResponse({
        source_type: "discord",
        source_ref: message.id,
        channel_id: message.channelId,
        guild_id: message.guildId,
        user_id: message.author.id,
        username: message.author.tag,
        prompt_text: pending.questionText,
        response_text: result.reply,
        path: result.path,
        detail: {
          seen_message_id: seenLog.id,
          memory: result.memory
        }
      });
      db.updateTyroneSeenMessageOutcome(seenLog.id, "answered", {
        path: result.path,
        response_log_id: responseLog.id
      });
    }
    return;
  }

  if (settings.direct_command_enabled && lower.startsWith("!tyrone")) {
    const query = content.slice("!tyrone".length).trim();

    if (!query) {
      await message.reply(`Hey <@${message.author.id}>, how can I help?`);
      db.updateTyroneSeenMessageOutcome(seenLog.id, "empty_direct_command", {});
      return;
    }

    const result = await answerQuestion(query, message, db, { settings, faqEntries, corrections });
    if (result.reply) {
      await message.reply(result.reply);
      const responseLog = db.logTyroneResponse({
        source_type: "discord",
        source_ref: message.id,
        channel_id: message.channelId,
        guild_id: message.guildId,
        user_id: message.author.id,
        username: message.author.tag,
        prompt_text: query,
        response_text: result.reply,
        path: result.path,
        detail: {
          seen_message_id: seenLog.id,
          memory: result.memory
        }
      });
      db.updateTyroneSeenMessageOutcome(seenLog.id, "answered", {
        path: result.path,
        response_log_id: responseLog.id
      });
    }
    return;
  }

  if (settings.ignore_owner_messages && message.author.id === settings.owner_user_id) {
    db.updateTyroneSeenMessageOutcome(seenLog.id, "ignored_owner", {
      allowed_commands: true
    });
    return;
  }

  if (settings.mention_reply_enabled && mentionsTyrone) {
    const query = stripBotMention(content, botId);

    if (!query) {
      await message.reply(`Hey <@${message.author.id}>, how can I help?`);
      db.updateTyroneSeenMessageOutcome(seenLog.id, "empty_mention", {});
      return;
    }

    const result = await answerQuestion(query, message, db, { settings, faqEntries, corrections });
    if (result.reply) {
      await message.reply(result.reply);
      const responseLog = db.logTyroneResponse({
        source_type: "discord",
        source_ref: message.id,
        channel_id: message.channelId,
        guild_id: message.guildId,
        user_id: message.author.id,
        username: message.author.tag,
        prompt_text: query,
        response_text: result.reply,
        path: result.path,
        detail: {
          seen_message_id: seenLog.id,
          memory: result.memory
        }
      });
      db.updateTyroneSeenMessageOutcome(seenLog.id, "answered", {
        path: result.path,
        response_log_id: responseLog.id
      });
    }
    return;
  }

  if (!settings.soft_intercept_enabled) {
    db.updateTyroneSeenMessageOutcome(seenLog.id, "ignored", {});
    return;
  }

  if (looksLikeTyroneQuestion(lower, faqEntries)) {
    if (!canNag(message.author.id, settings)) {
      db.updateTyroneSeenMessageOutcome(seenLog.id, "cooldown_skip", {});
      return;
    }
    if (delayedNagTimers.has(message.id)) {
      db.updateTyroneSeenMessageOutcome(seenLog.id, "already_queued", {});
      return;
    }

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
        const responseLog = db.logTyroneResponse({
          source_type: "discord",
          source_ref: message.id,
          channel_id: message.channelId,
          guild_id: message.guildId,
          user_id: message.author.id,
          username: message.author.tag,
          prompt_text: content,
          response_text: notice,
          path: "soft_intercept",
          detail: {
            seen_message_id: seenLog.id
          }
        });
        db.updateTyroneSeenMessageOutcome(seenLog.id, "soft_intercepted", {
          response_log_id: responseLog.id
        });
      } catch (err) {
        console.error("[Tyrone delayed nag] error:", err);
      }
    }, settings.auto_nag_delay_ms);

    delayedNagTimers.set(message.id, timer);
    db.updateTyroneSeenMessageOutcome(seenLog.id, "queued_soft_intercept", {});
    return;
  }

  db.updateTyroneSeenMessageOutcome(seenLog.id, "ignored", {});
}

module.exports = {
  DEFAULTS,
  DEFAULT_FAQ_ENTRIES,
  initializeAdminState,
  getRuntimeSettings,
  getFaqEntries,
  sanitizeSettingsInput,
  sanitizeFaqInput,
  sanitizeCorrectionInput,
  getAdminState,
  runAdminTest,
  runDashboardChat,
  triageHelpRequest,
  rewriteAdminText,
  handleInteraction,
  handleButton,
  handleMessage
};
