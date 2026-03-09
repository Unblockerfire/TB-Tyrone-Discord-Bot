// commands/tyrone.js

// local fetch wrapper so we do not break your existing style
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

// ---------- CONFIG ----------

const TYRONE_CHANNEL_ID = process.env.TYRONE_CHANNEL_ID || null;
const TYRONE_ALLOWED_ROLE_ID = process.env.TYRONE_ALLOWED_ROLE_ID || null;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;

// (Optional) where /report-issue should post
const TYRONE_ISSUES_CHANNEL_ID = process.env.TYRONE_ISSUES_CHANNEL_ID || null;

// Cache tuning
const TYRONE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TYRONE_CACHE_MAX_ENTRIES = 500;

// Soft-intercept / approval tuning
const APPROVAL_WINDOW_MS = 2 * 60 * 1000; // 2 minutes to approve
const NAG_COOLDOWN_MS = 60 * 1000; // don't nag same user repeatedly
const AUTO_NAG_DELAY_MS = 2 * 60 * 1000; // wait 2 minutes before suggesting Tyrone

// Add junk / spam words here later if you want Tyrone to ignore them
const tyroneIgnoreKeywords = [
  // "ratio",
  // "gyatt",
  // "ligma"
];

// Hardcoded server FAQ
const tyroneFaqEntries = [
  {
    keys: [
      "how become mod",
      "how to become mod",
      "mod app",
      "mod application",
      "be staff",
      "be a mod"
    ],
    answer:
      "To become a mod, use the `/apply` command. It should DM you with the application topic and info you need to fill out."
  },
  {
    keys: [
      "strike policy",
      "what is the strike policy",
      "how does the strike system work",
      "moderation system"
    ],
    answer:
      "Strike System:\n" +
      "• 1 Strike → warning\n" +
      "• 2 Strikes → 1-hour mute\n" +
      "• 3 Strikes → 3-hour mute\n" +
      "• 4 Strikes → temp ban (appeal allowed)\n" +
      "• 5 Strikes → permanent ban (no appeal)\n\n" +
      "Strikes are issued at staff discretion."
  },
  {
    keys: ["stream schedule", "when do you stream", "what time do you stream", "go live"],
    answer:
      "I do not have a fixed schedule yet since I’m new to streaming, but currently I try to stream around **6/7 PM MST** to around **9/9:30 PM MST**."
  },
  {
    keys: [
      "self promo",
      "self-promo",
      "self promotion",
      "promote my channel",
      "promote my tiktok",
      "promote my youtube"
    ],
    answer:
      "Keep any self promo in the **#self-promo** channel. Posting your stuff outside that channel may get removed or warned."
  }
];

// ---------- FOLLOW-UP MEMORY ----------
const followUpContext = new Map();
const FOLLOW_UP_WINDOW_MS = 60 * 1000;

// ---------- SOFT-INTERCEPT MEMORY ----------
const pendingApprovals = new Map();
// shape: userId -> { questionText, channelId, messageId, timestamp }

const nagCooldown = new Map();
// shape: userId -> timestamp

const delayedNagTimers = new Map();
// shape: messageId -> timeout

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

function getPendingApproval(userId) {
  const data = pendingApprovals.get(userId);
  if (!data) return null;

  if (Date.now() - data.timestamp > APPROVAL_WINDOW_MS) {
    pendingApprovals.delete(userId);
    return null;
  }
  return data;
}

function canNag(userId) {
  const last = nagCooldown.get(userId);
  if (!last) return true;
  return Date.now() - last > NAG_COOLDOWN_MS;
}

function markNag(userId) {
  nagCooldown.set(userId, Date.now());
}

// ---------- HELPERS ----------

function matchesFaqEntry(lowerContent) {
  for (const entry of tyroneFaqEntries) {
    for (const key of entry.keys) {
      const keyLower = key.toLowerCase();
      if (lowerContent.includes(keyLower)) return entry.answer;
    }
  }
  return null;
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

function looksLikeTyroneQuestion(lowered) {
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

  if (matchesFaqEntry(lowered)) return true;

  return (hasQuestionMark && serverKeywords) || (startsLikeQuestion && serverKeywords);
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

function addOutro(answerText) {
  return (
    `${answerText}\n\n` +
    `I hope that answered your question ✅ If not, run **!tyrone <follow-up>** ` +
    `or use **/report-issue** if I acted weird.`
  );
}

function stripBotMention(content, botId) {
  if (!content || !botId) return content || "";
  return content
    .replace(new RegExp(`<@!?${botId}>`, "g"), "")
    .trim();
}

async function askOpenAIAsTyrone(query, author) {
  if (!OPENAI_API_KEY) {
    return "AI is not configured yet. Please tell the server owner to set OPENAI_API_KEY.";
  }

  const systemPrompt =
    "You are Tyrone, the helper bot for the TB Server (a Discord community). " +
    "You talk in a friendly, direct way. " +
    "If the question is about this specific server, prefer these rules when relevant:\n" +
    "- Mod applications: /apply command DMs the user with the topic.\n" +
    "- Strike system: 1 = warning, 2 = 1 hour mute, 3 = 3 hour mute, 4 = temp ban (appeal allowed), 5 = perm ban.\n" +
    "- Self-promo must stay in the #self-promo channel.\n" +
    "- Streaming schedule is currently informal: usually around 6/7 PM MST to 9/9:30 PM MST.\n" +
    "If the user asks something unrelated to the server, answer like a normal helpful assistant.";

  const body = {
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
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
      Authorization: `Bearer ${OPENAI_API_KEY}`
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

// Centralized answer pipeline (FAQ -> cache -> OpenAI)
async function answerQuestion(query, message, db) {
  const loweredQuery = (query || "").toLowerCase().trim();

  if (tyroneIgnoreKeywords.some(k => loweredQuery.includes(k.toLowerCase()))) {
    console.log("[Tyrone] Ignored due to ignore keyword match");
    return null;
  }

  const priorContext = getFollowUpContext(message.author.id);

  if (isSelfStrikeLookup(loweredQuery)) {
    const stats = db.getUserStats(message.author.id);
    setFollowUpContext(message.author.id, "strike_lookup");

    const txt =
      `Hey <@${message.author.id}>, you currently have **${stats.strikes} strike${stats.strikes === 1 ? "" : "s"}** ` +
      `and **${stats.warnings} warning${stats.warnings === 1 ? "" : "s"}** on your account.`;

    return addOutro(txt);
  }

  if (isStrikeCountFollowUp(loweredQuery, priorContext)) {
    const strikeNum = extractStrikeNumber(loweredQuery);
    if (strikeNum !== null) {
      const action = getActionForStrikeCount(strikeNum);
      setFollowUpContext(message.author.id, "strike_lookup");
      return addOutro(
        `Hey <@${message.author.id}>, at **${strikeNum} strike${strikeNum === 1 ? "" : "s"}**, the action is **${action}**.`
      );
    }
  }

  const faq = matchesFaqEntry(loweredQuery);
  if (faq) {
    if (
      loweredQuery.includes("strike policy") ||
      loweredQuery.includes("how does the strike system work") ||
      loweredQuery.includes("moderation system")
    ) {
      setFollowUpContext(message.author.id, "strike_policy");
    }
    return addOutro(`Hey <@${message.author.id}>, ${faq}`);
  }

  if (priorContext && (priorContext.topic === "strike_lookup" || priorContext.topic === "strike_policy")) {
    const strikeNum = extractStrikeNumber(loweredQuery);
    if (strikeNum !== null) {
      const action = getActionForStrikeCount(strikeNum);
      setFollowUpContext(message.author.id, priorContext.topic);
      return addOutro(
        `Hey <@${message.author.id}>, at **${strikeNum} strike${strikeNum === 1 ? "" : "s"}**, the action is **${action}**.`
      );
    }
  }

  // Cache (DB-backed, if present)
  try {
    if (db.getTyroneCachedAnswer) {
      const cached = db.getTyroneCachedAnswer(query, TYRONE_CACHE_MAX_AGE_MS);
      if (cached) {
        console.log("[Tyrone] Cache hit");
        return addOutro(`Hey <@${message.author.id}>, ${cached}`);
      }
    }
  } catch (err) {
    console.error("[Tyrone cache] get error:", err);
  }

  let responseFromAi;
  try {
    console.log("[Tyrone] No direct match, sending to OpenAI");
    responseFromAi = await askOpenAIAsTyrone(query, message.author);
  } catch (err) {
    console.error("Tyrone AI error:", err);
    responseFromAi = "Tyrone ran into an error trying to answer that. Try again later.";
  }

  if (!responseFromAi) {
    responseFromAi = "I did not get a useful answer back. Try asking in a different way.";
  }

  try {
    if (db.setTyroneCachedAnswer && !looksLikeBadAiFallback(responseFromAi)) {
      db.setTyroneCachedAnswer(query, responseFromAi, TYRONE_CACHE_MAX_ENTRIES);
    }
  } catch (err) {
    console.error("[Tyrone cache] set error:", err);
  }

  return addOutro(`Hey <@${message.author.id}>, ${responseFromAi}`);
}

// ---------- SLASH: /report-issue ----------
async function handleInteraction(interaction, { client, db }) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "report-issue") return;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This can only be used in a server.", ephemeral: true });
    return;
  }

  if (!TYRONE_ISSUES_CHANNEL_ID) {
    await interaction.reply({
      content: "Issue logging isn’t configured yet (missing TYRONE_ISSUES_CHANNEL_ID). Tell Carson to set it in .env.",
      ephemeral: true
    });
    return;
  }

  const details = interaction.options.getString("details") || "No extra details provided.";
  const guild = interaction.guild;

  const issuesChannel = await guild.channels.fetch(TYRONE_ISSUES_CHANNEL_ID).catch(() => null);
  if (!issuesChannel || !issuesChannel.isTextBased()) {
    await interaction.reply({
      content: "TYRONE_ISSUES_CHANNEL_ID is invalid or not a text channel. Fix the ID.",
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

// ---------- MESSAGE HANDLER ----------
async function handleMessage(message, { db }) {
  if (message.author.bot) return;

  const raw = message.content || "";
  const content = raw.trim();
  const lower = content.toLowerCase();

  const botId = message.client?.user?.id || null;
  const mentionsTyrone = botId ? message.mentions.users.has(botId) : false;

  // optional channel gate (applies to all Tyrone behavior)
  if (TYRONE_CHANNEL_ID && message.channelId !== TYRONE_CHANNEL_ID) return;

  // optional role gate
  if (TYRONE_ALLOWED_ROLE_ID) {
    const member = message.member;
    if (!member || !member.roles.cache.has(TYRONE_ALLOWED_ROLE_ID)) return;
  }

  if (lower.startsWith("!tytest")) {
    console.log(`[Tyrone] !tytest from ${message.author.id} in ${message.channelId}`);
    await message.reply("tytest is working ✅");
    return;
  }

  if (lower === "!tyrone-approve") {
    const pending = getPendingApproval(message.author.id);
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

    const reply = await answerQuestion(pending.questionText, message, db);
    pendingApprovals.delete(message.author.id);

    if (reply) await message.reply(reply);
    return;
  }

  // Direct command invoke
  if (lower.startsWith("!tyrone")) {
    const query = content.slice("!tyrone".length).trim();

    if (!query) {
      await message.reply(`Hey <@${message.author.id}>, how can I help?`);
      return;
    }

    const reply = await answerQuestion(query, message, db);
    if (reply) await message.reply(reply);
    return;
  }

  // Direct mention invoke
  if (mentionsTyrone) {
    const query = stripBotMention(content, botId);

    if (!query) {
      await message.reply(`Hey <@${message.author.id}>, how can I help?`);
      return;
    }

    const reply = await answerQuestion(query, message, db);
    if (reply) await message.reply(reply);
    return;
  }

  // ---------- SOFT INTERCEPT WITH 2-MINUTE DELAY ----------
  if (looksLikeTyroneQuestion(lower)) {
    if (!canNag(message.author.id)) return;
    if (delayedNagTimers.has(message.id)) return;

    const timer = setTimeout(async () => {
      delayedNagTimers.delete(message.id);

      try {
        // make sure original message still exists
        const original = await message.channel.messages.fetch(message.id).catch(() => null);
        if (!original) return;

        // queue the approval only when we're actually about to send the nag
        setPendingApproval(message.author.id, content, message.channelId, message.id);
        markNag(message.author.id);

        const suggested = `!tyrone ${content}`;

        await message.reply(
          `Hey <@${message.author.id}>, I can help with that, but use **!tyrone** so I don’t spam chats.\n\n` +
          `Option A: copy/paste this:\n` +
          `\`${suggested}\`\n\n` +
          `Option B: type **!tyrone-approve** and I’ll answer your last question.`
        );
      } catch (err) {
        console.error("[Tyrone delayed nag] error:", err);
      }
    }, AUTO_NAG_DELAY_MS);

    delayedNagTimers.set(message.id, timer);
  }
}

module.exports = {
  handleMessage,
  handleInteraction
};