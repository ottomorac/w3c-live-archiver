#pragma once

#include <string>
#include <unordered_map>
#include <vector>
#include <mutex>
#include <chrono>

struct ParticipantInfo {
    uint32_t userId;
    std::string name;
    uint64_t lastActiveTimestamp = 0;
    bool isActive = false;
};

struct ActiveSpeaker {
    uint32_t userId;
    std::string name;
};

class ParticipantTracker {
public:
    void addParticipant(uint32_t userId, const std::string& name);
    void removeParticipant(uint32_t userId);
    void updateName(uint32_t userId, const std::string& name);

    // Mark a participant as actively speaking
    void markActive(uint32_t userId, uint64_t timestamp);

    // Get list of currently active speakers
    std::vector<ActiveSpeaker> getActiveSpeakers() const;

    // Decay activity for participants who haven't spoken recently
    void decayActivity(uint64_t currentTimestamp, uint64_t thresholdMs = 500);

    // Get participant name by user ID
    std::string getName(uint32_t userId) const;

    // Get all participants
    std::vector<ParticipantInfo> getAllParticipants() const;

private:
    mutable std::mutex mutex_;
    std::unordered_map<uint32_t, ParticipantInfo> participants_;
};
