// deploy-commands.js
require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue a strike and warning to a user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to warn")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the warning")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("strikes")
    .setDescription("View strikes and warnings for a user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to inspect")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("request-kick")
    .setDescription("Create a kick request that another admin must approve")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User you want to kick")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Why should they be kicked")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("set-status")
    .setDescription("Set your current status (for auto reply when mentioned)")
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
      option
        .setName("note")
        .setDescription("Optional extra note")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("mod-interest-panel")
    .setDescription("Post a message where users can say if they are interested in future staff opportunities (admin only)")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Refreshing application slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log("Slash commands registered.");
  } catch (error) {
    console.error(error);
  }
})();


