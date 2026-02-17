#pragma once

#include <string>
#include <ixwebsocket/IXWebSocket.h>
#include <nlohmann/json.hpp>

class WSClient {
public:
    WSClient();
    ~WSClient();

    void connect(const std::string& url);
    void disconnect();

    // Send raw PCM audio data (binary frame)
    void sendAudio(const char* pcm, size_t len);

    // Send JSON metadata (text frame)
    void sendMetadata(const nlohmann::json& msg);

    bool isConnected() const { return connected_; }

private:
    ix::WebSocket ws_;
    bool connected_ = false;
};
