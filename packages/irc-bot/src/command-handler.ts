/**
 * IRC command parser and handler
 */

import type Redis from 'ioredis';
import { CommandType, REDIS_CHANNELS, type Command } from '@transcriber/shared';

export interface CommandContext {
  nick: string;
  channel: string;
  message: string;
}

export class CommandHandler {
  private readonly commandPrefix: string;
  constructor(private redis: Redis, botNick: string) {
    this.commandPrefix = `${botNick},`;
  }

  async handleMessage(ctx: CommandContext): Promise<string | null> {
    const { message, nick, channel } = ctx;

    if (!message.toLowerCase().startsWith(this.commandPrefix.toLowerCase())) {
      return null;
    }

    const body = message.slice(this.commandPrefix.length).trim();
    const parts = body.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case 'connect':
        return await this.handleConnect(nick, channel);

      case 'pause':
        return await this.handlePause(nick, channel);

      case 'resume':
        return await this.handleResume(nick, channel);

      case 'status':
        return await this.handleStatus(nick, channel);

      case 'help':
        return this.handleHelp();

      default:
        return null;
    }
  }

  private async handleConnect(nick: string, channel: string): Promise<string> {
    const cmd: Command = {
      type: CommandType.CONNECT,
      triggeredBy: nick,
      channel,
      timestamp: Date.now()
    };
    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));
    return 'Attempting to connect to the Zoom meeting — transcription will start automatically once connected.';
  }

  private async handlePause(nick: string, channel: string): Promise<string | null> {
    const cmd: Command = {
      type: CommandType.PAUSE,
      triggeredBy: nick,
      channel,
      timestamp: Date.now()
    };
    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));
    return null;
  }

  private async handleResume(nick: string, channel: string): Promise<string | null> {
    const cmd: Command = {
      type: CommandType.RESUME,
      triggeredBy: nick,
      channel,
      timestamp: Date.now()
    };
    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));
    return null;
  }

  private async handleStatus(nick: string, channel: string): Promise<string> {
    const cmd: Command = {
      type: CommandType.STATUS,
      triggeredBy: nick,
      channel,
      timestamp: Date.now()
    };
    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));
    return '🔍 Checking transcription status...';
  }

  private handleHelp(): string {
    const p = this.commandPrefix;
    return [
      'Available commands:',
      `  ${p} connect          - Connect to the Zoom meeting and start transcription`,
      `  ${p} pause            - Pause transcription`,
      `  ${p} resume           - Resume transcription after a pause`,
      `  ${p} status           - Show transcription status`,
      `  ${p} please excuse us - Leave this IRC channel`,
      `  ${p} help             - Show this help message`
    ].join('\n');
  }
}
