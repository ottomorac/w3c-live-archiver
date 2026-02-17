#include "config.h"
#include <fstream>
#include <iostream>
#include <cstdlib>
#include <algorithm>
#include <filesystem>
#include <vector>

static std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

void Config::loadEnvFile(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) return;

    std::string line;
    while (std::getline(file, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#') continue;

        auto eqPos = line.find('=');
        if (eqPos == std::string::npos) continue;

        std::string key = trim(line.substr(0, eqPos));
        std::string value = trim(line.substr(eqPos + 1));

        // Remove surrounding quotes
        if (value.size() >= 2 &&
            ((value.front() == '"' && value.back() == '"') ||
             (value.front() == '\'' && value.back() == '\''))) {
            value = value.substr(1, value.size() - 2);
        }

        // Strip inline comments (only if not inside quotes)
        auto hashPos = value.find('#');
        if (hashPos != std::string::npos) {
            value = trim(value.substr(0, hashPos));
        }

        setenv(key.c_str(), value.c_str(), 0); // Don't overwrite existing env vars
    }
}

std::string Config::getEnv(const std::string& key, const std::string& defaultVal) {
    const char* val = std::getenv(key.c_str());
    return val ? std::string(val) : defaultVal;
}

Config Config::load(int argc, char* argv[]) {
    // Try to find .env file
    std::vector<std::string> envPaths = {
        ".env",
        "../.env",
        "../../.env",
        "../../../.env"
    };

    for (const auto& p : envPaths) {
        if (std::filesystem::exists(p)) {
            loadEnvFile(p);
            std::cout << "[Config] Loaded .env from: " << std::filesystem::absolute(p) << std::endl;
            break;
        }
    }

    Config config;
    config.sdkKey = getEnv("ZOOM_SDK_KEY");
    config.sdkSecret = getEnv("ZOOM_SDK_SECRET");
    config.displayName = getEnv("ZOOM_BOT_NAME", "Transcription Bot");
    config.gatewayUrl = "ws://localhost:" + getEnv("GATEWAY_WS_PORT", "8080");

    // Parse CLI args: --meeting-id, --password, --name, --gateway-url
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--meeting-id" && i + 1 < argc) {
            config.meetingNumber = std::stoull(argv[++i]);
        } else if (arg == "--password" && i + 1 < argc) {
            config.meetingPassword = argv[++i];
        } else if (arg == "--name" && i + 1 < argc) {
            config.displayName = argv[++i];
        } else if (arg == "--gateway-url" && i + 1 < argc) {
            config.gatewayUrl = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "Usage: zoom-bot --meeting-id <id> [--password <pwd>] [--name <name>] [--gateway-url <url>]" << std::endl;
            std::cout << "  --meeting-id   Zoom meeting number (required)" << std::endl;
            std::cout << "  --password     Meeting password" << std::endl;
            std::cout << "  --name         Bot display name (default: from ZOOM_BOT_NAME env)" << std::endl;
            std::cout << "  --gateway-url  Gateway WebSocket URL (default: ws://localhost:8080)" << std::endl;
            exit(0);
        }
    }

    // Validate
    if (config.sdkKey.empty() || config.sdkSecret.empty()) {
        std::cerr << "[Config] Error: ZOOM_SDK_KEY and ZOOM_SDK_SECRET are required in .env" << std::endl;
        exit(1);
    }

    if (config.meetingNumber == 0) {
        std::cerr << "[Config] Error: --meeting-id is required" << std::endl;
        std::cerr << "Usage: zoom-bot --meeting-id <id> [--password <pwd>]" << std::endl;
        exit(1);
    }

    std::cout << "[Config] Meeting: " << config.meetingNumber << std::endl;
    std::cout << "[Config] Bot name: " << config.displayName << std::endl;
    std::cout << "[Config] Gateway: " << config.gatewayUrl << std::endl;

    return config;
}
