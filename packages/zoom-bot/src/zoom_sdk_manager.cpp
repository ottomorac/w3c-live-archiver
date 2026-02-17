#include "zoom_sdk_manager.h"
#include "jwt.h"
#include <glib.h>
#include <iostream>

ZoomSDKManager::ZoomSDKManager(const Config& config, ParticipantTracker& tracker, WSClient& wsClient)
    : config_(config), tracker_(tracker), wsClient_(wsClient),
      meetingEventHandler_(tracker, wsClient) {}

ZoomSDKManager::~ZoomSDKManager() {
    cleanup();
}

bool ZoomSDKManager::initialize() {
    std::cout << "[SDK] Initializing Zoom SDK..." << std::endl;

    ZOOMSDK::InitParam initParam;
    initParam.strWebDomain = "https://zoom.us";
    initParam.emLanguageID = ZOOMSDK::LANGUAGE_English;
    initParam.enableLogByDefault = true;

    auto err = ZOOMSDK::InitSDK(initParam);
    if (err != ZOOMSDK::SDKERR_SUCCESS) {
        std::cerr << "[SDK] InitSDK failed with error: " << err << std::endl;
        return false;
    }

    std::cout << "[SDK] SDK initialized successfully" << std::endl;
    return true;
}

bool ZoomSDKManager::startAuth() {
    std::cout << "[SDK] Authenticating..." << std::endl;

    auto err = ZOOMSDK::CreateAuthService(&authService_);
    if (err != ZOOMSDK::SDKERR_SUCCESS || !authService_) {
        std::cerr << "[SDK] CreateAuthService failed: " << err << std::endl;
        return false;
    }

    // Set up auth callback - on success, automatically joins the meeting
    authEventHandler_.setCallback([this](ZOOMSDK::AuthResult result) {
        onAuthComplete(result);
    });

    authService_->SetEvent(&authEventHandler_);

    // Generate JWT token
    std::string jwt = generateZoomJWT(config_.sdkKey, config_.sdkSecret);

    ZOOMSDK::AuthContext authContext;
    authContext.jwt_token = jwt.c_str();

    err = authService_->SDKAuth(authContext);
    if (err != ZOOMSDK::SDKERR_SUCCESS) {
        std::cerr << "[SDK] SDKAuth call failed: " << err << std::endl;
        return false;
    }

    // Auth result will arrive via callback (processed by GLib main loop)
    std::cout << "[SDK] Auth request sent, waiting for callback..." << std::endl;
    return true;
}

void ZoomSDKManager::onAuthComplete(ZOOMSDK::AuthResult result) {
    if (result == ZOOMSDK::AUTHRET_SUCCESS) {
        std::cout << "[SDK] Authentication successful!" << std::endl;
        authenticated_ = true;
        // Chain: auth succeeded → join meeting
        joinMeeting();
    } else {
        std::cerr << "[SDK] Authentication failed with result: " << result << std::endl;
        failed_ = true;
    }
}

void ZoomSDKManager::joinMeeting() {
    std::cout << "[SDK] Creating meeting service..." << std::endl;

    auto err = ZOOMSDK::CreateMeetingService(&meetingService_);
    if (err != ZOOMSDK::SDKERR_SUCCESS || !meetingService_) {
        std::cerr << "[SDK] CreateMeetingService failed: " << err << std::endl;
        failed_ = true;
        return;
    }

    // Set up meeting event handler
    meetingEventHandler_.setStatusCallback([this](ZOOMSDK::MeetingStatus status, int result) {
        if (status == ZOOMSDK::MEETING_STATUS_INMEETING) {
            std::cout << "[SDK] Successfully joined the meeting!" << std::endl;
            inMeeting_ = true;
            subscribeToAudio();
        } else if (status == ZOOMSDK::MEETING_STATUS_ENDED) {
            std::cout << "[SDK] Meeting ended" << std::endl;
            inMeeting_ = false;
        } else if (status == ZOOMSDK::MEETING_STATUS_FAILED) {
            std::cerr << "[SDK] Meeting join failed with code: " << result << std::endl;
            failed_ = true;
        }
    });

    meetingService_->SetEvent(&meetingEventHandler_);

    // Set up participants controller
    auto* participantsCtrl = meetingService_->GetMeetingParticipantsController();
    if (participantsCtrl) {
        participantsCtrl->SetEvent(&meetingEventHandler_);
        meetingEventHandler_.setParticipantsController(participantsCtrl);
    }

    // Join meeting
    std::cout << "[SDK] Joining meeting: " << config_.meetingNumber << std::endl;

    ZOOMSDK::JoinParam joinParam;
    joinParam.userType = ZOOMSDK::SDK_UT_WITHOUT_LOGIN;

    auto& join = joinParam.param.withoutloginuserJoin;
    join.meetingNumber = config_.meetingNumber;
    join.userName = config_.displayName.c_str();
    join.psw = config_.meetingPassword.c_str();
    join.isVideoOff = true;
    join.isAudioOff = false;  // Must join audio to receive raw audio data
    join.isMyVoiceInMix = false;
    join.isAudioRawDataStereo = false;

    err = meetingService_->Join(joinParam);
    if (err != ZOOMSDK::SDKERR_SUCCESS) {
        std::cerr << "[SDK] Join meeting call failed: " << err << std::endl;
        failed_ = true;
    }

    // Meeting status will arrive via callback
}

// GLib callback to attempt raw audio subscription after delay
static gboolean trySubscribeAudio(gpointer data) {
    auto* mgr = static_cast<ZoomSDKManager*>(data);
    mgr->attemptAudioSubscription();
    return FALSE;  // Don't repeat
}

void ZoomSDKManager::subscribeToAudio() {
    std::cout << "[SDK] Joining VoIP audio..." << std::endl;

    // Check raw data license
    bool hasLicense = ZOOMSDK::HasRawdataLicense();
    std::cout << "[SDK] Raw data license: " << (hasLicense ? "YES" : "NO") << std::endl;

    // Join VoIP audio first (required for raw audio access)
    auto* audioCtrl = meetingService_->GetMeetingAudioController();
    if (audioCtrl) {
        auto voipErr = audioCtrl->JoinVoip();
        std::cout << "[SDK] JoinVoip result: " << voipErr << std::endl;

        // Mute our mic so we don't transmit noise
        audioCtrl->MuteAudio(0, true);  // 0 = self
    }

    // Delay audio subscription to allow VoIP to fully connect
    std::cout << "[SDK] Will attempt raw audio subscription in 3 seconds..." << std::endl;
    g_timeout_add(3000, trySubscribeAudio, this);
}

void ZoomSDKManager::attemptAudioSubscription() {
    std::cout << "[SDK] Attempting raw audio subscription..." << std::endl;

    // Need to start raw recording first to get permission
    auto* recCtrl = meetingService_->GetMeetingRecordingController();
    if (recCtrl) {
        auto canStart = recCtrl->CanStartRawRecording();
        std::cout << "[SDK] CanStartRawRecording: " << canStart << std::endl;

        if (canStart != ZOOMSDK::SDKERR_SUCCESS) {
            // Try requesting local recording privilege
            std::cout << "[SDK] Requesting local recording privilege..." << std::endl;
            auto reqErr = recCtrl->RequestLocalRecordingPrivilege();
            std::cout << "[SDK] RequestLocalRecordingPrivilege result: " << reqErr << std::endl;

            // Retry after delay to wait for host approval
            if (audioRetryCount_ < 5) {
                audioRetryCount_++;
                std::cout << "[SDK] Waiting for recording permission (attempt " << audioRetryCount_ << "/5)..." << std::endl;
                g_timeout_add(5000, trySubscribeAudio, this);
            } else {
                std::cerr << "[SDK] Could not get recording permission after 5 attempts." << std::endl;
                std::cerr << "[SDK] Please grant recording permission to the bot in the Zoom meeting." << std::endl;
            }
            return;
        }

        auto rawErr = recCtrl->StartRawRecording();
        std::cout << "[SDK] StartRawRecording result: " << rawErr << std::endl;
    }

    auto* audioHelper = ZOOMSDK::GetAudioRawdataHelper();
    if (!audioHelper) {
        std::cerr << "[SDK] Failed to get audio raw data helper" << std::endl;
        return;
    }

    audioHandler_ = new AudioRawDataHandler(tracker_, wsClient_);

    auto err = audioHelper->subscribe(audioHandler_);
    if (err != ZOOMSDK::SDKERR_SUCCESS) {
        std::cerr << "[SDK] Failed to subscribe to audio: " << err << std::endl;
        delete audioHandler_;
        audioHandler_ = nullptr;

        if (audioRetryCount_ < 5) {
            audioRetryCount_++;
            std::cout << "[SDK] Retrying in 5 seconds (attempt " << audioRetryCount_ << "/5)..." << std::endl;
            g_timeout_add(5000, trySubscribeAudio, this);
        }
        return;
    }

    std::cout << "[SDK] Subscribed to raw audio successfully!" << std::endl;
}

void ZoomSDKManager::leave() {
    if (meetingService_ && inMeeting_) {
        std::cout << "[SDK] Leaving meeting..." << std::endl;

        auto* audioHelper = ZOOMSDK::GetAudioRawdataHelper();
        if (audioHelper) {
            audioHelper->unSubscribe();
        }

        meetingService_->Leave(ZOOMSDK::LEAVE_MEETING);
        inMeeting_ = false;
    }
}

void ZoomSDKManager::cleanup() {
    leave();

    if (meetingService_) {
        ZOOMSDK::DestroyMeetingService(meetingService_);
        meetingService_ = nullptr;
    }

    if (authService_) {
        ZOOMSDK::DestroyAuthService(authService_);
        authService_ = nullptr;
    }

    ZOOMSDK::CleanUPSDK();

    delete audioHandler_;
    audioHandler_ = nullptr;

    std::cout << "[SDK] Cleaned up" << std::endl;
}
