#pragma once

#include "config.h"
#include "auth_event_handler.h"
#include "meeting_event_handler.h"
#include "audio_raw_data_handler.h"
#include "participant_tracker.h"
#include "ws_client.h"
#include "zoom_sdk.h"
#include "auth_service_interface.h"
#include "meeting_service_interface.h"
#include "rawdata/zoom_rawdata_api.h"
#include "meeting_service_components/meeting_recording_interface.h"
#include <atomic>

class ZoomSDKManager {
public:
    ZoomSDKManager(const Config& config, ParticipantTracker& tracker, WSClient& wsClient);
    ~ZoomSDKManager();

    bool initialize();
    bool startAuth();    // Non-blocking: kicks off auth, result comes via callback
    void leave();
    void cleanup();

    bool isInMeeting() const { return inMeeting_; }
    bool isAuthenticated() const { return authenticated_; }
    bool hasFailed() const { return failed_; }

    // Called by GLib timeout to attempt audio subscription
    void attemptAudioSubscription();

private:
    Config config_;
    ParticipantTracker& tracker_;
    WSClient& wsClient_;

    ZOOMSDK::IAuthService* authService_ = nullptr;
    ZOOMSDK::IMeetingService* meetingService_ = nullptr;

    AuthEventHandler authEventHandler_;
    MeetingEventHandler meetingEventHandler_;
    AudioRawDataHandler* audioHandler_ = nullptr;

    std::atomic<bool> authenticated_{false};
    std::atomic<bool> inMeeting_{false};
    std::atomic<bool> failed_{false};
    int audioRetryCount_ = 0;

    void onAuthComplete(ZOOMSDK::AuthResult result);
    void joinMeeting();
    void subscribeToAudio();
};
