/**
 * Main gateway server - handles audio streams and transcription
 */

import { WebSocketServer, WebSocket } from 'ws';
import type Redis from 'ioredis';
import {
  TranscriptionState,
  REDIS_CHANNELS,
  CommandType,
  type TranscriptSegment
} from '@transcriber/shared';
import { DeepgramStreamClient } from './deepgram-client';
import { SessionManager } from './session-manager';
import { SpeakerMap } from './speaker-map';
import type { GatewayConfig } from './config';

export class GatewayServer {
  private wss: WebSocketServer;
  private deepgram: DeepgramStreamClient | null = null;
  private sessionManager: SessionManager;
  private speakerMap = new SpeakerMap();
  private connectingToDeepgram = false;
  private deepgramRetryAt = 0; // timestamp: don't retry before this time

  constructor(
    private config: GatewayConfig,
    private redis: Redis,
    redisSub: Redis
  ) {
    this.wss = new WebSocketServer({ port: config.websocket.port });
    this.sessionManager = new SessionManager(redis, redisSub);
    this.setupWebSocketServer();
    this.setupCommandHandlers();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', async (ws: WebSocket) => {
      console.log('[Gateway] Client connected');

      ws.on('message', async (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          await this.handleAudioData(data);
        } else {
          // Text frame = JSON metadata from zoom-bot
          this.handleMetadata(data.toString());
        }
      });

      ws.on('close', () => {
        console.log('[Gateway] Client disconnected');
      });

      ws.on('error', (error: Error) => {
        console.error('[Gateway] WebSocket error:', error);
      });
    });

    console.log(`[Gateway] WebSocket server listening on port ${this.config.websocket.port}`);
  }

  private setupCommandHandlers(): void {
    this.sessionManager.onCommand(CommandType.PAUSE, async (cmd) => {
      if (!this.sessionManager.isChair(cmd.triggeredBy)) {
        console.warn(`[Gateway] Unauthorized pause attempt by ${cmd.triggeredBy}`);
        return;
      }

      await this.pause(cmd.triggeredBy);
    });

    this.sessionManager.onCommand(CommandType.RESUME, async (cmd) => {
      if (!this.sessionManager.isChair(cmd.triggeredBy)) {
        console.warn(`[Gateway] Unauthorized resume attempt by ${cmd.triggeredBy}`);
        return;
      }

      await this.resume(cmd.triggeredBy);
    });

    this.sessionManager.onCommand(CommandType.SET_CHAIR, async (cmd) => {
      const nick = cmd.args?.nick as string;
      if (nick) {
        await this.sessionManager.addChair(nick, cmd.triggeredBy);
        console.log(`[Gateway] Added chair: ${nick}`);
      }
    });
  }

  private async connectToDeepgram(): Promise<void> {
    // Disconnect existing connection if any
    if (this.deepgram) {
      await this.deepgram.disconnect();
    }

    // Create new Deepgram client
    this.deepgram = new DeepgramStreamClient(this.config.deepgram);

    this.deepgram.on('transcript', async (segment: TranscriptSegment) => {
      await this.handleTranscript(segment);
    });

    this.deepgram.on('error', (error: Error) => {
      console.error('[Gateway] Deepgram error:', error.message || error);
    });

    this.deepgram.on('closed', () => {
      console.log('[Gateway] Deepgram connection closed');
    });

    try {
      await this.deepgram.connect();
    } catch (error: any) {
      console.error('[Gateway] Failed to connect to Deepgram:', error.message || error);
      this.deepgram = null;
      // Back off for 5 seconds before allowing another attempt
      this.deepgramRetryAt = Date.now() + 5000;
    }
  }

  async start(ircChannel: string, chairs: string[] = []): Promise<void> {
    console.log('[Gateway] Starting transcription service');

    // Create session
    await this.sessionManager.createSession(ircChannel, chairs);

    // Don't connect to Deepgram yet - wait for first audio data
    // This avoids Deepgram timing out before the zoom-bot is ready

    await this.sessionManager.updateState(TranscriptionState.ACTIVE, 'Started');
  }

  private handleMetadata(message: string): void {
    try {
      const msg = JSON.parse(message);
      const type = msg.type;

      if (type === 'participant_joined') {
        console.log(`[Gateway] Participant joined: ${msg.name} (ID: ${msg.userId})`);
        this.speakerMap.addParticipant(msg.userId, msg.name);
      } else if (type === 'participant_left') {
        console.log(`[Gateway] Participant left: ${msg.name} (ID: ${msg.userId})`);
        this.speakerMap.removeParticipant(msg.userId);
      } else if (type === 'speaker_update') {
        // Feed active speaker info to SpeakerMap for name resolution
        if (msg.activeSpeakers) {
          this.speakerMap.updateActiveSpeakers(msg.activeSpeakers);
        }
      } else {
        console.log(`[Gateway] Metadata: ${type}`);
      }
    } catch (e) {
      console.warn('[Gateway] Failed to parse metadata:', message.substring(0, 100));
    }
  }

  private async handleAudioData(data: Buffer): Promise<void> {
    const state = this.sessionManager.getState();

    if (state === TranscriptionState.PAUSED) {
      // Audio is dropped when paused - no buffering
      return;
    }

    if (state !== TranscriptionState.ACTIVE) {
      return;
    }

    // Connect to Deepgram on first audio (lazy connection avoids timeout)
    if (!this.deepgram || !this.deepgram.connected) {
      if (!this.connectingToDeepgram && Date.now() >= this.deepgramRetryAt) {
        console.log('[Gateway] Audio received, connecting to Deepgram...');
        this.connectingToDeepgram = true;
        await this.connectToDeepgram();
        this.connectingToDeepgram = false;
      }
      return; // Drop frames while connecting or during backoff
    }

    this.deepgram.sendAudio(data);
  }

  private async handleTranscript(segment: TranscriptSegment): Promise<void> {
    const state = this.sessionManager.getState();

    if (state !== TranscriptionState.ACTIVE) {
      return;
    }

    // Resolve Deepgram's "Speaker N" to real Zoom participant name
    segment.speaker = this.speakerMap.resolve(segment.speaker);

    // Publish transcript to Redis
    await this.redis.publish(
      REDIS_CHANNELS.TRANSCRIPTION_EVENTS,
      JSON.stringify({
        type: 'transcript',
        data: segment,
        timestamp: Date.now()
      })
    );
  }

  async pause(triggeredBy: string): Promise<void> {
    console.log(`[Gateway] Pausing transcription (by ${triggeredBy})`);
    await this.sessionManager.updateState(
      TranscriptionState.PAUSED,
      `Paused by ${triggeredBy}`
    );
  }

  async resume(triggeredBy: string): Promise<void> {
    console.log(`[Gateway] Resuming transcription (by ${triggeredBy})`);
    await this.sessionManager.updateState(
      TranscriptionState.ACTIVE,
      `Resumed by ${triggeredBy}`
    );
  }

  async stop(): Promise<void> {
    console.log('[Gateway] Stopping transcription service');

    if (this.deepgram) {
      await this.deepgram.disconnect();
      this.deepgram = null;
    }

    await this.sessionManager.updateState(TranscriptionState.IDLE, 'Stopped');
    this.wss.close();
  }
}
