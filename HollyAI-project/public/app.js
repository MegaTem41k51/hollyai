(() => {
  const $ = (selector) => document.querySelector(selector);
  const STORAGE_KEY = "hollyai_chats_v1";
  const ACTIVE_KEY = "hollyai_active_chat_v1";
  const welcome = $("#welcome");
  const messagesEl = $("#messages");
  const chatList = $("#chatList");
  const input = $("#messageInput");
  const form = $("#chatForm");
  const sendButton = $("#sendButton");
  const charCount = $("#charCount");
  const toastEl = $("#toast");
  const sidebar = $("#sidebar");
  const settingsDialog = $("#settingsDialog");

  let chats = loadChats();
  let activeId = localStorage.getItem(ACTIVE_KEY);
  let busy = false;
  let toastTimer;

  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  }
  function loadChats() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(c => c && c.id && Array.isArray(c.messages)) : [];
    } catch { return []; }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch { showToast("Не удалось сохранить историю в браузере."); }
  }
  function currentChat() { return chats.find(c => c.id === activeId); }
  function makeTitle(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > 34 ? clean.slice(0, 34).trim() + "…" : clean || "Новый чат";
  }
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3000);
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
  function renderChats() {
    chatList.innerHTML = "";
    if (!chats.length) {
      const empty = document.createElement("div");
      empty.className = "empty-chats";
      empty.textContent = "Твои новые диалоги появятся здесь.";
      chatList.appendChild(empty);
      return;
    }
    [...chats].reverse().forEach(chat => {
      const row = document.createElement("div");
      row.className = "chat-item" + (chat.id === activeId ? " active" : "");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "chat-item";
      open.style.cssText = "padding:0;background:transparent;flex:1;min-width:0;color:inherit";
      open.innerHTML = '<span class="chat-icon">◌</span><span class="chat-title"></span>';
      open.querySelector(".chat-title").textContent = chat.title || "Новый чат";
      open.addEventListener("click", () => { activeId = chat.id; persist(); renderAll(); closeSidebar(); });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "delete-chat";
      del.textContent = "×";
      del.title = "Удалить чат";
      del.setAttribute("aria-label", "Удалить чат");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        chats = chats.filter(c => c.id !== chat.id);
        if (activeId === chat.id) activeId = chats.at(-1)?.id || null;
        persist(); renderAll(); showToast("Чат удалён.");
      });
      row.append(open, del);
      chatList.appendChild(row);
    });
  }
  function renderMessages() {
    messagesEl.innerHTML = "";
    const chat = currentChat();
    const hasMessages = Boolean(chat && chat.messages.length);
    welcome.hidden = hasMessages;
    messagesEl.hidden = !hasMessages;
    if (!hasMessages) return;
    chat.messages.forEach((message, index) => {
      const article = document.createElement("article");
      article.className = "message " + (message.role === "user" ? "user" : "assistant");
      const avatar = document.createElement("div");
      avatar.className = "message-avatar";
      avatar.textContent = message.role === "user" ? "Т" : "H";
      const body = document.createElement("div");
      body.className = "message-body";
      const name = document.createElement("div");
      name.className = "message-name";
      name.textContent = message.role === "user" ? "Ты" : "HollyAI";
      const content = document.createElement("div");
      content.className = "message-content";
      content.innerHTML = renderMarkdown(message.content || "");
      body.append(name, content);
      if (message.role === "assistant" && message.content) {
        const actions = document.createElement("div");
        actions.className = "message-actions";
        const copy = document.createElement("button");
        copy.className = "mini-action"; copy.textContent = "▢ Копировать";
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(message.content); showToast("Ответ скопирован."); }
          catch { showToast("Не удалось скопировать ответ."); }
        });
        actions.appendChild(copy);
        if (index === chat.messages.length - 1 && !busy) {
          const retry = document.createElement("button");
          retry.className = "mini-action"; retry.textContent = "↻ Повторить";
          retry.addEventListener("click", () => retryLast());
          actions.appendChild(retry);
        }
        body.appendChild(actions);
      }
      article.append(avatar, body);
      messagesEl.appendChild(article);
    });
    if (busy) {
      const typing = document.createElement("article");
      typing.className = "message assistant";
      typing.innerHTML = '<div class="message-avatar">H</div><div class="message-body"><div class="message-name">HollyAI</div><div class="typing-dots"><i></i><i></i><i></i></div></div>';
      messagesEl.appendChild(typing);
    }
    requestAnimationFrame(() => {
      const convo = $("#conversation");
      convo.scrollTop = convo.scrollHeight;
    });
  }
  function renderAll() { renderChats(); renderMessages(); }
  function newChat() {
    activeId = null;
    persist();
    renderAll();
    input.focus();
    closeSidebar();
  }
  function ensureChat(firstMessage) {
    let chat = currentChat();
    if (!chat) {
      chat = { id: uid(), title: makeTitle(firstMessage), messages: [], createdAt: Date.now() };
      chats.push(chat);
      activeId = chat.id;
    } else if (!chat.messages.length) {
      chat.title = makeTitle(firstMessage);
    }
    return chat;
  }
  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    sendButton.innerHTML = value ? '<span>…</span>' : '<span>↑</span>';
    renderAll();
  }
  async function sendMessage(text) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const chat = ensureChat(prompt);
    chat.messages.push({ role: "user", content: prompt });
    persist();
    input.value = "";
    resizeInput();
    setBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chat.messages.filter(m => ["user", "assistant"].includes(m.role)).slice(-24) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Сервер не смог обработать запрос.");
      chat.messages.push({ role: "assistant", content: data.answer });
      persist();
    } catch (error) {
      chat.messages.push({ role: "assistant", content: "⚠️ " + (error.message || "Не удалось связаться с сервером.") });
      persist();
    } finally {
      setBusy(false);
      input.focus();
    }
  }
  async function retryLast() {
    const chat = currentChat();
    if (!chat || busy) return;
    const last = chat.messages.at(-1);
    if (last?.role === "assistant") chat.messages.pop();
    if (chat.messages.at(-1)?.role !== "user") return;
    persist();
    const prompt = chat.messages.at(-1).content;
    setBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chat.messages.slice(-24) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Сервер не смог обработать запрос.");
      chat.messages.push({ role: "assistant", content: data.answer });
      persist();
    } catch (error) {
      chat.messages.push({ role: "assistant", content: "⚠️ " + (error.message || "Не удалось связаться с сервером.") });
      persist();
    } finally { setBusy(false); }
  }
  function resizeInput() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
    charCount.textContent = `${input.value.length} / 12000`;
  }
  function closeSidebar() { sidebar.classList.remove("open"); }
  form.addEventListener("submit", e => { e.preventDefault(); sendMessage(input.value); });
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  $("#newChat").addEventListener("click", newChat);
  $("#openSidebar").addEventListener("click", () => sidebar.classList.add("open"));
  $("#closeSidebar").addEventListener("click", closeSidebar);
  $("#settingsButton").addEventListener("click", () => settingsDialog.showModal());
  $("#profileButton").addEventListener("click", () => showToast("Профиль и аккаунты можно добавить следующим этапом."));
  $("#clearHistory").addEventListener("click", () => {
    chats = []; activeId = null; persist(); renderAll(); settingsDialog.close(); showToast("История очищена.");
  });
  document.querySelectorAll("[data-prompt]").forEach(button => {
    button.addEventListener("click", () => sendMessage(button.dataset.prompt));
  });
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
    if (e.key === "Escape") closeSidebar();
  });

  if (!activeId || !chats.some(c => c.id === activeId)) activeId = chats.at(-1)?.id || null;
  persist();
  renderAll();
  resizeInput();

  fetch("/api/health").then(r => r.json()).then(data => {
    if (!data.configured) {
      const pill = document.querySelector(".model-name");
      if (pill) pill.textContent = "нужна настройка API";
    } else {
      const pill = document.querySelector(".model-name");
      if (pill) pill.textContent = data.model || "Assistant";
    }
  }).catch(() => {});
})();
