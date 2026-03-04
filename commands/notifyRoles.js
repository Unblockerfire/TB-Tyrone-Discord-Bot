// commands/notifyRoles.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

// ------ CONFIG ------

const RULES_CHANNEL_ID = process.env.RULES_CHANNEL_ID || null;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID || null;

const RULES_ACCEPT_ROLE_ID = process.env.RULES_ACCEPT_ROLE_ID || null;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || null;

// Only you can run setup (your owner role)
const OWNER_ROLE_ID = "1113158001604427966";

// ------ SLASH COMMAND HANDLER: /setup-rules-verify ------

async function handleInteraction(interaction) {
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
        "Missing RULES_CHANNEL_ID or VERIFY_CHANNEL_ID in .env.",
      ephemeral: true
    });
    return;
  }

  if (!RULES_ACCEPT_ROLE_ID || !VERIFIED_ROLE_ID) {
    await interaction.reply({
      content:
        "Missing RULES_ACCEPT_ROLE_ID or VERIFIED_ROLE_ID in .env.",
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

  const guild = interaction.guild;

  const rulesChannel = await guild.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
  const verifyChannel = await guild.channels.fetch(VERIFY_CHANNEL_ID).catch(() => null);

  if (!rulesChannel || !rulesChannel.isTextBased()) {
    await interaction.reply({
      content: "RULES_CHANNEL_ID is invalid or not a text channel.",
      ephemeral: true
    });
    return;
  }

  if (!verifyChannel || !verifyChannel.isTextBased()) {
    await interaction.reply({
      content: "VERIFY_CHANNEL_ID is invalid or not a text channel.",
      ephemeral: true
    });
    return;
  }

  // RULES PANEL
  const rulesEmbed = new EmbedBuilder()
    .setTitle("Server Rules")
    .setColor(0xff0000)
    .setDescription(
      "Please read the server rules above carefully.\n\n" +
      "When you are done, choose **I accept the rules** to continue, " +
      "or **I do not accept the rules** to leave the server."
    );

  const rulesRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rules_accept")
      .setLabel("I accept the rules")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("rules_decline")
      .setLabel("I do not accept the rules")
      .setStyle(ButtonStyle.Danger)
  );

  await rulesChannel.send({ embeds: [rulesEmbed], components: [rulesRow] });

  // VERIFY PANEL
  const verifyEmbed = new EmbedBuilder()
    .setTitle("Verification")
    .setColor(0x3498db)
    .setDescription(
      `Once you have accepted the rules in <#${RULES_CHANNEL_ID}>, click **Verify** below to finish joining the server.`
    );

  const verifyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_me")
      .setLabel("Verify")
      .setStyle(ButtonStyle.Primary)
  );

  await verifyChannel.send({ embeds: [verifyEmbed], components: [verifyRow] });

  await interaction.reply({
    content: "Rules + Verify panels posted.",
    ephemeral: true
  });
}

// ------ BUTTON HANDLER ------

async function handleButton(interaction) {
  const id = interaction.customId || "";

  if (!["rules_accept", "rules_decline", "verify_me"].includes(id)) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This button only works inside the server.",
      ephemeral: true
    });
    return true;
  }

  const member = interaction.member;
  const guild = interaction.guild;

  if (!member) {
    await interaction.reply({
      content: "Could not find your member data in this server.",
      ephemeral: true
    });
    return true;
  }

  if (!RULES_ACCEPT_ROLE_ID || !VERIFIED_ROLE_ID) {
    await interaction.reply({
      content:
        "Missing RULES_ACCEPT_ROLE_ID or VERIFIED_ROLE_ID in .env.",
      ephemeral: true
    });
    return true;
  }

  if (id === "rules_accept") {
    try {
      if (member.roles.cache.has(RULES_ACCEPT_ROLE_ID)) {
        await interaction.reply({
          content:
            "You already accepted the rules. Go to the verify channel and press **Verify**.",
          ephemeral: true
        });
        return true;
      }

      await member.roles.add(RULES_ACCEPT_ROLE_ID, "User accepted server rules");

      await interaction.reply({
        content:
          "Thanks for accepting the rules. Now go to the verify channel and press **Verify** to finish.",
        ephemeral: true
      });
    } catch (err) {
      console.error("[rules_accept] error:", err);
      await interaction.reply({
        content: "I could not update your roles. Check bot permissions.",
        ephemeral: true
      });
    }
    return true;
  }

  if (id === "rules_decline") {
    try {
      await interaction.reply({
        content:
          "You chose not to accept the rules. You will be removed from the server. You can rejoin later.",
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
      }, 1000);
    } catch (err) {
      console.error("[rules_decline] error:", err);
    }
    return true;
  }

  if (id === "verify_me") {
    try {
      if (!member.roles.cache.has(RULES_ACCEPT_ROLE_ID)) {
        await interaction.reply({
          content: `You need to go to <#${RULES_CHANNEL_ID}> and accept the rules first.`,
          ephemeral: true
        });
        return true;
      }

      if (member.roles.cache.has(VERIFIED_ROLE_ID)) {
        await interaction.reply({
          content: "You are already verified.",
          ephemeral: true
        });
        return true;
      }

      await member.roles.add(VERIFIED_ROLE_ID, "User verified after accepting rules");

      await interaction.reply({
        content: "You are now verified. Welcome in 🎉",
        ephemeral: true
      });
    } catch (err) {
      console.error("[verify_me] error:", err);
      await interaction.reply({
        content: "I could not update your roles. Check bot permissions.",
        ephemeral: true
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleInteraction,
  handleButton
};