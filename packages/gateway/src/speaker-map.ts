/**
 * Maps Deepgram's speaker indices (Speaker 0, Speaker 1, ...) to real
 * Zoom participant names using active-speaker metadata from the zoom-bot.
 *
 * Strategy:
 * - The zoom-bot sends speaker_update messages every ~300ms listing who is
 *   currently speaking (based on per-participant audio RMS energy).
 * - When Deepgram emits a transcript with "Speaker N", we check if that
 *   speaker index has already been mapped to a name.
 * - If not, we assume the currently active Zoom speaker corresponds to this
 *   new Deepgram index and create the mapping.
 * - Once a mapping is established, it persists for the session.
 */

interface SpeakerEntry {
  name: string;
  zoomUserId: number;
}

interface ActiveSpeaker {
  userId: number;
  name: string;
  timestamp: number;
}

export class SpeakerMap {
  // Deepgram speaker index → resolved name
  private indexToName = new Map<number, SpeakerEntry>();
  // Track names already assigned to avoid duplicates
  private assignedNames = new Set<string>();
  // Most recent active speakers from zoom-bot
  private activeSpeakers: ActiveSpeaker[] = [];

  /**
   * Update the list of currently active speakers (from zoom-bot metadata).
   */
  updateActiveSpeakers(speakers: Array<{ userId: number; name: string }>): void {
    const now = Date.now();
    this.activeSpeakers = speakers.map(s => ({
      userId: s.userId,
      name: s.name,
      timestamp: now,
    }));
  }

  /**
   * Handle a participant joining - no action needed, speaker_update handles it.
   */
  addParticipant(userId: number, name: string): void {
    // If this name was previously mapped to an index, update it
    for (const [idx, entry] of this.indexToName) {
      if (entry.zoomUserId === userId) {
        entry.name = name;
        break;
      }
    }
  }

  /**
   * Handle a participant leaving - keep the mapping (Deepgram indices are stable).
   */
  removeParticipant(userId: number): void {
    // Keep mapping intact - Deepgram will keep using the same index
  }

  /**
   * Resolve Deepgram's "Speaker N" label to a real name.
   * Returns the real name if mapped, otherwise the original label.
   */
  resolve(deepgramSpeaker: string): string {
    const match = deepgramSpeaker.match(/^Speaker (\d+)$/);
    if (!match) return deepgramSpeaker;

    const index = parseInt(match[1], 10);

    // If we already have a mapping for this index, use it
    const existing = this.indexToName.get(index);
    if (existing) {
      return existing.name;
    }

    // Try to assign: pick the first active speaker not already mapped
    const now = Date.now();
    for (const speaker of this.activeSpeakers) {
      // Only consider recent activity (within last 3 seconds)
      if (now - speaker.timestamp > 3000) continue;
      if (this.assignedNames.has(speaker.name)) continue;

      // Map this Deepgram index to this Zoom participant
      this.indexToName.set(index, {
        name: speaker.name,
        zoomUserId: speaker.userId,
      });
      this.assignedNames.add(speaker.name);
      console.log(`[SpeakerMap] Mapped Speaker ${index} → ${speaker.name}`);
      return speaker.name;
    }

    // No mapping found - return original label
    return deepgramSpeaker;
  }

  /**
   * Reset all mappings (e.g., when starting a new session).
   */
  reset(): void {
    this.indexToName.clear();
    this.assignedNames.clear();
    this.activeSpeakers = [];
  }
}
