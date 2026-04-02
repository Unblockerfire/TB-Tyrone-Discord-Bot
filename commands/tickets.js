// commands/tickets.js

require("dotenv").config();

// local fetch wrapper (same style as other files)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder
} = require("discord.js");
const crypto = require("crypto");

// ---------- CONFIG (ENV) ----------

// Where the "Get Support" panel is posted
const SUPPORT_PANEL_CHANNEL_ID = process.env.SUPPORT_PANEL_CHANNEL_ID || null;

// Ticket categories
const TICKETS_CREATED_CATEGORY_ID = process.env.TICKETS_CREATED_CATEGORY_ID || null;
const TICKETS_CLAIMED_CATEGORY_ID = process.env.TICKETS_CLAIMED_CATEGORY_ID || null;
const TICKETS_CLOSED_CATEGORY_ID = process.env.TICKETS_CLOSED_CATEGORY_ID || null;

// Ticket logs channel (where we post events, links, etc)
const TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID || null;

// Roles to always ping when a ticket is created
const TICKET_ALWAYS_PING_ROLE_ID = process.env.TICKET_ALWAYS_PING_ROLE_ID || null;
// Optional second always-ping role
const TICKET_ALWAYS_PING_ROLE_ID_2 = process.env.TICKET_ALWAYS_PING_ROLE_ID_2 || null;

// Comma-separated list of role IDs allowed to claim/close/reopen
const TICKET_CLAIM_ROLE_IDS = (process.env.TICKET_CLAIM_ROLE_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Ticket timings
const INACTIVITY_WARN_MINUTES = Number(process.env.TICKET_INACTIVITY_WARN_MINUTES || "5");
const INACTIVITY_CLOSE_MINUTES = Number(process.env.TICKET_INACTIVITY_CLOSE_MINUTES || "2");
const TICKET_REOPEN_DAYS = Number(process.env.TICKET_REOPEN_DAYS || "14");

const TRANSCRIPT_MAX_MESSAGES = Number(process.env.TICKET_TRANSCRIPT_MAX_MESSAGES || "200");
const JANITOR_INTERVAL_MINUTES = Number(process.env.TICKET_JANITOR_INTERVAL_MINUTES || "360");

// Owner role allowed to run setup-support-panel
const OWNER_ROLE_ID = "1113158001604427966"; // your owner role ID (as you asked)
const SUPPORT_PANEL_CHANNEL_KEY = "support.panel.channel_id";
const SUPPORT_PANEL_MESSAGE_KEY = "support.panel.message_id";

// ---------- In-memory runtime state ----------
// tracks first-message prompt + inactivity timers by ticket channel id
const ticketRuntime = new Map();
// shape:
// ticketRuntime.set(channelId, {
//   openerId,
//   awaitingIssueText: true/false,
//   lastUserMessageAt: number,
//   warnTimeout: Timeout,
//   closeTimeout: Timeout
// });

// ---------- Helpers ----------

// ---------- Optional persistent storage (KB + ticket metadata) ----------
// We use the existing better-sqlite3 handle exposed by ./db.js as `db.db`.
// If it isn't available, we gracefully fall back to in-memory only.

function getSql(dbModule) {
  return dbModule && dbModule.db ? dbModule.db : null;
}

function ensureTicketTables(dbModule) {
  const sql = getSql(dbModule);
  if (!sql) return;

  try {
    sql.prepare(`
      CREATE TABLE IF NOT EXISTS ticket_kb (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_norm TEXT NOT NULL,
        trigger_hash TEXT NOT NULL,
        category TEXT,
        solution TEXT NOT NULL,
        created_by TEXT,
        created_at INTEGER NOT NULL
      )
    `).run();

    sql.prepare(`
      CREATE INDEX IF NOT EXISTS idx_ticket_kb_hash
      ON ticket_kb (trigger_hash)
    `).run();
  } catch (e) {
    console.error("[tickets] failed to ensure ticket tables:", e);
  }
}

function kbLookup(dbModule, triggerNorm) {
  const sql = getSql(dbModule);
  if (!sql) return null;

  const h = sha1(triggerNorm);

  try {
    const row = sql
      .prepare(
        `SELECT id, trigger_norm, category, solution, created_at
         FROM ticket_kb
         WHERE trigger_hash = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(h);

    return row || null;
  } catch (e) {
    console.error("[tickets] kb lookup failed:", e);
    return null;
  }
}

function kbInsert(dbModule, triggerNorm, category, solution, createdBy) {
  const sql = getSql(dbModule);
  if (!sql) return false;

  const h = sha1(triggerNorm);
  try {
    sql
      .prepare(
        `INSERT INTO ticket_kb (trigger_norm, trigger_hash, category, solution, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(triggerNorm, h, category || null, solution, createdBy || null, Date.now());

    return true;
  } catch (e) {
    console.error("[tickets] kb insert failed:", e);
    return false;
  }
}

// We store small metadata in the channel topic so the bot can recover after restarts.
// Format: key=value pairs separated by spaces.
function parseTopicMeta(topic) {
  const out = {};
  const t = (topic || "").trim();
  if (!t) return out;

  for (const part of t.split(/\s+/g)) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

function buildTopicMeta(meta) {
  const keys = Object.keys(meta || {});
  const parts = [];
  for (const k of keys) {
    const v = meta[k];
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.join(" ").slice(0, 1024); // Discord topic limit
}

async function setChannelTopicMeta(channel, patch) {
  try {
    const current = parseTopicMeta(channel.topic);
    const next = { ...current, ...patch };
    const topic = buildTopicMeta(next);
    await channel.setTopic(topic);
    return next;
  } catch (e) {
    return parseTopicMeta(channel.topic);
  }
}

function nowMs() {
  return Date.now();
}

function minutesToMs(m) {
  return m * 60 * 1000;
}

function daysToMs(d) {
  return d * 24 * 60 * 60 * 1000;
}

function missingConfig() {
  const missing = [];
  if (!SUPPORT_PANEL_CHANNEL_ID) missing.push("SUPPORT_PANEL_CHANNEL_ID");
  if (!TICKETS_CREATED_CATEGORY_ID) missing.push("TICKETS_CREATED_CATEGORY_ID");
  if (!TICKETS_CLAIMED_CATEGORY_ID) missing.push("TICKETS_CLAIMED_CATEGORY_ID");
  if (!TICKETS_CLOSED_CATEGORY_ID) missing.push("TICKETS_CLOSED_CATEGORY_ID");
  if (!TICKET_LOG_CHANNEL_ID) missing.push("TICKET_LOG_CHANNEL_ID");
  if (!TICKET_ALWAYS_PING_ROLE_ID) missing.push("TICKET_ALWAYS_PING_ROLE_ID");
  if (!TICKET_CLAIM_ROLE_IDS.length) missing.push("TICKET_CLAIM_ROLE_IDS");
  return missing;
}

function userHasAnyRole(member, roleIds) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return roleIds.some(rid => member.roles.cache.has(rid));
}

function safeTagRole(roleId) {
  return roleId ? `<@&${roleId}>` : "";
}

function makeTicketId(channelId) {
  // stable-ish id derived from channel
  return `t_${channelId}`;
}

function normalizeQuestion(text) {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function postToLog(guild, content) {
  try {
    if (!TICKET_LOG_CHANNEL_ID) return;
    const ch = await guild.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
    if (!ch || !ch.isTextBased()) return;

    // never ping from logs
    await ch.send({ content, allowedMentions: { parse: [] } });
  } catch (e) {
    console.error("[tickets] log post failed:", e);
  }
}

function ticketControlsRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel("Claim")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("ticket_reopen")
      .setLabel("Reopen")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function supportPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_open")
      .setLabel("Get Support")
      .setStyle(ButtonStyle.Success)
  );
}

function buildSupportPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle("Support Tickets")
    .setDescription("Click **Get Support** to open a private ticket with staff.")
    .setColor(0x2ecc71);

  return {
    embeds: [embed],
    components: [supportPanelRow()]
  };
}

function isSupportPanelMessage(message, botUserId) {
  if (!message) return false;
  if (botUserId && message.author?.id !== botUserId) return false;

  const hasMatchingEmbed = message.embeds?.some(embed => embed.title === "Support Tickets");
  const hasMatchingButton = message.components?.some(row =>
    row.components?.some(component => component.customId === "ticket_open")
  );

  return Boolean(hasMatchingEmbed && hasMatchingButton);
}

async function deleteExistingSupportPanels(channel, botUserId) {
  if (!channel?.isTextBased?.()) return 0;

  let deleted = 0;
  const recentMessages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!recentMessages) return 0;

  for (const message of recentMessages.values()) {
    if (!isSupportPanelMessage(message, botUserId)) continue;
    await message.delete().catch(() => null);
    deleted += 1;
  }

  return deleted;
}

async function refreshSupportPanel(client, db, { reason = "manual_refresh" } = {}) {
  const targetChannelId = db?.getAppSetting?.(SUPPORT_PANEL_CHANNEL_KEY)?.value || SUPPORT_PANEL_CHANNEL_ID;
  if (!targetChannelId) return false;

  const channel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const deletedCount = await deleteExistingSupportPanels(channel, client.user?.id);

  const sent = await channel.send(buildSupportPanelPayload());
  db?.setManyAppSettings?.({
    [SUPPORT_PANEL_CHANNEL_KEY]: channel.id,
    [SUPPORT_PANEL_MESSAGE_KEY]: sent.id
  });

  console.log(
    "[Tickets] Support panel refreshed",
    JSON.stringify({ reason, channel_id: channel.id, message_id: sent.id, deleted_previous_count: deletedCount })
  );
  return true;
}

function resetInactivityTimers(guild, channel, openerId) {
  const channelId = channel.id;
  const state = ticketRuntime.get(channelId);
  if (!state) return;

  // clear existing timers
  if (state.warnTimeout) clearTimeout(state.warnTimeout);
  if (state.closeTimeout) clearTimeout(state.closeTimeout);

  const warnMs = minutesToMs(INACTIVITY_WARN_MINUTES);
  const closeMs = warnMs + minutesToMs(INACTIVITY_CLOSE_MINUTES);

  state.warnTimeout = setTimeout(async () => {
    try {
      await channel.send(
        `Hey <@${openerId}>, I haven’t heard anything for ${INACTIVITY_WARN_MINUTES} minutes. ` +
          `This ticket will close in ${INACTIVITY_CLOSE_MINUTES} minutes if you don’t reply.`
      );
    } catch (e) {
      // ignore
    }
  }, warnMs);

  state.closeTimeout = setTimeout(async () => {
    try {
      await closeTicketByTimeout(guild, channel);
    } catch (e) {
      // ignore
    }
  }, closeMs);

  ticketRuntime.set(channelId, state);
}

async function closeTicketByTimeout(guild, channel) {
  if (!channel || !channel.isTextBased()) return;

  // Move to closed category
  try {
    await channel.setParent(TICKETS_CLOSED_CATEGORY_ID, { lockPermissions: false });
  } catch (e) {
    console.error("[tickets] failed to move ticket to closed:", e);
  }

  // Lock the opener (not @everyone)
  try {
    const meta = parseTopicMeta(channel.topic);
    const openerId = meta.openedBy || null;
    if (openerId) {
      await channel.permissionOverwrites.edit(openerId, {
        SendMessages: false
      });
    }
  } catch (e) {
    // ignore
  }

  // Persist closedAt in topic
  await setChannelTopicMeta(channel, { closedAt: String(Date.now()) });

  // Clear runtime timers
  const state = ticketRuntime.get(channel.id);
  if (state) {
    if (state.warnTimeout) clearTimeout(state.warnTimeout);
    if (state.closeTimeout) clearTimeout(state.closeTimeout);
    ticketRuntime.delete(channel.id);
  }

  await channel.send(
    "Ticket closed due to inactivity. If you still need help, you can reopen it (within the allowed window) or open a new one."
  );

  await postToLog(guild, `🧾 Ticket auto-closed: <#${channel.id}> (timeout).`);
}

// ---------- Advanced Tyrone Triage ----------
// Determines if Tyrone can solve the issue without staff

function trySolveCommonIssue(issueText) {
  const t = normalizeQuestion(issueText);

  // 0) Persistent KB lookup (exact normalized match hash)
  // If staff previously saved a solution for this exact question, reuse it.
  // NOTE: This is exact-match by normalization; we can improve fuzzy matching later.
  const kbHit = kbLookup(globalThis.__ticketsDbModuleForKb || null, t);
  if (kbHit && kbHit.solution) {
    return {
      category: kbHit.category || "kb",
      confidence: 0.98,
      answer: kbHit.solution
    };
  }

  // ---------- VERIFY / ACCESS ISSUES ----------
  if (
    t.includes("verify") ||
    t.includes("verification") ||
    t.includes("verified role") ||
    t.includes("can't verify") ||
    t.includes("cant verify") ||
    t.includes("where is verify") ||
    t.includes("can't find verify") ||
    t.includes("cant find verify")
  ) {
    return {
      category: "verification",
      confidence: 0.95,
      answer:
        "To verify:\n\n" +
        "1️⃣ Go to the **Rules channel** and click **Accept Rules**.\n" +
        "2️⃣ After that, go to the **Verify channel**.\n" +
        "3️⃣ Click **Verify Me**.\n\n" +
        "If you still cannot verify, tell me:\n" +
        "• What device you are on (mobile / PC)\n" +
        "• What channel you currently see"
    };
  }

  // ---------- RULES / SERVER ACCESS ----------
  if (
    t.includes("rules") ||
    t.includes("accept rules") ||
    t.includes("agree to rules")
  ) {
    return {
      category: "rules",
      confidence: 0.9,
      answer:
        "To access the server you must accept the rules first.\n\n" +
        "1️⃣ Go to the **Rules channel**.\n" +
        "2️⃣ Press **Accept Rules**.\n" +
        "3️⃣ Then go to the **Verify channel** and click **Verify Me**."
    };
  }

  // ---------- CANNOT SEE CHANNELS ----------
  if (
    t.includes("can't see channels") ||
    t.includes("cant see channels") ||
    t.includes("missing channels") ||
    t.includes("can't see chat") ||
    t.includes("cant see chat") ||
    t.includes("only see a few channels")
  ) {
    return {
      category: "channel access",
      confidence: 0.9,
      answer:
        "You likely have not completed verification yet.\n\n" +
        "Please go to the **Rules channel**, accept the rules, then go to the **Verify channel** and click **Verify Me**."
    };
  }

  // ---------- MOD / STAFF APPLICATION ----------
  if (
    t.includes("become mod") ||
    t.includes("mod application") ||
    t.includes("apply for mod") ||
    t.includes("staff application") ||
    t.includes("how do i become mod")
  ) {
    return {
      category: "staff application",
      confidence: 0.95,
      answer:
        "To apply for staff, go to <#1113094456242081832> and click **Start Application**.\n\n" +
        "Tyrone will walk you through the questions and send the application to staff for review."
    };
  }

  // ---------- STRIKE SYSTEM ----------
  if (
    t.includes("strike") ||
    t.includes("warning system") ||
    t.includes("how many strikes") ||
    t.includes("moderation system")
  ) {
    return {
      category: "moderation",
      confidence: 0.9,
      answer:
        "Strike System:\n\n" +
        "• 1 Strike → Warning\n" +
        "• 2 Strikes → 1 hour mute\n" +
        "• 3 Strikes → 3 hour mute\n" +
        "• 4 Strikes → Temporary ban (appeal allowed)\n" +
        "• 5 Strikes → Permanent ban\n\n" +
        "Strikes are issued at staff discretion."
    };
  }

  // ---------- SELF PROMO ----------
  if (
    t.includes("self promo") ||
    t.includes("self-promo") ||
    t.includes("promote my channel") ||
    t.includes("promote my tiktok") ||
    t.includes("promote my youtube")
  ) {
    return {
      category: "self promo",
      confidence: 0.95,
      answer:
        "You can promote your content in the **#self-promo** channel.\n\n" +
        "Posting self promo outside that channel may be removed."
    };
  }

  // ---------- STREAM SCHEDULE ----------
  if (
    t.includes("stream schedule") ||
    t.includes("when do you stream") ||
    t.includes("what time stream")
  ) {
    return {
      category: "stream schedule",
      confidence: 0.9,
      answer:
        "The stream schedule is currently flexible.\n\n" +
        "Usually around **6–7 PM MST** until **9–9:30 PM MST**."
    };
  }

  // ---------- DISCORD TECH ISSUES ----------
  if (
    t.includes("discord bug") ||
    t.includes("discord glitch") ||
    t.includes("not loading") ||
    t.includes("messages not sending")
  ) {
    return {
      category: "discord technical",
      confidence: 0.8,
      answer:
        "Try these steps:\n\n" +
        "1️⃣ Restart Discord\n" +
        "2️⃣ Refresh Discord (Ctrl + R)\n" +
        "3️⃣ Log out and back in\n" +
        "4️⃣ Restart your device\n\n" +
        "If it still happens, tell me exactly what error you see."
    };
  }

  // ---------- UNKNOWN ----------
  return null;
}
// ---------- OpenAI Summarization + Transcript ----------

async function summarizeWithOpenAI(text) {
  if (!OPENAI_API_KEY) return null;

  const systemPrompt =
    "You are Tyrone, a Discord support bot. Summarize a support ticket conversation for staff. " +
    "Be concise and structured. Output sections: Problem, Key details, What user tried, Suggested next steps.";

  const body = {
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text }
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
    const t = await res.text().catch(() => "");
    console.error("[tickets] OpenAI summarize error:", res.status, t);
    return null;
  }

  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  return content ? String(content).trim() : null;
}

async function fetchTranscriptText(channel) {
  const lines = [];
  let lastId = null;
  let fetched = 0;

  while (fetched < TRANSCRIPT_MAX_MESSAGES) {
    const batch = await channel.messages.fetch({
      limit: 100,
      before: lastId || undefined
    });
    if (!batch.size) break;

    const msgs = Array.from(batch.values());
    msgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const m of msgs) {
      fetched += 1;
      const author = `${m.author.tag} (${m.author.id})`;
      const content = (m.content || "").replace(/\n/g, " ").trim();
      if (!content) continue;
      lines.push(`${author}: ${content}`);
      if (fetched >= TRANSCRIPT_MAX_MESSAGES) break;
    }

    lastId = batch.first().id;
    if (batch.size < 100) break;
  }

  return lines.join("\n");
}

// ---------- Slash command: /setup-support-panel, /summarize-ticket, /ticket-save-solution ----------

async function handleInteraction(interaction, { client, db }) {
  if (!interaction.isChatInputCommand()) return;

  // ensure tables if possible and expose db module for KB lookup
  ensureTicketTables(db);
  globalThis.__ticketsDbModuleForKb = db;

  // ---------------- /setup-support-panel ----------------
  if (interaction.commandName === "setup-support-panel") {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true
      });
    }

    const missing = missingConfig();
    if (missing.length) {
      return interaction.reply({
        content:
          "Missing config in .env: " + missing.join(", ") + "\nSet those first, then run again.",
        ephemeral: true
      });
    }

    const member = interaction.member;
    if (!member.roles.cache.has(OWNER_ROLE_ID)) {
      return interaction.reply({
        content: "You do not have permission to run this command.",
        ephemeral: true
      });
    }

    if (interaction.channelId !== SUPPORT_PANEL_CHANNEL_ID) {
      return interaction.reply({
        content: "Run this command in the support panel channel.",
        ephemeral: true
      });
    }

    await deleteExistingSupportPanels(interaction.channel, interaction.client.user?.id);

    const posted = await interaction.channel.send(buildSupportPanelPayload());
    db?.setManyAppSettings?.({
      [SUPPORT_PANEL_CHANNEL_KEY]: posted.channelId,
      [SUPPORT_PANEL_MESSAGE_KEY]: posted.id
    });

    return interaction.reply({
      content: "Support panel posted ✅",
      ephemeral: true
    });
  }

  // ---------------- /summarize-ticket ----------------
  if (interaction.commandName === "summarize-ticket") {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Server-only command.", ephemeral: true });
    }

    const member = interaction.member;
    if (!userHasAnyRole(member, TICKET_CLAIM_ROLE_IDS)) {
      return interaction.reply({
        content: "You do not have permission to use this.",
        ephemeral: true
      });
    }

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !channel.name.startsWith("ticket-")) {
      return interaction.reply({
        content: "Run this inside a ticket channel.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const meta = parseTopicMeta(channel.topic);
    const openerId = meta.openedBy || "unknown";
    const issueText = meta.issueText ? decodeURIComponent(meta.issueText) : null;

    const transcript = await fetchTranscriptText(channel);
    const ai = await summarizeWithOpenAI(transcript);

    const summary = ai
      ? ai
      : `Problem: ${issueText || "(unknown)"}\n\nKey details: (no AI configured)\n\nSuggested next steps: Ask user for device + screenshots.`;

    return interaction.editReply({
      content:
        `**Ticket Summary**\n` +
        `User: <@${openerId}>\n` +
        (issueText ? `Issue: ${issueText}\n` : "") +
        "\n" +
        summary
    });
  }

  // ---------------- /ticket-save-solution ----------------
  if (interaction.commandName === "ticket-save-solution") {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Server-only command.", ephemeral: true });
    }

    const member = interaction.member;
    if (!userHasAnyRole(member, TICKET_CLAIM_ROLE_IDS)) {
      return interaction.reply({
        content: "You do not have permission to use this.",
        ephemeral: true
      });
    }

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !channel.name.startsWith("ticket-")) {
      return interaction.reply({
        content: "Run this inside a ticket channel.",
        ephemeral: true
      });
    }

    const solution = interaction.options.getString("solution");
    const category = interaction.options.getString("category") || null;

    const meta = parseTopicMeta(channel.topic);
    const issueText = meta.issueText ? decodeURIComponent(meta.issueText) : null;

    if (!issueText) {
      return interaction.reply({
        content: "I don't have the original issue recorded for this ticket yet. Ask the user to restate it, then try again.",
        ephemeral: true
      });
    }

    const ok = kbInsert(db, normalizeQuestion(issueText), category, solution, interaction.user.id);

    if (!ok) {
      return interaction.reply({
        content: "Failed to save the solution (DB not available or error).",
        ephemeral: true
      });
    }

    return interaction.reply({
      content: "Saved ✅ Tyrone will reuse this solution next time that exact question is asked.",
      ephemeral: true
    });
  }
}

// ---------- Buttons ----------

async function handleButton(interaction, { client, db }) {
  const id = interaction.customId || "";

  if (!["ticket_open", "ticket_claim", "ticket_close", "ticket_reopen"].includes(id)) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This button only works inside a server.",
      ephemeral: true
    });
    return true;
  }

  const guild = interaction.guild;

  const missing = missingConfig();
  if (missing.length) {
    await interaction.reply({
      content:
        "Tyrone ticket system is missing config in .env: " + missing.join(", "),
      ephemeral: true
    });
    return true;
  }

  // ----- OPEN -----
  if (id === "ticket_open") {
    const opener = interaction.user;

    // Create channel name
    const safeName = `ticket-${opener.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const channelName = safeName.length ? safeName.slice(0, 90) : `ticket-${opener.id}`;

    // Permission overwrites
    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: opener.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }
    ];

    // Allow claim roles to see ticket
    for (const rid of TICKET_CLAIM_ROLE_IDS) {
      overwrites.push({
        id: rid,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      });
    }

    // Create channel under "Created Tickets"
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: TICKETS_CREATED_CATEGORY_ID,
      permissionOverwrites: overwrites,
      reason: `Ticket opened by ${opener.tag} (${opener.id})`
    });

    // Persist opener and openedAt in topic
    await setChannelTopicMeta(ticketChannel, {
      openedBy: opener.id,
      openedAt: String(Date.now())
    });

    // Track runtime
    ticketRuntime.set(ticketChannel.id, {
      openerId: opener.id,
      awaitingIssueText: true,
      lastUserMessageAt: nowMs(),
      warnTimeout: null,
      closeTimeout: null
    });

    // Message inside ticket
    const pingLine =
      `${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID)} ${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID_2)}`.trim();

    await ticketChannel.send(
      (pingLine ? `${pingLine}\n` : "") +
        `Hey <@${opener.id}> 👋 Can you please explain your issue in more detail?`
    );

    await ticketChannel.send({
      content:
        "Staff controls (staff only):",
      components: [ticketControlsRow(false)]
    });

    await postToLog(
      guild,
      `🎫 Ticket created: <#${ticketChannel.id}> by <@${opener.id}>`
    );

    await interaction.reply({
      content: `Ticket created: <#${ticketChannel.id}>`,
      ephemeral: true
    });

    resetInactivityTimers(guild, ticketChannel, opener.id);

    return true;
  }

  // For claim/close/reopen, ensure we are in a ticket channel
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: "Invalid channel.", ephemeral: true });
    return true;
  }

  // Staff gate for claim/close/reopen
  const member = interaction.member;
  const canManage = userHasAnyRole(member, TICKET_CLAIM_ROLE_IDS);

  if (!canManage) {
    await interaction.reply({
      content: "You do not have permission to manage tickets.",
      ephemeral: true
    });
    return true;
  }

  // ----- CLAIM -----
  if (id === "ticket_claim") {
    try {
      await channel.setParent(TICKETS_CLAIMED_CATEGORY_ID, { lockPermissions: false });
      await channel.send(`✅ Ticket claimed by <@${interaction.user.id}>.`);
      await postToLog(guild, `📌 Ticket claimed: <#${channel.id}> by <@${interaction.user.id}>`);
      await interaction.reply({ content: "Claimed ✅", ephemeral: true });
    } catch (e) {
      console.error("[tickets] claim error:", e);
      await interaction.reply({ content: "Failed to claim ticket.", ephemeral: true });
    }
    return true;
  }

  // ----- CLOSE -----
  if (id === "ticket_close") {
    try {
      await channel.setParent(TICKETS_CLOSED_CATEGORY_ID, { lockPermissions: false });

      // lock the opener (ticket creator)
      const meta = parseTopicMeta(channel.topic);
      const openerId = meta.openedBy || null;
      if (openerId) {
        await channel.permissionOverwrites.edit(openerId, {
          SendMessages: false
        });
      }

      await setChannelTopicMeta(channel, { closedAt: String(Date.now()) });

      await channel.send(`🔒 Ticket closed by <@${interaction.user.id}>.`);
      await postToLog(guild, `🔒 Ticket closed: <#${channel.id}> by <@${interaction.user.id}>`);

      // stop runtime timers
      const state = ticketRuntime.get(channel.id);
      if (state) {
        if (state.warnTimeout) clearTimeout(state.warnTimeout);
        if (state.closeTimeout) clearTimeout(state.closeTimeout);
        ticketRuntime.delete(channel.id);
      }

      await interaction.reply({ content: "Closed ✅", ephemeral: true });
    } catch (e) {
      console.error("[tickets] close error:", e);
      await interaction.reply({ content: "Failed to close ticket.", ephemeral: true });
    }
    return true;
  }

  // ----- REOPEN -----
  if (id === "ticket_reopen") {
    try {
      const meta = parseTopicMeta(channel.topic);
      const closedAt = meta.closedAt ? Number(meta.closedAt) : null;
      if (closedAt && Date.now() - closedAt > daysToMs(TICKET_REOPEN_DAYS)) {
        return interaction.reply({
          content: `This ticket is older than ${TICKET_REOPEN_DAYS} days and cannot be reopened. Please open a new ticket.`,
          ephemeral: true
        });
      }

      await channel.setParent(TICKETS_CREATED_CATEGORY_ID, { lockPermissions: false });

      const openerId = meta.openedBy || null;
      if (openerId) {
        await channel.permissionOverwrites.edit(openerId, {
          SendMessages: true
        });
      }

      await channel.send(`🔓 Ticket reopened by <@${interaction.user.id}>.`);
      await postToLog(guild, `🔓 Ticket reopened: <#${channel.id}> by <@${interaction.user.id}>`);
      await interaction.reply({ content: "Reopened ✅", ephemeral: true });
    } catch (e) {
      console.error("[tickets] reopen error:", e);
      await interaction.reply({ content: "Failed to reopen ticket.", ephemeral: true });
    }
    return true;
  }

  return false;
}

// ---------- Message handler (inside ticket channels) ----------

async function handleMessage(message, { client, db }) {
  if (message.author.bot) return;
  ensureTicketTables(db);
  globalThis.__ticketsDbModuleForKb = db;
  if (!message.inGuild()) return;

  const channel = message.channel;
  const guild = message.guild;

  // Only handle messages inside channels that look like tickets
  // (simple heuristic: channel name starts with ticket-)
  if (!channel || !channel.name || !channel.name.startsWith("ticket-")) return;

  const state = ticketRuntime.get(channel.id);
  if (!state) {
    // If bot restarted, we may not have runtime state. Keep minimal behavior:
    // still reset timers for opener if we can infer it later (skip for now).
    return;
  }

  // If staff speak for the first time in this ticket, post an auto summary for them
  const member = message.member;
  const isStaff = userHasAnyRole(member, TICKET_CLAIM_ROLE_IDS);

  if (isStaff && message.author.id !== state.openerId) {
    if (!state.staffSummarySent) {
      state.staffSummarySent = true;
      ticketRuntime.set(channel.id, state);

      const meta = parseTopicMeta(channel.topic);
      const openerId = meta.openedBy || state.openerId;
      const issueText = meta.issueText ? decodeURIComponent(meta.issueText) : null;
      const category = meta.category || "unknown";
      const confidence = meta.confidence || "?";

      const summaryLines = [];
      summaryLines.push("**Tyrone Summary**");
      summaryLines.push(`User: <@${openerId}>`);
      if (issueText) {
        summaryLines.push("Issue:");
        summaryLines.push(`> ${issueText}`);
      }
      summaryLines.push(`Category: ${category}`);
      summaryLines.push(`Confidence: ${confidence}%`);
      summaryLines.push("\nStaff: please assist when available.");

      await channel.send({
        content: summaryLines.join("\n"),
        allowedMentions: { parse: [] }
      });
    }

    // staff message should keep the ticket alive too
    state.lastUserMessageAt = nowMs();
    ticketRuntime.set(channel.id, state);
    resetInactivityTimers(guild, channel, state.openerId);
    return;
  }

  // Only treat opener's messages as "issue text"
  if (message.author.id !== state.openerId) {
    return;
  }

  // update last activity
  state.lastUserMessageAt = nowMs();
  ticketRuntime.set(channel.id, state);

  resetInactivityTimers(guild, channel, state.openerId);

  // If awaiting first issue message, triage it
  if (state.awaitingIssueText) {
    state.awaitingIssueText = false;
    ticketRuntime.set(channel.id, state);

    const issueText = (message.content || "").trim();
    if (!issueText) {
      await channel.send(`Hey <@${state.openerId}>, I didn’t catch any text. Can you describe the issue?`);
      state.awaitingIssueText = true;
      ticketRuntime.set(channel.id, state);
      return;
    }

    // persist issueText for summaries + KB save. Use URI encoding to keep topic safe.
    await setChannelTopicMeta(channel, {
      issueText: encodeURIComponent(issueText.slice(0, 240))
    });

    // Try solve
    const solved = trySolveCommonIssue(issueText);

    if (solved && solved.category) {
      await setChannelTopicMeta(channel, {
        category: String(solved.category).replace(/\s+/g, "_").slice(0, 32),
        confidence: String(Math.round((solved.confidence || 0) * 100))
      });
    }

    if (solved && solved.confidence >= 0.75) {
      await channel.send(
        `Here’s what I think ✅\n\n${solved.answer}\n\nDo you still need help? (Reply **yes** or **no**)`
      );
      return;
    }

    // Escalate: ping always-ping roles and ask staff
    const pingLine =
      `${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID)} ${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID_2)}`.trim();

    await channel.send(
      (pingLine ? `${pingLine}\n` : "") +
        `I’m not 100% sure on this one, so I’m escalating to staff.\n\n` +
        `Issue summary from <@${state.openerId}>:\n> ${issueText}`
    );
    return;
  }

  // After initial triage, handle yes/no follow-up
  const t = normalizeQuestion(message.content);

  if (t === "no" || t === "nope" || t === "nah") {
    await channel.send(
      "Got you. I’ll close this ticket in 10 seconds. If you still need help later, open a new one."
    );
    setTimeout(async () => {
      try {
        await closeTicketByTimeout(guild, channel);
      } catch {}
    }, 10_000);
    return;
  }

  if (t === "yes" || t === "y" || t === "yeah" || t === "yep") {
    const pingLine =
      `${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID)} ${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID_2)}`.trim();

    await channel.send(
      (pingLine ? `${pingLine}\n` : "") +
        "The user still needs help. Staff assistance requested."
    );
    return;
  }
}

// ---------- Ticket Janitor ----------

async function archiveAndDeleteTicketChannel(channel) {
  try {
    const guild = channel.guild;
    const openerId = parseTopicMeta(channel.topic).openedBy || "unknown";

    const transcript = await fetchTranscriptText(channel);
    let payload = `🗂️ Ticket archived (auto): #${channel.name}\nUser: <@${openerId}>\nChannel was: <#${channel.id}>\n\nTranscript:\n`;

    // keep message under 1900ish, split if needed
    const chunks = [];
    const max = 1800;
    const lines = transcript.split("\n");
    let cur = "";
    for (const line of lines) {
      if ((cur + "\n" + line).length > max) {
        chunks.push(cur);
        cur = line;
      } else {
        cur = cur ? cur + "\n" + line : line;
      }
    }
    if (cur) chunks.push(cur);

    await postToLog(guild, payload + (chunks[0] || "(no text transcript)"));
    for (let i = 1; i < chunks.length; i++) {
      await postToLog(guild, chunks[i]);
    }

    await channel.delete(`Auto-archived after ${TICKET_REOPEN_DAYS} days closed`);
  } catch (e) {
    console.error("[tickets] archive/delete failed:", e);
  }
}

function startTicketJanitor(client) {
  // Runs periodically and deletes tickets that have been closed longer than the reopen window.
  const intervalMs = minutesToMs(JANITOR_INTERVAL_MINUTES);

  setInterval(async () => {
    try {
      const guilds = client.guilds.cache;
      for (const guild of guilds.values()) {
        // fetch channels to ensure we see category children
        const all = await guild.channels.fetch().catch(() => null);
        if (!all) continue;

        const closedTickets = all.filter(
          ch =>
            ch &&
            ch.isTextBased &&
            typeof ch.isTextBased === "function" &&
            ch.isTextBased() &&
            ch.parentId === TICKETS_CLOSED_CATEGORY_ID &&
            ch.name &&
            ch.name.startsWith("ticket-")
        );

        for (const ch of closedTickets.values()) {
          const meta = parseTopicMeta(ch.topic);
          const closedAt = meta.closedAt ? Number(meta.closedAt) : null;
          if (!closedAt) continue;

          if (Date.now() - closedAt > daysToMs(TICKET_REOPEN_DAYS)) {
            await archiveAndDeleteTicketChannel(ch);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }, intervalMs);
}

async function createTyroneFeedbackTicket({ guild, reporter, summary, responseLog, report }) {
  const missing = missingConfig();
  if (missing.length) {
    return {
      ok: false,
      error: "Tyrone ticket system is missing config in .env: " + missing.join(", ")
    };
  }

  if (!guild) {
    return { ok: false, error: "Guild is required to create a feedback ticket." };
  }

  const opener = reporter;
  const safeBase = `ticket-tyrone-${opener?.username || "feedback"}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90);
  const channelName = safeBase || `ticket-tyrone-${opener?.id || Date.now()}`;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel]
    }
  ];

  if (opener?.id) {
    overwrites.push({
      id: opener.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  for (const rid of TICKET_CLAIM_ROLE_IDS) {
    overwrites.push({
      id: rid,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKETS_CREATED_CATEGORY_ID,
    permissionOverwrites: overwrites,
    reason: `Tyrone feedback ticket for ${opener?.tag || opener?.id || "unknown user"}`
  });

  await setChannelTopicMeta(ticketChannel, {
    openedBy: opener?.id || "",
    openedAt: String(Date.now()),
    source: "tyrone_feedback",
    reportId: report?.id ? String(report.id) : "",
    responseLogId: responseLog?.id ? String(responseLog.id) : ""
  });

  ticketRuntime.set(ticketChannel.id, {
    openerId: opener?.id || null,
    awaitingIssueText: false,
    lastUserMessageAt: nowMs(),
    warnTimeout: null,
    closeTimeout: null,
    staffSummarySent: true
  });

  const pingLine =
    `${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID)} ${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID_2)}`.trim();

  const sourceLines = [];
  sourceLines.push("**Tyrone Feedback Ticket**");
  sourceLines.push(`Reporter: <@${opener?.id || "unknown"}>`);
  if (report?.report_type) {
    sourceLines.push(`Report type: ${report.report_type}`);
  }
  if (summary) {
    sourceLines.push("");
    sourceLines.push("Summary:");
    sourceLines.push(summary);
  }
  if (responseLog) {
    sourceLines.push("");
    sourceLines.push("Recent Tyrone response:");
    sourceLines.push(`Path: ${responseLog.path || "unknown"}`);
    sourceLines.push(`Prompt: ${responseLog.prompt_text || "(missing)"}`);
    sourceLines.push(`Reply: ${responseLog.response_text || "(missing)"}`);
  }
  if (report?.tyrone_guess) {
    sourceLines.push("");
    sourceLines.push("Tyrone guess:");
    sourceLines.push(report.tyrone_guess);
  }

  await ticketChannel.send({
    content:
      (pingLine ? `${pingLine}\n` : "") +
      `Hi <@${opener?.id || "unknown"}>, I am sorry Tyrone handled that badly. ` +
      "A staff ticket was created. Please allow up to 2 hours for it to be claimed.",
    allowedMentions: { parse: [], users: opener?.id ? [opener.id] : [] }
  });

  await ticketChannel.send({
    content: sourceLines.join("\n"),
    allowedMentions: { parse: [] }
  });

  await ticketChannel.send({
    content: "Staff controls (staff only):",
    components: [ticketControlsRow(false)]
  });

  await postToLog(
    guild,
    `🎫 Tyrone feedback ticket created: <#${ticketChannel.id}> for <@${opener?.id || "unknown"}>`
  );

  if (opener?.id) {
    resetInactivityTimers(guild, ticketChannel, opener.id);
  }

  return {
    ok: true,
    channelId: ticketChannel.id
  };
}

async function createStructuredSupportTicket({
  guild,
  opener,
  source = "request_panel",
  category = null,
  issueText = null,
  summary = null,
  introMessage = null,
  awaitingIssueText = false
}) {
  const missing = missingConfig();
  if (missing.length) {
    return {
      ok: false,
      error: "Tyrone ticket system is missing config in .env: " + missing.join(", ")
    };
  }

  if (!guild) {
    return { ok: false, error: "Guild is required to create a support ticket." };
  }

  const safeBase = `ticket-${opener?.username || "support"}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90);
  const channelName = safeBase || `ticket-${opener?.id || Date.now()}`;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel]
    }
  ];

  if (opener?.id) {
    overwrites.push({
      id: opener.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  for (const rid of TICKET_CLAIM_ROLE_IDS) {
    overwrites.push({
      id: rid,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKETS_CREATED_CATEGORY_ID,
    permissionOverwrites: overwrites,
    reason: `Support ticket for ${opener?.tag || opener?.id || "unknown user"} via ${source}`
  });

  const topicPatch = {
    openedBy: opener?.id || "",
    openedAt: String(Date.now()),
    source
  };

  if (category) {
    topicPatch.category = String(category).replace(/\s+/g, "_").slice(0, 32);
  }

  if (issueText) {
    topicPatch.issueText = encodeURIComponent(String(issueText).slice(0, 240));
  }

  await setChannelTopicMeta(ticketChannel, topicPatch);

  ticketRuntime.set(ticketChannel.id, {
    openerId: opener?.id || null,
    awaitingIssueText: !!awaitingIssueText,
    lastUserMessageAt: nowMs(),
    warnTimeout: null,
    closeTimeout: null,
    staffSummarySent: !awaitingIssueText
  });

  const pingLine =
    `${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID)} ${safeTagRole(TICKET_ALWAYS_PING_ROLE_ID_2)}`.trim();

  const introLines = [];
  introLines.push(
    introMessage ||
      `Hi <@${opener?.id || "unknown"}>, a support ticket was created from the request hub. Please allow up to 2 hours for it to be claimed.`
  );
  if (summary) {
    introLines.push("");
    introLines.push("Summary:");
    introLines.push(summary);
  }
  if (issueText && !awaitingIssueText) {
    introLines.push("");
    introLines.push("Issue:");
    introLines.push(issueText);
  }
  if (awaitingIssueText) {
    introLines.push("");
    introLines.push("Please explain your issue in more detail in this ticket.");
  }

  await ticketChannel.send({
    content: (pingLine ? `${pingLine}\n` : "") + introLines.join("\n"),
    allowedMentions: { parse: [], users: opener?.id ? [opener.id] : [] }
  });

  await ticketChannel.send({
    content: "Staff controls (staff only):",
    components: [ticketControlsRow(false)]
  });

  await postToLog(
    guild,
    `🎫 Support ticket created: <#${ticketChannel.id}> for <@${opener?.id || "unknown"}> via ${source}`
  );

  if (opener?.id) {
    resetInactivityTimers(guild, ticketChannel, opener.id);
  }

  return {
    ok: true,
    channelId: ticketChannel.id
  };
}

// ---------- Exports ----------
module.exports = {
  handleInteraction,
  handleButton,
  handleMessage,
  startTicketJanitor,
  createTyroneFeedbackTicket,
  createStructuredSupportTicket,
  refreshSupportPanel
};
