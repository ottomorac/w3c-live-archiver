#pragma once

#include "rawdata/rawdata_audio_helper_interface.h"
#include "zoom_sdk_raw_data_def.h"
#include "participant_tracker.h"
#include "ws_client.h"
#include "audio_resampler.h"
#include <chrono>
#include <atomic>

class AudioRawDataHandler : public ZOOMSDK::IZoomSDKAudioRawDataDelegate {
public:
    AudioRawDataHandler(ParticipantTracker& tracker, WSClient& wsClient);

    // IZoomSDKAudioRawDataDelegate callbacks
    void onMixedAudioRawDataReceived(AudioRawData* data_) override;
    void onOneWayAudioRawDataReceived(AudioRawData* data_, uint32_t user_id) override;
    void onShareAudioRawDataReceived(AudioRawData* data_, uint32_t user_id) override;
    void onOneWayInterpreterAudioRawDataReceived(AudioRawData* data_, const zchar_t* pLanguageName) override;

private:
    ParticipantTracker& tracker_;
    WSClient& wsClient_;
    uint64_t lastSpeakerUpdateMs_ = 0;
    static constexpr uint64_t SPEAKER_UPDATE_INTERVAL_MS = 300;

    // Compute RMS energy of audio buffer to detect speech
    static double computeRMS(const char* buffer, unsigned int bufferLen);
    static constexpr double SPEECH_THRESHOLD = 500.0; // RMS threshold for speech detection

    uint64_t nowMs() const;
    void sendActiveSpeakerUpdate();
};
