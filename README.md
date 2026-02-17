# W3C Live Archiver

Real-time meeting transcription system for W3C working groups. Captures audio from Zoom meetings, transcribes it using Deepgram, and posts speaker-attributed transcripts to IRC channels in real time.

## Architecture

```
                    ┌─────────────┐
                    │  Zoom Bot   │  C++ (Meeting SDK)
                    │  Joins call │  Captures per-participant audio
                    └──────┬──────┘
                           │ WebSocket (audio + metadata)
                           ▼
                    ┌─────────────┐
                    │  Gateway    │  Node.js/TypeScript
                    │  Server     │  Speaker name resolution
                    └──┬──────┬──┘
                       │      │
            Deepgram ◄─┘      └─► Redis
            (STT API)             (pub/sub)
                                    │
                                    ▼
                    ┌─────────────┐
                    │  IRC Bot    │  Node.js/TypeScript
                    │             │  Posts to IRC channel
                    └─────────────┘
```

**Data flow:** Zoom audio --> Gateway --> Deepgram (speech-to-text) --> Redis --> IRC Bot --> IRC channel

## How It Works

1. The **Zoom Bot** joins a Zoom meeting headlessly via the Meeting SDK, captures raw PCM audio per participant, and detects who is speaking using audio energy levels.

2. The **Gateway** receives the mixed audio stream and speaker metadata over WebSocket, forwards audio to Deepgram for transcription, and maps Deepgram's generic "Speaker 0/1/2" labels to real Zoom participant names.

3. The **IRC Bot** subscribes to transcripts via Redis and posts them to the configured IRC channel with speaker attribution. Meeting chairs can pause/resume transcription using IRC commands.

## IRC Output Example

```
transcriber-bot: Transcription bot ready. Type !help for commands.
transcriber-bot: Otto Mora: Rock music is pretty cool right man?
transcriber-bot: Paul McCartney: You're asking me dude?
transcriber-bot: Yeah. I assumed you were inspired in a few folks before
transcriber-bot: you became a rockstar yourself right?
transcriber-bot: Paul McCartney: I can tell you my inspirations,
transcriber-bot: Paul McCartney: but I would like be this off-the-record,.
transcriber-bot: Paul McCartney: please. Sound good?
transcriber-bot: Otto Mora: ok, let me pause the transcription
ottomorac: !pause
transcriber-bot: Transcription PAUSED (Paused by ottomorac)
ottomorac: !resume
transcriber-bot: Transcription ACTIVE (Resumed by ottomorac)
transcriber-bot: Paul McCartney: Thanks man, I want to keep my influences a secret.
```

## Components

| Component | Language | Location | Description |
|-----------|----------|----------|-------------|
| Gateway | TypeScript | `packages/gateway/` | Audio ingestion, Deepgram streaming, speaker name mapping |
| IRC Bot | TypeScript | `packages/irc-bot/` | IRC integration, command handling, transcript buffering |
| Shared | TypeScript | `packages/shared/` | Common types, Redis channels, interfaces |
| Zoom Bot | C++ | `packages/zoom-bot/` | Zoom Meeting SDK integration, raw audio capture |

## Prerequisites

- **Node.js** 18+ and npm 9+
- **Redis** server
- **Deepgram** API key ([deepgram.com](https://deepgram.com))
- **Zoom Meeting SDK** for Linux (for the Zoom Bot component)
- **CMake** and C++ build tools (for the Zoom Bot component)

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Deepgram API key, IRC settings, and Zoom SDK credentials
```

### 3. Start Redis

```bash
# Using Docker
docker run -d -p 6379:6379 redis:alpine

# Or if installed locally (Ubuntu)
sudo systemctl start redis-server
```

### 4. Start the Gateway and IRC Bot

```bash
npm run dev
```

This starts both the gateway (port 8080) and IRC bot concurrently.

### 5. Build and run the Zoom Bot

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed Zoom Bot build instructions.

```bash
cd packages/zoom-bot
mkdir build && cd build
cmake ..
make -j$(nproc)
cd ..
./run.sh --meeting-id 12345678901 --password abc123
```

The bot will join the Zoom meeting, request recording permission (the host must approve), and begin streaming audio to the gateway (you must input the `!resume` command the first time in order to start the audio transcription).

## IRC Commands

| Command | Access | Description |
|---------|--------|-------------|
| `!pause` | Chairs only | Pause transcription (off the record) |
| `!resume` | Chairs only | Resume transcription |
| `!status` | Anyone | Show current transcription status |
| `!chair <nick>` | Anyone | Add an IRC user as a meeting chair |
| `!scribe` | Anyone | Toggle W3C scribe mode (outputs `scribe+`/`scribe-`) |
| `!help` | Anyone | Show available commands |

## Configuration

All configuration is done via environment variables. See [.env.example](.env.example) for the full list:

- `DEEPGRAM_API_KEY` - Deepgram speech-to-text API key
- `IRC_SERVER`, `IRC_PORT`, `IRC_CHANNEL` - IRC connection settings
- `ZOOM_SDK_KEY`, `ZOOM_SDK_SECRET` - Zoom Meeting SDK credentials
- `REDIS_HOST`, `REDIS_PORT` - Redis connection settings

## Project Status

- [x] Transcription gateway with Deepgram streaming
- [x] IRC bot with pause/resume/chair commands
- [x] Zoom Meeting SDK bot (C++, Linux)
- [x] Speaker name resolution (Zoom participant names in transcripts)
- [x] Transcript buffering (consolidated IRC output)
- [x] W3C scribe mode toggle
- [ ] Production deployment and hardening
- [ ] Web API for remote meeting triggering

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full development guide including:

- Project structure and architecture details
- Building the C++ Zoom Bot
- Testing without a Zoom meeting
- Troubleshooting common issues

## License

[MIT](LICENSE)
