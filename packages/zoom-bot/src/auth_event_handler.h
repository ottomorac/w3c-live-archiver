#pragma once

#include "auth_service_interface.h"
#include <functional>
#include <iostream>

class AuthEventHandler : public ZOOMSDK::IAuthServiceEvent {
public:
    using AuthCallback = std::function<void(ZOOMSDK::AuthResult)>;

    void setCallback(AuthCallback cb) { callback_ = std::move(cb); }

    void onAuthenticationReturn(ZOOMSDK::AuthResult ret) override {
        std::cout << "[Auth] Authentication result: " << ret << std::endl;
        if (callback_) callback_(ret);
    }

    void onLoginReturnWithReason(ZOOMSDK::LOGINSTATUS ret,
                                  ZOOMSDK::IAccountInfo* pAccountInfo,
                                  ZOOMSDK::LoginFailReason reason) override {
        std::cout << "[Auth] Login status: " << ret << std::endl;
    }

    void onLogout() override {
        std::cout << "[Auth] Logged out" << std::endl;
    }

    void onZoomIdentityExpired() override {
        std::cerr << "[Auth] Zoom identity expired" << std::endl;
    }

    void onZoomAuthIdentityExpired() override {
        std::cerr << "[Auth] Zoom auth identity expired" << std::endl;
    }

private:
    AuthCallback callback_;
};
