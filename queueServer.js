const express = require("express");
const path = require("path");

function startQueueServer(db){

const app = express();

app.use(express.json());

app.use(express.static(path.join(__dirname,"web")));

app.get("/api/queue", (req, res) => {

  const queue = db.listFortniteQueue();

  const users = queue.map(entry => {

    const id = entry.user_id;

    // Web guest format: guest|display|epic
    if (typeof id === "string" && id.startsWith("guest|")) {
      const parts = id.split("|");
      const display = parts[1] || "Guest";
      const epic = parts[2] || "Unknown";
      return `${display} - ${epic}`;
    }

    const link = db.getFortniteLink(entry.user_id);
    const epic = link?.epic_username || "Not linked";

    return epic;

  });

  res.json(users);

});

app.post("/api/queue/join", (req, res) => {

  const { displayName, epicUsername, rulesAccepted } = req.body || {};

  if (!rulesAccepted) {
    return res.status(400).json({ error: "Rules must be accepted." });
  }

  if (!displayName || !epicUsername) {
    return res.status(400).json({ error: "Display name and Epic username are required." });
  }

  const safeDisplay = String(displayName).trim().slice(0, 32);
  const safeEpic = String(epicUsername).trim().slice(0, 32);

  if (!safeDisplay || !safeEpic) {
    return res.status(400).json({ error: "Invalid input." });
  }

  // Create guest-style queue ID
  const guestId = `guest|${safeDisplay}|${safeEpic}`;

  if (db.isInFortniteQueue(guestId)) {
    return res.status(400).json({ error: "You are already in the queue." });
  }

  db.addToFortniteQueue(guestId);

  res.json({
    message: "You were added to the queue successfully."
  });

});

const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
console.log("Queue overlay running on http://localhost:"+PORT+"/queue.html");
});

}

module.exports = { startQueueServer };