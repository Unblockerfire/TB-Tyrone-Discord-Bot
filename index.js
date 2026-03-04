// index.js
require("dotenv").config();

const { Client, GatewayIntentBits, Partials } = require("discord.js");

// Local modules
const db = require("./db");
const moderation = require("./commands/moderation");
const songs = require("./commands/songs");
const status = require("./commands/status");
const tyrone = require("./commands/tyrone");
const notifyRoles = require("./commands/notifyRoles");

// ---------- CLIENT SETUP ----------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember]
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
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
          break;

        // Status
        case "set-status":
        case "clear-status":
          await status.handleInteraction(interaction, { client, db });
          break;

        // Rules + Verify setup
        case "setup-rules-verify":
          await notifyRoles.handleInteraction(interaction, { client, db });
          break;

        // Tyrone issue report
        case "report-issue":
          await tyrone.handleInteraction(interaction, { client, db });
          break;

        default:
          break;
      }
      return;
    }

    if (interaction.isButton()) {
      // Moderation buttons first
      const handledByModeration = await moderation.handleButton(interaction, {
        client,
        db
      });
      if (handledByModeration) return;

      // Song buttons
      const handledBySongs = await songs.handleButton(interaction, {
        client,
        db
      });
      if (handledBySongs) return;

      // Rules/Verify buttons (live in notifyRoles.js now)
      const handledByNotify = await notifyRoles.handleButton(interaction, {
        client,
        db
      });
      if (handledByNotify) return;
    }
  } catch (err) {
    console.error("interactionCreate error:", err);

    if (interaction.isRepliable()) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "Something went wrong handling that interaction.",
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: "Something went wrong handling that interaction.",
            ephemeral: true
          });
        }
      } catch {
        // ignore follow-up failures
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

    // Moderation text commands
    await moderation.handleMessage(message, { client, db });

    // Tyrone AI / FAQ
    await tyrone.handleMessage(message, { client, db });

    // Song requests
    await songs.handleMessage(message, { client, db });

    // Status auto-reply
    await status.handleMessage(message, { client, db });
  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

// ---------- LOGIN ----------
client.login(process.env.DISCORD_TOKEN);