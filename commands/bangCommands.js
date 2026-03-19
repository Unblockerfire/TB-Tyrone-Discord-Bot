const { EmbedBuilder, MessageFlags } = require("discord.js");

const COMMAND_GROUPS = [
  {
    title: "Tyrone",
    commands: [
      { usage: "!tyrone <question>", detail: "Ask Tyrone directly." },
      { usage: "!tyrone-approve", detail: "Approve Tyrone's queued reply in the same channel." },
      { usage: "!tytest", detail: "Quick Tyrone test command." }
    ]
  },
  {
    title: "Private VC",
    commands: [
      { usage: "!lockvc", detail: "Start locking the VC you are in." },
      { usage: "!tyrone-lock @user", detail: "Invite a user and make the VC private." },
      { usage: "!vcinvite @user", detail: "Invite a user without forcing private mode." },
      { usage: "!unlockvc", detail: "Open the tracked private VC back up." },
      { usage: "!vcprivate", detail: "Make your tracked VC private again." },
      { usage: "!deletevc [channel id]", detail: "Delete your tracked private VC or a specific one." },
      { usage: "!vccleanup", detail: "Run the private VC cleanup sweep." },
      { usage: "!vcowner @user", detail: "Transfer ownership of a tracked private VC." }
    ]
  },
  {
    title: "Songs",
    commands: [
      { usage: "!rqsong Song Name - Artist", detail: "Submit a song request in the song request channel." }
    ]
  },
  {
    title: "Staff / Owner",
    commands: [
      { usage: "!tyrone-cleanup", detail: "Archive Tyrone conversation history from the current channel." }
    ]
  }
];

function buildEmbed() {
  return new EmbedBuilder()
    .setTitle("Tyrone `!` Commands")
    .setDescription("This is a view-only list of the current prefix commands.")
    .setColor(0x1f6f63)
    .addFields(
      COMMAND_GROUPS.map(group => ({
        name: group.title,
        value: group.commands
          .map(command => `\`${command.usage}\`\n${command.detail}`)
          .join("\n\n")
      }))
    );
}

async function handleInteraction(interaction) {
  if (interaction.commandName !== "bang-commands") return false;

  await interaction.reply({
    embeds: [buildEmbed()],
    flags: MessageFlags.Ephemeral
  });

  return true;
}

module.exports = {
  handleInteraction
};
