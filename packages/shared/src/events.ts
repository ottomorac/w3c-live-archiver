/**
 * Redis pub/sub event channels and utilities
 */

export const REDIS_CHANNELS = {
  TRANSCRIPTION_EVENTS: 'transcription:events',
  STATE_CHANGES: 'transcription:state',
  COMMANDS: 'transcription:commands',
  AUDIO_STREAM: 'transcription:audio'
} as const;

export enum CommandType {
  CONNECT = 'connect',
  PAUSE = 'pause',
  RESUME = 'resume',
  STATUS = 'status',
}

export interface Command {
  type: CommandType;
  triggeredBy: string;
  timestamp: number;
  channel?: string;
  args?: Record<string, unknown>;
}
