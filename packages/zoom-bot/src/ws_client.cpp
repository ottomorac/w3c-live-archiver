#include "ws_client.h"
#include <iostream>

WSClient::WSClient() {}

WSClient::~WSClient() {
    disconnect();
}

void WSClient::connect(const std::string& url) {
    ws_.setUrl(url);

    // Auto-reconnect with exponential backoff
    ws_.enableAutomaticReconnection();
    ws_.setMinWaitBetweenReconnectionRetries(1000);  // 1s
    ws_.setMaxWaitBetweenReconnectionRetries(10000); // 10s

    ws_.setOnMessageCallback([this](const ix::WebSocketMessagePtr& msg) {
        switch (msg->type) {
            case ix::WebSocketMessageType::Open:
                std::cout << "[WS] Connected to gateway" << std::endl;
                connected_ = true;
                break;

            case ix::WebSocketMessageType::Close:
                std::cout << "[WS] Disconnected from gateway: " << msg->closeInfo.reason << std::endl;
                connected_ = false;
                break;

            case ix::WebSocketMessageType::Error:
                std::cerr << "[WS] Error: " << msg->errorInfo.reason << std::endl;
                connected_ = false;
                break;

            case ix::WebSocketMessageType::Message:
                // Gateway might send commands back (future use)
                break;

            default:
                break;
        }
    });

    std::cout << "[WS] Connecting to " << url << std::endl;
    ws_.start();
}

void WSClient::disconnect() {
    ws_.stop();
    connected_ = false;
}

void WSClient::sendAudio(const char* pcm, size_t len) {
    if (!connected_) return;
    ws_.sendBinary(std::string(pcm, len));
}

void WSClient::sendMetadata(const nlohmann::json& msg) {
    if (!connected_) return;
    ws_.send(msg.dump());
}
