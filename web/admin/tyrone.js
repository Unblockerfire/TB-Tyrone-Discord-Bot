const settingsForm = document.getElementById("settingsForm");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const refreshStateButton = document.getElementById("refreshStateButton");
const logoutButton = document.getElementById("logoutButton");
const addFaqButton = document.getElementById("addFaqButton");
const addCorrectionButton = document.getElementById("addCorrectionButton");
const faqList = document.getElementById("faqList");
const correctionsList = document.getElementById("correctionsList");
const overviewGrid = document.getElementById("overviewGrid");
const cacheCount = document.getElementById("cacheCount");
const cacheAgeText = document.getElementById("cacheAgeText");
const cacheEntries = document.getElementById("cacheEntries");
const eventsList = document.getElementById("eventsList");
const clearCacheButton = document.getElementById("clearCacheButton");
const chatForm = document.getElementById("chatForm");
const chatHistory = document.getElementById("chatHistory");
const heroStatus = document.getElementById("heroStatus");
const heroMeta = document.getElementById("heroMeta");
const seenChatList = document.getElementById("seenChatList");
const responsesList = document.getElementById("responsesList");
const memoryGrid = document.getElementById("memoryGrid");
const reportsList = document.getElementById("reportsList");
const pageNotice = document.getElementById("pageNotice");
const overviewWindow = document.getElementById("overviewWindow");
const overviewWindowBackdrop = document.getElementById("overviewWindowBackdrop");
const overviewWindowTitle = document.getElementById("overviewWindowTitle");
const overviewWindowSummary = document.getElementById("overviewWindowSummary");
const overviewWindowCards = document.getElementById("overviewWindowCards");
const closeOverviewWindowButton = document.getElementById("closeOverviewWindowButton");

let currentState = null;
let localChatHistory = [];
const overviewSummaryCache = new Map();

function setButtonBusy(button, busy, busyText = null) {
  if (!button) return;
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy && busyText ? busyText : button.dataset.originalText;
}

function showNotice(message, kind = "loading") {
  pageNotice.textContent = message;
  pageNotice.className = `notice notice-${kind}`;
}

function formatDate(ts) {
  if (!ts) return "Unknown";
  return new Date(ts).toLocaleString();
}

function humanizeOrigin(origin) {
  return origin === "stored" ? "saved override" : "env/default";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emptyState(message) {
  return `<div class="empty">${escapeHtml(message)}</div>`;
}

function cleanSummaryText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, match => match.replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (res.status === 401) {
    window.location.href = "/admin/tyrone/login";
    throw new Error("Authentication required.");
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }

  return payload;
}

function fillSettings(settings, origins) {
  for (const [key, value] of Object.entries(settings)) {
    const field = settingsForm.elements.namedItem(key);
    if (!field) continue;

    if (field.type === "checkbox") {
      field.checked = !!value;
    } else if (Array.isArray(value)) {
      field.value = value.join("\n");
    } else if (value === null || value === undefined) {
      field.value = "";
    } else {
      field.value = String(value);
    }
  }

  [
    "channel_id",
    "allowed_role_id",
    "issues_channel_id",
    "owner_user_id"
  ].forEach(key => {
    const pill = document.getElementById(`origin_${key}`);
    if (pill) {
      pill.textContent = humanizeOrigin(origins[key]);
    }
  });
}

function collectSettings() {
  const data = {};
  const formData = new FormData(settingsForm);

  for (const [key, value] of formData.entries()) {
    data[key] = value;
  }

  [
    "enabled",
    "ignore_owner_messages",
    "direct_command_enabled",
    "mention_reply_enabled",
    "soft_intercept_enabled"
  ].forEach(name => {
    data[name] = !!settingsForm.elements.namedItem(name).checked;
  });

  data.ignore_keywords = String(data.ignore_keywords || "")
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);

  return data;
}

function buildOverviewModalData(key) {
  if (!currentState) {
    return {
      title: "Overview",
      summaryInput: "Dashboard state is still loading.",
      cards: []
    };
  }

  const settings = currentState.settings || {};
  const cardMap = {
    enabled: {
      title: "Enabled",
      summaryInput: `Tyrone enabled: ${settings.enabled ? "yes" : "no"}.`,
      cards: [
        { title: "Enabled", body: settings.enabled ? "Tyrone is currently active and able to answer." : "Tyrone is currently disabled." },
        { title: "Direct command", body: settings.direct_command_enabled ? "The !tyrone command path is enabled." : "The !tyrone command path is disabled." },
        { title: "Mention replies", body: settings.mention_reply_enabled ? "Mention replies are enabled." : "Mention replies are disabled." },
        { title: "Soft intercept", body: settings.soft_intercept_enabled ? "Soft intercept nags are enabled." : "Soft intercept nags are disabled." }
      ]
    },
    openai: {
      title: "OpenAI",
      summaryInput: JSON.stringify({
        configured: currentState.overview.openai_configured,
        model: settings.openai_model,
        cache_rows: currentState.cache.count,
        response_logs: currentState.response_logs.slice(0, 5).map(row => ({ path: row.path, created_at: row.created_at }))
      }, null, 2),
      cards: [
        { title: "Configured", body: currentState.overview.openai_configured ? "OpenAI is configured." : "OpenAI is not configured." },
        { title: "Model", body: settings.openai_model || "No model set." },
        { title: "Recent AI answers", body: currentState.response_logs.filter(row => row.path === "ai").slice(0, 5).map(row => row.prompt_text).join("\n\n") || "No recent AI answers logged." }
      ]
    },
    faq: {
      title: "FAQ Entries",
      summaryInput: JSON.stringify(currentState.faqs.slice(0, 12), null, 2),
      cards: currentState.faqs.map(faq => ({
        title: faq.label || `FAQ ${faq.id}`,
        body: `Patterns:\n${faq.pattern}\n\nAnswer:\n${faq.answer}`
      }))
    },
    corrections: {
      title: "Corrections",
      summaryInput: JSON.stringify(currentState.corrections.slice(0, 12), null, 2),
      cards: currentState.corrections.map(correction => ({
        title: correction.label || `Correction ${correction.id}`,
        body: `Trigger:\n${correction.trigger_text}\n\nResponse:\n${correction.response_text}`
      }))
    },
    reports: {
      title: "Reports Pending",
      summaryInput: JSON.stringify(currentState.reports.filter(report => report.status === "pending" || report.status === "pending_review"), null, 2),
      cards: currentState.reports.map(report => ({
        title: `${report.report_type || "report"} · ${report.status || "unknown"}`,
        body: `Question:\n${report.question_text || "(missing)"}\n\nReply:\n${report.response_text || "(missing)"}\n\nGuess:\n${report.tyrone_guess || "(none)"}`
      }))
    },
    cache: {
      title: "Cache Rows",
      summaryInput: JSON.stringify(currentState.cache.entries || [], null, 2),
      cards: (currentState.cache.entries || []).map(entry => ({
        title: entry.question_key,
        body: `Uses: ${entry.use_count}\n\n${entry.answer}`
      }))
    },
    model: {
      title: "Model",
      summaryInput: `Current model: ${settings.openai_model || "none"}.`,
      cards: [
        { title: "Model", body: settings.openai_model || "No model set." },
        { title: "System prompt", body: settings.system_prompt || "(empty)" },
        { title: "Outro template", body: settings.outro_template || "(empty)" }
      ]
    },
    channel_gate: {
      title: "Channel Gate",
      summaryInput: JSON.stringify({
        channel_id: settings.channel_id,
        seen_messages: currentState.seen_messages.slice(0, 10).map(row => ({
          channel_id: row.channel_id,
          outcome: row.outcome,
          content: row.content
        }))
      }, null, 2),
      cards: [
        { title: "Configured channel", body: settings.channel_id || "All channels are currently allowed." },
        ...currentState.seen_messages.slice(0, 12).map(row => ({
          title: `${row.outcome || "seen"} · ${row.channel_id || "unknown channel"}`,
          body: row.content || "(empty)"
        }))
      ]
    },
    role_gate: {
      title: "Role Gate",
      summaryInput: JSON.stringify({
        allowed_role_id: settings.allowed_role_id,
        recent_seen: currentState.seen_messages.slice(0, 10).map(row => ({ outcome: row.outcome, user_id: row.user_id }))
      }, null, 2),
      cards: [
        { title: "Allowed role", body: settings.allowed_role_id || "No role gate is enforced." },
        ...currentState.seen_messages.slice(0, 12).map(row => ({
          title: `${row.username || row.user_id}`,
          body: `Outcome: ${row.outcome || "seen"}\nChannel: ${row.channel_id || "unknown"}`
        }))
      ]
    },
    issues_channel: {
      title: "Issues Channel",
      summaryInput: JSON.stringify({
        issues_channel_id: settings.issues_channel_id,
        recent_events: currentState.events.filter(event => String(event.kind || "").includes("report")).slice(0, 10)
      }, null, 2),
      cards: [
        { title: "Configured channel", body: settings.issues_channel_id || "No issues channel is set." },
        ...currentState.events.filter(event => String(event.kind || "").includes("report")).slice(0, 10).map(event => ({
          title: event.kind,
          body: JSON.stringify(event.detail || {}, null, 2)
        }))
      ]
    }
  };

  return cardMap[key] || {
    title: "Overview",
    summaryInput: JSON.stringify(currentState, null, 2),
    cards: []
  };
}

async function openOverviewWindow(key) {
  const detail = buildOverviewModalData(key);
  overviewWindowTitle.textContent = detail.title;
  overviewWindowSummary.textContent = "Writing summary...";
  overviewWindowCards.innerHTML = detail.cards.length
    ? detail.cards
        .map(card => `
          <article class="feed-card">
            <div class="feed-title">${escapeHtml(card.title)}</div>
            <div class="feed-block pre">${escapeHtml(card.body)}</div>
          </article>
        `)
        .join("")
    : emptyState("No detailed items yet.");

  overviewWindow.classList.remove("hidden");
  overviewWindow.setAttribute("aria-hidden", "false");

  const cacheKey = `${key}:${detail.summaryInput}`;
  if (overviewSummaryCache.has(cacheKey)) {
    overviewWindowSummary.textContent = cleanSummaryText(overviewSummaryCache.get(cacheKey));
    return;
  }

  try {
    const data = await api("/admin/tyrone/api/rewrite", {
      method: "POST",
      body: {
        purpose: `Write a short admin summary for the Tyrone dashboard section "${detail.title}". Focus on what matters and keep it concise.`,
        text: detail.summaryInput
      }
    });
    const summary = cleanSummaryText(data.rewritten || "No summary available.");
    overviewSummaryCache.set(cacheKey, summary);
    if (overviewWindowTitle.textContent === detail.title) {
      overviewWindowSummary.textContent = summary;
    }
  } catch (err) {
    overviewWindowSummary.textContent = "Summary failed to load. The detail cards below still show the live data.";
  }
}

function closeOverviewWindow() {
  overviewWindow.classList.add("hidden");
  overviewWindow.setAttribute("aria-hidden", "true");
}

function renderOverview(state) {
  const cards = [
    ["Enabled", state.settings.enabled ? "Yes" : "No", "enabled"],
    ["OpenAI", state.overview.openai_configured ? "Configured" : "Missing", "openai"],
    ["FAQ entries", String(state.overview.faq_count), "faq"],
    ["Corrections", String(state.overview.corrections_count), "corrections"],
    ["Reports pending", String(state.overview.reports_pending), "reports"],
    ["Cache rows", String(state.cache.count), "cache"],
    ["Model", state.settings.openai_model || "None", "model"],
    ["Channel gate", state.settings.channel_id || "All channels", "channel_gate"],
    ["Role gate", state.settings.allowed_role_id || "No role gate", "role_gate"],
    ["Issues channel", state.settings.issues_channel_id || "Not set", "issues_channel"]
  ];

  overviewGrid.innerHTML = cards
    .map(([label, value, overviewKey]) => `
      <button type="button" class="overview-card clickable-card" data-overview-key="${overviewKey}">
        <div class="muted">${escapeHtml(label)}</div>
        <strong>${escapeHtml(value)}</strong>
      </button>
    `)
    .join("");

  heroStatus.textContent = state.settings.enabled ? "Tyrone live" : "Tyrone disabled";
  heroMeta.textContent = state.overview.openai_configured
    ? `OpenAI configured. ${state.response_logs.length} recent responses tracked.`
    : "OpenAI missing. FAQ, corrections, and strike helpers still work.";
}

function renderFeedList(container, rows, renderRow, emptyMessage) {
  if (!rows.length) {
    container.innerHTML = emptyState(emptyMessage);
    return;
  }
  container.innerHTML = rows.map(renderRow).join("");
}

function renderCache(cache) {
  cacheCount.textContent = String(cache.count || 0);
  cacheAgeText.textContent = `${currentState.settings.cache_max_age_ms} ms`;

  renderFeedList(
    cacheEntries,
    cache.entries || [],
    entry => `
      <article class="feed-card">
        <div class="entry-head">
          <div class="feed-title mono">${escapeHtml(entry.question_key)}</div>
          <div class="feed-meta">${entry.use_count} use${entry.use_count === 1 ? "" : "s"}</div>
        </div>
        <div class="feed-block pre">${escapeHtml(entry.answer)}</div>
      </article>
    `,
    "No cache entries yet."
  );
}

function renderEvents(events) {
  renderFeedList(
    eventsList,
    events || [],
    event => `
      <article class="feed-card">
        <div class="entry-head">
          <div class="feed-title">${escapeHtml(event.kind)}</div>
          <div class="feed-meta">${formatDate(event.created_at)}</div>
        </div>
        <div class="feed-block mono pre">${escapeHtml(JSON.stringify(event.detail || {}, null, 2))}</div>
      </article>
    `,
    "No Tyrone admin events yet."
  );
}

function renderMemory(memory) {
  const cards = [
    ["Follow-up context", memory.follow_up_context || []],
    ["Pending approvals", memory.pending_approvals || []],
    ["Nag cooldowns", memory.nag_cooldowns || []],
    ["Pending DM feedback", memory.pending_dm_feedback || []]
  ];

  memoryGrid.innerHTML = cards
    .map(([label, items]) => `
      <div class="memory-card">
        <div class="muted">${escapeHtml(label)}</div>
        <strong>${items.length}</strong>
        ${items.length
          ? `<ul>${items
              .slice(0, 5)
              .map(item => `<li class="mono">${escapeHtml(JSON.stringify(item))}</li>`)
              .join("")}</ul>`
          : '<div class="small">Nothing active.</div>'}
      </div>
    `)
    .join("");
}

function renderSeenChat(rows) {
  renderFeedList(
    seenChatList,
    rows || [],
    row => `
      <article class="feed-card">
        <div class="entry-head">
          <div>
            <div class="feed-title">${escapeHtml(row.username || row.user_id)}</div>
            <div class="feed-meta">${escapeHtml(row.channel_id || "unknown channel")} · ${formatDate(row.created_at)}</div>
          </div>
          <span class="status-pill">${escapeHtml(row.outcome || "seen")}</span>
        </div>
        <div class="feed-block pre">${escapeHtml(row.content || "(no content)")}</div>
      </article>
    `,
    "No seen-message logs yet."
  );
}

function renderResponses(rows) {
  renderFeedList(
    responsesList,
    rows || [],
    row => `
      <article class="feed-card">
        <div class="entry-head">
          <div>
            <div class="feed-title">${escapeHtml(row.username || row.user_id)}</div>
            <div class="feed-meta">${formatDate(row.created_at)}</div>
          </div>
          <span class="path-pill">${escapeHtml(row.path || "unknown")}</span>
        </div>
        <div class="feed-block">
          <div class="small">Prompt</div>
          <div class="pre">${escapeHtml(row.prompt_text || "(missing)")}</div>
        </div>
        <div class="feed-block">
          <div class="small">Reply</div>
          <div class="pre">${escapeHtml(row.response_text || "(missing)")}</div>
        </div>
        <div class="entry-actions">
          <button type="button" class="ghost-button mini-button response-to-correction" data-prompt="${escapeHtml(row.prompt_text || "")}" data-reply="${escapeHtml(row.response_text || "")}" data-log-id="${row.id}">Use this answer next time</button>
          <button type="button" class="ghost-button mini-button response-to-faq" data-prompt="${escapeHtml(row.prompt_text || "")}" data-reply="${escapeHtml(row.response_text || "")}">Create FAQ from this</button>
        </div>
      </article>
    `,
    "No Tyrone responses logged yet."
  );
}

function buildFaqCard(faq = null) {
  const article = document.createElement("article");
  article.className = "stack-card";
  if (faq?.id) article.dataset.id = faq.id;
  article.innerHTML = `
    <div class="form-grid">
      <label>
        <span>Label</span>
        <input type="text" name="label" value="${escapeHtml(faq?.label || "")}" />
      </label>
      <label>
        <span>Match type</span>
        <select name="match_type">
          <option value="includes"${faq?.match_type === "includes" || !faq ? " selected" : ""}>Includes</option>
          <option value="exact"${faq?.match_type === "exact" ? " selected" : ""}>Exact</option>
        </select>
      </label>
      <label>
        <span>Sort order</span>
        <input type="number" name="sort_order" value="${faq?.sort_order || 0}" />
      </label>
      <label class="toggle tile">
        <input type="checkbox" name="enabled" ${faq?.enabled !== false ? "checked" : ""} />
        <span>Enabled</span>
      </label>
      <label class="full">
        <span>Patterns</span>
        <textarea name="pattern" rows="4">${escapeHtml(faq?.pattern || "")}</textarea>
      </label>
      <label class="full">
        <span class="field-header">
          <span>Answer</span>
          <button type="button" class="ghost-button mini-button faq-improve">Improve with AI</button>
        </span>
        <textarea name="answer" rows="5">${escapeHtml(faq?.answer || "")}</textarea>
      </label>
    </div>
    <div class="form-actions">
      <button type="button" class="faq-save">Save FAQ</button>
      <button type="button" class="danger-button faq-delete">Delete</button>
    </div>
  `;

  const answerField = article.querySelector('textarea[name="answer"]');

  article.querySelector(".faq-improve").addEventListener("click", async event => {
    await handleImproveRequest(event.currentTarget, answerField, "faq answer");
  });

  article.querySelector(".faq-save").addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, "Saving...");
      const payload = {
        label: article.querySelector('input[name="label"]').value,
        match_type: article.querySelector('select[name="match_type"]').value,
        sort_order: Number(article.querySelector('input[name="sort_order"]').value || 0),
        enabled: article.querySelector('input[name="enabled"]').checked,
        pattern: article.querySelector('textarea[name="pattern"]').value,
        answer: article.querySelector('textarea[name="answer"]').value
      };
      const id = article.dataset.id;
      if (id) {
        await api(`/admin/tyrone/api/faq/${id}`, { method: "POST", body: payload });
      } else {
        await api("/admin/tyrone/api/faq", { method: "POST", body: payload });
      }
      showNotice("FAQ saved.", "success");
      await loadState();
    } catch (err) {
      showNotice(err.message, "error");
    } finally {
      setButtonBusy(button, false);
    }
  });

  article.querySelector(".faq-delete").addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!article.dataset.id) {
      article.remove();
      return;
    }

    if (!window.confirm("Delete this FAQ entry?")) return;

    try {
      setButtonBusy(button, true, "Deleting...");
      await api(`/admin/tyrone/api/faq/${article.dataset.id}/delete`, { method: "POST", body: {} });
      showNotice("FAQ deleted.", "success");
      await loadState();
    } catch (err) {
      showNotice(err.message, "error");
    } finally {
      setButtonBusy(button, false);
    }
  });

  return article;
}

function renderFaqs(faqs) {
  faqList.innerHTML = "";
  if (!faqs.length) {
    faqList.innerHTML = emptyState("No FAQ entries yet.");
    return;
  }
  faqs.forEach(faq => faqList.appendChild(buildFaqCard(faq)));
}

function buildCorrectionCard(correction = null) {
  const article = document.createElement("article");
  article.className = "stack-card";
  if (correction?.id) article.dataset.id = correction.id;
  article.innerHTML = `
    <div class="form-grid">
      <label>
        <span>Label</span>
        <input type="text" name="label" value="${escapeHtml(correction?.label || "")}" />
      </label>
      <label>
        <span>Sort order</span>
        <input type="number" name="sort_order" value="${correction?.sort_order || 0}" />
      </label>
      <label class="toggle tile">
        <input type="checkbox" name="enabled" ${correction?.enabled !== false ? "checked" : ""} />
        <span>Enabled</span>
      </label>
      <label>
        <span>Source response log ID</span>
        <input type="number" name="source_response_log_id" value="${correction?.source_response_log_id || ""}" />
      </label>
      <label class="full">
        <span>Trigger text</span>
        <textarea name="trigger_text" rows="3">${escapeHtml(correction?.trigger_text || "")}</textarea>
      </label>
      <label class="full">
        <span class="field-header">
          <span>Response text</span>
          <button type="button" class="ghost-button mini-button correction-improve">Improve with AI</button>
        </span>
        <textarea name="response_text" rows="5">${escapeHtml(correction?.response_text || "")}</textarea>
      </label>
      <label class="full">
        <span>Notes</span>
        <textarea name="notes" rows="3">${escapeHtml(correction?.notes || "")}</textarea>
      </label>
    </div>
    <div class="form-actions">
      <button type="button" class="correction-save">Save correction</button>
      <button type="button" class="danger-button correction-delete">Delete</button>
    </div>
  `;

  const responseField = article.querySelector('textarea[name="response_text"]');
  article.querySelector(".correction-improve").addEventListener("click", async event => {
    await handleImproveRequest(event.currentTarget, responseField, "correction response");
  });

  article.querySelector(".correction-save").addEventListener("click", async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, "Saving...");
      const payload = {
        label: article.querySelector('input[name="label"]').value,
        trigger_text: article.querySelector('textarea[name="trigger_text"]').value,
        response_text: article.querySelector('textarea[name="response_text"]').value,
        notes: article.querySelector('textarea[name="notes"]').value,
        enabled: article.querySelector('input[name="enabled"]').checked,
        sort_order: Number(article.querySelector('input[name="sort_order"]').value || 0),
        source_response_log_id: article.querySelector('input[name="source_response_log_id"]').value || null
      };
      const id = article.dataset.id;
      if (id) {
        await api(`/admin/tyrone/api/corrections/${id}`, { method: "POST", body: payload });
      } else {
        await api("/admin/tyrone/api/corrections", { method: "POST", body: payload });
      }
      showNotice("Correction saved.", "success");
      await loadState();
    } catch (err) {
      showNotice(err.message, "error");
    } finally {
      setButtonBusy(button, false);
    }
  });

  article.querySelector(".correction-delete").addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!article.dataset.id) {
      article.remove();
      return;
    }
    if (!window.confirm("Delete this correction?")) return;
    try {
      setButtonBusy(button, true, "Deleting...");
      await api(`/admin/tyrone/api/corrections/${article.dataset.id}/delete`, { method: "POST", body: {} });
      showNotice("Correction deleted.", "success");
      await loadState();
    } catch (err) {
      showNotice(err.message, "error");
    } finally {
      setButtonBusy(button, false);
    }
  });

  return article;
}

function renderCorrections(corrections) {
  correctionsList.innerHTML = "";
  if (!corrections.length) {
    correctionsList.innerHTML = emptyState("No correction rules yet.");
    return;
  }
  corrections.forEach(correction => correctionsList.appendChild(buildCorrectionCard(correction)));
}

function renderReports(reports) {
  renderFeedList(
    reportsList,
    reports || [],
    report => `
      <article class="stack-card">
        <div class="entry-head">
          <div>
            <div class="feed-title">${escapeHtml(report.reporter_username || report.reporter_user_id)}</div>
            <div class="feed-meta">${escapeHtml(report.report_type || "unknown")} · ${formatDate(report.created_at)}</div>
          </div>
          <span class="status-pill">${escapeHtml(report.status || "pending")}</span>
        </div>
        <div class="feed-block">
          <div class="small">Question</div>
          <div class="pre">${escapeHtml(report.question_text || "(missing)")}</div>
        </div>
        <div class="feed-block">
          <div class="small">Tyrone response</div>
          <div class="pre">${escapeHtml(report.response_text || "(missing)")}</div>
        </div>
        <div class="feed-block">
          <div class="small">Tyrone guess</div>
          <div class="pre">${escapeHtml(report.tyrone_guess || "(none)")}</div>
        </div>
        <label class="full">
          <span>Admin reason / corrected answer</span>
          <textarea rows="3" data-report-reason="${report.id}">${escapeHtml(report.admin_resolution || report.user_feedback || "")}</textarea>
        </label>
        <div class="report-actions">
          <button type="button" class="ghost-button mini-button report-action" data-action="approve_guess" data-id="${report.id}">Approve guess</button>
          <button type="button" class="ghost-button mini-button report-action" data-action="save_reason" data-id="${report.id}">Save reason</button>
          <button type="button" class="ghost-button mini-button report-action" data-action="create_correction" data-id="${report.id}">Make correction</button>
          <button type="button" class="ghost-button mini-button report-action" data-action="create_faq" data-id="${report.id}">Make FAQ</button>
          <button type="button" class="danger-button mini-button report-action" data-action="dismiss" data-id="${report.id}">Dismiss</button>
        </div>
      </article>
    `,
    "No feedback reports yet."
  );
}

function renderChatHistory() {
  renderFeedList(
    chatHistory,
    localChatHistory,
    entry => `
      <article class="feed-card">
        <div class="entry-head">
          <div>
            <div class="feed-title">${escapeHtml(entry.query)}</div>
            <div class="feed-meta">${formatDate(entry.createdAt)}</div>
          </div>
          <span class="path-pill">${escapeHtml(entry.path || "unknown")}</span>
        </div>
        <div class="feed-block">
          <div class="small">Tyrone reply</div>
          <div class="pre">${escapeHtml(entry.reply || "(empty)")}</div>
        </div>
        <div class="feed-block mono pre">${escapeHtml(JSON.stringify(entry.memory || {}, null, 2))}</div>
        <div class="entry-actions">
          <button type="button" class="ghost-button mini-button chat-to-correction" data-index="${entry.index}">Use this answer next time</button>
          <button type="button" class="ghost-button mini-button chat-rewrite" data-index="${entry.index}">Rewrite this answer with AI</button>
          <button type="button" class="ghost-button mini-button chat-to-faq" data-index="${entry.index}">Create FAQ from this</button>
        </div>
      </article>
    `,
    "No dashboard chat yet."
  );
}

function prependChatEntry(result) {
  localChatHistory.unshift({
    index: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: Date.now(),
    ...result
  });
  localChatHistory = localChatHistory.slice(0, 30);
  renderChatHistory();
}

async function handleImproveRequest(button, field, purpose) {
  try {
    setButtonBusy(button, true, "Rewriting...");
    const data = await api("/admin/tyrone/api/rewrite", {
      method: "POST",
      body: {
        text: field.value,
        purpose
      }
    });
    field.value = data.rewritten || field.value;
    showNotice(`AI rewrite applied for ${purpose}. Save when ready.`, "success");
  } catch (err) {
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function loadState() {
  showNotice("Loading Tyrone dashboard...", "loading");
  const state = await api("/admin/tyrone/api/state");
  currentState = state;
  fillSettings(state.settings, state.setting_origins || {});
  renderOverview(state);
  renderFaqs(state.faqs || []);
  renderCorrections(state.corrections || []);
  renderCache(state.cache || { count: 0, entries: [] });
  renderEvents(state.events || []);
  renderSeenChat(state.seen_messages || []);
  renderResponses(state.response_logs || []);
  renderMemory(state.memory || {});
  renderReports(state.reports || []);
  if (!localChatHistory.length && (state.response_logs || []).length) {
    localChatHistory = state.response_logs
      .filter(row => row.source_type === "dashboard")
      .slice(0, 10)
      .map(row => ({
        index: `seed-${row.id}`,
        createdAt: row.created_at,
        query: row.prompt_text,
        reply: row.response_text,
        path: row.path,
        memory: row.detail?.memory || {}
      }));
    renderChatHistory();
  } else {
    renderChatHistory();
  }
  showNotice("Dashboard loaded.", "success");
}

saveSettingsButton.addEventListener("click", async () => {
  try {
    setButtonBusy(saveSettingsButton, true, "Saving...");
    await api("/admin/tyrone/api/settings", {
      method: "POST",
      body: collectSettings()
    });
    await loadState();
  } catch (err) {
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(saveSettingsButton, false);
  }
});

refreshStateButton.addEventListener("click", async () => {
  try {
    setButtonBusy(refreshStateButton, true, "Refreshing...");
    await loadState();
  } catch (err) {
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(refreshStateButton, false);
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    setButtonBusy(logoutButton, true, "Logging out...");
    await api("/admin/tyrone/logout", { method: "POST", body: {} });
    window.location.href = "/admin/tyrone/login";
  } catch (err) {
    showNotice(err.message, "error");
    setButtonBusy(logoutButton, false);
  }
});

addFaqButton.addEventListener("click", () => {
  if (faqList.querySelector(".empty")) faqList.innerHTML = "";
  faqList.prepend(buildFaqCard(null));
});

addCorrectionButton.addEventListener("click", () => {
  if (correctionsList.querySelector(".empty")) correctionsList.innerHTML = "";
  correctionsList.prepend(buildCorrectionCard(null));
});

clearCacheButton.addEventListener("click", async () => {
  if (!window.confirm("Clear all Tyrone cache entries?")) return;
  try {
    setButtonBusy(clearCacheButton, true, "Clearing...");
    await api("/admin/tyrone/api/cache/clear", { method: "POST", body: {} });
    showNotice("Cache cleared.", "success");
    await loadState();
  } catch (err) {
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(clearCacheButton, false);
  }
});

chatForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("chatSendButton");
  const formData = new FormData(chatForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    setButtonBusy(button, true, "Sending...");
    const data = await api("/admin/tyrone/api/chat", {
      method: "POST",
      body: payload
    });
    prependChatEntry(data.result || {});
    showNotice("Tyrone chat response loaded.", "success");
    await loadState();
  } catch (err) {
    showNotice(err.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
});

document.addEventListener("click", async event => {
  const overviewButton = event.target.closest("[data-overview-key]");
  if (overviewButton && overviewButton.dataset.overviewKey) {
    await openOverviewWindow(overviewButton.dataset.overviewKey);
    return;
  }

  const targetButton = event.target.closest("[data-target]");
  if (targetButton && targetButton.dataset.target) {
    const target = document.getElementById(targetButton.dataset.target);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const improveButton = event.target.closest(".improve-button");
  if (improveButton) {
    const field = settingsForm.elements.namedItem(improveButton.dataset.field);
    if (field) {
      await handleImproveRequest(improveButton, field, improveButton.dataset.purpose || "dashboard text");
    }
    return;
  }

  const responseCorrection = event.target.closest(".response-to-correction");
  if (responseCorrection) {
    const card = buildCorrectionCard({
      trigger_text: responseCorrection.dataset.prompt || "",
      response_text: responseCorrection.dataset.reply || "",
      source_response_log_id: responseCorrection.dataset.logId || ""
    });
    correctionsList.prepend(card);
    document.getElementById("correctionsSection").scrollIntoView({ behavior: "smooth" });
    showNotice("Correction draft added from response history.", "success");
    return;
  }

  const responseFaq = event.target.closest(".response-to-faq");
  if (responseFaq) {
    const card = buildFaqCard({
      pattern: responseFaq.dataset.prompt || "",
      answer: responseFaq.dataset.reply || ""
    });
    faqList.prepend(card);
    document.getElementById("faqSection").scrollIntoView({ behavior: "smooth" });
    showNotice("FAQ draft added from response history.", "success");
    return;
  }

  const chatCorrection = event.target.closest(".chat-to-correction");
  if (chatCorrection) {
    const item = localChatHistory.find(entry => entry.index === chatCorrection.dataset.index);
    if (!item) return;
    correctionsList.prepend(buildCorrectionCard({
      trigger_text: item.query,
      response_text: item.reply,
      source_response_log_id: item.responseLogId || ""
    }));
    document.getElementById("correctionsSection").scrollIntoView({ behavior: "smooth" });
    showNotice("Correction draft created from dashboard chat.", "success");
    return;
  }

  const chatFaq = event.target.closest(".chat-to-faq");
  if (chatFaq) {
    const item = localChatHistory.find(entry => entry.index === chatFaq.dataset.index);
    if (!item) return;
    faqList.prepend(buildFaqCard({
      pattern: item.query,
      answer: item.reply
    }));
    document.getElementById("faqSection").scrollIntoView({ behavior: "smooth" });
    showNotice("FAQ draft created from dashboard chat.", "success");
    return;
  }

  const chatRewrite = event.target.closest(".chat-rewrite");
  if (chatRewrite) {
    const item = localChatHistory.find(entry => entry.index === chatRewrite.dataset.index);
    if (!item) return;
    try {
      setButtonBusy(chatRewrite, true, "Rewriting...");
      const data = await api("/admin/tyrone/api/rewrite", {
        method: "POST",
        body: {
          text: item.reply,
          purpose: "dashboard chat response rewrite"
        }
      });
      item.reply = data.rewritten || item.reply;
      renderChatHistory();
      showNotice("Rewritten reply added to dashboard chat history.", "success");
    } catch (err) {
      showNotice(err.message, "error");
    } finally {
      setButtonBusy(chatRewrite, false);
    }
    return;
  }

  const reportAction = event.target.closest(".report-action");
  if (reportAction) {
    const id = reportAction.dataset.id;
    const action = reportAction.dataset.action;
    const reasonField = document.querySelector(`[data-report-reason="${id}"]`);
    const adminReason = reasonField ? reasonField.value.trim() : "";
    try {
      setButtonBusy(reportAction, true, "Saving...");
      await api(`/admin/tyrone/api/reports/${id}`, {
        method: "POST",
        body: {
          action,
          admin_reason: adminReason,
          response_text: adminReason,
          answer: adminReason
        }
      });
      showNotice(`Report action "${action}" saved.`, "success");
      await loadState();
    } catch (err) {
      showNotice(err.message, "error");
    } finally {
      setButtonBusy(reportAction, false);
    }
  }
});

closeOverviewWindowButton.addEventListener("click", closeOverviewWindow);
overviewWindowBackdrop.addEventListener("click", closeOverviewWindow);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !overviewWindow.classList.contains("hidden")) {
    closeOverviewWindow();
  }
});

loadState().catch(err => {
  heroStatus.textContent = "Dashboard error";
  heroMeta.textContent = err.message;
  showNotice(err.message, "error");
});
