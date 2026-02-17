#pragma once

#include <string>
#include <cstdint>

struct Config {
    // Zoom SDK credentials
    std::string sdkKey;
    std::string sdkSecret;

    // Meeting info
    uint64_t meetingNumber = 0;
    std::string meetingPassword;
    std::string displayName = "Transcription Bot";

    // Gateway connection
    std::string gatewayUrl = "ws://localhost:8080";

    // Load from .env file and CLI args
    static Config load(int argc, char* argv[]);

private:
    static void loadEnvFile(const std::string& path);
    static std::string getEnv(const std::string& key, const std::string& defaultVal = "");
};
