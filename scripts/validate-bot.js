const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const { slashCommands } = require(path.join(projectRoot, "slashCommands"));
const { slashCommandRouteMap } = require(path.join(projectRoot, "slashCommandRoutes"));

function fail(message) {
  console.error(`[smoke] ${message}`);
  process.exitCode = 1;
}

function getCommandNames() {
  return slashCommands.map(command => command.name);
}

function validateUnique(names, label) {
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) {
      fail(`Duplicate ${label}: ${name}`);
    }
    seen.add(name);
  }
}

function validateSlashCommandsMatchRoutes() {
  const commandNames = getCommandNames();
  const routeNames = Object.keys(slashCommandRouteMap);

  validateUnique(commandNames, "slash command name");
  validateUnique(routeNames, "route manifest entry");

  const commandSet = new Set(commandNames);
  const routeSet = new Set(routeNames);

  for (const commandName of commandNames) {
    if (!routeSet.has(commandName)) {
      fail(`Slash command "${commandName}" is missing from slashCommandRoutes.js`);
    }
  }

  for (const routeName of routeNames) {
    if (!commandSet.has(routeName)) {
      fail(`Route manifest command "${routeName}" is not registered in slashCommands.js`);
    }
  }
}

function validateRouteModules() {
  for (const [commandName, route] of Object.entries(slashCommandRouteMap)) {
    const moduleFullPath = path.join(projectRoot, route.modulePath);
    let loadedModule = null;

    try {
      loadedModule = require(moduleFullPath);
    } catch (error) {
      fail(`Could not load module for "${commandName}" from ${route.modulePath}: ${error.message}`);
      continue;
    }

    if (typeof loadedModule?.[route.handlerName] !== "function") {
      fail(
        `Command "${commandName}" expects ${route.handlerName} in ${route.modulePath}, but it was not found`
      );
    }
  }
}

validateSlashCommandsMatchRoutes();
validateRouteModules();

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("[smoke] Slash command wiring validated ✅");
