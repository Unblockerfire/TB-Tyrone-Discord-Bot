const slashCommandRouteGroups = [
  {
    moduleKey: "moderation",
    modulePath: "./commands/moderation",
    handlerName: "handleInteraction",
    commands: ["warn", "timeout", "strikes", "request-kick", "mod-interest-panel", "autofill", "revokestrike"]
  },
  {
    moduleKey: "status",
    modulePath: "./commands/status",
    handlerName: "handleInteraction",
    commands: ["set-status", "clear-status"]
  },
  {
    moduleKey: "notifyRoles",
    modulePath: "./commands/notifyRoles",
    handlerName: "handleInteraction",
    commands: ["setup-rules-verify"]
  },
  {
    moduleKey: "tickets",
    modulePath: "./commands/tickets",
    handlerName: "handleInteraction",
    commands: ["setup-support-panel"]
  },
  {
    moduleKey: "applications",
    modulePath: "./commands/applications",
    handlerName: "handleInteraction",
    commands: ["setup-applacation", "application-info", "application-toggle", "show-applications"]
  },
  {
    moduleKey: "roleSelect",
    modulePath: "./commands/roleSelect",
    handlerName: "handleInteraction",
    commands: [
      "setup-live",
      "setup-chat",
      "setup-giveaways",
      "setup-announcements",
      "setup-party",
      "setup-notify-all"
    ]
  },
  {
    moduleKey: "privateVc",
    modulePath: "./commands/privateVc",
    handlerName: "handleInteraction",
    commands: ["setup-private-vc-panel", "private-vc-status"]
  },
  {
    moduleKey: "bangCommands",
    modulePath: "./commands/bangCommands",
    handlerName: "handleInteraction",
    commands: ["bang-commands"]
  },
  {
    moduleKey: "requests",
    modulePath: "./commands/requests",
    handlerName: "handleInteraction",
    commands: ["setup-requests"]
  },
  {
    moduleKey: "communityPosts",
    modulePath: "./commands/communityPosts",
    handlerName: "handleInteraction",
    commands: ["setup-shoutout"]
  },
  {
    moduleKey: "staffPanels",
    modulePath: "./commands/staffPanels",
    handlerName: "handleInteraction",
    commands: ["tyrone-cleanup-setup", "checklist-setup", "refresh-tyrone-buttons"]
  },
  {
    moduleKey: "leaderboard",
    modulePath: "./commands/leaderboard",
    handlerName: "handleInteraction",
    commands: [
      "setup-leaderboard",
      "leaderboard-add",
      "leaderboard-set",
      "leaderboard-remove",
      "leaderboard-add-likes",
      "leaderboard-set-likes",
      "leaderboard-reset",
      "leaderboard-update"
    ]
  },
  {
    moduleKey: "fortniteQueue",
    modulePath: "./commands/fortniteQueue",
    handlerName: "handleInteraction",
    commands: [
      "setup-fort-verify-panel",
      "setup-fort-ready-panel",
      "setup-fort-queue-display",
      "fort-queue-open",
      "fort-queue-close",
      "fort-queue-status",
      "fort-queue-next",
      "fort-queue-remove",
      "fort-queue-add-guest",
      "fort-queue-remove-guest"
    ]
  },
  {
    moduleKey: "tyrone",
    modulePath: "./commands/tyrone",
    handlerName: "handleInteraction",
    commands: ["report-issue", "report"]
  }
];

const slashCommandRouteMap = Object.fromEntries(
  slashCommandRouteGroups.flatMap(group =>
    group.commands.map(commandName => [commandName, {
      moduleKey: group.moduleKey,
      modulePath: group.modulePath,
      handlerName: group.handlerName
    }])
  )
);

module.exports = {
  slashCommandRouteGroups,
  slashCommandRouteMap
};
