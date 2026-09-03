# Top-level CMake for the ARROH native whisper.cpp library.
#
# Builds whisper.cpp (ggml + whisper) from the vendored source in ./whisper and
# links in a small JNI bridge (whisper_arroh_jni.c). The Gradle module points its
# externalNativeBuild at this file; NDK + CMake drive the whole thing.
#
# Everything here runs on-device (CPU). No network is used at build time beyond
# NDK/CMake fetching source that is already vendored locally.

cmake_minimum_required(VERSION 3.22)

project(arroh_whisper)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ggml builds as SHARED by default on Android, which produces separate .so
# libraries that each fail to link the C++ runtime. Force static so everything
# is folded into our single libarroh_whisper.so below (where c++_static is
# linked). Set this BEFORE add_subdirectory(ggml) so ggml inherits it.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build shared libraries" FORCE)

# Vendored whisper.cpp source tree.
set(WHISPER_LIB_DIR ${CMAKE_CURRENT_SOURCE_DIR}/whisper)

# Parse whisper.cpp's version string from its own CMakeLists.
file(READ "${WHISPER_LIB_DIR}/CMakeLists.txt" WHISPER_MAIN_CMAKE)
string(REGEX MATCH "project\\(\"whisper\\.cpp\" VERSION ([0-9]+\\.[0-9]+\\.[0-9]+)\\)"
    WHISPER_VERSION_MATCH "${WHISPER_MAIN_CMAKE}")
if(CMAKE_MATCH_1)
    set(WHISPER_VERSION ${CMAKE_MATCH_1})
else()
    set(WHISPER_VERSION "unknown")
endif()
message(STATUS "whisper.cpp version: ${WHISPER_VERSION}")

# ggml is pulled in as a subproject (add_subdirectory). It defines the `ggml`
# target we link against.
add_subdirectory(${WHISPER_LIB_DIR}/ggml ggml-build)

# Native JNI library.
add_library(
    arroh_whisper
    SHARED
    ${CMAKE_CURRENT_SOURCE_DIR}/whisper_arroh_jni.c
)

# whisper.cpp core.
target_sources(
    arroh_whisper
    PRIVATE
    ${WHISPER_LIB_DIR}/src/whisper.cpp
)

# Include paths for whisper.cpp and ggml.
target_include_directories(
    arroh_whisper
    PUBLIC
    ${WHISPER_LIB_DIR}
    ${WHISPER_LIB_DIR}/src
    ${WHISPER_LIB_DIR}/include
    ${WHISPER_LIB_DIR}/ggml/include
    ${WHISPER_LIB_DIR}/ggml/src
    ${WHISPER_LIB_DIR}/ggml/src/ggml-cpu
)

# Android CPU backend — whisper.cpp will use the CPU (no GPU on low-cost phones).
target_compile_definitions(arroh_whisper PUBLIC GGML_USE_CPU)
target_compile_definitions(arroh_whisper PRIVATE WHISPER_VERSION="${WHISPER_VERSION}")

# This library mixes C (JNI bridge) and C++ (whisper.cpp / ggml). Force the
# linker to use the C++ driver so the C++ runtime (libc++) is linked in.
set_target_properties(arroh_whisper PROPERTIES LINKER_LANGUAGE CXX)

# Link Android log + the ggml library + the full C++ runtime. ggml, libc++ and
# libc++abi reference each other circularly, so wrap them in a link group. NDK
# r27's c++_static does NOT pull in libc++abi / libunwind by itself, so they are
# listed explicitly. This is the standard fix for "undefined symbol __cxa_* /
# operator new" when building a C++ shared library against static ggml.
find_library(LOG_LIB log)
target_link_libraries(
    arroh_whisper
    ${LOG_LIB}
    android
    -Wl,--start-group
    ggml
    c++_static
    c++abi
    unwind
    -Wl,--end-group
)

if(NOT ${CMAKE_BUILD_TYPE} STREQUAL "Debug")
    target_compile_options(arroh_whisper PRIVATE -O3)
    target_compile_options(arroh_whisper PRIVATE -fvisibility=hidden -fvisibility-inlines-hidden)
    target_compile_options(arroh_whisper PRIVATE -ffunction-sections -fdata-sections)
endif()
