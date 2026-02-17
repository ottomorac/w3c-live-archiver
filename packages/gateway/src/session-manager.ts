/**
 * Manages transcription session state
 */

import Redis from 'ioredis';
import {
  TranscriptionState,
  type MeetingSession,
  type Command,
  CommandType,
  REDIS_CHANNELS
} from '@transcriber/shared';

const SESSION_KEY = 'transcription:session:current';

export class SessionManager {
  private session: MeetingSession | null = null;
  private commandCallbacks = new Map<CommandType, (cmd: Command) => void>();

  constructor(
    private redis: Redis,
    private redisSub: Redis
  ) {
    this.setupCommandListener();
  }

  private setupCommandListener(): void {
    this.redisSub.subscribe(REDIS_CHANNELS.COMMANDS, (err) => {
      if (err) {
        console.error('[SessionManager] Failed to subscribe to commands:', err);
        return;
      }
      console.log('[SessionManager] Subscribed to commands channel');
    });

    this.redisSub.on('message', (channel, message) => {
      if (channel === REDIS_CHANNELS.COMMANDS) {
        try {
          const command: Command = JSON.parse(message);
          this.handleCommand(command);
        } catch (error) {
          console.error('[SessionManager] Error parsing command:', error);
        }
      }
    });
  }

  private handleCommand(command: Command): void {
    console.log('[SessionManager] Received command:', command.type, 'from', command.triggeredBy);

    const callback = this.commandCallbacks.get(command.type);
    if (callback) {
      callback(command);
    }
  }

  onCommand(type: CommandType, callback: (cmd: Command) => void): void {
    this.commandCallbacks.set(type, callback);
  }

  async createSession(ircChannel: string, chairs: string[] = []): Promise<MeetingSession> {
    const session: MeetingSession = {
      id: `session-${Date.now()}`,
      startedAt: Date.now(),
      ircChannel,
      chairs: chairs.map(nick => ({
        ircNick: nick,
        addedAt: Date.now()
      })),
      state: TranscriptionState.IDLE
    };

    this.session = session;
    await this.saveSession();
    return session;
  }

  async getSession(): Promise<MeetingSession | null> {
    if (this.session) {
      return this.session;
    }

    const data = await this.redis.get(SESSION_KEY);
    if (data) {
      this.session = JSON.parse(data);
    }

    return this.session;
  }

  async updateState(newState: TranscriptionState, reason?: string): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }

    const previousState = this.session.state;
    this.session.state = newState;

    await this.saveSession();

    // Publish state change event
    await this.redis.publish(
      REDIS_CHANNELS.STATE_CHANGES,
      JSON.stringify({
        type: 'state_change',
        data: {
          previousState,
          newState,
          reason
        },
        timestamp: Date.now()
      })
    );

    console.log(`[SessionManager] State: ${previousState} -> ${newState}`, reason || '');
  }

  async addChair(ircNick: string, addedBy?: string): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }

    if (!this.session.chairs.find(c => c.ircNick === ircNick)) {
      this.session.chairs.push({
        ircNick,
        addedAt: Date.now(),
        addedBy
      });
      await this.saveSession();
    }
  }

  async removeChair(ircNick: string): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }

    this.session.chairs = this.session.chairs.filter(c => c.ircNick !== ircNick);
    await this.saveSession();
  }

  isChair(ircNick: string): boolean {
    return this.session?.chairs.some(c => c.ircNick === ircNick) ?? false;
  }

  getState(): TranscriptionState {
    return this.session?.state ?? TranscriptionState.IDLE;
  }

  private async saveSession(): Promise<void> {
    if (this.session) {
      await this.redis.set(SESSION_KEY, JSON.stringify(this.session));
    }
  }

  async clearSession(): Promise<void> {
    this.session = null;
    await this.redis.del(SESSION_KEY);
  }
}
