#include "config.h"
#include "zoom_sdk_manager.h"
#include "participant_tracker.h"
#include "ws_client.h"
#include <glib.h>
#include <iostream>
#include <csignal>

static GMainLoop* g_loop = nullptr;
static ZoomSDKManager* g_sdkManager = nullptr;

void signalHandler(int sig) {
    std::cout << "\n[Main] Received signal " << sig << ", shutting down..." << std::endl;
    if (g_sdkManager) {
        g_sdkManager->leave();
        g_sdkManager->cleanup();
    }
    if (g_loop) {
        g_main_loop_quit(g_loop);
    }
}

// Called periodically by GLib to check if we should exit
static gboolean checkStatus(gpointer data) {
    auto* mgr = static_cast<ZoomSDKManager*>(data);

    if (mgr->hasFailed()) {
        std::cerr << "[Main] SDK operation failed, exiting..." << std::endl;
        g_main_loop_quit(g_loop);
        return FALSE;
    }

    return TRUE;  // Keep calling
}

int main(int argc, char* argv[]) {
    std::cout << "=== Zoom Meeting Transcription Bot ===" << std::endl;

    // Install signal handlers
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    // Load configuration
    Config config = Config::load(argc, argv);

    // Create components
    ParticipantTracker tracker;
    WSClient wsClient;

    // Connect to gateway (non-blocking, auto-reconnects)
    wsClient.connect(config.gatewayUrl);

    // Initialize SDK
    ZoomSDKManager sdkManager(config, tracker, wsClient);
    g_sdkManager = &sdkManager;

    if (!sdkManager.initialize()) {
        std::cerr << "[Main] SDK initialization failed" << std::endl;
        return 1;
    }

    // Start authentication (non-blocking, chains to joinMeeting on success)
    if (!sdkManager.startAuth()) {
        std::cerr << "[Main] Failed to start authentication" << std::endl;
        return 1;
    }

    // Create GLib main loop - required for SDK callbacks to fire on Linux
    g_loop = g_main_loop_new(nullptr, FALSE);

    // Periodic status check (every 1 second)
    g_timeout_add(1000, checkStatus, &sdkManager);

    std::cout << "[Main] Running event loop (Ctrl+C to exit)..." << std::endl;

    // Run the GLib event loop - this drives all SDK callbacks
    g_main_loop_run(g_loop);

    // Cleanup
    std::cout << "[Main] Shutting down..." << std::endl;
    sdkManager.cleanup();
    wsClient.disconnect();
    g_main_loop_unref(g_loop);
    g_loop = nullptr;
    g_sdkManager = nullptr;

    std::cout << "[Main] Done." << std::endl;
    return 0;
}
