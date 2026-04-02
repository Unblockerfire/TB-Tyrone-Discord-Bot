// commands/notifyRoles.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

// ------ CONFIG ------

// Channel IDs (use env so you can change without editing code)
const RULES_CHANNEL_ID = process.env.RULES_CHANNEL_ID || null;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID || null;

// Roles (hardcoded to your IDs as requested)
const RULES_ACCEPT_ROLE_ID = "1478198936127934689"; // Accepted Rules
const VERIFIED_ROLE_ID = "1113560011193450536"; // Verified

// Owner role (you) allowed to run the setup command
const OWNER_ROLE_ID = "1113158001604427966";
const VERIFY_REFRESH_TIMEZONE = "America/Boise";
const VERIFY_RULES_MESSAGE_KEY = "rules_verify.rules_message_id";
const VERIFY_PANEL_MESSAGE_KEY = "rules_verify.verify_message_id";
const VERIFY_LAST_REFRESH_KEY = "rules_verify.last_refresh_date";

let verifyRefreshStarted = false;

// helper: customId builder scoped to user
function uidScoped(id, userId) {
  return `${id}:${userId}`;
}

function parseScopedId(customId) {
  // "verify_confirm_yes:123" -> { base: "verify_confirm_yes", uid: "123" }
  const parts = String(customId || "").split(":");
  return { base: parts[0], uid: parts[1] || null };
}

function getBoiseDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: VERIFY_REFRESH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getStoredPanelState(db) {
  return {
    rulesMessageId: db?.getAppSetting?.(VERIFY_RULES_MESSAGE_KEY)?.value || null,
    verifyMessageId: db?.getAppSetting?.(VERIFY_PANEL_MESSAGE_KEY)?.value || null,
    lastRefreshDate: db?.getAppSetting?.(VERIFY_LAST_REFRESH_KEY)?.value || null
  };
}

function savePanelState(db, state = {}) {
  db?.setManyAppSettings?.({
    [VERIFY_RULES_MESSAGE_KEY]: state.rulesMessageId || "",
    [VERIFY_PANEL_MESSAGE_KEY]: state.verifyMessageId || "",
    [VERIFY_LAST_REFRESH_KEY]: state.lastRefreshDate || ""
  });
}

async function postRulesVerifyPanels(guild, db, { refreshReason = "manual" } = {}) {
  const rulesChannel = await guild.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
  const verifyChannel = await guild.channels.fetch(VERIFY_CHANNEL_ID).catch(() => null);

  if (!rulesChannel || !rulesChannel.isTextBased()) {
    throw new Error("RULES_CHANNEL_ID is invalid or not a text channel.");
  }

  if (!verifyChannel || !verifyChannel.isTextBased()) {
    throw new Error("VERIFY_CHANNEL_ID is invalid or not a text channel.");
  }

  const existing = getStoredPanelState(db);

  if (existing.rulesMessageId) {
    const priorRulesMessage = await rulesChannel.messages.fetch(existing.rulesMessageId).catch(() => null);
    if (priorRulesMessage) {
      await priorRulesMessage.delete().catch(error => {
        console.error("[Verify panels] Failed to delete old rules message:", error);
      });
    }
  }

  if (existing.verifyMessageId) {
    const priorVerifyMessage = await verifyChannel.messages.fetch(existing.verifyMessageId).catch(() => null);
    if (priorVerifyMessage) {
      await priorVerifyMessage.delete().catch(error => {
        console.error("[Verify panels] Failed to delete old verify message:", error);
      });
    }
  }

  const rulesEmbed = new EmbedBuilder()
    .setTitle("Rules Agreement")
    .setColor(0xff3b30)
    .setDescription(
      "Do you accept the server rules?\n\n" +
        "✅ If you accept, you can continue to verification.\n" +
        "❌ If you do not accept, you will be removed (you can rejoin anytime)."
    );

  const rulesRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rules_accept")
      .setLabel("I accept the rules")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("rules_decline")
      .setLabel("I do not accept")
      .setStyle(ButtonStyle.Danger)
  );

  const verifyEmbed = new EmbedBuilder()
    .setTitle("Verification")
    .setColor(0x3498db)
    .setDescription(
      `Once you’ve accepted the rules in <#${RULES_CHANNEL_ID}>, click **Verify me** below.`
    );

  const verifyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_me")
      .setLabel("Verify me")
      .setStyle(ButtonStyle.Primary)
  );

  const rulesMessage = await rulesChannel.send({
    embeds: [rulesEmbed],
    components: [rulesRow]
  });

  const verifyMessage = await verifyChannel.send({
    embeds: [verifyEmbed],
    components: [verifyRow]
  });

  savePanelState(db, {
    rulesMessageId: rulesMessage.id,
    verifyMessageId: verifyMessage.id,
    lastRefreshDate: getBoiseDateKey()
  });

  console.log(
    "[Verify panels] Refreshed",
    JSON.stringify({
      refresh_reason: refreshReason,
      rules_message_id: rulesMessage.id,
      verify_message_id: verifyMessage.id,
      date_key: getBoiseDateKey()
    })
  );
}

async function runDailyVerifyRefresh(client, db, { force = false } = {}) {
  if (!RULES_CHANNEL_ID || !VERIFY_CHANNEL_ID) return false;

  const state = getStoredPanelState(db);
  if (!state.rulesMessageId && !state.verifyMessageId) {
    return false;
  }

  const dateKey = getBoiseDateKey();
  if (!force && state.lastRefreshDate === dateKey) {
    return false;
  }

  const rulesChannel = await client.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
  if (!rulesChannel?.guild) {
    console.error("[Verify panels] Could not resolve guild from rules channel for refresh.");
    return false;
  }

  await postRulesVerifyPanels(rulesChannel.guild, db, {
    refreshReason: force ? "forced_startup_check" : "daily_ticker"
  });
  return true;
}

function startRulesVerifyTicker(client, db) {
  if (verifyRefreshStarted) return;
  verifyRefreshStarted = true;

  runDailyVerifyRefresh(client, db).catch(error => {
    console.error("[Verify panels] Initial refresh check failed:", error);
  });

  setInterval(() => {
    runDailyVerifyRefresh(client, db).catch(error => {
      console.error("[Verify panels] Daily refresh failed:", error);
    });
  }, 60 * 60 * 1000);
}

// ------ SLASH COMMAND HANDLER: /setup-rules-verify ------
async function handleInteraction(interaction, { db }) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "setup-rules-verify") return;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true
    });
    return;
  }

  if (!RULES_CHANNEL_ID || !VERIFY_CHANNEL_ID) {
    await interaction.reply({
      content:
        "Missing RULES_CHANNEL_ID or VERIFY_CHANNEL_ID in your .env. Add them and redeploy.",
      ephemeral: true
    });
    return;
  }

  const member = interaction.member;
  if (!member?.roles?.cache?.has(OWNER_ROLE_ID)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  try {
    await postRulesVerifyPanels(interaction.guild, db, {
      refreshReason: "manual_setup"
    });
  } catch (error) {
    await interaction.reply({
      content: error.message || "I couldn’t refresh the rules + verify panels.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: "Rules + Verify panels posted ✅",
    ephemeral: true
  });
}

// ------ BUTTON HANDLER ------
async function handleButton(interaction) {
  const { base, uid } = parseScopedId(interaction.customId);

  const handledBases = [
    "rules_accept",
    "rules_decline",
    "verify_me",
    "verify_confirm_yes",
    "verify_confirm_cancel"
  ];

  if (!handledBases.includes(base)) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This button only works inside the server.",
      ephemeral: true
    });
    return true;
  }

  // Optional: only allow these buttons to work in the configured channels
  // (prevents weird reposts / copied messages)
  if (
    (base === "rules_accept" || base === "rules_decline") &&
    interaction.channelId !== RULES_CHANNEL_ID
  ) {
    await interaction.reply({
      content: `Please use the buttons in <#${RULES_CHANNEL_ID}>.`,
      ephemeral: true
    });
    return true;
  }

  if (
    (base === "verify_me" || base.startsWith("verify_confirm_")) &&
    interaction.channelId !== VERIFY_CHANNEL_ID
  ) {
    await interaction.reply({
      content: `Please use the verify buttons in <#${VERIFY_CHANNEL_ID}>.`,
      ephemeral: true
    });
    return true;
  }

  const guild = interaction.guild;
  const member = interaction.member;

  if (!member) {
    await interaction.reply({
      content: "Could not find your member data in this server.",
      ephemeral: true
    });
    return true;
  }

  // If it's a scoped confirm button, make sure ONLY the same user can click it
  if (uid && uid !== interaction.user.id) {
    await interaction.reply({
      content: "Those buttons aren’t for you 🙂",
      ephemeral: true
    });
    return true;
  }

  // ---------- RULES ACCEPT ----------
  if (base === "rules_accept") {
    try {
      if (member.roles.cache.has(RULES_ACCEPT_ROLE_ID)) {
        await interaction.reply({
          content:
            "You already accepted the rules ✅ Go to the verify channel and press **Verify me**.",
          ephemeral: true
        });
        return true;
      }

      await member.roles.add(RULES_ACCEPT_ROLE_ID, "User accepted server rules");

      await interaction.reply({
        content: "✅ Rules accepted. Now go to the verify channel and press **Verify me**.",
        ephemeral: true
      });
    } catch (err) {
      console.error("[rules_accept] error:", err);
      await interaction.reply({
        content: "I couldn’t update your roles. Ask Carson to check my permissions.",
        ephemeral: true
      });
    }
    return true;
  }

  // ---------- RULES DECLINE (KICK) ----------
  if (base === "rules_decline") {
    try {
      await interaction.reply({
        content:
          "You chose not to accept the rules. You will be removed from the server (you can rejoin anytime).",
        ephemeral: true
      });

      setTimeout(async () => {
        try {
          const freshMember = await guild.members.fetch(member.id).catch(() => null);
          if (freshMember) {
            await freshMember.kick("Did not accept server rules");
          }
        } catch (err) {
          console.error("[rules_decline] kick error:", err);
        }
      }, 900);
    } catch (err) {
      console.error("[rules_decline] error:", err);
    }
    return true;
  }

  // ---------- VERIFY ME (STEP 1: show confirm buttons) ----------
  if (base === "verify_me") {
    if (!member.roles.cache.has(RULES_ACCEPT_ROLE_ID)) {
      await interaction.reply({
        content: `You need to go to <#${RULES_CHANNEL_ID}> and accept the rules first.`,
        ephemeral: true
      });
      return true;
    }

    if (member.roles.cache.has(VERIFIED_ROLE_ID)) {
      await interaction.reply({
        content: "You are already verified ✅",
        ephemeral: true
      });
      return true;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(uidScoped("verify_confirm_yes", interaction.user.id))
        .setLabel("Yes, verify me")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(uidScoped("verify_confirm_cancel", interaction.user.id))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: "Last step: do you 100% confirm you accept the rules?",
      components: [confirmRow],
      ephemeral: true
    });

    return true;
  }

  // ---------- VERIFY CONFIRM YES (STEP 2: re-check + assign role) ----------
  if (base === "verify_confirm_yes") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const freshMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!freshMember) {
        await interaction.editReply("Could not re-check your roles. Try again.");
        return true;
      }

      if (!freshMember.roles.cache.has(RULES_ACCEPT_ROLE_ID)) {
        await interaction.editReply(`You need to accept the rules in <#${RULES_CHANNEL_ID}> first.`);
        return true;
      }

      if (freshMember.roles.cache.has(VERIFIED_ROLE_ID)) {
        await interaction.editReply("You are already verified ✅");
        return true;
      }

      await freshMember.roles.add(VERIFIED_ROLE_ID, "User verified after confirming rules");

      await interaction.editReply("✅ You are now verified. Welcome in 🎉");
    } catch (err) {
      console.error("[verify_confirm_yes] error:", err);
      try {
        await interaction.editReply(
          "I couldn’t update your roles. Ask Carson to check my permissions."
        );
      } catch {}
    }
    return true;
  }

  // ---------- VERIFY CONFIRM CANCEL ----------
  if (base === "verify_confirm_cancel") {
    try {
      // This is a scoped button, so it will only be pressed by the same user
      await interaction.update({
        content: "Canceled. If you change your mind, click **Verify me** again.",
        components: []
      });
    } catch (err) {
      console.error("[verify_confirm_cancel] error:", err);
    }
    return true;
  }

  return true;
}

module.exports = {
  handleInteraction,
  handleButton,
  startRulesVerifyTicker,
  runDailyVerifyRefresh
};
