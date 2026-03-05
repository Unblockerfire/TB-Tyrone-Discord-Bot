// deploy-commands.js
require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

requireEnv("DISCORD_TOKEN");
requireEnv("CLIENT_ID");
requireEnv("GUILD_ID");

const commands = [
  // -------- WARN --------
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue a strike and warning to a user")
    .addUserOption(option =>
      option.setName("user").setDescription("User to warn").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for the warning").setRequired(true)
    ),

  // -------- STRIKES --------
  new SlashCommandBuilder()
    .setName("strikes")
    .setDescription("View strikes and warnings for a user")
    .addUserOption(option =>
      option.setName("user").setDescription("User to inspect").setRequired(true)
    ),

  // -------- REQUEST KICK --------
  new SlashCommandBuilder()
    .setName("request-kick")
    .setDescription("Create a kick request another admin must approve")
    .addUserOption(option =>
      option.setName("user").setDescription("User you want kicked").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Why should they be kicked?").setRequired(true)
    ),

  // -------- STATUS --------
  new SlashCommandBuilder()
    .setName("set-status")
    .setDescription("Set your current status (auto replies when mentioned)")
    .addStringOption(option =>
      option
        .setName("status")
        .setDescription("Current status")
        .setRequired(true)
        .addChoices(
          { name: "Streaming", value: "streaming" },
          { name: "AFK", value: "afk" },
          { name: "Sleeping", value: "sleeping" },
          { name: "Offline", value: "offline" }
        )
    )
    .addStringOption(option =>
      option.setName("note").setDescription("Optional extra note").setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName("duration")
        .setDescription("Minutes to keep this status. Leave empty to keep until cleared.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("clear-status")
    .setDescription("Clear your current status"),

  // -------- MOD INTEREST PANEL --------
  new SlashCommandBuilder()
    .setName("mod-interest-panel")
    .setDescription("Post a panel where users can mark interest in future staff roles (admin only)"),

  // -------- RULES + VERIFY SETUP --------
  new SlashCommandBuilder()
    .setName("setup-rules-verify")
    .setDescription("Post the Rules Agreement + Verify panels (owner only)"),

  // -------- TICKETS: SUPPORT PANEL --------
  new SlashCommandBuilder()
    .setName("setup-support-panel")
    .setDescription("Post the Get Support ticket button panel (admin/owner only)"),
   
    // -------- ROLE SELECT PANEL --------
  new SlashCommandBuilder()
    .setName("setup-role-panel")
    .setDescription("Post the notification role select panel (admin/owner only)"),

  // -------- REPORT ISSUE --------
  new SlashCommandBuilder()
    .setName("report-issue")
    .setDescription("Report an issue with Tyrone and attach your latest Tyrone convo link if available")
    .addStringOption(option =>
      option.setName("details").setDescription("Optional details about the issue").setRequired(false)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Refreshing application slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log("Slash commands registered ✅");
  } catch (error) {
    console.error("Failed to register commands:", error);
    process.exitCode = 1;
  }
})();