import type { ChannelMeetingMap } from './types';

/**
 * Parses CHANNEL_MEETING_MAP: comma-separated #channel:meetingId:zoomUserId entries.
 *
 * zoomUserId stays optional at parse time: a user only learns their ID from
 * /oauth/install, which needs the gateway to be running with this config.
 */
export function parseChannelMeetingMap(raw: string): ChannelMeetingMap {
  const map: ChannelMeetingMap = {};
  for (const entry of raw.split(',')) {
    const [channel, meetingId, zoomUserId] = entry.split(':').map((part) => part.trim());
    if (channel && meetingId) {
      map[channel] = zoomUserId ? { meetingId, zoomUserId } : { meetingId };
    }
  }
  return map;
}
