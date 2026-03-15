const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");
const loginNotice = document.getElementById("loginNotice");

function setBusy(busy) {
  loginButton.disabled = busy;
  loginButton.textContent = busy ? "Signing in..." : "Open dashboard";
}

function setNotice(message, isError = false) {
  loginNotice.textContent = message;
  loginNotice.className = isError ? "notice error" : "notice";
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    setBusy(true);
    setNotice("Checking credentials...");

    const res = await fetch("/admin/tyrone/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Login failed.");
    }

    window.location.href = "/admin/tyrone";
  } catch (err) {
    setNotice(err.message, true);
    setBusy(false);
  }
});
