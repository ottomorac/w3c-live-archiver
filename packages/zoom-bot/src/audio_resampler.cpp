#include "audio_resampler.h"

std::vector<int16_t> AudioResampler::resample(const char* buffer, unsigned int bufferLen,
                                               unsigned int inputSampleRate) {
    const int16_t* samples = reinterpret_cast<const int16_t*>(buffer);
    unsigned int sampleCount = bufferLen / sizeof(int16_t);

    if (inputSampleRate == 16000) {
        // No resampling needed
        return std::vector<int16_t>(samples, samples + sampleCount);
    }

    unsigned int ratio = inputSampleRate / 16000;
    if (ratio == 0) ratio = 1;

    std::vector<int16_t> output;
    output.reserve(sampleCount / ratio);

    // Simple averaging decimation filter
    for (unsigned int i = 0; i + ratio <= sampleCount; i += ratio) {
        int32_t sum = 0;
        for (unsigned int j = 0; j < ratio; j++) {
            sum += samples[i + j];
        }
        output.push_back(static_cast<int16_t>(sum / static_cast<int32_t>(ratio)));
    }

    return output;
}
