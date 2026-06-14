/**
 * IRC client wrapper
 */

import type { IRCConfig } from '@transcriber/shared';
import { EventEmitter } from 'events';

const IrcFramework = require('irc-framework');
const Client = IrcFramework.Client || IrcFramework;

export interface IRCMessage {
  nick: string;
  channel: string;
  message: string;
}

export interface IRCInvite {
  channel: string;
  invitedBy: string;
}

export class IRCClient extends EventEmitter {
  private client: any;
  private connected = false;

  constructor(private config: IRCConfig) {
    super();
    this.client = new Client();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('registered', () => {
      console.log('[IRC] Connected to server');
      this.connected = true;
      // No auto-join — bot waits to be invited
    });

    this.client.on('join', (event: any) => {
      if (event.nick === this.client.user.nick) {
        console.log(`[IRC] Joined channel: ${event.channel}`);
        this.emit('joined', event.channel);
      }
    });

    this.client.on('part', (event: any) => {
      if (event.nick === this.client.user.nick) {
        console.log(`[IRC] Left channel: ${event.channel}`);
        this.emit('parted', event.channel);
      }
    });

    this.client.on('invite', (event: any) => {
      console.log(`[IRC] Invited to ${event.channel} by ${event.nick}`);
      this.emit('invited', { channel: event.channel, invitedBy: event.nick } as IRCInvite);
    });

    this.client.on('privmsg', (event: any) => {
      const message: IRCMessage = {
        nick: event.nick,
        channel: event.target,
        message: event.message
      };
      this.emit('message', message);
    });

    this.client.on('close', () => {
      console.log('[IRC] Connection closed');
      this.connected = false;
      this.emit('disconnected');
    });

    this.client.on('socket error', (error: Error) => {
      console.error('[IRC] Socket error:', error);
      this.emit('error', error);
    });
  }

  connect(): void {
    console.log(`[IRC] Connecting to ${this.config.server}:${this.config.port}`);
    this.client.connect({
      host: this.config.server,
      port: this.config.port,
      nick: this.config.nick,
      username: this.config.username,
      gecos: this.config.realname,
      account: this.config.sasl ? {
        account: this.config.sasl.username,
        password: this.config.sasl.password
      } : undefined
    });
  }

  join(channel: string): void {
    if (!this.connected) {
      console.warn('[IRC] Cannot join channel: not connected');
      return;
    }
    this.client.join(channel);
  }

  part(channel: string, message?: string): void {
    if (!this.connected) return;
    this.client.part(channel, message ?? '');
  }

  say(target: string, message: string): void {
    if (!this.connected) {
      console.warn('[IRC] Cannot send message: not connected');
      return;
    }
    this.client.say(target, message);
  }

  action(target: string, message: string): void {
    if (!this.connected) {
      console.warn('[IRC] Cannot send action: not connected');
      return;
    }
    this.client.action(target, message);
  }

  disconnect(): void {
    if (this.connected) {
      this.client.quit('Transcription bot shutting down');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
