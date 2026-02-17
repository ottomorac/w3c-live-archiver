# Development Guide

## Prerequisites

- Node.js 18+ and npm 9+
- Redis server
- Deepgram API key ([deepgram.com](https://deepgram.com))
- For the Zoom Bot: CMake, C++ compiler, Zoom Meeting SDK for Linux

## Setup

1. Install Node.js dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Start Redis:
```bash
# Using Docker
docker run -d -p 6379:6379 redis:alpine

# Or install locally
# Ubuntu: sudo apt-get install redis-server && sudo systemctl start redis-server
# macOS: brew install redis && brew services start redis
```

4. Get a Deepgram API key:
   - Sign up at https://deepgram.com
   - Create an API key with streaming permissions
   - Add to `.env` as `DEEPGRAM_API_KEY`

## Project Structure

```
w3c-live-archiver/
├── packages/
│   ├── shared/                 # Shared types and utilities
│   │   └── src/
│   │       ├── types.ts        # TypeScript interfaces
│   │       ├── events.ts       # Redis channel definitions
│   │       └── index.ts
│   │
│   ├── gateway/                # Audio → Deepgram → Redis
│   │   └── src/
│   │       ├── gateway-server.ts   # WebSocket server, audio routing
│   │       ├── deepgram-client.ts  # Deepgram streaming connection
│   │       ├── speaker-map.ts      # Maps Deepgram speaker IDs to Zoom names
│   │       ├── session-manager.ts  # Session state management
│   │       ├── config.ts
│   │       └── index.ts
│   │
│   ├── irc-bot/                # IRC client + command handler
│   │   └── src/
│   │       ├── bot.ts              # Transcript buffering and posting
│   │       ├── irc-client.ts       # IRC connection wrapper
│   │       ├── command-handler.ts  # !pause, !resume, !chair, !scribe
│   │       ├── config.ts
│   │       └── index.ts
│   │
│   └── zoom-bot/               # C++ Zoom Meeting SDK bot
│       ├── CMakeLists.txt
│       ├── run.sh              # Launch script (sets LD_LIBRARY_PATH)
│       ├── src/
│       │   ├── main.cpp                    # Entry point, GLib main loop
│       │   ├── config.h / config.cpp       # .env loader, CLI arg parser
│       │   ├── jwt.h / jwt.cpp             # JWT generation (HMAC-SHA256)
│       │   ├── zoom_sdk_manager.h / .cpp   # SDK lifecycle (init, auth, join)
│       │   ├── auth_event_handler.h        # Authentication callbacks
│       │   ├── meeting_event_handler.h     # Meeting + participant callbacks
│       │   ├── audio_raw_data_handler.h/.cpp  # Raw audio capture + speaker detection
│       │   ├── audio_resampler.h / .cpp    # Resample to 16kHz for Deepgram
│       │   ├── participant_tracker.h/.cpp  # Thread-safe participant name map
│       │   └── ws_client.h / ws_client.cpp # WebSocket client to gateway
│       └── third_party/
│           └── nlohmann/json.hpp           # Header-only JSON library (auto-fetched)
│
├── zoom-sdk/                   # Zoom Meeting SDK (not committed, see below)
├── .env.example
├── package.json                # Root workspace config
├── tsconfig.json
├── LICENSE
└── README.md
```

## Running the TypeScript Services

### Development Mode (hot reload)

Run both gateway and IRC bot:
```bash
npm run dev
```

Or run individually:
```bash
npm run dev:gateway
npm run dev:irc
```

### Production Build

```bash
npm run build
npm run start
```

## Building the Zoom Bot (C++)

### 1. Install system dependencies

```bash
sudo apt-get install -y cmake build-essential libssl-dev zlib1g-dev libglib2.0-dev
```

### 2. Download the Zoom Meeting SDK

Download the Zoom Meeting SDK for Linux from the [Zoom Marketplace](https://marketplace.zoom.us/).

Extract it to `zoom-sdk/` at the repository root:
```bash
# After downloading the SDK archive
tar -xzf zoom-meeting-sdk-linux-*.tar.gz -C zoom-sdk/
```

The directory should contain `libmeetingsdk.so` and an `h/` directory with headers.

Create the required versioned symlink:
```bash
cd zoom-sdk
ln -s libmeetingsdk.so libmeetingsdk.so.1
```

### 3. Get Zoom SDK credentials

1. Go to the [Zoom Marketplace](https://marketplace.zoom.us/)
2. Create a **Meeting SDK** app (not Video SDK)
3. Note the **SDK Key** and **SDK Secret**
4. Add them to your `.env`:
   ```
   ZOOM_SDK_KEY=your_sdk_key
   ZOOM_SDK_SECRET=your_sdk_secret
   ```

### 4. Build the Zoom Bot

```bash
cd packages/zoom-bot
mkdir -p build && cd build
cmake ..
make -j$(nproc)
```

CMake will automatically fetch [IXWebSocket](https://github.com/machinezone/IXWebSocket) and the [nlohmann/json](https://github.com/nlohmann/json) header.

### 5. Run the Zoom Bot

```bash
cd packages/zoom-bot
./run.sh --meeting-id 12345678901 --password abc123
```

The `run.sh` script sets `LD_LIBRARY_PATH` to include the Zoom SDK libraries.

Optional arguments:
- `--name "Bot Name"` - Custom display name (default: "Transcription Bot")
- `--gateway-url ws://host:port` - Gateway URL (default: `ws://localhost:8080`)

### What happens when the bot runs

1. Initializes the Zoom SDK and authenticates with a JWT
2. Joins the specified meeting (may land in waiting room)
3. Once admitted, joins VoIP audio and mutes its microphone
4. Requests recording permission (host must approve in Zoom)
5. Subscribes to raw audio and begins streaming to the gateway
6. Sends speaker metadata (who is talking) every 300ms

## Testing Without Zoom

You can test the gateway and IRC bot without the Zoom Bot by sending audio directly:

```bash
# Generate 10 seconds of test audio (16kHz, mono, 16-bit PCM)
ffmpeg -f lavfi -i "sine=frequency=440:duration=10" -ar 16000 -ac 1 -f s16le test-tone.raw

# Send to gateway
node test-audio-sender.js
```

Or use the test audio sender in the repo:
```javascript
// test-audio-sender.js
import WebSocket from 'ws';
import fs from 'fs';

const ws = new WebSocket('ws://localhost:8080');
ws.on('open', () => {
  const audio = fs.readFileSync('test-tone.raw');
  // Send in chunks to simulate streaming
  const chunkSize = 3200; // 100ms at 16kHz mono 16-bit
  for (let i = 0; i < audio.length; i += chunkSize) {
    const chunk = audio.slice(i, i + chunkSize);
    ws.send(chunk);
  }
});
```

## IRC Command Testing

1. Ensure the bot has joined your IRC channel
2. Test commands:
```
!help               # Show available commands
!status             # Check transcription state
!chair YourNick     # Add yourself as a chair
!pause              # Pause transcription (chair only)
!resume             # Resume transcription (chair only)
!scribe             # Toggle W3C scribe mode (scribe+/scribe-)
```

## Monitoring

### Check Redis Activity

```bash
# Monitor all Redis pub/sub in real time
redis-cli monitor

# Subscribe to transcript events directly
redis-cli SUBSCRIBE transcription:events
redis-cli SUBSCRIBE transcription:state
redis-cli SUBSCRIBE transcription:commands
```

### Logs

All services log to stdout with prefixed tags:
- `[Gateway]` - Gateway server events
- `[Deepgram]` - Deepgram connection and transcript events
- `[SpeakerMap]` - Speaker name mapping events
- `[IRC]` / `[Bot]` - IRC bot events
- `[SDK]` / `[Auth]` / `[Meeting]` - Zoom Bot events

## Troubleshooting

### "DEEPGRAM_API_KEY is required"
Make sure `.env` exists and contains `DEEPGRAM_API_KEY=your_key`.

### IRC bot not connecting
- Check `IRC_SERVER` and `IRC_PORT` in `.env`
- Some servers require SASL authentication: set `IRC_SASL_USERNAME` and `IRC_SASL_PASSWORD`

### Redis connection failed
- Ensure Redis is running: `redis-cli ping` should return `PONG`
- Check `REDIS_HOST` and `REDIS_PORT` in `.env`

### Deepgram 429 (rate limited)
Too many connection attempts in a short time. The gateway has built-in backoff (5 seconds). Wait a moment and it will reconnect automatically.

### Zoom Bot: "libmeetingsdk.so.1: cannot open shared object file"
Create the versioned symlink:
```bash
cd zoom-sdk
ln -s libmeetingsdk.so libmeetingsdk.so.1
```

### Zoom Bot: Authentication fails / callbacks never fire
The Zoom SDK on Linux requires a GLib main loop for event dispatch. The bot uses `g_main_loop_run()` for this. If you modify `main.cpp`, make sure the main loop is running.

### Zoom Bot: Audio subscription error 12 (NO_PERMISSION)
The host needs to approve the recording permission request. When the bot joins:
1. Look for "Transcription Bot wants to record" in Zoom
2. Click "Approve" as the meeting host
3. The bot will automatically start capturing audio

### No transcripts appearing in IRC
1. Check that Deepgram is connected (look for `[Deepgram] Connection opened` in gateway logs)
2. Verify audio is flowing (the gateway should not show "Cannot send audio" messages)
3. Ensure transcription state is ACTIVE (use `!status` in IRC)
4. Check that Redis pub/sub is working (`redis-cli SUBSCRIBE transcription:events`)

### Audio plays through laptop speakers when zoom-bot runs
The Zoom SDK outputs meeting audio to the local audio device. The bot mutes its own mic but does not suppress audio output. For headless deployment, use a virtual audio sink:
```bash
# Create a null audio sink (PulseAudio)
pactl load-module module-null-sink sink_name=zoom_null
export PULSE_SINK=zoom_null
```
