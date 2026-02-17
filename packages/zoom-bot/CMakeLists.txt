cmake_minimum_required(VERSION 3.16)
project(zoom-bot CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Zoom SDK paths
set(ZOOM_SDK_DIR "${CMAKE_SOURCE_DIR}/../../zoom-sdk")
set(ZOOM_SDK_INCLUDE "${ZOOM_SDK_DIR}/h")
set(ZOOM_SDK_LIB_DIR "${ZOOM_SDK_DIR}")

# Source files
file(GLOB SOURCES "src/*.cpp")

# Fetch IXWebSocket
include(FetchContent)
FetchContent_Declare(
    ixwebsocket
    GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
    GIT_TAG v11.4.5
)
set(USE_TLS ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(ixwebsocket)

# Find GLib (required for SDK event loop on Linux)
find_package(PkgConfig REQUIRED)
pkg_check_modules(GLIB REQUIRED glib-2.0)

add_executable(zoom-bot ${SOURCES})

target_include_directories(zoom-bot PRIVATE
    ${ZOOM_SDK_INCLUDE}
    ${CMAKE_SOURCE_DIR}/third_party
    ${GLIB_INCLUDE_DIRS}
)

target_link_libraries(zoom-bot PRIVATE
    ${ZOOM_SDK_LIB_DIR}/libmeetingsdk.so
    ixwebsocket
    ${GLIB_LIBRARIES}
    pthread
    ssl
    crypto
    z
)

# RPATH so the binary finds Zoom SDK .so files at runtime
set_target_properties(zoom-bot PROPERTIES
    BUILD_RPATH "${ZOOM_SDK_LIB_DIR};${ZOOM_SDK_DIR}/qt_libs"
    INSTALL_RPATH "${ZOOM_SDK_LIB_DIR};${ZOOM_SDK_DIR}/qt_libs"
)
