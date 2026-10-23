(() => {
  const $ = s => document.querySelector(s);
  const welcome = $("#welcome"), messagesEl = $("#messages"), chatList = $("#chatList");
  const input = $("#messageInput"), form = $("#chatForm"), sendButton = $("#sendButton");
  const charCount = $("#charCount"), toastEl = $("#toast"), sidebar = $("#sidebar");
  const settingsDialog = $("#settingsDialog");
  const authDialog = $("#authDialog");
  let chats = [], activeId = null, busy = false, authenticated = false, me = null, toastTimer;

  function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function showToast(message) {
    toastEl.textContent = message; toastEl.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3500);
  }
  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  }
  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      marked.setOptions({ breaks: true, gfm: true });
      return DOMPurify.sanitize(marked.parse(text));
    }
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
  function currentChat() { return chats.find(c => c.id === activeId); }
  function makeTitle(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > 34 ? clean.slice(0, 34).trim() + "…" : clean || "Новый чат";
  }
  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ошибка сервера (${response.status})`);
    return data;
  }
  async function saveChat(chat) {
    if (!authenticated) return;
    await api(`/api/chats/${encodeURIComponent(chat.id)}`, {
      method: "PUT",
      body: JSON.stringify({ title: chat.title, messages: chat.messages })
    });
  }
  async function loadChats() {
    const data = await api("/api/chats");
    chats = Array.isArray(data.chats) ? data.chats.map(c => ({
      id: c.id, title: c.title || "Новый чат",
      messages: Array.isArray(c.messages) ? c.messages : [],
      createdAt: c.created_at
    })) : [];
    activeId = chats[0]?.id || null;
    renderAll();
  }
  function renderAccount() {
    const area = $("#accountArea");
    const welcomeLogin = $("#welcomeGoogleLogin");
    const welcomeLoginText = $("#welcomeLoginText");
    const isLoggedIn = Boolean(authenticated && me?.user);

    if (!isLoggedIn) {
      area.innerHTML = '<button type="button" class="google-button" id="authOpenButton">Авторизация</button>';
      $("#authOpenButton").addEventListener("click", () => authDialog.showModal());
      if (welcomeLogin) {
        welcomeLogin.hidden = false;
        welcomeLogin.onclick = () => { window.location.href = "/auth/google"; };
      }
      if (welcomeLoginText) welcomeLoginText.textContent = "Войди через Google, чтобы сохранять историю чатов.";
      return;
    }

    // Авторизованному пользователю показываем профиль вместо кнопки входа.
    area.innerHTML = '';
    const profile = document.createElement("button");
    profile.type = "button";
    profile.className = "account-chip";
    profile.title = "Открыть профиль";
    if (me.user.picture) {
      const img = document.createElement("img");
      img.src = me.user.picture;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      profile.appendChild(img);
    } else {
      const initial = document.createElement("span");
      initial.className = "account-initial";
      initial.textContent = (me.user.name || me.user.email || "H").slice(0, 1).toUpperCase();
      profile.appendChild(initial);
    }
    const label = document.createElement("span");
    label.className = "account-label";
    label.textContent = "Профиль";
    const arrow = document.createElement("span");
    arrow.textContent = "⌄";
    profile.append(label, arrow);
    profile.addEventListener("click", () => settingsDialog.showModal());
    area.appendChild(profile);
    if (welcomeLogin) welcomeLogin.hidden = true;
    if (welcomeLoginText) welcomeLoginText.textContent = "Рад снова видеть тебя! Твои чаты сохраняются в профиле.";
  }
  function renderChats() {
    chatList.innerHTML = "";
    if (!chats.length) {
      const empty = document.createElement("div");
      empty.className = "empty-chats";
      empty.textContent = authenticated ? "Твои диалоги появятся здесь." : "Войди через Google, чтобы начать.";
      chatList.appendChild(empty); return;
    }
    chats.forEach(chat => {
      const row = document.createElement("div");
      row.className = "chat-item" + (chat.id === activeId ? " active" : "");
      const open = document.createElement("button");
      open.type = "button"; open.className = "chat-open";
      open.innerHTML = '<span class="chat-icon">◌</span><span class="chat-title"></span>';
      open.querySelector(".chat-title").textContent = chat.title || "Новый чат";
      open.addEventListener("click", () => { activeId = chat.id; renderAll(); closeSidebar(); });
      const del = document.createElement("button");
      del.type = "button"; del.className = "delete-chat"; del.textContent = "×"; del.title = "Удалить чат";
      del.addEventListener("click", async e => {
        e.stopPropagation();
        try {
          await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: "DELETE" });
          chats = chats.filter(c => c.id !== chat.id);
          if (activeId === chat.id) activeId = chats[0]?.id || null;
          renderAll(); showToast("Чат удалён.");
        } catch (err) { showToast(err.message); }
      });
      row.append(open, del); chatList.appendChild(row);
    });
  }
  function renderMessages() {
    messagesEl.innerHTML = "";
    const chat = currentChat(), hasMessages = Boolean(chat && chat.messages.length);
    welcome.hidden = hasMessages;
    messagesEl.hidden = !hasMessages;
    if (hasMessages) chat.messages.forEach((message, index) => {
      const article = document.createElement("article");
      article.className = "message " + (message.role === "user" ? "user" : "assistant");
      const avatar = document.createElement("div");
      avatar.className = "message-avatar";
      avatar.textContent = message.role === "user" ? ((me?.user?.name || "Т").slice(0,1).toUpperCase()) : "H";
      const body = document.createElement("div"); body.className = "message-body";
      const name = document.createElement("div"); name.className = "message-name";
      name.textContent = message.role === "user" ? (me?.user?.name || "Ты") : "HollyAI";
      const content = document.createElement("div"); content.className = "message-content";
      content.innerHTML = renderMarkdown(message.content || "");
      body.append(name, content);
      if (message.role === "assistant" && message.content) {
        const actions = document.createElement("div"); actions.className = "message-actions";
        const copy = document.createElement("button"); copy.className = "mini-action"; copy.textContent = "▢ Копировать";
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(message.content); showToast("Ответ скопирован."); }
          catch { showToast("Не удалось скопировать ответ."); }
        });
        actions.appendChild(copy);
        if (index === chat.messages.length - 1 && !busy) {
          const retry = document.createElement("button"); retry.className = "mini-action"; retry.textContent = "↻ Повторить";
          retry.addEventListener("click", retryLast); actions.appendChild(retry);
        }
        body.appendChild(actions);
      }
      article.append(avatar, body); messagesEl.appendChild(article);
    });
    if (busy) {
      const typing = document.createElement("article"); typing.className = "message assistant";
      typing.innerHTML = '<div class="message-avatar">H</div><div class="message-body"><div class="message-name">HollyAI</div><div class="typing-dots"><i></i><i></i><i></i></div></div>';
      messagesEl.appendChild(typing);
    }
    requestAnimationFrame(() => { $("#conversation").scrollTop = $("#conversation").scrollHeight; });
  }
  function renderAll() {
    renderChats(); renderMessages();
    input.disabled = !authenticated || busy;
    sendButton.disabled = !authenticated || busy;
    input.placeholder = authenticated ? "Напиши свой вопрос HollyAI..." : "Сначала войди через Google...";
    $("#newChat").disabled = !authenticated;
    $("#clearHistory").disabled = !authenticated;
  }
  function setBusy(value) {
    busy = value;
    sendButton.innerHTML = value ? "<span>…</span>" : "<span>↑</span>";
    renderAll();
  }
  async function sendMessage(text) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    if (!authenticated) { showToast("Сначала войди через Google."); return; }
    let chat = currentChat();
    if (!chat) {
      chat = { id: uid(), title: makeTitle(prompt), messages: [], createdAt: Date.now() };
      chats.unshift(chat); activeId = chat.id;
    } else if (!chat.messages.length) chat.title = makeTitle(prompt);
    chat.messages.push({ role: "user", content: prompt });
    input.value = ""; resizeInput(); setBusy(true);
    try {
      await saveChat(chat);
      const data = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: chat.messages.slice(-24) })
      });
      chat.messages.push({ role: "assistant", content: data.answer });
      await saveChat(chat);
    } catch (err) {
      chat.messages.push({ role: "assistant", content: "⚠️ " + err.message });
      try { await saveChat(chat); } catch (saveErr) { showToast(saveErr.message); }
    } finally { setBusy(false); input.focus(); }
  }
  async function retryLast() {
    const chat = currentChat();
    if (!chat || busy) return;
    if (chat.messages.at(-1)?.role === "assistant") chat.messages.pop();
    if (chat.messages.at(-1)?.role !== "user") return;
    setBusy(true);
    try {
      const data = await api("/api/chat", { method: "POST", body: JSON.stringify({ messages: chat.messages.slice(-24) }) });
      chat.messages.push({ role: "assistant", content: data.answer });
      await saveChat(chat);
    } catch (err) {
      chat.messages.push({ role: "assistant", content: "⚠️ " + err.message });
      try { await saveChat(chat); } catch {}
    } finally { setBusy(false); }
  }
  function resizeInput() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
    charCount.textContent = `${input.value.length} / 12000`;
  }
  function closeSidebar() { sidebar.classList.remove("open"); }
  async function init() {
    const params = new URLSearchParams(location.search);
    if (params.get("auth") === "failed") showToast("Не удалось войти через Google. Проверь OAuth-настройки.");
    if (params.get("auth") === "not_configured") showToast("Вход через Google ещё не настроен.");
    if (params.has("auth")) history.replaceState({}, "", "/");
    try {
      me = await api("/api/me");
      authenticated = Boolean(me.authenticated);
      renderAccount();
      if (authenticated) {
        await loadChats();
      } else {
        chats = []; activeId = null; renderAll();
      }
      if (!me.googleConfigured) showToast("Нужно настроить Google OAuth в переменных Render.");
      else if (!me.databaseReady) showToast("База данных не подключена. История не сможет сохраняться.");
    } catch (err) {
      renderAccount(); renderAll(); showToast(err.message);
    }
    const health = await fetch("/api/health").then(r => r.json()).catch(() => null);
    if (health) {
      const pill = document.querySelector(".model-name");
      pill.textContent = health.aiConfigured ? health.model : "нужна настройка API";
    }
  }
  form.addEventListener("submit", e => { e.preventDefault(); sendMessage(input.value); });
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  $("#newChat").addEventListener("click", () => {
    if (!authenticated) return showToast("Сначала войди через Google.");
    activeId = null; renderAll(); input.focus(); closeSidebar();
  });
  $("#openSidebar").addEventListener("click", () => sidebar.classList.add("open"));
  $("#closeSidebar").addEventListener("click", closeSidebar);
  $("#settingsButton").addEventListener("click", () => settingsDialog.showModal());
  $("#googleAuthChoice").addEventListener("click", () => { window.location.href = "/auth/google"; });
  $("#clearHistory").addEventListener("click", async () => {
    if (!authenticated) return;
    if (!confirm("Удалить все чаты из твоего аккаунта? Это действие нельзя отменить.")) return;
    try {
      await Promise.all(chats.map(c => api(`/api/chats/${encodeURIComponent(c.id)}`, { method: "DELETE" })));
      chats = []; activeId = null; renderAll(); settingsDialog.close(); showToast("История удалена.");
    } catch (err) { showToast(err.message); }
  });
  $("#logoutButton").addEventListener("click", async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      location.href = "/";
    } catch (err) { showToast(err.message); }
  });
  document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => sendMessage(button.dataset.prompt)));
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (authenticated) { activeId = null; renderAll(); input.focus(); } }
    if (e.key === "Escape") closeSidebar();
  });
  init();
  resizeInput();
})();
