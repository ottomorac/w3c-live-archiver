#pragma once

#include <string>

// Generate a JWT token for Zoom SDK authentication
// Uses HMAC-SHA256 with the SDK secret
std::string generateZoomJWT(const std::string& sdkKey, const std::string& sdkSecret, int expirySeconds = 7200);
