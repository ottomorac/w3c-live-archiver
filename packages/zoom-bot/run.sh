#!/bin/bash
# Launch script for the Zoom bot
# Sets up LD_LIBRARY_PATH for the Zoom SDK shared libraries

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_DIR="$SCRIPT_DIR/../../zoom-sdk"
BUILD_DIR="$SCRIPT_DIR/build"

export LD_LIBRARY_PATH="$SDK_DIR:$SDK_DIR/qt_libs:${LD_LIBRARY_PATH:-}"

if [ ! -f "$BUILD_DIR/zoom-bot" ]; then
    echo "Error: zoom-bot binary not found. Build first:"
    echo "  cd $BUILD_DIR && cmake .. && make"
    exit 1
fi

exec "$BUILD_DIR/zoom-bot" "$@"
