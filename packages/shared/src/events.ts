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
  PAUSE = 'pause',
  RESUME = 'resume',
  STATUS = 'status',
  SET_CHAIR = 'set_chair',
  REMOVE_CHAIR = 'remove_chair'
}

export interface Command {
  type: CommandType;
  triggeredBy: string; // IRC nick
  timestamp: number;
  args?: Record<string, unknown>;
}
