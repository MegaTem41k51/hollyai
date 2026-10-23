require("dotenv").config();

const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MAX_MESSAGE_CHARS = 12000;
const MAX_HISTORY_MESSAGES = 24;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
}));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "HollyAI",
    model: MODEL,
    configured: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.post("/api/chat", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: "HollyAI ещё не подключена к модели. Добавьте OPENAI_API_KEY в переменные окружения Render."
    });
  }

  const messages = req.body && req.body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Добавьте сообщение для HollyAI." });
  }

  const safeMessages = messages
    .slice(-MAX_HISTORY_MESSAGES)
    .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, MAX_MESSAGE_CHARS) }))
    .filter(m => m.content.length > 0);

  if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
    return res.status(400).json({ error: "Последнее сообщение должно быть сообщением пользователя." });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: "Ты — HollyAI, полезный, честный и дружелюбный ИИ-помощник. Отвечай на языке пользователя. Если не уверен, честно скажи об этом. Для кода давай практичные решения и поясняй, куда помещать файлы."
        },
        ...safeMessages
      ],
      temperature: 0.7
    });

    const answer = completion.choices?.[0]?.message?.content;
    if (!answer) throw new Error("Модель вернула пустой ответ.");
    res.json({ answer, model: MODEL });
  } catch (error) {
    console.error("HollyAI API error:", error?.status || "", error?.message || error);
    const status = error?.status === 401 ? 502 : 502;
    let message = "Не удалось получить ответ от ИИ. Попробуйте ещё раз.";
    if (error?.status === 401) message = "API-ключ не принят. Проверьте OPENAI_API_KEY в Render.";
    else if (error?.status === 429) message = "У API временно закончился лимит или превышена частота запросов. Проверьте лимиты и оплату провайдера.";
    else if (error?.status === 404) message = "Модель не найдена или недоступна для этого API-ключа. Проверьте OPENAI_MODEL.";
    res.status(status).json({ error: message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`HollyAI is running on port ${PORT}`);
});
