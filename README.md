# W3C Live Archiver — RTMS Edition

Real-time meeting transcription system for W3C working groups. Uses Zoom's **Real-Time Media Streams (RTMS)** API to receive transcripts server-side — bot does not need to join the meeting.

> **Note:** The legacy Deepgram + Zoom Meeting SDK approach is preserved on the git tag `v0.1-deepgram-zoom-sdk` and archived in `backups/pre-rtms-zoom-sdk-deepgram.zip`.

## Architecture

```
  Zoom Meeting (host)
        │
        │  Webhooks: meeting.started / meeting.rtms_started / meeting.rtms_stopped
        ▼
  ┌─────────────────┐
  │  RTMS Gateway   │  Node.js/TypeScript
  │  (Express +     │  Webhook signature verification
  │   @zoom/rtms    │  RTMS session management
  │   SDK)          │  Manual RTMS start via REST API
  └────────┬────────┘
           │  Redis pub/sub (transcript events + commands)
           ▼
  ┌─────────────────┐
  │    IRC Bot      │  Node.js/TypeScript
  │                 │  Invite-based channel joining
  │                 │  Transcript buffering
  │                 │  IRC command handling
  └─────────────────┘
           │
           ▼
     IRC Channel
```

**Data flow:** Zoom meeting → `meeting.started` webhook → IRC `connect` command → RTMS Gateway calls Zoom API → `meeting.rtms_started` webhook → `@zoom/rtms` SDK → Redis → IRC Bot → IRC channel

## How It Works

1. The **RTMS Gateway** is a webhook server. It receives `meeting.started` events from Zoom and logs which IRC channel the meeting maps to, but does **not** start RTMS automatically.

2. The **IRC Bot** waits to be **invited** to an IRC channel rather than auto-joining. On receiving an invite it checks whether the channel is in its authorised list (`CHANNEL_MEETING_MAP`). If authorised it joins and announces itself; if not it posts an apology message and leaves.

3. Once the bot is in the channel and a Zoom meeting is running, a chair types `transcriber-bot, connect`. The gateway looks up the meeting ID for that IRC channel and calls Zoom's REST API to manually start RTMS.

4. Zoom confirms via a `meeting.rtms_started` webhook. The gateway uses the `@zoom/rtms` SDK to connect to the media stream and receive real-time transcript segments with speaker attribution.

5. Transcript segments are published to Redis and picked up by the IRC Bot, which buffers them briefly to consolidate short utterances, then posts them to the IRC channel.

6. Chairs can pause and resume transcription mid-meeting. When the meeting ends Zoom fires `meeting.rtms_stopped` and the system returns to idle.

## IRC Output Example

```
--> transcriber-bot has joined #wpwg
* transcriber-bot Transcription bot ready. Type "transcriber-bot, help" for commands.
ottomorac: transcriber-bot, connect
* transcriber-bot Attempting to connect to the Zoom meeting — transcription will start automatically once connected.
* transcriber-bot ▶️  Transcription ACTIVE (RTMS connected)
<transcriber-bot> scribe+
<transcriber-bot> Otto Mora: Good morning everyone, let's get started...
<transcriber-bot> Jane Smith: Thanks for joining, today's agenda has three items...
ottomorac: transcriber-bot, pause
* transcriber-bot ⏸️  Transcription PAUSED (Paused by ottomorac)
ottomorac: transcriber-bot, resume
* transcriber-bot ▶️  Transcription ACTIVE (Resumed by ottomorac)
<transcriber-bot> Jane Smith: As I was saying, the first item is...
ottomorac: transcriber-bot, please excuse us
* transcriber-bot Happy to be of service bye!
<-- transcriber-bot has left #wpwg
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
2. Choose **OAuth** (user-managed) app type — RTMS only works with user-level apps, not server-to-server OAuth
3. Under **OAuth**, set:
   - **OAuth Redirect URL**: `https://your-ngrok-url.ngrok-free.app/oauth/callback`
4. Under **Scopes**, add:
   - `meeting:update:participant_rtms_app_status`
   - `meeting:update:participant_rtms_app_status:admin`
5. Under **Feature**, enable **Real-time Media Streams (RTMS)** and **disable** the auto-start option (the bot starts RTMS manually via IRC command)
6. Under **Feature → Event Subscriptions**, add a new subscription:
   - **Event notification endpoint URL**: `https://your-ngrok-url.ngrok-free.app/webhook`
   - Subscribe to events: `meeting.started`, `meeting.rtms_started`, `meeting.rtms_stopped`
7. Save and note your **Client ID**, **Client Secret**, and **Secret Token**

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
# Map IRC channels to their Zoom meeting IDs (comma-separated channel:meetingId pairs)
CHANNEL_MEETING_MAP="#did:5637387869,#wpwg:86873854269"
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

`CHANNEL_MEETING_MAP` is the authorised list of IRC channels and their corresponding Zoom meeting IDs. The bot will only join channels on this list and will only start RTMS for the mapped meeting.

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

This redirects you to Zoom's OAuth authorization page. Approve the app. You should see "App installed successfully" and the terminal will log `OAuth token exchange successful — app installed, access token stored`.

You only need to do this once per gateway restart (the token is held in memory).

### 9. Invite the bot to an IRC channel

The bot does not auto-join channels. Invite it from within the target channel:

```
/invite transcriber-bot #wpwg
```

The bot checks whether `#wpwg` is in `CHANNEL_MEETING_MAP`. If authorised it joins and announces itself. If not, it posts an apology and leaves.

### 10. Start a meeting and connect

Start the corresponding Zoom meeting as host, then in the IRC channel type:

```
transcriber-bot, connect
```

The gateway calls Zoom's API to start RTMS for that meeting. Within a few seconds transcription will begin and the bot announces `▶️  Transcription ACTIVE`.

## IRC Commands

All commands use the format `transcriber-bot, <command>` (the bot's IRC nick followed by a comma).

| Command | Description |
|---------|-------------|
| `transcriber-bot, connect` | Start RTMS for this channel's Zoom meeting and begin transcription |
| `transcriber-bot, pause` | Pause transcription (go off the record) |
| `transcriber-bot, resume` | Resume transcription after a pause |
| `transcriber-bot, status` | Show current transcription status |
| `transcriber-bot, please excuse us` | Bot emotes a goodbye message and leaves the IRC channel |
| `transcriber-bot, help` | Show available commands |

### Command details

**`connect`** — Triggers the full RTMS startup sequence for the Zoom meeting associated with the current IRC channel (via `CHANNEL_MEETING_MAP`). The bot replies immediately to confirm the attempt; the `▶️  Transcription ACTIVE` announcement follows once Zoom confirms RTMS is running (usually within a few seconds). If no Zoom meeting is currently in progress the command has no effect.

**`pause`** — Silences transcript output in IRC without disconnecting from the RTMS stream. Useful for off-the-record discussions. The bot posts `scribe-` to signal the change to W3C tooling.

**`resume`** — Resumes posting transcripts after a pause. The bot posts `scribe+`.

**`please excuse us`** — The bot emotes `Happy to be of service bye!` and then parts the IRC channel. To invite it back use `/invite transcriber-bot #channel-name`.

## Configuration Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `CHANNEL_MEETING_MAP` | Yes | Comma-separated `#channel:meetingId` pairs of authorised channels (e.g. `"#did:5637387869,#wpwg:86873854269"`) |
| `ZOOM_CLIENT_ID` | Yes | OAuth Client ID from Zoom Marketplace |
| `ZOOM_CLIENT_SECRET` | Yes | OAuth Client Secret from Zoom Marketplace |
| `ZOOM_SECRET_TOKEN` | Yes | Secret Token from Event Subscriptions section (not the Client Secret) |
| `ZM_RTMS_CLIENT` | Yes | Same as `ZOOM_CLIENT_ID` (used by `@zoom/rtms` SDK) |
| `ZM_RTMS_SECRET` | Yes | Same as `ZOOM_CLIENT_SECRET` (used by `@zoom/rtms` SDK) |
| `ZOOM_OAUTH_REDIRECT_URI` | Yes | Full public URL for OAuth callback (ngrok URL + `/oauth/callback`) |
| `WEBHOOK_PORT` | No | Port for webhook server (default: `3000`) |
| `WEBHOOK_PATH` | No | Webhook endpoint path (default: `/webhook`) |
| `IRC_SERVER` | Yes | IRC server hostname |
| `IRC_PORT` | No | IRC server port (default: `6667`) |
| `IRC_BOT_NICK` | No | Bot's IRC nick (default: `transcriber-bot`) |
| `REDIS_HOST` | No | Redis hostname (default: `localhost`) |
| `REDIS_PORT` | No | Redis port (default: `6379`) |

## Troubleshooting

**Bot joins a channel then immediately leaves**
- The channel is not in `CHANNEL_MEETING_MAP`. Add the channel and its Zoom meeting ID to the variable and restart.

**`transcriber-bot, connect` has no effect**
- Confirm a Zoom meeting is currently in progress for the mapped meeting ID
- Confirm the gateway has a valid OAuth token (visit `/oauth/install` if the gateway was restarted)
- Check the gateway logs for "CONNECT" and "startRTMS" lines to see the API response

**No `meeting.rtms_started` webhook after a successful `connect`**
- Confirm RTMS auto-start is **disabled** in your Zoom app's Feature settings (if auto-start is on, Zoom may have already started and stopped RTMS before `connect` was typed)
- Confirm `meeting.rtms_started` is listed under Event Subscriptions in your Zoom app

**Webhook signature invalid**
- Check that `ZOOM_SECRET_TOKEN` matches the **Secret Token** in your Zoom app's Event Subscriptions section (not the Client Secret)

**`ZM_RTMS_CLIENT cannot be empty` error**
- Make sure `ZM_RTMS_CLIENT` and `ZM_RTMS_SECRET` are set in `.env`

**`failed to open file ... logs/node_XXXXX` messages**
- Create the logs directory: `mkdir -p packages/rtms-gateway/logs`
- These are non-fatal; the SDK just can't write its internal log files

**ngrok URL changes on every restart**
- Update the OAuth Redirect URL and Event notification endpoint URL in your Zoom app settings after each ngrok restart
- Consider a paid ngrok account for a stable domain

**OAuth token lost after gateway restart**
- The access token is stored in memory only. Visit `/oauth/install` again after restarting the gateway to get a fresh token.

## Project Status

- [x] RTMS webhook integration
- [x] Real-time transcription via `@zoom/rtms` SDK
- [x] Speaker attribution (from Zoom, no Deepgram needed)
- [x] Invite-based IRC channel joining with channel authorisation
- [x] Manual RTMS start via IRC `connect` command
- [x] Channel-to-meeting mapping (`CHANNEL_MEETING_MAP`)
- [x] IRC bot with connect/pause/resume/leave commands
- [x] Transcript buffering (consolidated IRC output)
- [x] W3C scribe mode toggle
- [ ] Persistent OAuth token storage (survive gateway restarts)
- [ ] Production deployment (persistent process, stable webhook URL)
- [ ] Web API for remote meeting control

## License

[MIT](LICENSE)
