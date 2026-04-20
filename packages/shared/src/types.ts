/**
 * Shared types for the meeting transcription system
 */

export enum TranscriptionState {
  IDLE = 'idle',
  ACTIVE = 'active',
  PAUSED = 'paused',
  ERROR = 'error'
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
  confidence: number;
}

export interface TranscriptionEvent {
  type: 'transcript' | 'state_change' | 'error';
  data: TranscriptSegment | StateChangeData | ErrorData;
  timestamp: number;
}

export interface StateChangeData {
  previousState: TranscriptionState;
  newState: TranscriptionState;
  reason?: string;
  triggeredBy?: string; // IRC user who triggered the change
}

export interface ErrorData {
  message: string;
  code?: string;
  details?: unknown;
}

export interface MeetingSession {
  id: string;
  startedAt: number;
  ircChannel: string;
  state: TranscriptionState;
}

export interface IRCConfig {
  server: string;
  port: number;
  channel: string;
  nick: string;
  username: string;
  realname: string;
  sasl?: {
    username: string;
    password: string;
  };
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}
