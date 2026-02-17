/**
 * Deepgram streaming client wrapper
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { DeepgramConfig, TranscriptSegment } from '@transcriber/shared';
import { EventEmitter } from 'events';

export class DeepgramStreamClient extends EventEmitter {
  private client: ReturnType<typeof createClient>;
  private connection: any;
  private isConnected = false;

  constructor(private config: DeepgramConfig) {
    super();
    this.client = createClient(config.apiKey);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.connection = this.client.listen.live({
          model: this.config.model || 'nova-2',
          language: this.config.language || 'en',
          diarize: this.config.diarize ?? true,
          punctuate: this.config.punctuate ?? true,
          interim_results: this.config.interim_results ?? true,
          smart_format: true,
          encoding: 'linear16',
          sample_rate: 16000,
          channels: 1
        });

        let settled = false;

        this.connection.on(LiveTranscriptionEvents.Open, () => {
          console.log('[Deepgram] Connection opened');
          this.isConnected = true;
          this.emit('connected');
          if (!settled) { settled = true; resolve(); }
        });

        this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
          const channel = data.channel;
          const alternatives = channel?.alternatives;

          if (!alternatives || alternatives.length === 0) {
            return;
          }

          const isFinal = data.is_final || data.speech_final;
          if (!isFinal) {
            return;
          }

          const transcript = alternatives[0].transcript;
          const words = alternatives[0].words;

          if (!transcript || transcript.trim() === '') {
            return;
          }

          let speaker = 'Speaker 0';
          if (words && words.length > 0 && words[0].speaker !== undefined) {
            speaker = `Speaker ${words[0].speaker}`;
          }

          const segment: TranscriptSegment = {
            speaker,
            text: transcript,
            timestamp: Date.now(),
            confidence: alternatives[0].confidence || 0
          };

          this.emit('transcript', segment);
        });

        this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
          console.error('[Deepgram] Error:', error.message || error);
          this.emit('error', error);
          if (!settled) { settled = true; reject(error); }
        });

        this.connection.on(LiveTranscriptionEvents.Close, () => {
          console.log('[Deepgram] Connection closed');
          this.isConnected = false;
          this.emit('closed');
          if (!settled) { settled = true; reject(new Error('Connection closed before opening')); }
        });

      } catch (error) {
        console.error('[Deepgram] Failed to connect:', error);
        reject(error);
      }
    });
  }

  sendAudio(audioData: Buffer): void {
    if (!this.isConnected || !this.connection) {
      console.warn('[Deepgram] Cannot send audio: not connected');
      return;
    }

    try {
      this.connection.send(audioData);
    } catch (error) {
      console.error('[Deepgram] Error sending audio:', error);
      this.emit('error', error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.finish();
        this.isConnected = false;
      } catch (error) {
        console.error('[Deepgram] Error disconnecting:', error);
      }
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
