// commands/leaderboard.js
const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");

// ---------- CONFIG ----------
const SETUP_CHANNEL_ID = "1479295934646059069";
const DISPLAY_CHANNEL_ID = "1478919882463772846";
const OWNER_ROLE_ID = "1113158001604427966";

const DATA_PATH = path.join(__dirname, "..", "leaderboard-data.json");

// ---------- DATA ----------
function loadData() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return { setupMessageId: null, displayMessageId: null, entries: [] };
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return {
      setupMessageId: parsed.setupMessageId || null,
      displayMessageId: parsed.displayMessageId || null,
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    };
  } catch {
    return { setupMessageId: null, displayMessageId: null, entries: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if ((b.coins || 0) !== (a.coins || 0)) {
      return (b.coins || 0) - (a.coins || 0);
    }

    if ((b.likes || 0) !== (a.likes || 0)) {
      return (b.likes || 0) - (a.likes || 0);
    }

    return String(a.userId || "").localeCompare(String(b.userId || ""));
  });
}

function findEntry(entries, userId) {
  return entries.find(e => e.userId === userId) || null;
}

function ensureEntry(entries, userId) {
  let entry = findEntry(entries, userId);

  if (!entry) {
    entry = {
      userId,
      coins: 0,
      likes: 0
    };
    entries.push(entry);
  }

  if (!Number.isInteger(entry.coins)) entry.coins = Number(entry.coins || 0);
  if (!Number.isInteger(entry.likes)) entry.likes = Number(entry.likes || 0);

  return entry;
}

function progressBar(value, max) {
  const size = 10;
  const safeMax = max > 0 ? max : 1;
  const filled = Math.max(0, Math.min(size, Math.round((value / safeMax) * size)));
  return "█".repeat(filled) + "░".repeat(size - filled);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

// ---------- EMBEDS ----------
function buildDisplayEmbed(entries) {
  const sorted = sortEntries(entries).slice(0, 10);
  const maxCoins = sorted[0]?.coins || 1;

  const lines = sorted.map((e, i) => {
    const medal =
      i === 0 ? "🥇" :
      i === 1 ? "🥈" :
      i === 2 ? "🥉" :
      `#${i + 1}`;

    return (
      `${medal} <@${e.userId}>\n` +
      `${progressBar(e.coins || 0, maxCoins)}\n` +
      `🪙 **${formatNumber(e.coins)} coins**\n` +
      `❤️ **${formatNumber(e.likes)} likes**`
    );
  });

  return new EmbedBuilder()
    .setTitle("🏆 Live Stream Leaderboard")
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n\n") || "No leaderboard data yet.")
    .setFooter({ text: "Public leaderboard • auto updates" })
    .setTimestamp();
}

function buildSetupEmbed(entries) {
  const sorted = sortEntries(entries).slice(0, 10);

  const lines = sorted.map((e, i) =>
    `#${i + 1} <@${e.userId}> — 🪙 ${formatNumber(e.coins)} | ❤️ ${formatNumber(e.likes)}`
  );

  return new EmbedBuilder()
    .setTitle("🛠 Leaderboard Control Panel")
    .setColor(0x3498db)
    .setDescription(
      `Edit the leaderboard from this channel.\n\n` +
      `**Coins commands**\n` +
      `• \`/leaderboard-add\`\n` +
      `• \`/leaderboard-set\`\n` +
      `• \`/leaderboard-remove\`\n\n` +
      `**Likes commands**\n` +
      `• \`/leaderboard-add-likes\`\n` +
      `• \`/leaderboard-set-likes\`\n\n` +
      `**Other**\n` +
      `• \`/leaderboard-reset\`\n` +
      `• \`/leaderboard-update\`\n\n` +
      `Public leaderboard updates automatically.`
    )
    .addFields({
      name: "Preview",
      value: lines.join("\n") || "No entries yet."
    })
    .setFooter({ text: "Edit here • display updates there" })
    .setTimestamp();
}

// ---------- SYNC ----------
async function syncLeaderboard(guild) {
  const data = loadData();

  const setupChannel = await guild.channels.fetch(SETUP_CHANNEL_ID).catch(() => null);
  const displayChannel = await guild.channels.fetch(DISPLAY_CHANNEL_ID).catch(() => null);

  if (!setupChannel || !setupChannel.isTextBased()) {
    throw new Error("Setup leaderboard channel is invalid or missing.");
  }

  if (!displayChannel || !displayChannel.isTextBased()) {
    throw new Error("Display leaderboard channel is invalid or missing.");
  }

  const setupEmbed = buildSetupEmbed(data.entries);
  const displayEmbed = buildDisplayEmbed(data.entries);

  let setupMsg = null;
  if (data.setupMessageId) {
    setupMsg = await setupChannel.messages.fetch(data.setupMessageId).catch(() => null);
  }

  if (setupMsg) {
    await setupMsg.edit({ embeds: [setupEmbed] });
  } else {
    setupMsg = await setupChannel.send({ embeds: [setupEmbed] });
    data.setupMessageId = setupMsg.id;
  }

  let displayMsg = null;
  if (data.displayMessageId) {
    displayMsg = await displayChannel.messages.fetch(data.displayMessageId).catch(() => null);
  }

  if (displayMsg) {
    await displayMsg.edit({ embeds: [displayEmbed] });
  } else {
    displayMsg = await displayChannel.send({ embeds: [displayEmbed] });
    data.displayMessageId = displayMsg.id;
  }

  saveData(data);
}

// ---------- COMMAND HANDLER ----------
async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const cmd = interaction.commandName;

  if (![
    "setup-leaderboard",
    "leaderboard-add",
    "leaderboard-set",
    "leaderboard-remove",
    "leaderboard-add-likes",
    "leaderboard-set-likes",
    "leaderboard-reset",
    "leaderboard-update"
  ].includes(cmd)) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true
    });
    return true;
  }

  if (!interaction.member?.roles?.cache?.has(OWNER_ROLE_ID)) {
    await interaction.reply({
      content: "No permission.",
      ephemeral: true
    });
    return true;
  }

  if (interaction.channelId !== SETUP_CHANNEL_ID) {
    await interaction.reply({
      content: `Run this in <#${SETUP_CHANNEL_ID}>`,
      ephemeral: true
    });
    return true;
  }

  const data = loadData();

  // setup
  if (cmd === "setup-leaderboard") {
    await syncLeaderboard(interaction.guild);

    await interaction.reply({
      content: "Leaderboard control panel + public display are now linked.",
      ephemeral: true
    });
    return true;
  }

  // add coins
  if (cmd === "leaderboard-add") {
    const user = interaction.options.getUser("user");
    const coins = interaction.options.getInteger("coins");

    if (!user || !Number.isInteger(coins) || coins <= 0) {
      await interaction.reply({
        content: "Provide a valid user and a positive coin amount.",
        ephemeral: true
      });
      return true;
    }

    const entry = ensureEntry(data.entries, user.id);
    entry.coins += coins;

    saveData(data);
    await syncLeaderboard(interaction.guild);

    await interaction.reply({
      content: `Added **${formatNumber(coins)} coins** to ${user}\nNew total: **${formatNumber(entry.coins)} coins**`,
      ephemeral: true
    });

    return true;
  }

  // set coins
  if (cmd === "leaderboard-set") {
    const user = interaction.options.getUser("user");
    const coins = interaction.options.getInteger("coins");

    if (!user || !Number.isInteger(coins) || coins < 0) {
      await interaction.reply({
        content: "Provide a valid user and a coin total of 0 or more.",
        ephemeral: true
      });
      return true;
    }

    const entry = ensureEntry(data.entries, user.id);
    entry.coins = coins;

    // If both become 0, remove the entry
    if ((entry.coins || 0) === 0 && (entry.likes || 0) === 0) {
      data.entries = data.entries.filter(e => e.userId !== user.id);
    }

    saveData(data);
    await syncLeaderboard(interaction.guild);

    await interaction.reply({
      content: `${user} now has **${formatNumber(coins)} coins**`,
      ephemeral: true
    });

    return true;
  }

  // remove coins
  if (cmd === "leaderboard-remove") {
    const user = interaction.options.getUser("user");
    const coins = interaction.options.getInteger("coins");

    if (!user || !Number.isInteger(coins) || coins <= 0) {
      await interaction.reply({
        content: "Provide a valid user and a positive coin amount to remove.",
        ephemeral: true
      });
      return true;
    }

    const entry = findEntry(data.entries, user.id);

    if (!entry) {
      await interaction.reply({
        content: "User not found.",
        ephemeral: true
      });
      return true;
    }

    entry.coins = Math.max(0, (entry.coins || 0) - coins);

    if ((entry.coins || 0) === 0 && (entry.likes || 0) === 0) {
      data.entries = data.entries.filter(e => e.userId !== user.id);
    }

    saveData(data);
    await syncLeaderboard(interaction.guild);

    await interaction.reply({
      content: `Removed **${formatNumber(coins)} coins** from ${user}\nNew total: **${formatNumber(entry.coins || 0)} coins**`,
      ephemeral: true
    });

    return true;
  }

  // add likes
  if (cmd === "leaderboard-add-likes") {
    const user = interaction.options.getUser("user");
    const likes = interaction.options.getInteger("likes");

    if (!user || !Number.isInteger(likes) || likes <= 0) {
      await interaction.reply({
        content: "Provide a valid user and a positive like amount.",
        ephemeral: true
      });
      return true;
    }

    const entry = ensureEntry(data.entries, user.id);
    entry.likes += likes;

    saveData(data);
    await syncLeaderboard(interaction.guild);

    await interaction.reply({
      content: `Added **${formatNumber(likes)} likes** to ${user}\nNew total: **${formatNumber(entry.likes)} likes**`,
      ephemeral: true
    });

    return true;
  }

  // set likes
  if (cmd === "leaderboard-set-likes") {
    const user = interaction.options.getUser("user");
    const likes = interaction.options.getInteger("likes");

    if (!user || !Number.isInteger(likes) || likes < 0) {
      await interaction.reply({
        content: "Provide a valid user and a like total of 0 or more.",
        ephemeral: true
      });
      return true;
    }

    const entry = ensureEntry(data.entries, user.id);
    entry.likes = likes;

    if ((entry.coins || 0) === 0 && (entry.likes || 0) === 0) {
      data.entries = data.entries.filter(e => e.userId !== user.id);
    }

    saveData(data);
    await syncLeaderboard(interaction.guild);

    await interaction.reply({
      content: `${user} now has **${formatNumber(likes)} likes**`,
      ephemeral: true
    });

    return true;
  }

  // reset
  if (cmd === "leaderboard-reset") {
    const user = interaction.options.getUser("user");

    if (user) {
      const before = data.entries.length;
      data.entries = data.entries.filter(e => e.userId !== user.id);

      if (data.entries.length === before) {
        await interaction.reply({
          content: "User not found.",
          ephemeral: true
        });
        return true;
      }

      saveData(data);
      await syncLeaderboard(interaction.guild);

      await interaction.reply({
        content: `Reset ${user} and removed them from the leaderboard.`,
        ephemeral: true
      });
      return true;
    }

    data.entries = [];
    saveData(data);
    await syncLeaderboard(interaction.guild);

    await interaction.reply({
      content: "Leaderboard reset.",
      ephemeral: true
    });

    return true;
  }

  // update
  if (cmd === "leaderboard-update") {
    await syncLeaderboard(interaction.guild);

    await interaction.reply({
      content: "Leaderboard refreshed.",
      ephemeral: true
    });

    return true;
  }

  return false;
}

module.exports = {
  handleInteraction
};