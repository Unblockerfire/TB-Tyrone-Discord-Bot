// index.js
require("dotenv").config();

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

if (tyrone && typeof tyrone.initializeAdminState === "function") {
  tyrone.initializeAdminState(db);
}

startQueueServer(db);

// ---------- CLIENT SETUP ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.GuildMember, Partials.Channel]
});

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);

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

      const handledByTickets =
        tickets && typeof tickets.handleButton === "function"
          ? await tickets.handleButton(interaction, { client, db })
          : false;
      if (handledByTickets) return;

      return;
    }

    if (interaction.isModalSubmit()) {
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

// ---------- LOGIN ----------
client.login(process.env.DISCORD_TOKEN);
