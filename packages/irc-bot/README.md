# IRC Bot

Connects to IRC, posts transcripts in real-time, and handles commands.

## Features

- Real-time transcript posting
- IRC command handling
- Meeting chair authorization
- Pause/resume transcription control
- Status reporting

## Configuration

Set environment variables in `.env`:

```bash
IRC_SERVER=irc.w3.org
IRC_PORT=6667
IRC_CHANNEL=#your-channel
IRC_BOT_NICK=transcriber-bot
IRC_BOT_USERNAME=transcriber
IRC_BOT_REALNAME=Meeting Transcription Bot

# Optional SASL authentication
IRC_SASL_USERNAME=your_username
IRC_SASL_PASSWORD=your_password

REDIS_HOST=localhost
REDIS_PORT=6379
```

## Running

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## IRC Commands

### User Commands

- `!help` - Show available commands
- `!status` - Show transcription status

### Chair-Only Commands

- `!pause` - Pause transcription
- `!resume` - Resume transcription
- `!chair <nick>` - Add another meeting chair

## Transcript Format

```
<Speaker 0> Good morning everyone
  Let's get started with the agenda
<Speaker 1> I have a question about the first item
```

Speaker changes are shown with `<Speaker N>`, continued speech from the same speaker is indented.

## State Indicators

The bot will post status messages when state changes:

- `▶️  Transcription ACTIVE` - Currently transcribing
- `⏸️  Transcription PAUSED` - Paused (off the record)
- `⏹️  Transcription STOPPED` - Not running

## Authorization

Meeting chairs are authorized to use pause/resume commands. Chairs can be:

1. Set when the session starts (via API in Phase 3)
2. Added during the meeting with `!chair <nick>`

Unauthorized pause/resume attempts are silently ignored and logged.
