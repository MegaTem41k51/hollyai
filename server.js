require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const pg = require("pg");
const connectPgSimple = require("connect-pg-simple");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MAX_MESSAGE_CHARS = 12000;
const MAX_HISTORY_MESSAGES = 24;
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
if (isProduction) app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

let pool = null;
let dbReady = false;

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is not set. Google sign-in and persistent history are unavailable.");
    return;
  }
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      picture TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Новый чат',
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS chats_user_updated_idx ON chats(user_id, updated_at DESC);
  `);
  dbReady = true;
  console.log("HollyAI PostgreSQL tables are ready.");
}

const PgSession = connectPgSimple(session);
app.use(session({
  store: process.env.DATABASE_URL ? new PgSession({
    pool: (() => {
      if (!pool) {
        pool = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
          max: 5
        });
      }
      return pool;
    })(),
    createTableIfMissing: true,
    tableName: "user_sessions"
  }) : undefined,
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    if (!pool || !dbReady) return done(null, false);
    const result = await pool.query(
      "SELECT id, email, name, picture FROM users WHERE id = $1",
      [id]
    );
    done(null, result.rows[0] || false);
  } catch (err) { done(err); }
});

const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_CALLBACK_URL
);

if (googleConfigured) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      if (!pool || !dbReady) return done(new Error("Database is not ready."));
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error("Google did not return an email address."));
      const result = await pool.query(`
        INSERT INTO users (google_id, email, name, picture, last_login_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (google_id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          picture = EXCLUDED.picture,
          last_login_at = NOW()
        RETURNING id, email, name, picture
      `, [
        profile.id,
        email,
        profile.displayName || email.split("@")[0],
        profile.photos?.[0]?.value || null
      ]);
      done(null, result.rows[0]);
    } catch (err) { done(err); }
  }));
}

function requireAuth(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Войди через Google, чтобы пользоваться HollyAI и сохранять чаты." });
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "HollyAI",
    model: MODEL,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    googleConfigured,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseReady: dbReady
  });
});

app.get("/auth/google", (req, res, next) => {
  if (!googleConfigured) return res.status(503).send("Google OAuth ещё не настроен. Добавьте GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET и GOOGLE_CALLBACK_URL в Environment.");
  passport.authenticate("google", { scope: ["profile", "email"], prompt: "select_account" })(req, res, next);
});

app.get("/auth/google/callback", (req, res, next) => {
  if (!googleConfigured) return res.redirect("/?auth=not_configured");
  passport.authenticate("google", {
    failureRedirect: "/?auth=failed",
    session: true
  }, (err, user) => {
    if (err || !user) {
      console.error("Google OAuth error:", err?.message || "No user");
      return res.redirect("/?auth=failed");
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error("Google session error:", loginErr.message);
        return res.redirect("/?auth=failed");
      }
      res.redirect("/");
    });
  })(req, res, next);
});

app.post("/auth/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.json({ authenticated: false, googleConfigured, databaseReady: dbReady });
  }
  res.json({
    authenticated: true,
    googleConfigured,
    databaseReady: dbReady,
    user: req.user
  });
});

app.get("/api/chats", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, messages, created_at, updated_at FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100",
      [req.user.id]
    );
    res.json({ chats: result.rows });
  } catch (err) {
    console.error("Load chats error:", err.message);
    res.status(500).json({ error: "Не удалось загрузить историю. Проверь подключение базы данных." });
  }
});

app.put("/api/chats/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id || "").slice(0, 100);
  const title = String(req.body?.title || "Новый чат").slice(0, 120);
  const messages = req.body?.messages;
  if (!id || !Array.isArray(messages) || messages.length > 100) {
    return res.status(400).json({ error: "Некорректные данные чата." });
  }
  const safeMessages = messages
    .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  try {
    const result = await pool.query(`
      INSERT INTO chats (id, user_id, title, messages, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        messages = EXCLUDED.messages,
        updated_at = NOW()
      WHERE chats.user_id = EXCLUDED.user_id
      RETURNING id
    `, [id, req.user.id, title, JSON.stringify(safeMessages)]);
    if (!result.rowCount) return res.status(404).json({ error: "Чат не найден." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Save chat error:", err.message);
    res.status(500).json({ error: "Не удалось сохранить чат в базе данных." });
  }
});

app.delete("/api/chats/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM chats WHERE id = $1 AND user_id = $2", [
      String(req.params.id).slice(0, 100), req.user.id
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete chat error:", err.message);
    res.status(500).json({ error: "Не удалось удалить чат." });
  }
});

app.post("/api/chat", requireAuth, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "ИИ не подключён: добавь OPENAI_API_KEY в Environment на Render." });
  }
  if (!dbReady) {
    return res.status(503).json({ error: "База данных ещё не готова. Проверь DATABASE_URL в Render." });
  }

  const messages = req.body && req.body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Добавь сообщение для HollyAI." });
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
        { role: "system", content: "Ты — HollyAI, полезный, честный и дружелюбный ИИ-помощник. Отвечай на языке пользователя. Если не уверен, честно скажи об этом. Для кода давай практичные решения и поясняй, куда помещать файлы." },
        ...safeMessages
      ],
      temperature: 0.7
    });
    const answer = completion.choices?.[0]?.message?.content;
    if (!answer) throw new Error("Модель вернула пустой ответ.");
    res.json({ answer, model: MODEL });
  } catch (error) {
    console.error("HollyAI API error:", {
      status: error?.status,
      code: error?.code,
      message: error?.message
    });
    let message = "Не удалось получить ответ от ИИ. Проверь логи сервера.";
    if (error?.status === 401) message = "API-ключ ИИ недействителен. Проверь OPENAI_API_KEY в Render.";
    else if (error?.status === 429) message = "Лимит API исчерпан или слишком много запросов. Проверь биллинг и лимиты провайдера.";
    else if (error?.status === 404) message = "Модель недоступна. Проверь значение OPENAI_MODEL.";
    else if (error?.status === 400) message = "Провайдер отклонил запрос. Проверь настройки модели и содержимое запроса.";
    else if (error?.code === "ENOTFOUND" || error?.code === "ECONNREFUSED") message = "Сервер не может подключиться к API ИИ. Проверь соединение и настройки провайдера.";
    res.status(502).json({ error: message });
  }
});

app.use(express.static(path.join(__dirname, "public"), { maxAge: isProduction ? "1h" : 0 }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initDatabase().catch(err => {
  console.error("Database initialization failed:", err.message);
  dbReady = false;
});

app.listen(PORT, () => console.log(`HollyAI is running on port ${PORT}`));
