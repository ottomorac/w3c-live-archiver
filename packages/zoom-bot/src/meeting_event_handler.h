#pragma once

#include "meeting_service_interface.h"
#include "meeting_service_components/meeting_audio_interface.h"
#include "meeting_service_components/meeting_participants_ctrl_interface.h"
#include "participant_tracker.h"
#include "ws_client.h"
#include <functional>
#include <iostream>
#include <nlohmann/json.hpp>

class MeetingEventHandler : public ZOOMSDK::IMeetingServiceEvent,
                             public ZOOMSDK::IMeetingParticipantsCtrlEvent {
public:
    using StatusCallback = std::function<void(ZOOMSDK::MeetingStatus, int)>;

    MeetingEventHandler(ParticipantTracker& tracker, WSClient& wsClient)
        : tracker_(tracker), wsClient_(wsClient) {}

    void setStatusCallback(StatusCallback cb) { statusCallback_ = std::move(cb); }
    void setParticipantsController(ZOOMSDK::IMeetingParticipantsController* ctrl) {
        participantsCtrl_ = ctrl;
    }

    // IMeetingServiceEvent
    void onMeetingStatusChanged(ZOOMSDK::MeetingStatus status, int iResult) override {
        std::cout << "[Meeting] Status changed: " << status;
        if (iResult != 0) std::cout << " (result: " << iResult << ")";
        std::cout << std::endl;

        if (status == ZOOMSDK::MEETING_STATUS_INMEETING) {
            std::cout << "[Meeting] In meeting! Enumerating participants..." << std::endl;
            enumerateParticipants();
        }

        if (statusCallback_) statusCallback_(status, iResult);
    }

    void onMeetingStatisticsWarningNotification(ZOOMSDK::StatisticsWarningType type) override {}
    void onMeetingParameterNotification(const ZOOMSDK::MeetingParameter* param) override {}
    void onSuspendParticipantsActivities() override {}
    void onAICompanionActiveChangeNotice(bool bActive) override {}
    void onMeetingTopicChanged(const zchar_t* sTopic) override {}
    void onMeetingFullToWatchLiveStream(const zchar_t* sLiveStreamUrl) override {}
    void onUserNetworkStatusChanged(ZOOMSDK::MeetingComponentType type, ZOOMSDK::ConnectionQuality level, unsigned int userId, bool uplink) override {}

    // IMeetingParticipantsCtrlEvent
    void onUserJoin(ZOOMSDK::IList<unsigned int>* lstUserID, const zchar_t* strUserList = nullptr) override {
        if (!lstUserID || !participantsCtrl_) return;
        for (int i = 0; i < lstUserID->GetCount(); i++) {
            unsigned int userId = lstUserID->GetItem(i);
            auto* userInfo = participantsCtrl_->GetUserByUserID(userId);
            if (userInfo) {
                std::string name = userInfo->GetUserName() ? userInfo->GetUserName() : "Unknown";
                tracker_.addParticipant(userId, name);

                // Notify gateway
                nlohmann::json msg;
                msg["type"] = "participant_joined";
                msg["userId"] = userId;
                msg["name"] = name;
                msg["timestamp"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                wsClient_.sendMetadata(msg);
            }
        }
    }

    void onUserLeft(ZOOMSDK::IList<unsigned int>* lstUserID, const zchar_t* strUserList = nullptr) override {
        if (!lstUserID) return;
        for (int i = 0; i < lstUserID->GetCount(); i++) {
            unsigned int userId = lstUserID->GetItem(i);
            std::string name = tracker_.getName(userId);
            tracker_.removeParticipant(userId);

            nlohmann::json msg;
            msg["type"] = "participant_left";
            msg["userId"] = userId;
            msg["name"] = name;
            msg["timestamp"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            wsClient_.sendMetadata(msg);
        }
    }

    void onHostChangeNotification(unsigned int userId) override {
        std::cout << "[Meeting] Host changed to user: " << userId << std::endl;
    }

    void onLowOrRaiseHandStatusChanged(bool bLow, unsigned int userid) override {}
    void onUserNamesChanged(ZOOMSDK::IList<unsigned int>* lstUserID) override {
        if (!lstUserID || !participantsCtrl_) return;
        for (int i = 0; i < lstUserID->GetCount(); i++) {
            unsigned int userId = lstUserID->GetItem(i);
            auto* userInfo = participantsCtrl_->GetUserByUserID(userId);
            if (userInfo && userInfo->GetUserName()) {
                tracker_.updateName(userId, userInfo->GetUserName());
            }
        }
    }

    void onCoHostChangeNotification(unsigned int userId, bool isCoHost) override {}
    void onInvalidReclaimHostkey() override {}
    void onAllHandsLowered() override {}
    void onLocalRecordingStatusChanged(unsigned int user_id, ZOOMSDK::RecordingStatus status) override {}
    void onAllowParticipantsRenameNotification(bool bAllow) override {}
    void onAllowParticipantsUnmuteSelfNotification(bool bAllow) override {}
    void onAllowParticipantsStartVideoNotification(bool bAllow) override {}
    void onAllowParticipantsShareWhiteBoardNotification(bool bAllow) override {}
    void onRequestLocalRecordingPrivilegeChanged(ZOOMSDK::LocalRecordingRequestPrivilegeStatus status) override {}
    void onInMeetingUserAvatarPathUpdated(unsigned int userID) override {}
    void onParticipantProfilePictureStatusChange(bool bHidden) override {}
    void onFocusModeStateChanged(bool bEnabled) override {}
    void onFocusModeShareTypeChanged(ZOOMSDK::FocusModeShareType type) override {}
    void onAllowParticipantsRequestCloudRecording(bool bAllow) override {}
    void onBotAuthorizerRelationChanged(unsigned int authorizeUserID) override {}
    void onVirtualNameTagStatusChanged(bool bOn, unsigned int userID) override {}
    void onVirtualNameTagRosterInfoUpdated(unsigned int userID) override {}
    void onGrantCoOwnerPrivilegeChanged(bool canGrantOther) override {}

private:
    ParticipantTracker& tracker_;
    WSClient& wsClient_;
    StatusCallback statusCallback_;
    ZOOMSDK::IMeetingParticipantsController* participantsCtrl_ = nullptr;

    void enumerateParticipants() {
        if (!participantsCtrl_) return;
        auto* list = participantsCtrl_->GetParticipantsList();
        if (!list) return;

        std::cout << "[Meeting] " << list->GetCount() << " participants in meeting" << std::endl;
        for (int i = 0; i < list->GetCount(); i++) {
            unsigned int userId = list->GetItem(i);
            auto* userInfo = participantsCtrl_->GetUserByUserID(userId);
            if (userInfo) {
                std::string name = userInfo->GetUserName() ? userInfo->GetUserName() : "Unknown";
                tracker_.addParticipant(userId, name);
            }
        }
    }
};
