const settingsForm = document.getElementById("settingsForm");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const refreshStateButton = document.getElementById("refreshStateButton");
const addFaqButton = document.getElementById("addFaqButton");
const faqList = document.getElementById("faqList");
const overviewGrid = document.getElementById("overviewGrid");
const cacheCount = document.getElementById("cacheCount");
const cacheEntries = document.getElementById("cacheEntries");
const eventsList = document.getElementById("eventsList");
const clearCacheButton = document.getElementById("clearCacheButton");
const testForm = document.getElementById("testForm");
const testResult = document.getElementById("testResult");
const faqTemplate = document.getElementById("faqTemplate");
const heroStatus = document.getElementById("heroStatus");
const heroMeta = document.getElementById("heroMeta");

let currentState = null;

function setButtonBusy(button, busy, text = null) {
  button.disabled = busy;
  if (text) {
    button.dataset.originalText = button.dataset.originalText || button.textContent;
    button.textContent = busy ? text : button.dataset.originalText;
  }
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

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }

  return payload;
}

function fillSettings(settings) {
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
}

function collectSettings() {
  const data = {};
  const formData = new FormData(settingsForm);

  for (const [key, value] of formData.entries()) {
    data[key] = value;
  }

  for (const name of [
    "enabled",
    "ignore_owner_messages",
    "direct_command_enabled",
    "mention_reply_enabled",
    "soft_intercept_enabled"
  ]) {
    data[name] = !!settingsForm.elements.namedItem(name).checked;
  }

  data.ignore_keywords = String(data.ignore_keywords || "")
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);

  return data;
}

function renderOverview(state) {
  const cards = [
    ["Enabled", state.settings.enabled ? "Yes" : "No"],
    ["OpenAI", state.overview.openai_configured ? "Configured" : "Missing"],
    ["FAQ entries", String(state.overview.faq_count)],
    ["Cache rows", String(state.cache.count)],
    ["Model", state.settings.openai_model || "None"],
    ["Channel gate", state.settings.channel_id || "All channels"],
    ["Role gate", state.settings.allowed_role_id || "No role gate"],
    ["Issues channel", state.settings.issues_channel_id || "Not set"],
    ["Owner ignore", state.settings.ignore_owner_messages ? "Enabled" : "Disabled"],
    ["Auto nag delay", `${state.settings.auto_nag_delay_ms} ms`]
  ];

  overviewGrid.innerHTML = cards
    .map(([label, value]) =>
      `<div class="overview-card"><div class="muted">${label}</div><strong>${value}</strong></div>`
    )
    .join("");

  heroStatus.textContent = state.settings.enabled ? "Tyrone live" : "Tyrone disabled";
  heroMeta.textContent = state.overview.openai_configured
    ? `OpenAI configured. ${state.cache.count} cache row${state.cache.count === 1 ? "" : "s"} loaded.`
    : "OpenAI secret missing. FAQ and strike helpers still work.";
}

function renderCache(entries) {
  cacheCount.textContent = String(currentState.cache.count || 0);

  if (!entries.length) {
    cacheEntries.innerHTML = '<div class="muted">No cache entries yet.</div>';
    return;
  }

  cacheEntries.innerHTML = entries
    .map(entry => `
      <div class="cache-entry">
        <div><strong>${entry.question_key}</strong></div>
        <div class="muted">Used ${entry.use_count} time${entry.use_count === 1 ? "" : "s"}</div>
        <code>${entry.answer}</code>
      </div>
    `)
    .join("");
}

function formatDate(ts) {
  if (!ts) return "Unknown";
  return new Date(ts).toLocaleString();
}

function renderEvents(events) {
  if (!events.length) {
    eventsList.innerHTML = '<div class="muted">No recent Tyrone admin events.</div>';
    return;
  }

  eventsList.innerHTML = events
    .map(event => `
      <div class="event-card">
        <strong>${event.kind}</strong>
        <div class="muted">${event.detail ? JSON.stringify(event.detail) : "No extra detail"}</div>
        <time>${formatDate(event.created_at)}</time>
      </div>
    `)
    .join("");
}

function buildFaqCard(faq = null) {
  const node = faqTemplate.content.firstElementChild.cloneNode(true);

  if (faq) {
    node.dataset.id = faq.id;
    node.elements.label.value = faq.label || "";
    node.elements.match_type.value = faq.match_type || "includes";
    node.elements.sort_order.value = faq.sort_order || 0;
    node.elements.enabled.checked = !!faq.enabled;
    node.elements.pattern.value = faq.pattern || "";
    node.elements.answer.value = faq.answer || "";
  } else {
    node.elements.enabled.checked = true;
    node.elements.sort_order.value = currentState ? currentState.faqs.length * 10 + 10 : 10;
  }

  node.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      label: node.elements.label.value,
      match_type: node.elements.match_type.value,
      sort_order: Number(node.elements.sort_order.value || 0),
      enabled: node.elements.enabled.checked,
      pattern: node.elements.pattern.value,
      answer: node.elements.answer.value
    };

    try {
      const id = node.dataset.id;
      if (id) {
        await api(`/admin/tyrone/api/faq/${id}`, { method: "POST", body: payload });
      } else {
        await api("/admin/tyrone/api/faq", { method: "POST", body: payload });
      }
      await loadState();
    } catch (err) {
      alert(err.message);
    }
  });

  node.querySelector(".faq-delete").addEventListener("click", async () => {
    if (!node.dataset.id) {
      node.remove();
      return;
    }

    if (!window.confirm("Delete this FAQ entry?")) return;

    try {
      await api(`/admin/tyrone/api/faq/${node.dataset.id}/delete`, { method: "POST", body: {} });
      await loadState();
    } catch (err) {
      alert(err.message);
    }
  });

  return node;
}

function renderFaqs(faqs) {
  faqList.innerHTML = "";
  faqs.forEach(faq => faqList.appendChild(buildFaqCard(faq)));
}

async function loadState() {
  const state = await api("/admin/tyrone/api/state");
  currentState = state;
  fillSettings(state.settings);
  renderOverview(state);
  renderFaqs(state.faqs);
  renderCache(state.cache.entries || []);
  renderEvents(state.events || []);
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
    alert(err.message);
  } finally {
    setButtonBusy(saveSettingsButton, false);
  }
});

refreshStateButton.addEventListener("click", () => {
  loadState().catch(err => alert(err.message));
});

addFaqButton.addEventListener("click", () => {
  faqList.prepend(buildFaqCard(null));
});

clearCacheButton.addEventListener("click", async () => {
  if (!window.confirm("Clear all Tyrone cache entries?")) return;

  try {
    setButtonBusy(clearCacheButton, true, "Clearing...");
    await api("/admin/tyrone/api/cache/clear", { method: "POST", body: {} });
    await loadState();
  } catch (err) {
    alert(err.message);
  } finally {
    setButtonBusy(clearCacheButton, false);
  }
});

testForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(testForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    setButtonBusy(document.getElementById("runTestButton"), true, "Running...");
    const data = await api("/admin/tyrone/api/test-response", {
      method: "POST",
      body: payload
    });

    const result = data.result || {};
    testResult.className = "result-box";
    testResult.textContent =
      `Path: ${result.path || "unknown"}\n\n` +
      `${result.reply || "No reply returned."}`;
    await loadState();
  } catch (err) {
    testResult.className = "result-box";
    testResult.textContent = err.message;
  } finally {
    setButtonBusy(document.getElementById("runTestButton"), false);
  }
});

loadState().catch(err => {
  heroStatus.textContent = "Dashboard error";
  heroMeta.textContent = err.message;
});
