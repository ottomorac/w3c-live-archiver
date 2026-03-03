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
  private scribeActive = false;

  constructor(private redis: Redis, botNick: string) {
    // Accept "botNick, command args" — case-insensitive on the nick
    this.commandPrefix = `${botNick},`;
  }

  async handleMessage(ctx: CommandContext): Promise<string | null> {
    const { message, nick } = ctx;

    // Match "<botnick>, <command> [args]" case-insensitively
    if (!message.toLowerCase().startsWith(this.commandPrefix.toLowerCase())) {
      return null;
    }

    const body = message.slice(this.commandPrefix.length).trim();
    const parts = body.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'pause':
        return await this.handlePause(nick);

      case 'resume':
        return await this.handleResume(nick);

      case 'status':
        return await this.handleStatus(nick);

      case 'chair':
        return await this.handleChair(nick, args);

      case 'scribe':
        return this.handleScribe();

      case 'help':
        return this.handleHelp();

      default:
        return null;
    }
  }

  private async handlePause(nick: string): Promise<string | null> {
    const cmd: Command = {
      type: CommandType.PAUSE,
      triggeredBy: nick,
      timestamp: Date.now()
    };

    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));
    // Don't return a message - the state change event will announce the result
    return null;
  }

  private async handleResume(nick: string): Promise<string | null> {
    const cmd: Command = {
      type: CommandType.RESUME,
      triggeredBy: nick,
      timestamp: Date.now()
    };

    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));
    // Don't return a message - the state change event will announce the result
    return null;
  }

  private async handleStatus(nick: string): Promise<string> {
    const cmd: Command = {
      type: CommandType.STATUS,
      triggeredBy: nick,
      timestamp: Date.now()
    };

    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));

    // Status will be returned via Redis pub/sub
    return '🔍 Checking transcription status...';
  }

  private async handleChair(nick: string, args: string[]): Promise<string> {
    if (args.length === 0) {
      return `Usage: ${this.commandPrefix} chair <nick> - Add a meeting chair`;
    }

    const chairNick = args[0];
    const cmd: Command = {
      type: CommandType.SET_CHAIR,
      triggeredBy: nick,
      timestamp: Date.now(),
      args: { nick: chairNick }
    };

    await this.redis.publish(REDIS_CHANNELS.COMMANDS, JSON.stringify(cmd));
    return `✓ Added ${chairNick} as meeting chair`;
  }

  private handleScribe(): string {
    this.scribeActive = !this.scribeActive;
    return this.scribeActive ? 'scribe+' : 'scribe-';
  }

  private handleHelp(): string {
    const p = this.commandPrefix;
    return [
      'Available commands:',
      `  ${p} pause          - Pause transcription (chairs only)`,
      `  ${p} resume         - Resume transcription (chairs only)`,
      `  ${p} status         - Show transcription status`,
      `  ${p} chair <nick>   - Add a meeting chair`,
      `  ${p} scribe         - Toggle scribe mode (scribe+/scribe-)`,
      `  ${p} help           - Show this help message`
    ].join('\n');
  }
}
