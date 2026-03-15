const express = require("express");
const path = require("path");
const tyrone = require("./commands/tyrone");

function parseBasicAuth(header) {
  if (!header || !header.startsWith("Basic ")) return null;

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx === -1) return null;

    return {
      username: decoded.slice(0, idx),
      password: decoded.slice(idx + 1)
    };
  } catch {
    return null;
  }
}

function makeAdminAuthMiddleware() {
  const expectedUser = process.env.TYRONE_ADMIN_USER || "";
  const expectedPass = process.env.TYRONE_ADMIN_PASS || "";

  return function requireAdminAuth(req, res, next) {
    if (!expectedUser || !expectedPass) {
      return res.status(503).json({
        error: "TYRONE_ADMIN_USER and TYRONE_ADMIN_PASS must be configured."
      });
    }

    const creds = parseBasicAuth(req.headers.authorization || "");
    if (!creds || creds.username !== expectedUser || creds.password !== expectedPass) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Tyrone Admin"');
      return res.status(401).send("Authentication required.");
    }

    next();
  };
}

function startQueueServer(db) {
  const app = express();
  const webDir = path.join(__dirname, "web");
  const adminAuth = makeAdminAuthMiddleware();

  app.use(express.json({ limit: "1mb" }));
  app.use("/admin", adminAuth);
  app.use("/admin/tyrone/assets", adminAuth, express.static(path.join(webDir, "admin")));
  app.use(express.static(webDir));

  app.get("/api/queue", (req, res) => {
    const queue = db.listFortniteQueue();

    const users = queue.map(entry => {
      const id = entry.user_id;

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

    const guestId = `guest|${safeDisplay}|${safeEpic}`;

    if (db.isInFortniteQueue(guestId)) {
      return res.status(400).json({ error: "You are already in the queue." });
    }

    db.addToFortniteQueue(guestId);

    res.json({
      message: "You were added to the queue successfully."
    });
  });

  app.get("/admin/tyrone", adminAuth, (req, res) => {
    res.sendFile(path.join(webDir, "admin", "tyrone.html"));
  });

  app.get("/admin/tyrone/api/state", adminAuth, (req, res) => {
    res.json(tyrone.getAdminState(db));
  });

  app.get("/admin/tyrone/api/events", adminAuth, (req, res) => {
    res.json({ events: db.listTyroneEvents(20) });
  });

  app.post("/admin/tyrone/api/settings", adminAuth, (req, res) => {
    const sanitized = tyrone.sanitizeSettingsInput(req.body || {});
    db.setManyTyroneSettings(sanitized);
    db.logTyroneEvent("settings_saved", sanitized);
    res.json({
      ok: true,
      settings: tyrone.getAdminState(db).settings
    });
  });

  app.post("/admin/tyrone/api/faq", adminAuth, (req, res) => {
    const payload = tyrone.sanitizeFaqInput(req.body || {});
    if (!payload.pattern || !payload.answer) {
      return res.status(400).json({ error: "Pattern and answer are required." });
    }

    const row = db.createTyroneFaq(payload);
    db.logTyroneEvent("faq_created", { id: row.id, label: row.label });
    res.json({ ok: true, faq: row });
  });

  app.post("/admin/tyrone/api/faq/:id", adminAuth, (req, res) => {
    const current = db.getTyroneFaqById(req.params.id);
    if (!current) {
      return res.status(404).json({ error: "FAQ entry not found." });
    }

    const payload = tyrone.sanitizeFaqInput(req.body || {});
    if (!payload.pattern || !payload.answer) {
      return res.status(400).json({ error: "Pattern and answer are required." });
    }

    const row = db.updateTyroneFaq(req.params.id, payload);
    db.logTyroneEvent("faq_updated", { id: row.id, label: row.label });
    res.json({ ok: true, faq: row });
  });

  app.post("/admin/tyrone/api/faq/:id/delete", adminAuth, (req, res) => {
    const current = db.getTyroneFaqById(req.params.id);
    if (!current) {
      return res.status(404).json({ error: "FAQ entry not found." });
    }

    db.deleteTyroneFaq(req.params.id);
    db.logTyroneEvent("faq_deleted", { id: current.id, label: current.label });
    res.json({ ok: true });
  });

  app.post("/admin/tyrone/api/cache/clear", adminAuth, (req, res) => {
    db.clearTyroneCache();
    db.logTyroneEvent("cache_cleared", {});
    res.json({ ok: true, cache: db.getTyroneCacheStats() });
  });

  app.post("/admin/tyrone/api/test-response", adminAuth, async (req, res) => {
    try {
      const result = await tyrone.runAdminTest(db, req.body || {});
      res.json({ ok: true, result });
    } catch (err) {
      console.error("[Tyrone admin test] error:", err);
      res.status(500).json({ error: "Failed to run Tyrone test response." });
    }
  });

  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`Queue overlay running on http://localhost:${PORT}/queue.html`);
  });
}

module.exports = { startQueueServer };
