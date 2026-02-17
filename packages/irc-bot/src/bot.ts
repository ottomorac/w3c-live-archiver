/**
 * Main IRC bot - handles transcript posting and commands
 */

import type Redis from 'ioredis';
import {
  REDIS_CHANNELS,
  TranscriptionState,
  type TranscriptSegment,
  type StateChangeData,
  type TranscriptionEvent
} from '@transcriber/shared';
import { IRCClient, type IRCMessage } from './irc-client';
import { CommandHandler } from './command-handler';
import type { BotConfig } from './config';

// Maximum characters per IRC line (leaving room for protocol overhead + speaker prefix)
const MAX_LINE_LENGTH = 400;
// Flush buffer after this many ms of no new transcript from same speaker
const BUFFER_FLUSH_DELAY_MS = 3000;

interface TranscriptBuffer {
  speaker: string;
  text: string;
  timer: NodeJS.Timeout | null;
}

export class TranscriptionBot {
  private ircClient: IRCClient;
  private commandHandler: CommandHandler;
  private currentState: TranscriptionState = TranscriptionState.IDLE;
  private buffer: TranscriptBuffer | null = null;

  constructor(
    private config: BotConfig,
    private redis: Redis,
    private redisSub: Redis
  ) {
    this.ircClient = new IRCClient(config.irc);
    this.commandHandler = new CommandHandler(redis);
    this.setupIRCHandlers();
    this.setupRedisSubscriptions();
  }

  private setupIRCHandlers(): void {
    this.ircClient.on('joined', (channel: string) => {
      this.sendMessage('Transcription bot ready. Type !help for commands.');
    });

    this.ircClient.on('message', async (msg: IRCMessage) => {
      const response = await this.commandHandler.handleMessage({
        nick: msg.nick,
        channel: msg.channel,
        message: msg.message
      });

      if (response) {
        this.sendMessage(response);
      }
    });

    this.ircClient.on('disconnected', () => {
      console.log('[Bot] IRC disconnected, attempting reconnect...');
      setTimeout(() => this.ircClient.connect(), 5000);
    });
  }

  private setupRedisSubscriptions(): void {
    this.redisSub.subscribe(
      REDIS_CHANNELS.TRANSCRIPTION_EVENTS,
      REDIS_CHANNELS.STATE_CHANGES,
      (err) => {
        if (err) {
          console.error('[Bot] Failed to subscribe to Redis channels:', err);
          return;
        }
        console.log('[Bot] Subscribed to Redis channels');
      }
    );

    this.redisSub.on('message', (channel, message) => {
      try {
        const event: TranscriptionEvent = JSON.parse(message);

        if (channel === REDIS_CHANNELS.TRANSCRIPTION_EVENTS) {
          this.handleTranscriptEvent(event);
        } else if (channel === REDIS_CHANNELS.STATE_CHANGES) {
          this.handleStateChange(event);
        }
      } catch (error) {
        console.error('[Bot] Error handling Redis message:', error);
      }
    });
  }

  private handleTranscriptEvent(event: TranscriptionEvent): void {
    if (event.type !== 'transcript') {
      return;
    }

    const segment = event.data as TranscriptSegment;
    this.postTranscript(segment);
  }

  private handleStateChange(event: TranscriptionEvent): void {
    if (event.type !== 'state_change') {
      return;
    }

    const stateChange = event.data as StateChangeData;
    this.currentState = stateChange.newState;

    // Flush any pending transcript before posting state change
    this.flushBuffer();

    let message = '';
    switch (stateChange.newState) {
      case TranscriptionState.ACTIVE:
        message = '▶️  Transcription ACTIVE';
        break;
      case TranscriptionState.PAUSED:
        message = '⏸️  Transcription PAUSED';
        break;
      case TranscriptionState.IDLE:
        message = '⏹️  Transcription STOPPED';
        break;
    }

    if (stateChange.reason) {
      message += ` (${stateChange.reason})`;
    }

    this.sendMessage(message);
  }

  private postTranscript(segment: TranscriptSegment): void {
    if (this.currentState !== TranscriptionState.ACTIVE) {
      return;
    }

    // If speaker changed, flush previous buffer first
    if (this.buffer && this.buffer.speaker !== segment.speaker) {
      this.flushBuffer();
    }

    if (!this.buffer) {
      this.buffer = { speaker: segment.speaker, text: '', timer: null };
    }

    // Append text to buffer
    const separator = this.buffer.text ? ' ' : '';
    this.buffer.text += separator + segment.text;

    // If buffer exceeds max line length, flush it
    const fullLine = `${this.buffer.speaker}: ${this.buffer.text}`;
    if (fullLine.length >= MAX_LINE_LENGTH) {
      this.flushBuffer();
    } else {
      // Reset the flush timer
      this.resetFlushTimer();
    }
  }

  private flushBuffer(): void {
    if (!this.buffer || !this.buffer.text) return;

    if (this.buffer.timer) {
      clearTimeout(this.buffer.timer);
    }

    this.sendMessage(`${this.buffer.speaker}: ${this.buffer.text}`);
    this.buffer = null;
  }

  private resetFlushTimer(): void {
    if (!this.buffer) return;

    if (this.buffer.timer) {
      clearTimeout(this.buffer.timer);
    }

    this.buffer.timer = setTimeout(() => {
      this.flushBuffer();
    }, BUFFER_FLUSH_DELAY_MS);
  }

  private sendMessage(message: string): void {
    // Don't send if not connected yet
    if (!this.ircClient.isConnected()) {
      return;
    }

    // Split long messages
    const lines = message.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        this.ircClient.say(this.config.irc.channel, line);
      }
    }
  }

  start(): void {
    console.log('[Bot] Starting IRC bot...');
    this.ircClient.connect();
  }

  stop(): void {
    console.log('[Bot] Stopping IRC bot...');
    this.ircClient.disconnect();
  }
}
