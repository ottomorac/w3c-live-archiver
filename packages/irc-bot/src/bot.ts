/**
 * Main IRC bot - handles transcript posting and commands
 */

import type Redis from 'ioredis';
import {
  REDIS_CHANNELS,
  CommandType,
  TranscriptionState,
  type Command,
  type TranscriptSegment,
  type StateChangeData,
  type TranscriptionEvent
} from '@transcriber/shared';
import { IRCClient, type IRCMessage } from './irc-client';
import { CommandHandler } from './command-handler';
import type { BotConfig } from './config';

const MAX_LINE_LENGTH = 400;
const BUFFER_FLUSH_DELAY_MS = 3000;
const SLEEP_TIMEOUT_MS = 10 * 60 * 1000;

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
  private lastPostedSpeaker: string | null = null;
  private sleepTimer: NodeJS.Timeout | null = null;
  private sleepTriggeredPause = false;

  constructor(
    private config: BotConfig,
    private redis: Redis,
    private redisSub: Redis
  ) {
    this.ircClient = new IRCClient(config.irc);
    this.commandHandler = new CommandHandler(redis, config.irc.nick);
    this.setupIRCHandlers();
    this.setupRedisSubscriptions();
  }

  private setupIRCHandlers(): void {
    this.ircClient.on('joined', (channel: string) => {
      this.sendAction(`Transcription bot ready. Type "${this.config.irc.nick}, help" for commands.`);
    });

    this.ircClient.on('message', async (msg: IRCMessage) => {
      const response = await this.commandHandler.handleMessage({
        nick: msg.nick,
        channel: msg.channel,
        message: msg.message
      });

      if (response) {
        this.sendAction(response);
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

    this.resetSleepTimer();
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
    this.lastPostedSpeaker = null;

    let message = '';
    switch (stateChange.newState) {
      case TranscriptionState.ACTIVE:
        message = '▶️  Transcription ACTIVE';
        this.sendMessage('scribe+');
        this.resetSleepTimer();
        break;
      case TranscriptionState.PAUSED:
        this.clearSleepTimer();
        if (this.sleepTriggeredPause) {
          this.sleepTriggeredPause = false;
          message = 'Going into sleep mode, transcription paused';
        } else {
          message = '⏸️  Transcription PAUSED';
        }
        this.sendMessage('scribe-');
        break;
      case TranscriptionState.IDLE:
        this.clearSleepTimer();
        message = '⏹️  Transcription STOPPED';
        this.sendMessage('scribe-');
        break;
    }

    if (stateChange.reason) {
      message += ` (${stateChange.reason})`;
    }

    this.sendAction(message);
  }

  private resetSleepTimer(): void {
    if (this.currentState !== TranscriptionState.ACTIVE) return;
    this.clearSleepTimer();
    this.sleepTimer = setTimeout(() => this.triggerSleepMode(), SLEEP_TIMEOUT_MS);
  }

  private clearSleepTimer(): void {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
  }

  private async triggerSleepMode(): Promise<void> {
    this.sleepTimer = null;
    this.sleepTriggeredPause = true;
    const cmd: Command = {
      type: CommandType.PAUSE,
      triggeredBy: 'sleep-mode',
      timestamp: Date.now()
    };
    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));
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

    const text = this.buffer.text.replace(/[\u2026.]+$/, '');
    const isContinuation = this.buffer.speaker === this.lastPostedSpeaker;
    const speaker = this.buffer.speaker.replace(/ /g, '\u00A0');
    this.sendMessage(isContinuation ? `... ${text}` : `${speaker}: ${text}...`);
    this.lastPostedSpeaker = this.buffer.speaker;
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
    if (!this.ircClient.isConnected()) {
      return;
    }

    const lines = message.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        this.ircClient.say(this.config.irc.channel, line);
      }
    }
  }

  private sendAction(message: string): void {
    if (!this.ircClient.isConnected()) {
      return;
    }

    const lines = message.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        this.ircClient.action(this.config.irc.channel, line);
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
