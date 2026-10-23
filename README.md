# HollyAI v1.1 — Google login + persistent chats

## Что исправлено

- Сервер показывает понятные причины ошибок ИИ вместо одной общей ошибки.
- Добавлен вход через Google OAuth.
- Пользовательские аккаунты сохраняются в PostgreSQL.
- История чатов сохраняется в PostgreSQL, привязана к аккаунту и доступна после повторного входа.
- Сессии хранятся в PostgreSQL, cookie защищена настройками для Render.
- Добавлены загрузка, удаление чатов и выход из аккаунта.

## 1. Подготовь сервисы

Тебе нужны:
1. Render Web Service для сайта.
2. PostgreSQL на Render.
3. API-ключ провайдера ИИ.
4. OAuth Client ID и Client Secret в Google Cloud Console.

## 2. Google OAuth

1. Открой https://console.cloud.google.com/.
2. Создай проект (или выбери существующий).
3. В **APIs & Services → OAuth consent screen** настрой экран согласия. Для личного тестирования можно выбрать External и добавить свой Google-аккаунт в Test users, если приложение в режиме тестирования.
4. В **APIs & Services → Credentials → Create Credentials → OAuth client ID** выбери **Web application**.
5. В **Authorized JavaScript origins** добавь домен сайта, например `https://ТВОЙ-СЕРВИС.onrender.com`.
6. В **Authorized redirect URIs** добавь ТОЧНО:
   `https://ТВОЙ-СЕРВИС.onrender.com/auth/google/callback`
7. Скопируй Client ID и Client Secret. Не публикуй Client Secret.

Для локального тестирования добавь также:
- Origin: `http://localhost:3000`
- Redirect URI: `http://localhost:3000/auth/google/callback`

После смены домена обнови redirect URI в Google Cloud.

## 3. PostgreSQL на Render

1. В Render создай **New → PostgreSQL**.
2. После создания скопируй **Internal Database URL**, если Web Service и база в одном регионе/среде Render. Если подключаешься извне, используй подходящий External URL.
3. Убедись, что в URL нет лишних пробелов. Сервер создаёт таблицы `users`, `chats` и таблицу сессий автоматически.
4. Не удаляй базу, если хочешь сохранить историю пользователей.

## 4. Переменные окружения Web Service

В Render → твой Web Service → **Environment** добавь:

- `NODE_ENV` = `production`
- `OPENAI_API_KEY` = секретный ключ API модели
- `OPENAI_MODEL` = `gpt-4.1-mini` (или модель, доступная твоему ключу)
- `DATABASE_URL` = URL PostgreSQL
- `SESSION_SECRET` = длинная случайная строка
- `GOOGLE_CLIENT_ID` = Client ID из Google Cloud
- `GOOGLE_CLIENT_SECRET` = Client Secret из Google Cloud
- `GOOGLE_CALLBACK_URL` = `https://ТВОЙ-СЕРВИС.onrender.com/auth/google/callback`

`DATABASE_SSL` обычно не нужно задавать на Render. Для локальной БД без TLS можно установить `DATABASE_SSL=false`.

После добавления переменных выполни redeploy.

## 5. Деплой

В Render Web Service:
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Либо используй `render.yaml` как Blueprint, затем задай секретные переменные вручную.

## 6. Проверка

Открой `https://ТВОЙ-СЕРВИС.onrender.com/api/health`. В ответе проверь:
- `aiConfigured: true`
- `googleConfigured: true`
- `databaseReady: true`

Если `aiConfigured` false — проверь `OPENAI_API_KEY`.
Если `googleConfigured` false — проверь все три `GOOGLE_*` переменные.
Если `databaseReady` false — открой Render Logs и проверь `DATABASE_URL`, сетевой доступ и SSL.
Если ИИ возвращает ошибку, серверные логи покажут статус API. Проверь баланс/лимиты API и доступность `OPENAI_MODEL`.

## Безопасность и ограничения

- Никогда не коммить `.env`, Client Secret или API-ключ в GitHub.
- Не используй один общий аккаунт для всех пользователей.
- Этот стартовый проект пока не включает rate limiting, CAPTCHA, биллинг, админ-панель или лимиты расходов. Перед публичным запуском их стоит добавить.
- Существующие старые чаты, которые хранились только в localStorage предыдущей версии, автоматически в PostgreSQL не переносятся.
- OAuth-тестовый режим Google может разрешать вход только тестовым пользователям, пока приложение не опубликовано/не проверено по требованиям Google.
