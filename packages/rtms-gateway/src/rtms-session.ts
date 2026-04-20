/**
 * Thin wrapper around the official @zoom/rtms SDK Client.
 *
 * The SDK handles all WebSocket protocol details internally
 * (signaling handshake, media handshake, keepalives, reconnects).
 *
 * Usage:
 *   const session = new RTMSSession(payload);
 *   session.on('transcript', ({ speaker, text, timestamp }) => { ... });
 *   session.start();
 *   session.stop();  // calls client.leave()
 */

import { EventEmitter } from 'events';
import rtms from '@zoom/rtms';

export interface RTMSTranscript {
  speaker: string;
  text: string;
  timestamp: number;
}

export class RTMSSession extends EventEmitter {
  private client: any;

  constructor(private payload: any) {
    super();
    this.client = new rtms.Client();
  }

  start(): void {
    console.log(`[RTMSSession] Starting RTMS session via SDK for meeting ${this.payload.meeting_uuid}`);

    this.client.onTranscriptData((data: Buffer | string, _size: number, timestamp: number, metadata: any) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const speaker = metadata?.userName ?? metadata?.user_name ?? 'Unknown';
      if (!text.trim()) return;
      console.log(`[RTMSSession] Transcript: ${speaker}: ${text}`);
      this.emit('transcript', { speaker, text, timestamp } as RTMSTranscript);
    });

    this.client.join(this.payload);
  }

  stop(): void {
    try {
      this.client.leave();
    } catch {
      // ignore errors on leave (meeting may already be ended)
    }
    console.log(`[RTMSSession] Stopped session for meeting ${this.payload.meeting_uuid}`);
  }
}
