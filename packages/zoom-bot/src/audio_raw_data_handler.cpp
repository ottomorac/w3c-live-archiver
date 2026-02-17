#include "audio_raw_data_handler.h"
#include <cmath>
#include <iostream>
#include <nlohmann/json.hpp>

AudioRawDataHandler::AudioRawDataHandler(ParticipantTracker& tracker, WSClient& wsClient)
    : tracker_(tracker), wsClient_(wsClient) {}

uint64_t AudioRawDataHandler::nowMs() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
}

double AudioRawDataHandler::computeRMS(const char* buffer, unsigned int bufferLen) {
    const int16_t* samples = reinterpret_cast<const int16_t*>(buffer);
    unsigned int sampleCount = bufferLen / sizeof(int16_t);
    if (sampleCount == 0) return 0.0;

    double sumSquares = 0.0;
    for (unsigned int i = 0; i < sampleCount; i++) {
        double s = static_cast<double>(samples[i]);
        sumSquares += s * s;
    }
    return std::sqrt(sumSquares / sampleCount);
}

void AudioRawDataHandler::onMixedAudioRawDataReceived(AudioRawData* data_) {
    if (!data_ || !wsClient_.isConnected()) return;

    // Resample from SDK rate to 16kHz for Deepgram
    auto resampled = AudioResampler::resample(
        data_->GetBuffer(), data_->GetBufferLen(), data_->GetSampleRate());

    if (!resampled.empty()) {
        wsClient_.sendAudio(
            reinterpret_cast<const char*>(resampled.data()),
            resampled.size() * sizeof(int16_t));
    }
}

void AudioRawDataHandler::onOneWayAudioRawDataReceived(AudioRawData* data_, uint32_t user_id) {
    if (!data_) return;

    // Compute RMS to detect if this participant is speaking
    double rms = computeRMS(data_->GetBuffer(), data_->GetBufferLen());

    if (rms > SPEECH_THRESHOLD) {
        tracker_.markActive(user_id, nowMs());
    }

    // Periodically decay inactive speakers and send updates
    uint64_t now = nowMs();
    if (now - lastSpeakerUpdateMs_ >= SPEAKER_UPDATE_INTERVAL_MS) {
        tracker_.decayActivity(now);
        sendActiveSpeakerUpdate();
        lastSpeakerUpdateMs_ = now;
    }
}

void AudioRawDataHandler::onShareAudioRawDataReceived(AudioRawData* data_, uint32_t user_id) {
    // Ignore screen share audio for now
}

void AudioRawDataHandler::onOneWayInterpreterAudioRawDataReceived(AudioRawData* data_, const zchar_t* pLanguageName) {
    // Ignore interpreter audio for now
}

void AudioRawDataHandler::sendActiveSpeakerUpdate() {
    auto speakers = tracker_.getActiveSpeakers();
    if (speakers.empty()) return;

    nlohmann::json msg;
    msg["type"] = "speaker_update";
    msg["timestamp"] = nowMs();

    nlohmann::json speakerArray = nlohmann::json::array();
    for (const auto& s : speakers) {
        speakerArray.push_back({
            {"userId", s.userId},
            {"name", s.name}
        });
    }
    msg["activeSpeakers"] = speakerArray;

    wsClient_.sendMetadata(msg);
}
