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
  type Command,
} from '@transcriber/shared';
import { SessionManager } from './session-manager';
import { RTMSSession } from './rtms-session';
import type { RTMSGatewayConfig } from './config';

export class RTMSGateway {
  private app = express();
  private sessionManager: SessionManager;
  private activeSessions = new Map<string, RTMSSession>(); // streamId → session

  private static readonly MAX_RTMS_START_ATTEMPTS = 3;

  private currentIrcChannel: string | null = null;
  private userAccessToken: string | null = null;
  private refreshToken: string | null = null;

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
    await this.sessionManager.createSession();

    const { port, path } = this.config.webhook;
    this.app.listen(port, () => {
      console.log(`[RTMSGateway] Webhook listening on port ${port} at ${path}`);
      console.log('[RTMSGateway] Ready — RTMS will connect when Zoom auto-starts it for an authorised meeting');
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
    this.app.use(express.raw({ type: '*/*' }));

    // OAuth install — open this URL in a browser to install the app on your account
    this.app.get('/oauth/install', (_req: Request, res: Response) => {
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
          const data: any = await response.json();
          this.userAccessToken = data.access_token;
          this.refreshToken = data.refresh_token;
          console.log('[RTMSGateway] OAuth token exchange successful — app installed, access token stored');
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
        const plainToken: string = payload.plainToken;
        const encryptedToken = createHmac('sha256', this.config.zoom.secretToken)
          .update(plainToken)
          .digest('hex');
        res.json({ plainToken, encryptedToken });
        return;
      }

      res.status(200).send();

      if (event === 'meeting.started') {
        this.handleMeetingStarted(payload);
      } else if (event === 'meeting.rtms_started') {
        this.handleRTMSStarted(payload).catch((err) =>
          console.error('[RTMSGateway] Error handling rtms_started:', err)
        );
      } else if (event === 'meeting.rtms_stopped') {
        this.handleRTMSStopped(payload).catch((err) =>
          console.error('[RTMSGateway] Error handling rtms_stopped:', err)
        );
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

    try {
      return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(receivedSig));
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Manual RTMS start via REST API (triggered by meeting.started)
  // ---------------------------------------------------------------------------

  private handleMeetingStarted(payload: any): void {
    const meetingId = String(payload.object?.id ?? '');
    const topic = payload.object?.topic ?? '';
    const ircChannel = this.lookupChannelByMeetingId(meetingId);
    console.log(
      `[RTMSGateway] meeting.started: id=${meetingId}, topic="${topic}"` +
      (ircChannel ? ` → mapped to ${ircChannel}` : ' (not in CHANNEL_MEETING_MAP)')
    );
  }

  private async callStartRTMS(meetingId: string): Promise<void> {
    if (!this.userAccessToken) {
      console.error('[RTMSGateway] startRTMS: no OAuth access token — visit /oauth/install first');
      return;
    }

    const url = `https://api.zoom.us/v2/live_meetings/${encodeURIComponent(meetingId)}/rtms_app/status`;
    const body = JSON.stringify({
      action: 'start',
      settings: { client_id: this.config.zoom.clientId },
    });

    for (let attempt = 1; attempt <= RTMSGateway.MAX_RTMS_START_ATTEMPTS; attempt++) {
      console.log(`[RTMSGateway] startRTMS → PATCH ${url} (attempt ${attempt}/${RTMSGateway.MAX_RTMS_START_ATTEMPTS})`);
      console.log(`[RTMSGateway] startRTMS → body: ${body}`);

      let response: globalThis.Response;
      try {
        response = await fetch(url, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${this.userAccessToken}`,
            'Content-Type': 'application/json',
          },
          body,
        });
      } catch (err) {
        console.error('[RTMSGateway] startRTMS → network error:', err);
        return;
      }

      const responseText = await response.text();
      console.log(`[RTMSGateway] startRTMS → HTTP ${response.status} ${response.statusText}`);
      console.log(`[RTMSGateway] startRTMS → response body: ${responseText || '(empty)'}`);

      if (response.ok || response.status === 204) {
        console.log('[RTMSGateway] startRTMS API call succeeded — waiting for meeting.rtms_started webhook');
        return;
      }

      if (response.status === 401 && attempt < RTMSGateway.MAX_RTMS_START_ATTEMPTS) {
        console.warn('[RTMSGateway] startRTMS → 401 Unauthorized, access token likely expired — attempting refresh');
        const refreshed = await this.refreshAccessToken();
        if (!refreshed) {
          console.error('[RTMSGateway] startRTMS → token refresh failed, aborting');
          return;
        }
        continue;
      }

      console.error(`[RTMSGateway] startRTMS API call failed (${response.status})`);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // OAuth token refresh
  // ---------------------------------------------------------------------------

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) {
      console.error('[RTMSGateway] refreshAccessToken: no refresh token available — visit /oauth/install to re-authorize');
      return false;
    }

    console.log('[RTMSGateway] Refreshing OAuth access token...');
    const { clientId, clientSecret } = this.config.zoom;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    let response: globalThis.Response;
    try {
      response = await fetch('https://zoom.us/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }),
      });
    } catch (err) {
      console.error('[RTMSGateway] refreshAccessToken → network error:', err);
      return false;
    }

    const responseText = await response.text();
    console.log(`[RTMSGateway] refreshAccessToken → HTTP ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.error(`[RTMSGateway] refreshAccessToken → failed: ${responseText || '(empty)'}`);
      return false;
    }

    const data: any = JSON.parse(responseText);
    this.userAccessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    console.log('[RTMSGateway] refreshAccessToken → success, access token updated');
    return true;
  }

  // ---------------------------------------------------------------------------
  // RTMS session lifecycle
  // ---------------------------------------------------------------------------

  private async handleRTMSStarted(payload: any): Promise<void> {
    const { meeting_uuid, rtms_stream_id } = payload;
    const meetingId = String(payload.meeting_id ?? payload.id ?? '');

    if (!meeting_uuid || !rtms_stream_id) {
      console.error('[RTMSGateway] rtms_started payload missing required fields:', payload);
      return;
    }

    const ircChannel = this.lookupChannelByMeetingId(meetingId);
    if (!ircChannel) {
      console.log(`[RTMSGateway] Ignoring RTMS for unrecognised meeting ${meetingId}`);
      return;
    }

    if (this.activeSessions.has(rtms_stream_id)) {
      console.warn(`[RTMSGateway] Session already active for stream ${rtms_stream_id}`);
      return;
    }

    console.log(`[RTMSGateway] Connecting RTMS: meeting=${meeting_uuid} (${meetingId}), channel=${ircChannel}, stream=${rtms_stream_id}`);

    this.currentIrcChannel = ircChannel;

    const session = new RTMSSession(payload);
    session.on('transcript', async (t) => {
      await this.handleTranscript(t);
    });

    this.activeSessions.set(rtms_stream_id, session);
    session.start();

    await this.sessionManager.updateState(TranscriptionState.ACTIVE, 'RTMS connected', ircChannel);
  }

  private async handleRTMSStopped(payload: any): Promise<void> {
    const { rtms_stream_id } = payload;
    const session = this.activeSessions.get(rtms_stream_id);
    if (session) {
      session.stop();
      this.activeSessions.delete(rtms_stream_id);
      console.log(`[RTMSGateway] Session stopped: stream=${rtms_stream_id}`);
    }

    if (this.activeSessions.size === 0) {
      this.currentIrcChannel = null;
      await this.sessionManager.updateState(TranscriptionState.IDLE, 'Meeting ended');
    }
  }

  // Reverse lookup: meeting ID string → IRC channel name
  private lookupChannelByMeetingId(meetingId: string): string | null {
    if (!meetingId) return null;
    for (const [channel, id] of Object.entries(this.config.channelMeetingMap)) {
      if (id === meetingId) return channel;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Transcript publishing
  // ---------------------------------------------------------------------------

  private async handleTranscript(t: { speaker: string; text: string; timestamp: number }): Promise<void> {
    if (this.sessionManager.getState() !== TranscriptionState.ACTIVE) return;

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
  // IRC command handlers
  // ---------------------------------------------------------------------------

  private setupCommandHandlers(): void {
    this.sessionManager.onCommand(CommandType.CONNECT, async (cmd: Command) => {
      const channel = cmd.channel;
      if (!channel) {
        console.error('[RTMSGateway] CONNECT command missing channel');
        return;
      }

      const meetingId = this.config.channelMeetingMap[channel];
      if (!meetingId) {
        console.error(`[RTMSGateway] CONNECT: no meeting ID configured for channel ${channel}`);
        return;
      }

      if (!this.userAccessToken) {
        console.error('[RTMSGateway] CONNECT: no OAuth access token — visit /oauth/install first');
        return;
      }

      console.log(`[RTMSGateway] CONNECT from ${channel} (by ${cmd.triggeredBy}) — starting RTMS for meeting ${meetingId}`);
      await this.callStartRTMS(meetingId);
    });

    this.sessionManager.onCommand(CommandType.PAUSE, async (cmd: Command) => {
      console.log(`[RTMSGateway] Pausing transcription (by ${cmd.triggeredBy})`);
      await this.sessionManager.updateState(
        TranscriptionState.PAUSED,
        `Paused by ${cmd.triggeredBy}`,
        cmd.channel,
      );
    });

    this.sessionManager.onCommand(CommandType.RESUME, async (cmd: Command) => {
      const channel = cmd.channel ?? this.currentIrcChannel ?? undefined;
      console.log(`[RTMSGateway] Resuming transcription (by ${cmd.triggeredBy}) for channel ${channel ?? 'unknown'}`);
      await this.sessionManager.updateState(
        TranscriptionState.ACTIVE,
        `Resumed by ${cmd.triggeredBy}`,
        channel,
      );
    });
  }
}
