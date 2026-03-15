const crypto = require("crypto");
const express = require("express");
const path = require("path");
const tyrone = require("./commands/tyrone");

const SESSION_COOKIE = "tyrone_admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const adminSessions = new Map();

function parseCookies(cookieHeader) {
  const out = {};
  for (const chunk of String(cookieHeader || "").split(";")) {
    const [rawKey, ...rawValue] = chunk.trim().split("=");
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rawValue.join("=") || "");
  }
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = adminSessions.get(token);
  if (!session) return null;

  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    adminSessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000
    )}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function isApiRequest(req) {
  return req.path.startsWith("/admin/tyrone/api/");
}

function requireAdminConfig(req, res, next) {
  const expectedUser = process.env.TYRONE_ADMIN_USER || "";
  const expectedPass = process.env.TYRONE_ADMIN_PASS || "";

  if (expectedUser && expectedPass) {
    req.tyroneAdminCreds = { expectedUser, expectedPass };
    return next();
  }

  const payload = {
    error: "TYRONE_ADMIN_USER and TYRONE_ADMIN_PASS must be configured."
  };

  if (isApiRequest(req)) {
    return res.status(503).json(payload);
  }

  return res.status(503).send(payload.error);
}

function requireAdminSession(req, res, next) {
  const session = getSession(req);
  if (session) {
    req.tyroneAdminSession = session;
    return next();
  }

  if (isApiRequest(req)) {
    return res.status(401).json({ error: "Authentication required." });
  }

  return res.redirect("/admin/tyrone/login");
}

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function ensureNonEmptyText(value, label) {
  if (!String(value || "").trim()) {
    const error = new Error(`${label} is required.`);
    error.statusCode = 400;
    throw error;
  }
}

function startQueueServer(db) {
  const app = express();
  const webDir = path.join(__dirname, "web");
  const adminDir = path.join(webDir, "admin");

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use("/admin/tyrone/assets", express.static(adminDir));
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

  app.get("/admin/tyrone/login", requireAdminConfig, (req, res) => {
    if (getSession(req)) {
      return res.redirect("/admin/tyrone");
    }
    return res.sendFile(path.join(adminDir, "login.html"));
  });

  app.post("/admin/tyrone/login", requireAdminConfig, (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const { expectedUser, expectedPass } = req.tyroneAdminCreds;

    if (username !== expectedUser || password !== expectedPass) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const token = crypto.randomBytes(24).toString("hex");
    adminSessions.set(token, {
      username,
      createdAt: Date.now()
    });
    setSessionCookie(res, token);
    return res.json({ ok: true });
  });

  app.post("/admin/tyrone/logout", requireAdminConfig, (req, res) => {
    const session = getSession(req);
    if (session?.token) {
      adminSessions.delete(session.token);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/admin/tyrone", requireAdminConfig, requireAdminSession, (req, res) => {
    res.sendFile(path.join(adminDir, "tyrone.html"));
  });

  app.get("/admin/tyrone/api/state", requireAdminConfig, requireAdminSession, (req, res) => {
    res.json(tyrone.getAdminState(db));
  });

  app.get("/admin/tyrone/api/events", requireAdminConfig, requireAdminSession, (req, res) => {
    res.json({ events: db.listTyroneEvents(parseLimit(req.query.limit, 30, 200)) });
  });

  app.get("/admin/tyrone/api/seen-chat", requireAdminConfig, requireAdminSession, (req, res) => {
    res.json({ seen_messages: db.listTyroneSeenMessages(parseLimit(req.query.limit, 80, 300)) });
  });

  app.get("/admin/tyrone/api/responses", requireAdminConfig, requireAdminSession, (req, res) => {
    res.json({ response_logs: db.listTyroneResponseLogs(parseLimit(req.query.limit, 80, 300)) });
  });

  app.get("/admin/tyrone/api/reports", requireAdminConfig, requireAdminSession, (req, res) => {
    res.json({ reports: db.listTyroneReports(parseLimit(req.query.limit, 80, 300)) });
  });

  app.post("/admin/tyrone/api/settings", requireAdminConfig, requireAdminSession, (req, res) => {
    const sanitized = tyrone.sanitizeSettingsInput(req.body || {});
    db.setManyTyroneSettings(sanitized);
    db.logTyroneEvent("settings_saved", sanitized);
    res.json({
      ok: true,
      settings: tyrone.getAdminState(db).settings
    });
  });

  app.post("/admin/tyrone/api/faq", requireAdminConfig, requireAdminSession, (req, res) => {
    const payload = tyrone.sanitizeFaqInput(req.body || {});
    ensureNonEmptyText(payload.pattern, "Pattern");
    ensureNonEmptyText(payload.answer, "Answer");

    const row = db.createTyroneFaq(payload);
    db.logTyroneEvent("faq_created", { id: row.id, label: row.label });
    res.json({ ok: true, faq: row });
  });

  app.post("/admin/tyrone/api/faq/:id", requireAdminConfig, requireAdminSession, (req, res) => {
    const current = db.getTyroneFaqById(req.params.id);
    if (!current) {
      return res.status(404).json({ error: "FAQ entry not found." });
    }

    const payload = tyrone.sanitizeFaqInput(req.body || {});
    ensureNonEmptyText(payload.pattern, "Pattern");
    ensureNonEmptyText(payload.answer, "Answer");

    const row = db.updateTyroneFaq(req.params.id, payload);
    db.logTyroneEvent("faq_updated", { id: row.id, label: row.label });
    res.json({ ok: true, faq: row });
  });

  app.post("/admin/tyrone/api/faq/:id/delete", requireAdminConfig, requireAdminSession, (req, res) => {
    const current = db.getTyroneFaqById(req.params.id);
    if (!current) {
      return res.status(404).json({ error: "FAQ entry not found." });
    }

    db.deleteTyroneFaq(req.params.id);
    db.logTyroneEvent("faq_deleted", { id: current.id, label: current.label });
    res.json({ ok: true });
  });

  app.post("/admin/tyrone/api/corrections", requireAdminConfig, requireAdminSession, (req, res) => {
    const payload = tyrone.sanitizeCorrectionInput(req.body || {});
    ensureNonEmptyText(payload.trigger_text, "Trigger text");
    ensureNonEmptyText(payload.response_text, "Response text");

    const row = db.createTyroneCorrection(payload);
    db.logTyroneEvent("correction_created", { id: row.id, label: row.label });
    res.json({ ok: true, correction: row });
  });

  app.post("/admin/tyrone/api/corrections/:id", requireAdminConfig, requireAdminSession, (req, res) => {
    const current = db.getTyroneCorrectionById(req.params.id);
    if (!current) {
      return res.status(404).json({ error: "Correction not found." });
    }

    const payload = tyrone.sanitizeCorrectionInput(req.body || {});
    ensureNonEmptyText(payload.trigger_text, "Trigger text");
    ensureNonEmptyText(payload.response_text, "Response text");

    const row = db.updateTyroneCorrection(req.params.id, payload);
    db.logTyroneEvent("correction_updated", { id: row.id, label: row.label });
    res.json({ ok: true, correction: row });
  });

  app.post(
    "/admin/tyrone/api/corrections/:id/delete",
    requireAdminConfig,
    requireAdminSession,
    (req, res) => {
      const current = db.getTyroneCorrectionById(req.params.id);
      if (!current) {
        return res.status(404).json({ error: "Correction not found." });
      }

      db.deleteTyroneCorrection(req.params.id);
      db.logTyroneEvent("correction_deleted", { id: current.id, label: current.label });
      res.json({ ok: true });
    }
  );

  app.post("/admin/tyrone/api/cache/clear", requireAdminConfig, requireAdminSession, (req, res) => {
    db.clearTyroneCache();
    db.logTyroneEvent("cache_cleared", {});
    res.json({ ok: true, cache: db.getTyroneCacheStats() });
  });

  app.post("/admin/tyrone/api/chat", requireAdminConfig, requireAdminSession, async (req, res) => {
    try {
      const result = await tyrone.runDashboardChat(db, req.body || {});
      res.json({ ok: true, result });
    } catch (err) {
      console.error("[Tyrone dashboard chat] error:", err);
      res.status(500).json({ error: "Failed to run Tyrone dashboard chat." });
    }
  });

  app.post("/admin/tyrone/api/test-response", requireAdminConfig, requireAdminSession, async (req, res) => {
    try {
      const result = await tyrone.runAdminTest(db, req.body || {});
      res.json({ ok: true, result });
    } catch (err) {
      console.error("[Tyrone admin test] error:", err);
      res.status(500).json({ error: "Failed to run Tyrone test response." });
    }
  });

  app.post("/admin/tyrone/api/rewrite", requireAdminConfig, requireAdminSession, async (req, res) => {
    try {
      const result = await tyrone.rewriteAdminText(db, req.body || {});
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[Tyrone admin rewrite] error:", err);
      res.status(500).json({ error: "Failed to rewrite text." });
    }
  });

  app.post("/admin/tyrone/api/reports/:id", requireAdminConfig, requireAdminSession, (req, res) => {
    const reportId = Number(req.params.id);
    const report = db.getTyroneReportById(reportId);
    if (!report) {
      return res.status(404).json({ error: "Report not found." });
    }

    const action = String(req.body?.action || "").trim();
    const adminReason = String(req.body?.admin_reason || "").trim() || null;

    if (action === "approve_guess") {
      const updated = db.updateTyroneReport(reportId, {
        admin_resolution: report.tyrone_guess,
        status: "approved"
      });
      db.logTyroneEvent("report_approved", { id: reportId });
      return res.json({ ok: true, report: updated });
    }

    if (action === "dismiss") {
      const updated = db.updateTyroneReport(reportId, {
        admin_resolution: adminReason,
        status: "dismissed"
      });
      db.logTyroneEvent("report_dismissed", { id: reportId });
      return res.json({ ok: true, report: updated });
    }

    if (action === "save_reason") {
      const updated = db.updateTyroneReport(reportId, {
        admin_resolution: adminReason,
        status: "reviewed"
      });
      db.logTyroneEvent("report_reason_saved", { id: reportId });
      return res.json({ ok: true, report: updated });
    }

    if (action === "create_correction") {
      const payload = tyrone.sanitizeCorrectionInput({
        label: req.body?.label || `Report ${reportId}`,
        trigger_text: req.body?.trigger_text || report.question_text,
        response_text: req.body?.response_text || adminReason,
        notes: adminReason || report.tyrone_guess,
        enabled: req.body?.enabled !== false,
        sort_order: req.body?.sort_order || 0,
        source_response_log_id: report.source_response_log_id
      });
      ensureNonEmptyText(payload.trigger_text, "Trigger text");
      ensureNonEmptyText(payload.response_text, "Response text");

      const correction = db.createTyroneCorrection(payload);
      const updated = db.updateTyroneReport(reportId, {
        admin_resolution: adminReason || report.tyrone_guess,
        status: "converted_to_correction"
      });
      db.logTyroneEvent("report_to_correction", { id: reportId, correction_id: correction.id });
      return res.json({ ok: true, report: updated, correction });
    }

    if (action === "create_faq") {
      const payload = tyrone.sanitizeFaqInput({
        label: req.body?.label || `Report ${reportId}`,
        match_type: req.body?.match_type || "includes",
        pattern: req.body?.pattern || report.question_text,
        answer: req.body?.answer || adminReason,
        enabled: req.body?.enabled !== false,
        sort_order: req.body?.sort_order || 0
      });
      ensureNonEmptyText(payload.pattern, "Pattern");
      ensureNonEmptyText(payload.answer, "Answer");

      const faq = db.createTyroneFaq(payload);
      const updated = db.updateTyroneReport(reportId, {
        admin_resolution: adminReason || report.tyrone_guess,
        status: "converted_to_faq"
      });
      db.logTyroneEvent("report_to_faq", { id: reportId, faq_id: faq.id });
      return res.json({ ok: true, report: updated, faq });
    }

    return res.status(400).json({ error: "Unknown report action." });
  });

  app.use((err, req, res, next) => {
    if (!err) return next();
    const statusCode = err.statusCode || 500;
    if (isApiRequest(req)) {
      return res.status(statusCode).json({ error: err.message || "Server error." });
    }
    return res.status(statusCode).send(err.message || "Server error.");
  });

  const PORT = process.env.PORT || 3000;

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Queue overlay running on http://0.0.0.0:${PORT}/queue.html`);
  });
}

module.exports = { startQueueServer };
