// deploy-commands.js
require("dotenv").config();
const { REST, Routes } = require("discord.js");
const { getSlashCommandPayloads } = require("./slashCommands");

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

requireEnv("DISCORD_TOKEN");
requireEnv("CLIENT_ID");
requireEnv("GUILD_ID");

const commands = getSlashCommandPayloads();

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
