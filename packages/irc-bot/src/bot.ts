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
import { IRCClient, type IRCMessage, type IRCInvite } from './irc-client';
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
  private currentChannel: string | null = null;
  private activeChannels = new Set<string>();
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
    this.ircClient.on('invited', (invite: IRCInvite) => {
      console.log(`[Bot] Invited to ${invite.channel} by ${invite.invitedBy}`);
      this.ircClient.join(invite.channel);
    });

    this.ircClient.on('joined', (channel: string) => {
      if (this.config.irc.channelMeetingMap[channel]) {
        this.activeChannels.add(channel);
        this.ircClient.action(channel, `Transcription bot ready. Type "${this.config.irc.nick}, help" for commands.`);
      } else {
        this.ircClient.action(channel, 'Apologies I am not configured for this channel, please contact W3C staff to configure me');
        this.ircClient.part(channel);
      }
    });

    this.ircClient.on('parted', (channel: string) => {
      this.activeChannels.delete(channel);
      if (this.currentChannel === channel) {
        this.currentChannel = null;
      }
    });

    this.ircClient.on('message', async (msg: IRCMessage) => {
      if (this.isLeaveCommand(msg.message)) {
        this.ircClient.action(msg.channel, 'Happy to be of service bye!');
        this.ircClient.part(msg.channel);
        return;
      }

      const response = await this.commandHandler.handleMessage({
        nick: msg.nick,
        channel: msg.channel,
        message: msg.message
      });

      if (response) {
        this.sendAction(response, msg.channel);
      }
    });

    this.ircClient.on('disconnected', () => {
      console.log('[Bot] IRC disconnected, attempting reconnect...');
      this.activeChannels.clear();
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
    if (event.type !== 'transcript') return;

    this.resetSleepTimer();
    const segment = event.data as TranscriptSegment;
    this.postTranscript(segment);
  }

  private handleStateChange(event: TranscriptionEvent): void {
    if (event.type !== 'state_change') return;

    const stateChange = event.data as StateChangeData;
    this.currentState = stateChange.newState;

    if (stateChange.ircChannel) {
      this.currentChannel = stateChange.ircChannel;
    }

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
    if (this.currentState !== TranscriptionState.ACTIVE) return;

    if (this.buffer && this.buffer.speaker !== segment.speaker) {
      this.flushBuffer();
    }

    if (!this.buffer) {
      this.buffer = { speaker: segment.speaker, text: '', timer: null };
    }

    const separator = this.buffer.text ? ' ' : '';
    this.buffer.text += separator + segment.text;

    const fullLine = `${this.buffer.speaker}: ${this.buffer.text}`;
    if (fullLine.length >= MAX_LINE_LENGTH) {
      this.flushBuffer();
    } else {
      this.resetFlushTimer();
    }
  }

  private flushBuffer(): void {
    if (!this.buffer || !this.buffer.text) return;

    if (this.buffer.timer) {
      clearTimeout(this.buffer.timer);
    }

    const text = this.buffer.text.replace(/[….]+$/, '');
    const isContinuation = this.buffer.speaker === this.lastPostedSpeaker;
    const speaker = this.buffer.speaker.replace(/ /g, ' ');
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

  private isLeaveCommand(message: string): boolean {
    const prefix = `${this.config.irc.nick},`;
    if (!message.toLowerCase().startsWith(prefix.toLowerCase())) return false;
    return message.slice(prefix.length).trim().toLowerCase() === 'please excuse us';
  }

  private sendMessage(message: string, channel?: string): void {
    const target = channel ?? this.currentChannel;
    if (!this.ircClient.isConnected() || !target) return;

    for (const line of message.split('\n')) {
      if (line.trim()) this.ircClient.say(target, line);
    }
  }

  private sendAction(message: string, channel?: string): void {
    const target = channel ?? this.currentChannel;
    if (!this.ircClient.isConnected() || !target) return;

    for (const line of message.split('\n')) {
      if (line.trim()) this.ircClient.action(target, line);
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
