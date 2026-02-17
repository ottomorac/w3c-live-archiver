#include "participant_tracker.h"
#include <iostream>

void ParticipantTracker::addParticipant(uint32_t userId, const std::string& name) {
    std::lock_guard<std::mutex> lock(mutex_);
    participants_[userId] = {userId, name, 0, false};
    std::cout << "[Participants] Added: " << name << " (ID: " << userId << ")" << std::endl;
}

void ParticipantTracker::removeParticipant(uint32_t userId) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = participants_.find(userId);
    if (it != participants_.end()) {
        std::cout << "[Participants] Removed: " << it->second.name << " (ID: " << userId << ")" << std::endl;
        participants_.erase(it);
    }
}

void ParticipantTracker::updateName(uint32_t userId, const std::string& name) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = participants_.find(userId);
    if (it != participants_.end()) {
        it->second.name = name;
    }
}

void ParticipantTracker::markActive(uint32_t userId, uint64_t timestamp) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = participants_.find(userId);
    if (it != participants_.end()) {
        it->second.isActive = true;
        it->second.lastActiveTimestamp = timestamp;
    }
}

std::vector<ActiveSpeaker> ParticipantTracker::getActiveSpeakers() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<ActiveSpeaker> speakers;
    for (const auto& [id, info] : participants_) {
        if (info.isActive) {
            speakers.push_back({info.userId, info.name});
        }
    }
    return speakers;
}

void ParticipantTracker::decayActivity(uint64_t currentTimestamp, uint64_t thresholdMs) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto& [id, info] : participants_) {
        if (info.isActive && (currentTimestamp - info.lastActiveTimestamp) > thresholdMs) {
            info.isActive = false;
        }
    }
}

std::string ParticipantTracker::getName(uint32_t userId) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = participants_.find(userId);
    if (it != participants_.end()) {
        return it->second.name;
    }
    return "Unknown";
}

std::vector<ParticipantInfo> ParticipantTracker::getAllParticipants() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<ParticipantInfo> result;
    for (const auto& [id, info] : participants_) {
        result.push_back(info);
    }
    return result;
}
