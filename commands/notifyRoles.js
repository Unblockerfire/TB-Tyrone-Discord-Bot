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

// helper: customId builder scoped to user
function uidScoped(id, userId) {
  return `${id}:${userId}`;
}

function parseScopedId(customId) {
  // "verify_confirm_yes:123" -> { base: "verify_confirm_yes", uid: "123" }
  const parts = String(customId || "").split(":");
  return { base: parts[0], uid: parts[1] || null };
}

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

  // ----- RULES PANEL -----
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

  await rulesChannel.send({
    embeds: [rulesEmbed],
    components: [rulesRow]
  });

  // ----- VERIFY PANEL -----
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

  await verifyChannel.send({
    embeds: [verifyEmbed],
    components: [verifyRow]
  });

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
  handleButton
};