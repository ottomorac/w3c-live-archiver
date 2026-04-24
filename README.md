# W3C Live Archiver — RTMS Edition

Real-time meeting transcription system for W3C working groups. Uses Zoom's **Real-Time Media Streams (RTMS)** API to receive transcripts server-side — no bot joins the meeting, no C++ code, no Deepgram costs.

> **Note:** The legacy Deepgram + Zoom Meeting SDK approach is preserved on the git tag `v0.1-deepgram-zoom-sdk` and archived in `backups/pre-rtms-zoom-sdk-deepgram.zip`.

## Architecture

```
  Zoom Meeting (host)
        │
        │  Webhook: meeting.rtms_started / meeting.rtms_stopped
        ▼
  ┌─────────────────┐
  │  RTMS Gateway   │  Node.js/TypeScript
  │  (Express +     │  Webhook signature verification
  │   @zoom/rtms    │  RTMS session management
  │   SDK)          │
  └────────┬────────┘
           │  Redis pub/sub (transcript events + commands)
           ▼
  ┌─────────────────┐
  │    IRC Bot      │  Node.js/TypeScript
  │                 │  Transcript buffering
  │                 │  IRC command handling
  └─────────────────┘
           │
           ▼
     IRC Channel
```

**Data flow:** Zoom meeting → RTMS webhook → RTMS Gateway → Redis → IRC Bot → IRC channel

## How It Works

1. The **RTMS Gateway** is a webhook server. When a meeting starts, Zoom POSTs a `meeting.rtms_started` event to it. The gateway uses the official `@zoom/rtms` Node.js SDK to connect to Zoom's media stream and receive real-time transcript segments with speaker names already attributed.

2. Transcript segments are published to Redis and picked up by the **IRC Bot**, which buffers them briefly to consolidate short utterances, then posts them to the configured IRC channel.

3. Meeting chairs can control transcription from IRC using `transcriber-bot, <command>` commands.

## IRC Output Example

```
transcriber-bot: Transcription bot ready. Type "transcriber-bot, help" for commands.
transcriber-bot: Otto Mora: Good morning everyone, let's get started...
transcriber-bot: Jane Smith: Thanks for joining, today's agenda has three items...
ottomorac: transcriber-bot, pause
transcriber-bot: Transcription PAUSED (Paused by ottomorac)
ottomorac: transcriber-bot, resume
transcriber-bot: Transcription ACTIVE (Resumed by ottomorac)
transcriber-bot: Jane Smith: As I was saying, the first item is...
```

## Components

| Component | Language | Location | Description |
|-----------|----------|----------|-------------|
| RTMS Gateway | TypeScript | `packages/rtms-gateway/` | Webhook server, RTMS session management, Redis publishing |
| IRC Bot | TypeScript | `packages/irc-bot/` | IRC integration, command handling, transcript buffering |
| Shared | TypeScript | `packages/shared/` | Common types, Redis channels, interfaces |

## Prerequisites

- **Node.js 20.3+** (required by the `@zoom/rtms` SDK)
- **npm 9+**
- **Redis** server
- **Zoom account** with RTMS enabled (see Setup below)
- **ngrok** (or any reverse proxy) to expose your local webhook to Zoom during development

## Setup

### 1. Create a Zoom Marketplace App

1. Go to [marketplace.zoom.us](https://marketplace.zoom.us) → **Develop** → **Build App**
2. Choose **General App** type
3. Under **Information**, fill in the app name and description
4. Under **OAuth**, set:
   - **OAuth Redirect URL**: `https://your-ngrok-url.ngrok-free.app/oauth/callback`
5. Under **Scopes**, add:
   - `meeting:read:meeting_transcript`
   - Any other RTMS-related scopes available (search "rtms")
6. Under **Feature**, enable **Real-time Media Streams (RTMS)**
7. Under **Feature → Event Subscriptions**, add a new subscription:
   - **Event notification endpoint URL**: `https://your-ngrok-url.ngrok-free.app/webhook`
   - Subscribe to events: `meeting.rtms_started`, `meeting.rtms_stopped`
8. Save and note your **Client ID**, **Client Secret**, and **Secret Token**

### 2. Request RTMS Enablement

RTMS is not self-service. Submit the [30-day free trial form](https://developers.zoom.us/docs/rtms/) on Zoom's RTMS page. Zoom's team will email you once your account is enabled (usually within a few days).

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# IRC
IRC_SERVER=irc.w3.org
IRC_PORT=6667
IRC_CHANNEL="#your-channel"
IRC_BOT_NICK=transcriber-bot

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Zoom RTMS
ZOOM_CLIENT_ID=your_client_id
ZOOM_CLIENT_SECRET=your_client_secret
ZOOM_SECRET_TOKEN=your_secret_token
ZOOM_OAUTH_REDIRECT_URI=https://your-ngrok-url.ngrok-free.app/oauth/callback

# Required by @zoom/rtms SDK (same values as above)
ZM_RTMS_CLIENT=your_client_id
ZM_RTMS_SECRET=your_client_secret

# Webhook server
WEBHOOK_PORT=3000
WEBHOOK_PATH=/webhook
```

### 5. Start Redis

```bash
# Using Docker
docker run -d -p 6379:6379 redis:alpine

# Or if installed locally (Ubuntu/Debian)
sudo systemctl start redis-server
```

### 6. Start ngrok

```bash
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL and update it in:
- Your Zoom app's **OAuth Redirect URL**: `https://xxxx.ngrok-free.app/oauth/callback`
- Your Zoom app's **Event notification endpoint URL**: `https://xxxx.ngrok-free.app/webhook`
- The `ZOOM_OAUTH_REDIRECT_URI` value in your `.env`

### 7. Start the services

```bash
npm run dev
```

This starts both the RTMS Gateway (port 3000) and IRC Bot concurrently.

### 8. Install the Zoom app on your account

Open in your browser:
```
https://your-ngrok-url.ngrok-free.app/oauth/install
```

This redirects you to Zoom's OAuth authorization page. Approve the app. You should see "App installed successfully" and the terminal will log `OAuth token exchange successful — app installed`.

You only need to do this once per account (or after adding new scopes).

### 9. Test

Start a Zoom meeting as the host. Within a few seconds you should see in the terminal:

```
[RTMSGateway] Webhook event: meeting.rtms_started
[RTMSSession] Starting RTMS session via SDK for meeting ...
[RTMSSession] Transcript: Your Name: Hello this is a test...
```

And in your IRC channel:
```
transcriber-bot: Your Name: Hello this is a test...
```

## IRC Commands

All commands use the format `transcriber-bot, <command>` (the bot's IRC nick followed by a comma).

| Command | Access | Description |
|---------|--------|-------------|
| `transcriber-bot, pause` | Anyone | Pause transcription (off the record) |
| `transcriber-bot, resume` | Anyone | Resume transcription |
| `transcriber-bot, status` | Anyone | Show current transcription status |
| `transcriber-bot, scribe` | Anyone | Toggle W3C scribe mode (`scribe+`/`scribe-`) |
| `transcriber-bot, help` | Anyone | Show available commands |

By default the transcriber-bot joins an IRC channel in "paused mode". This means it needs to be told resume in order to start transcribing meeting notes:

```
transcriber-bot, resume
```

## Configuration Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `ZOOM_CLIENT_ID` | Yes | OAuth Client ID from Zoom Marketplace |
| `ZOOM_CLIENT_SECRET` | Yes | OAuth Client Secret from Zoom Marketplace |
| `ZOOM_SECRET_TOKEN` | Yes | Secret Token from Event Subscriptions section |
| `ZM_RTMS_CLIENT` | Yes | Same as `ZOOM_CLIENT_ID` (used by `@zoom/rtms` SDK) |
| `ZM_RTMS_SECRET` | Yes | Same as `ZOOM_CLIENT_SECRET` (used by `@zoom/rtms` SDK) |
| `ZOOM_OAUTH_REDIRECT_URI` | Yes | Full public URL for OAuth callback (ngrok URL + `/oauth/callback`) |
| `WEBHOOK_PORT` | No | Port for webhook server (default: `3000`) |
| `WEBHOOK_PATH` | No | Webhook endpoint path (default: `/webhook`) |
| `IRC_SERVER` | Yes | IRC server hostname |
| `IRC_PORT` | No | IRC server port (default: `6667`) |
| `IRC_CHANNEL` | Yes | IRC channel to post transcripts to |
| `IRC_BOT_NICK` | No | Bot's IRC nick (default: `transcriber-bot`) |
| `REDIS_HOST` | No | Redis hostname (default: `localhost`) |
| `REDIS_PORT` | No | Redis port (default: `6379`) |

## Troubleshooting

**No `meeting.rtms_started` webhook received when starting a meeting**
- Confirm Zoom emailed you that RTMS is enabled on your account
- Confirm the app is installed on your account (visit `/oauth/install`)
- Confirm the event subscription includes `meeting.rtms_started`
- Confirm ngrok is running and the endpoint URL in Zoom matches

**`ZM_RTMS_CLIENT cannot be empty` error**
- Make sure `ZM_RTMS_CLIENT` and `ZM_RTMS_SECRET` are set in `.env`

**`failed to open file ... logs/node_XXXXX` messages**
- Create the logs directory: `mkdir -p packages/rtms-gateway/logs`
- These are non-fatal; the SDK just can't write its internal log files

**Webhook signature invalid**
- Check that `ZOOM_SECRET_TOKEN` matches the Secret Token in your Zoom app's Event Subscriptions section (not the Client Secret)

**ngrok URL changes on every restart**
- Update the OAuth Redirect URL and Event notification endpoint URL in your Zoom app settings after each ngrok restart
- Consider a paid ngrok account for a stable domain

## Project Status

- [x] RTMS webhook integration
- [x] Real-time transcription via `@zoom/rtms` SDK
- [x] Speaker attribution (from Zoom, no Deepgram needed)
- [x] IRC bot with pause/resume/chair commands
- [x] Transcript buffering (consolidated IRC output)
- [x] W3C scribe mode toggle
- [ ] Production deployment (persistent process, stable webhook URL)
- [ ] Web API for remote meeting control

## License

[MIT](LICENSE)
