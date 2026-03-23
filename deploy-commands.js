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

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a user and log the offence")
    .addUserOption(option =>
      option.setName("user").setDescription("User to timeout").setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription("Duration like 10m, 1h, 2h 30m, or 1d")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for the timeout").setRequired(true)
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

  // -------- ROLE SELECT (5 separate commands) --------
  new SlashCommandBuilder()
    .setName("setup-live")
    .setDescription("Post the Live Notifications role button panel (owner/admin)"),

  new SlashCommandBuilder()
    .setName("setup-chat")
    .setDescription("Post the Chat Revive role button panel (owner/admin)"),

  new SlashCommandBuilder()
    .setName("setup-giveaways")
    .setDescription("Post the Giveaways role button panel (owner/admin)"),

  new SlashCommandBuilder()
    .setName("setup-announcements")
    .setDescription("Post the Announcements role button panel (owner/admin)"),

  new SlashCommandBuilder()
    .setName("setup-party")
    .setDescription("Post the Party Member role button panel (owner/admin)"),

  new SlashCommandBuilder()
    .setName("setup-notify-all")
    .setDescription("Post the combined notification roles panel (owner/admin)"),

  new SlashCommandBuilder()
    .setName("setup-private-vc-panel")
    .setDescription("Post the private VC creation panel (admin/owner)"),

  new SlashCommandBuilder()
    .setName("private-vc-status")
    .setDescription("View the currently tracked private voice channels (admin/owner)"),

  new SlashCommandBuilder()
    .setName("bang-commands")
    .setDescription("View the current ! command list in a private pane"),

  new SlashCommandBuilder()
    .setName("setup-requests")
    .setDescription("Post the Tyrone request/help panel (staff/admin only)"),

  new SlashCommandBuilder()
    .setName("setup-inspire")
    .setDescription("View the fixed daily inspire schedule info"),

  new SlashCommandBuilder()
    .setName("setup-shoutout")
    .setDescription("Configure and post the Shoutout of the Day")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Optional shoutout channel to store for future posts")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("First user to shout out")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("user_2")
        .setDescription("Second user to shout out")
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName("user_3")
        .setDescription("Third user to shout out")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("tyrone-cleanup-setup")
    .setDescription("Post the Tyrone cleanup button panel"),

  new SlashCommandBuilder()
    .setName("checklist-setup")
    .setDescription("Post the live staff checklist panel"),

  // -------- LEADERBOARD --------
  new SlashCommandBuilder()
    .setName("setup-leaderboard")
    .setDescription("Create or refresh the leaderboard post (owner only)"),

  new SlashCommandBuilder()
    .setName("leaderboard-add")
    .setDescription("Add coins to a user on the leaderboard (owner only)")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Discord user to add coins to")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("coins")
        .setDescription("How many coins to add")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard-set")
    .setDescription("Set a user's exact coin total on the leaderboard (owner only)")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Discord user to update")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("coins")
        .setDescription("Exact total to set")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard-remove")
    .setDescription("Remove coins from a user on the leaderboard (owner only)")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Discord user to update")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("coins")
        .setDescription("How many coins to remove")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard-add-likes")
    .setDescription("Add likes to a user on the leaderboard (owner only)")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Discord user to add likes to")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("likes")
        .setDescription("How many likes to add")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard-set-likes")
    .setDescription("Set a user's exact like total on the leaderboard (owner only)")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Discord user to update")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("likes")
        .setDescription("Exact total of likes to set")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard-reset")
    .setDescription("Reset one user or the whole leaderboard (owner only)")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Optional user to reset. Leave blank to reset all.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard-update")
    .setDescription("Force refresh the leaderboard post (owner only)"),

  // -------- FORTNITE PANELS / QUEUE --------
  new SlashCommandBuilder()
    .setName("setup-fort-verify-panel")
    .setDescription("Post the Fortnite verification panel (staff only)"),

  new SlashCommandBuilder()
    .setName("setup-fort-ready-panel")
    .setDescription("Post the Fortnite Ready Up button panel (staff only)"),

  new SlashCommandBuilder()
    .setName("setup-fort-queue-display")
    .setDescription("Post the Fortnite queue display panel (staff only)"),

  new SlashCommandBuilder()
    .setName("fort-queue-open")
    .setDescription("Open the Fortnite ready-up queue (staff only)"),

  new SlashCommandBuilder()
    .setName("fort-queue-close")
    .setDescription("Close the Fortnite ready-up queue (staff only)"),

  new SlashCommandBuilder()
    .setName("fort-queue-status")
    .setDescription("View the current Fortnite queue and status"),

  new SlashCommandBuilder()
    .setName("fort-queue-next")
    .setDescription("Advance the queue to the next player or group (staff only)")
    .addIntegerOption(option =>
      option
        .setName("count")
        .setDescription("How many people should be up next")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  new SlashCommandBuilder()
    .setName("fort-queue-remove")
    .setDescription("Remove a user from the Fortnite queue or current slot (staff only)")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to remove from queue")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("fort-queue-add-guest")
    .setDescription("Add a guest to the Fortnite queue (staff only)")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Guest display name")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("epic")
        .setDescription("Guest Fortnite username")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("fort-queue-remove-guest")
    .setDescription("Remove a guest from the Fortnite queue (staff only)")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Guest display name")
        .setRequired(true)
    ),

  // -------- REPORT ISSUE --------
  new SlashCommandBuilder()
    .setName("report")
    .setDescription("Tell Tyrone he answered wrong or should not have answered")
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription("What kind of Tyrone issue are you reporting?")
        .setRequired(true)
        .addChoices(
          { name: "Answered incorrectly", value: "incorrect" },
          { name: "Should not have answered", value: "should_not_answer" }
        )
    ),

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
