/**
 * RTMS Gateway — webhook server + session orchestration + Redis publishing
 */

import { createHmac, timingSafeEqual } from 'crypto';
import express, { type Request, type Response } from 'express';
import type Redis from 'ioredis';
import {
  TranscriptionState,
  REDIS_CHANNELS,
  CommandType,
  type TranscriptSegment,
} from '@transcriber/shared';
import { SessionManager } from './session-manager';
import { RTMSSession } from './rtms-session';
import type { RTMSGatewayConfig } from './config';

export class RTMSGateway {
  private app = express();
  private sessionManager: SessionManager;
  private activeSessions = new Map<string, RTMSSession>(); // streamId → session

  constructor(
    private config: RTMSGatewayConfig,
    private redis: Redis,
    redisSub: Redis,
  ) {
    this.sessionManager = new SessionManager(redis, redisSub);
    this.setupWebhook();
    this.setupCommandHandlers();
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    console.log('[RTMSGateway] Starting...');
    await this.sessionManager.createSession(this.config.irc.channel);
    await this.sessionManager.updateState(TranscriptionState.ACTIVE, 'Started');

    const { port, path } = this.config.webhook;
    this.app.listen(port, () => {
      console.log(`[RTMSGateway] Webhook listening on port ${port} at ${path}`);
      console.log('[RTMSGateway] Ready — waiting for Zoom RTMS events');
    });
  }

  async stop(): Promise<void> {
    for (const session of this.activeSessions.values()) {
      session.stop();
    }
    this.activeSessions.clear();
    await this.sessionManager.updateState(TranscriptionState.IDLE, 'Stopped');
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  private setupWebhook(): void {
    // Parse raw body for signature verification before JSON parsing
    this.app.use(express.raw({ type: '*/*' }));

    // OAuth install — open this URL in a browser to install the app on your account
    this.app.get('/oauth/install', (req: Request, res: Response) => {
      const { clientId, oauthRedirectUri } = this.config.zoom;
      const url = `https://zoom.us/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(oauthRedirectUri)}`;
      console.log('[RTMSGateway] OAuth install — redirecting to Zoom authorization');
      res.redirect(url);
    });

    // OAuth callback — exchange authorization code for access token
    this.app.get('/oauth/callback', async (req: Request, res: Response) => {
      const code = req.query.code as string;
      if (!code) {
        res.status(400).send('Missing authorization code');
        return;
      }

      console.log('[RTMSGateway] OAuth callback — exchanging code for token');
      const { clientId, clientSecret, oauthRedirectUri } = this.config.zoom;
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      try {
        const response = await fetch('https://zoom.us/oauth/token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: oauthRedirectUri,
          }),
        });

        if (response.ok) {
          console.log('[RTMSGateway] OAuth token exchange successful — app installed');
          res.send('<html><body><h2>App installed successfully. You may close this tab.</h2></body></html>');
        } else {
          const err = await response.text();
          console.error('[RTMSGateway] OAuth token exchange failed:', err);
          res.status(500).send(`Token exchange failed: ${err}`);
        }
      } catch (err) {
        console.error('[RTMSGateway] OAuth token exchange error:', err);
        res.status(500).send('Token exchange error');
      }
    });

    this.app.post(this.config.webhook.path, (req: Request, res: Response) => {
      if (!this.verifySignature(req)) {
        console.warn('[RTMSGateway] Webhook signature invalid — rejected');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      let body: any;
      try {
        body = JSON.parse((req.body as Buffer).toString());
      } catch {
        res.status(400).json({ error: 'Invalid JSON' });
        return;
      }

      const event: string = body.event;
      const payload: any = body.payload;

      console.log(`[RTMSGateway] Webhook event: ${event}`);

      if (event === 'endpoint.url_validation') {
        // Zoom verifies the webhook URL on first setup
        const plainToken: string = payload.plainToken;
        const encryptedToken = createHmac('sha256', this.config.zoom.secretToken)
          .update(plainToken)
          .digest('hex');
        res.json({ plainToken, encryptedToken });
        return;
      }

      res.status(200).send();

      if (event === 'meeting.rtms_started') {
        this.handleRTMSStarted(payload);
      } else if (event === 'meeting.rtms_stopped') {
        this.handleRTMSStopped(payload);
      }
    });
  }

  private verifySignature(req: Request): boolean {
    const timestamp = req.headers['x-zm-request-timestamp'] as string;
    const receivedSig = req.headers['x-zm-signature'] as string;
    if (!timestamp || !receivedSig) return false;

    const rawBody = (req.body as Buffer).toString();
    const message = `v0:${timestamp}:${rawBody}`;
    const expectedSig = 'v0=' + createHmac('sha256', this.config.zoom.secretToken)
      .update(message)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    try {
      return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(receivedSig));
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // RTMS session lifecycle
  // ---------------------------------------------------------------------------

  private handleRTMSStarted(payload: any): void {
    const { meeting_uuid, rtms_stream_id } = payload;
    if (!meeting_uuid || !rtms_stream_id) {
      console.error('[RTMSGateway] rtms_started payload missing required fields:', payload);
      return;
    }

    if (this.activeSessions.has(rtms_stream_id)) {
      console.warn(`[RTMSGateway] Session already active for stream ${rtms_stream_id}`);
      return;
    }

    console.log(`[RTMSGateway] Starting RTMS session: meeting=${meeting_uuid}, stream=${rtms_stream_id}`);

    const session = new RTMSSession(payload);

    session.on('transcript', async (t) => {
      await this.handleTranscript(t);
    });

    this.activeSessions.set(rtms_stream_id, session);
    session.start();
  }

  private handleRTMSStopped(payload: any): void {
    const { rtms_stream_id } = payload;
    const session = this.activeSessions.get(rtms_stream_id);
    if (session) {
      session.stop();
      this.activeSessions.delete(rtms_stream_id);
      console.log(`[RTMSGateway] Session stopped: stream=${rtms_stream_id}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Transcript publishing
  // ---------------------------------------------------------------------------

  private async handleTranscript(t: { speaker: string; text: string; timestamp: number }): Promise<void> {
    if (this.sessionManager.getState() !== TranscriptionState.ACTIVE) {
      return;
    }

    const segment: TranscriptSegment = {
      speaker: t.speaker,
      text: t.text,
      timestamp: t.timestamp,
      confidence: 1,
    };

    await this.redis.publish(
      REDIS_CHANNELS.TRANSCRIPTION_EVENTS,
      JSON.stringify({ type: 'transcript', data: segment, timestamp: Date.now() }),
    );
  }

  // ---------------------------------------------------------------------------
  // IRC command handlers (pause / resume / chair)
  // ---------------------------------------------------------------------------

  private setupCommandHandlers(): void {
    this.sessionManager.onCommand(CommandType.PAUSE, async (cmd: Command) => {
      console.log(`[RTMSGateway] Pausing transcription (by ${cmd.triggeredBy})`);
      await this.sessionManager.updateState(
        TranscriptionState.PAUSED,
        `Paused by ${cmd.triggeredBy}`,
      );
    });

    this.sessionManager.onCommand(CommandType.RESUME, async (cmd: Command) => {
      console.log(`[RTMSGateway] Resuming transcription (by ${cmd.triggeredBy})`);
      await this.sessionManager.updateState(
        TranscriptionState.ACTIVE,
        `Resumed by ${cmd.triggeredBy}`,
      );
    });
  }
}
