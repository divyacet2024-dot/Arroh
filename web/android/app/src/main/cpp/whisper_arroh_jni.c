/*
 * ARROH Whisper JNI bridge.
 *
 * Wraps whisper.cpp and exposes a small, focused surface to Java:
 *   - initModel(path)      : load a ggml model from a filesystem path
 *   - releaseModel(ctx)    : free the context
 *   - transcribe(ctx, lang, threads, pcm, n) -> combined text string
 *
 * It deliberately keeps a single long-lived context across calls (the model is
 * loaded once) and returns the concatenated transcript. No network happens
 * here: the model must already reside on the device.
 */
#include <jni.h>
#include <android/log.h>
#include <string.h>
#include <stdlib.h>

#include "whisper.h"

#define TAG "ArrohWhisperJni"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)

static jstring emptyString(JNIEnv * env) {
    jstring s = (*env)->NewStringUTF(env, "");
    return s;
}

/* Load a ggml model from a file path. Returns a native context pointer (jlong)
 * or 0 on failure. use_gpu is always false on Android CPU-only builds. */
JNIEXPORT jlong JNICALL
Java_in_arroh_medical_WhisperLib_initModel(JNIEnv * env, jobject thiz, jstring modelPath) {
    (void) thiz;
    if (modelPath == NULL) {
        LOGW("initModel: modelPath is null");
        return 0;
    }
    const char * path = (*env)->GetStringUTFChars(env, modelPath, NULL);
    if (path == NULL) {
        return 0;
    }
    LOGI("Loading model from %s", path);

    struct whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;

    struct whisper_context * ctx = whisper_init_from_file_with_params(path, cparams);
    (*env)->ReleaseStringUTFChars(env, modelPath, path);

    if (ctx == NULL) {
        LOGW("whisper_init_from_file_with_params returned NULL");
        return 0;
    }
    return (jlong) (intptr_t) ctx;
}

/* Free a previously loaded context. */
JNIEXPORT void JNICALL
Java_in_arroh_medical_WhisperLib_releaseModel(JNIEnv * env, jobject thiz, jlong ctxPtr) {
    (void) env;
    (void) thiz;
    struct whisper_context * ctx = (struct whisper_context *) (intptr_t) ctxPtr;
    if (ctx != NULL) {
        whisper_free(ctx);
    }
}

/* Transcribe PCM samples (16-bit mono, 16kHz, normalized to float).
 *
 * Returns the concatenated text of all segments. If the model fails to run,
 * returns an empty string. `language` is an ISO-639-1 code (e.g. "ta", "en",
 * "hi", "kn", "te", "ml") or NULL/"auto" to let whisper detect it.
 *
 * This function may block for the duration of the decode; callers must invoke
 * it off the UI thread.
 */
JNIEXPORT jstring JNICALL
Java_in_arroh_medical_WhisperLib_transcribe(
        JNIEnv * env,
        jobject thiz,
        jlong ctxPtr,
        jint numThreads,
        jstring language,
        jfloatArray audioData) {
    (void) thiz;
    if (ctxPtr == 0) {
        LOGW("transcribe: null context");
        return emptyString(env);
    }
    if (audioData == NULL) {
        LOGW("transcribe: null audio");
        return emptyString(env);
    }

    struct whisper_context * ctx = (struct whisper_context *) (intptr_t) ctxPtr;

    jfloat * samples = (*env)->GetFloatArrayElements(env, audioData, NULL);
    const jsize nSamples = (*env)->GetArrayLength(env, audioData);
    if (samples == NULL || nSamples == 0) {
        LOGW("transcribe: no audio samples");
        return emptyString(env);
    }
    LOGI("transcribe: %d samples, %d threads", (int) nSamples, (int) numThreads);

    // Reset the context so a repeated call does not reuse the previous utterance
    // as an initial prompt. Fresh decoding for each listen() is what the app wants.
    whisper_reset_timings(ctx);

    struct whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_realtime  = false;
    params.print_progress  = false;
    params.print_timestamps = false;
    params.print_special   = false;
    params.translate       = false;
    params.no_context      = true;   // do not chain prior transcription
    params.single_segment  = false;
    params.n_threads       = numThreads > 0 ? numThreads : 2;
    params.detect_language = false;

    if (language != NULL) {
        const char * lang = (*env)->GetStringUTFChars(env, language, NULL);
        if (lang != NULL && lang[0] != '\0' && strcmp(lang, "auto") != 0) {
            params.language = lang;
        }
        // We must not release lang here: params.language points at these chars
        // while whisper_full runs. We release after whisper_full below.
        // To manage the lifetime cleanly, defer the release.
        int rc = whisper_full(ctx, params, samples, (int) nSamples);
        (*env)->ReleaseStringUTFChars(env, language, lang);
        if (rc != 0) {
            LOGW("whisper_full failed with rc=%d", rc);
            (*env)->ReleaseFloatArrayElements(env, audioData, samples, JNI_ABORT);
            return emptyString(env);
        }
    } else {
        params.language = "auto";
        int rc = whisper_full(ctx, params, samples, (int) nSamples);
        if (rc != 0) {
            LOGW("whisper_full failed with rc=%d", rc);
            (*env)->ReleaseFloatArrayElements(env, audioData, samples, JNI_ABORT);
            return emptyString(env);
        }
    }

    (*env)->ReleaseFloatArrayElements(env, audioData, samples, JNI_ABORT);

    // Concatenate segments.
    const int nSegments = whisper_full_n_segments(ctx);
    size_t total = 1;
    for (int i = 0; i < nSegments; ++i) {
        const char * seg = whisper_full_get_segment_text(ctx, i);
        total += seg != NULL ? strlen(seg) : 0;
    }
    char * buf = (char *) calloc(total, 1);
    if (buf == NULL) {
        return emptyString(env);
    }
    size_t off = 0;
    for (int i = 0; i < nSegments; ++i) {
        const char * seg = whisper_full_get_segment_text(ctx, i);
        if (seg != NULL) {
            memcpy(buf + off, seg, strlen(seg));
            off += strlen(seg);
        }
    }
    jstring result = (*env)->NewStringUTF(env, buf);
    free(buf);
    return result;
}

JNIEXPORT jstring JNICALL
Java_in_arroh_medical_WhisperLib_systemInfo(JNIEnv * env, jobject thiz) {
    (void) env;
    (void) thiz;
    return (*env)->NewStringUTF(env, whisper_print_system_info());
}
