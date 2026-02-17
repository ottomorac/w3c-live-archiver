# Transcription Gateway

Receives audio streams from Zoom bot, transcribes via Deepgram, and publishes events to Redis.

## Features

- WebSocket server for receiving audio streams
- Deepgram streaming transcription with speaker diarization
- State management (active/paused/idle)
- Command handling via Redis pub/sub
- Permission-based pause/resume (meeting chairs only)

## Architecture

```
Audio Source → WebSocket → Gateway → Deepgram API
                             ↓
                        Redis Pub/Sub
                             ↓
                          IRC Bot
```

## Configuration

Set environment variables in `.env`:

```bash
DEEPGRAM_API_KEY=your_api_key
GATEWAY_WS_PORT=8080
REDIS_HOST=localhost
REDIS_PORT=6379
IRC_CHANNEL=#your-channel
```

## Running

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## WebSocket Protocol

Send raw PCM audio data (16kHz, mono, 16-bit linear PCM):

```javascript
const ws = new WebSocket('ws://localhost:8080');
ws.send(audioBuffer); // Buffer containing PCM audio
```

## State Machine

- **IDLE**: Not transcribing
- **ACTIVE**: Actively transcribing audio
- **PAUSED**: Audio is dropped, not sent to Deepgram

## Redis Events Published

### Transcription Events
Channel: `transcription:events`

```json
{
  "type": "transcript",
  "data": {
    "speaker": "Speaker 0",
    "text": "Hello everyone",
    "timestamp": 1234567890,
    "confidence": 0.95
  }
}
```

### State Changes
Channel: `transcription:state`

```json
{
  "type": "state_change",
  "data": {
    "previousState": "active",
    "newState": "paused",
    "reason": "Paused by alice"
  }
}
```

## Commands (via Redis)

Channel: `transcription:commands`

```json
{
  "type": "pause",
  "triggeredBy": "alice",
  "timestamp": 1234567890
}
```

Supported commands:
- `pause` - Pause transcription (chairs only)
- `resume` - Resume transcription (chairs only)
- `set_chair` - Add meeting chair
