#pragma once

#include <vector>
#include <cstdint>

class AudioResampler {
public:
    // Downsample from inputRate to 16000 Hz
    // Input: 16-bit signed PCM mono samples
    // Returns: resampled 16-bit signed PCM at 16kHz
    static std::vector<int16_t> resample(const char* buffer, unsigned int bufferLen,
                                          unsigned int inputSampleRate);
};
