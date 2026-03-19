// index.js
require("dotenv").config();
const crypto = require("crypto");

const {
  Client,
  GatewayIntentBits,
  Partials,
  MessageFlags
} = require("discord.js");

// Local modules
const { startQueueServer } = require("./queueServer");
const db = require("./db");
const moderation = require("./commands/moderation");
const songs = require("./commands/songs");
const leaderboard = require("./commands/leaderboard");
const status = require("./commands/status");
const tyrone = require("./commands/tyrone");
const notifyRoles = require("./commands/notifyRoles");
const tickets = require("./commands/tickets");
const roleSelect = require("./commands/roleSelect");
const fortniteQueue = require("./commands/fortniteQueue");
const privateVc = require("./commands/privateVc");
const bangCommands = require("./commands/bangCommands");
const requests = require("./commands/requests");

const MEE6_BOT_ID = "159985870458322944";
const MEE6_ACHIEVEMENT_FORWARD_CHANNEL_ID = "1478930416097562728";

function isMee6AchievementMessage(message) {
  if (!message || message.author?.id !== MEE6_BOT_ID) return false;

  const content = String(message.content || "").trim();
  if (/unlocked the achievement/i.test(content)) return true;

  const embedText = (message.embeds || [])
    .map(embed => [embed.title, embed.description]
      .filter(Boolean)
      .join(" "))
    .join(" ");

  return /unlocked the achievement/i.test(embedText);
}

async function forwardMee6Achievement(message, client) {
  if (!isMee6AchievementMessage(message)) return false;

  const targetChannel = await client.channels
    .fetch(MEE6_ACHIEVEMENT_FORWARD_CHANNEL_ID)
    .catch(() => null);

  if (!targetChannel?.isTextBased()) {
    console.error(
      "[MEE6] Forward target channel is missing or not text-based:",
      MEE6_ACHIEVEMENT_FORWARD_CHANNEL_ID
    );
    return false;
  }

  const embedParts = (message.embeds || [])
    .map(embed => [embed.title, embed.description].filter(Boolean).join("\n"))
    .filter(Boolean);
  const forwardContent = [message.content, ...embedParts].filter(Boolean).join("\n\n").trim();

  if (!forwardContent) {
    console.warn("[MEE6] Matched achievement message had no forwardable content.");
    return false;
  }

  await targetChannel.send(forwardContent);
  await message.delete().catch(error => {
    console.error("[MEE6] Failed to delete original achievement message:", error);
  });
  console.log(
    "[MEE6] Forwarded achievement message",
    JSON.stringify({
      source_channel_id: message.channelId,
      target_channel_id: MEE6_ACHIEVEMENT_FORWARD_CHANNEL_ID,
      message_id: message.id
    })
  );
  return true;
}

function logBoot(stage, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[BOOT] ${stage}${suffix}`);
}

function logBootError(stage, error) {
  console.error(`[BOOT] ${stage}`, error);
}

function fingerprintSecret(value) {
  if (!value) return "missing";
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function validateEnv() {
  const token = process.env.DISCORD_TOKEN || "";
  const clientId = process.env.CLIENT_ID || "";
  const guildId = process.env.GUILD_ID || "";

  logBoot(
    "env.validation",
    JSON.stringify({
      node_env: process.env.NODE_ENV || "unset",
      discord_token_present: !!token,
      discord_token_length: token.length || 0,
      discord_token_fingerprint: fingerprintSecret(token),
      client_id_present: !!clientId,
      client_id: clientId || null,
      guild_id_present: !!guildId,
      guild_id: guildId || null
    })
  );

  if (!token) {
    throw new Error("Missing required env var DISCORD_TOKEN.");
  }

  return { token, clientId, guildId };
}

process.on("uncaughtException", (error) => {
  console.error("[PROCESS] uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[PROCESS] unhandledRejection", reason);
});

logBoot("app.boot.start", `pid=${process.pid} node=${process.version}`);

if (tyrone && typeof tyrone.initializeAdminState === "function") {
  logBoot("tyrone.initialize.start");
  tyrone.initializeAdminState(db);
  logBoot("tyrone.initialize.done");
}

logBoot("web.startQueueServer.start");
startQueueServer(db);
logBoot("web.startQueueServer.done");

// ---------- CLIENT SETUP ----------
logBoot("discord.client.create.start");
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.GuildMember, Partials.Channel]
});
logBoot("discord.client.create.done");

client.once("clientReady", () => {
  logBoot(
    "discord.clientReady",
    JSON.stringify({
      tag: client.user?.tag || null,
      user_id: client.user?.id || null,
      guild_count: client.guilds.cache.size,
      expected_client_id: process.env.CLIENT_ID || null,
      client_id_matches_user: !!client.user?.id && !!process.env.CLIENT_ID
        ? client.user.id === process.env.CLIENT_ID
        : null
    })
  );

  try {
    if (tickets && typeof tickets.startTicketJanitor === "function") {
      tickets.startTicketJanitor(client, { db });
      console.log("[Tickets] Janitor started ✅");
    }
  } catch (err) {
    console.error("[Tickets] Failed to start janitor:", err);
  }

  try {
    if (fortniteQueue && typeof fortniteQueue.startFortniteQueueTicker === "function") {
      fortniteQueue.startFortniteQueueTicker(client, { db });
      console.log("[Fortnite] Queue ticker started ✅");
    }
  } catch (err) {
    console.error("[Fortnite] Failed to start queue ticker:", err);
  }

  try {
    if (privateVc && typeof privateVc.startPrivateVcJanitor === "function") {
      privateVc.startPrivateVcJanitor(client, { db });
      console.log("[Private VC] Janitor started ✅");
    }
  } catch (err) {
    console.error("[Private VC] Failed to start janitor:", err);
  }
});

// ---------- INTERACTION ROUTER ----------
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        // Moderation
        case "warn":
        case "strikes":
        case "request-kick":
        case "mod-interest-panel":
        case "autofill":
        case "revokestrike":
          await moderation.handleInteraction(interaction, { client, db });
          return;

        // Status
        case "set-status":
        case "clear-status":
          await status.handleInteraction(interaction, { client, db });
          return;

        // Rules + Verify setup
        case "setup-rules-verify":
          await notifyRoles.handleInteraction(interaction, { client, db });
          return;

        // Notification role panels
        case "setup-live":
        case "setup-chat":
        case "setup-giveaways":
        case "setup-announcements":
        case "setup-party":
        case "setup-notify-all":
          await roleSelect.handleInteraction(interaction, { client, db });
          return;

        case "setup-private-vc-panel":
        case "private-vc-status":
          await privateVc.handleInteraction(interaction, { client, db });
          return;

        case "bang-commands":
          await bangCommands.handleInteraction(interaction, { client, db });
          return;

        case "setup-requests":
          await requests.handleInteraction(interaction, { client, db });
          return;

        // Leaderboard
        case "setup-leaderboard":
        case "leaderboard-add":
        case "leaderboard-set":
        case "leaderboard-remove":
        case "leaderboard-add-likes":
        case "leaderboard-set-likes":
        case "leaderboard-reset":
        case "leaderboard-update":
          await leaderboard.handleInteraction(interaction, { client, db });
          return;

        // Fortnite queue
        case "setup-fort-verify-panel":
        case "setup-fort-ready-panel":
        case "setup-fort-queue-display":
        case "fort-queue-open":
        case "fort-queue-close":
        case "fort-queue-status":
        case "fort-queue-next":
        case "fort-queue-remove":
          await fortniteQueue.handleInteraction(interaction, { client, db });
          return;

        // Tyrone issue report
        case "report-issue":
        case "report":
          await tyrone.handleInteraction(interaction, { client, db });
          return;

        // Tickets
        default: {
          const handledByTickets =
            tickets && typeof tickets.handleInteraction === "function"
              ? await tickets.handleInteraction(interaction, { client, db })
              : false;

          if (handledByTickets) return;
          return;
        }
      }
    }

    if (interaction.isButton()) {
      const handledByModeration =
        moderation && typeof moderation.handleButton === "function"
          ? await moderation.handleButton(interaction, { client, db })
          : false;
      if (handledByModeration) return;

      const handledBySongs =
        songs && typeof songs.handleButton === "function"
          ? await songs.handleButton(interaction, { client, db })
          : false;
      if (handledBySongs) return;

      const handledByNotify =
        notifyRoles && typeof notifyRoles.handleButton === "function"
          ? await notifyRoles.handleButton(interaction, { client, db })
          : false;
      if (handledByNotify) return;

      const handledByRoleSelect =
        roleSelect && typeof roleSelect.handleButton === "function"
          ? await roleSelect.handleButton(interaction, { client, db })
          : false;
      if (handledByRoleSelect) return;

      const handledByFortnite =
        fortniteQueue && typeof fortniteQueue.handleButton === "function"
          ? await fortniteQueue.handleButton(interaction, { client, db })
          : false;
      if (handledByFortnite) return;

      const handledByTyrone =
        tyrone && typeof tyrone.handleButton === "function"
          ? await tyrone.handleButton(interaction, { client, db })
          : false;
      if (handledByTyrone) return;

      const handledByPrivateVc =
        privateVc && typeof privateVc.handleButton === "function"
          ? await privateVc.handleButton(interaction, { client, db })
          : false;
      if (handledByPrivateVc) return;

      const handledByTickets =
        tickets && typeof tickets.handleButton === "function"
          ? await tickets.handleButton(interaction, { client, db })
          : false;
      if (handledByTickets) return;

      return;
    }

    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      const handledByRequests =
        requests && typeof requests.handleSelectMenu === "function"
          ? await requests.handleSelectMenu(interaction, { client, db })
          : false;
      if (handledByRequests) return;

      const handledByPrivateVc =
        privateVc && typeof privateVc.handleSelectMenu === "function"
          ? await privateVc.handleSelectMenu(interaction, { client, db })
          : false;
      if (handledByPrivateVc) return;

      return;
    }

    if (interaction.isModalSubmit()) {
      const handledByRequests =
        requests && typeof requests.handleModalSubmit === "function"
          ? await requests.handleModalSubmit(interaction, { client, db })
          : false;
      if (handledByRequests) return;

      const handledByFortnite =
        fortniteQueue && typeof fortniteQueue.handleModalSubmit === "function"
          ? await fortniteQueue.handleModalSubmit(interaction, { client, db })
          : false;
      if (handledByFortnite) return;

      return;
    }
  } catch (err) {
    console.error("interactionCreate error:", err);

    if (err?.code === 40060 || err?.code === 10062) {
      return;
    }

    if (interaction.isRepliable()) {
      try {
        const payload = {
          content: "Something went wrong handling that interaction.",
          flags: MessageFlags.Ephemeral
        };

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (followErr) {
        if (followErr?.code !== 40060 && followErr?.code !== 10062) {
          console.error("interactionCreate follow-up error:", followErr);
        }
      }
    }
  }
});

// ---------- MESSAGE ROUTER ----------
client.on("messageCreate", async (message) => {
  try {
    const handledMee6Achievement = await forwardMee6Achievement(message, client);
    if (handledMee6Achievement) return;

    if (message.author.bot) return;

    console.log(
      "[DEBUG] messageCreate from",
      `${message.author.tag} (${message.author.id})`,
      "in channel",
      message.channelId,
      "content:",
      message.content
    );

    await moderation.handleMessage(message, { client, db });
    const handledByPrivateVc =
      privateVc && typeof privateVc.handleMessage === "function"
        ? await privateVc.handleMessage(message, { client, db })
        : false;
    if (handledByPrivateVc) return;

    await tyrone.handleMessage(message, { client, db });
    await songs.handleMessage(message, { client, db });
    await status.handleMessage(message, { client, db });

    if (tickets && typeof tickets.handleMessage === "function") {
      await tickets.handleMessage(message, { client, db });
    }
  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

client.on("ready", () => {
  logBoot(
    "discord.ready",
    JSON.stringify({
      tag: client.user?.tag || null,
      user_id: client.user?.id || null,
      guild_count: client.guilds.cache.size
    })
  );
});

client.on("guildCreate", (guild) => {
  logBoot(
    "discord.guildCreate",
    JSON.stringify({
      guild_id: guild.id,
      guild_name: guild.name,
      member_count: guild.memberCount
    })
  );
});

client.on("error", (error) => {
  console.error("[DISCORD] client.error", error);
});

client.on("shardError", (error, shardId) => {
  console.error("[DISCORD] shardError", { shardId, error });
});

client.on("warn", (warning) => {
  console.warn("[DISCORD] warn", warning);
});

client.on("invalidated", () => {
  console.error("[DISCORD] session invalidated");
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    if (privateVc && typeof privateVc.handleVoiceStateUpdate === "function") {
      await privateVc.handleVoiceStateUpdate(oldState, newState, { client, db });
    }
  } catch (err) {
    console.error("voiceStateUpdate error:", err);
  }
});

// ---------- LOGIN ----------
async function startDiscordBot() {
  try {
    const { token, clientId } = validateEnv();
    logBoot("discord.login.attempt", `client_id=${clientId || "missing"}`);
    const loginResult = await client.login(token);
    logBoot(
      "discord.login.success",
      `token_fingerprint=${fingerprintSecret(loginResult || token)}`
    );
  } catch (error) {
    logBootError("discord.login.failure", error);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 250);
  }
}

startDiscordBot();
