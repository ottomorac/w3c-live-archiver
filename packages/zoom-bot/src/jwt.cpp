#include "jwt.h"
#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <ctime>
#include <cstring>
#include <sstream>
#include <vector>
#include <iostream>

static std::string base64UrlEncode(const unsigned char* data, size_t len) {
    static const char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string result;
    result.reserve(4 * ((len + 2) / 3));

    for (size_t i = 0; i < len; i += 3) {
        uint32_t n = static_cast<uint32_t>(data[i]) << 16;
        if (i + 1 < len) n |= static_cast<uint32_t>(data[i + 1]) << 8;
        if (i + 2 < len) n |= static_cast<uint32_t>(data[i + 2]);

        result.push_back(table[(n >> 18) & 0x3F]);
        result.push_back(table[(n >> 12) & 0x3F]);
        result.push_back((i + 1 < len) ? table[(n >> 6) & 0x3F] : '=');
        result.push_back((i + 2 < len) ? table[n & 0x3F] : '=');
    }

    // Convert to URL-safe base64: replace + with -, / with _, remove =
    for (auto& c : result) {
        if (c == '+') c = '-';
        else if (c == '/') c = '_';
    }
    // Remove trailing '='
    while (!result.empty() && result.back() == '=') {
        result.pop_back();
    }

    return result;
}

static std::string base64UrlEncode(const std::string& s) {
    return base64UrlEncode(reinterpret_cast<const unsigned char*>(s.data()), s.size());
}

std::string generateZoomJWT(const std::string& sdkKey, const std::string& sdkSecret, int expirySeconds) {
    auto now = std::time(nullptr);
    auto exp = now + expirySeconds;

    // Header
    std::string header = R"({"alg":"HS256","typ":"JWT"})";

    // Payload per Zoom SDK spec
    std::ostringstream payloadStream;
    payloadStream << R"({"appKey":")" << sdkKey
                  << R"(","iat":)" << now
                  << R"(,"exp":)" << exp
                  << R"(,"tokenExp":)" << exp
                  << "}";
    std::string payload = payloadStream.str();

    // Encode header and payload
    std::string encodedHeader = base64UrlEncode(header);
    std::string encodedPayload = base64UrlEncode(payload);

    // Create signing input
    std::string signingInput = encodedHeader + "." + encodedPayload;

    // HMAC-SHA256
    unsigned char hmacResult[EVP_MAX_MD_SIZE];
    unsigned int hmacLen = 0;

    HMAC(EVP_sha256(),
         sdkSecret.data(), static_cast<int>(sdkSecret.size()),
         reinterpret_cast<const unsigned char*>(signingInput.data()),
         signingInput.size(),
         hmacResult, &hmacLen);

    std::string signature = base64UrlEncode(hmacResult, hmacLen);

    std::string jwt = signingInput + "." + signature;
    std::cout << "[JWT] Generated token (expires in " << expirySeconds << "s)" << std::endl;

    return jwt;
}
