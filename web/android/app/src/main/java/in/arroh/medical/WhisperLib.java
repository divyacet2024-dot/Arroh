package in.arroh.medical;

import android.content.res.AssetManager;
import android.os.Build;
import android.util.Log;

/**
 * JNI bindings to the natively built whisper.cpp library (libarroh_whisper.so).
 *
 * The native code returns a long-lived context pointer; the model is loaded
 * once from a device file path and reused for every transcription, which keeps
 * memory bounded and avoids repeated model loads. All methods that do work
 * (transcribe in particular) are blocking and must be called off the UI thread.
 */
public final class WhisperLib {

    private static final String TAG = "ArrohWhisperLib";

    static {
        // The NDK builds the library as libarroh_whisper.so.
        System.loadLibrary("arroh_whisper");
        Log.d(TAG, "Loaded libarroh_whisper.so (ABI " + Build.SUPPORTED_ABIS[0] + ")");
    }

    private WhisperLib() {
    }

    /**
     * Load a ggml model from a filesystem path. Returns a native context
     * pointer (long, treated as an opaque handle) or 0 on failure.
     * The caller owns the returned handle and must call {@link #releaseModel(long)}.
     */
    public static native long initModel(String modelPath);

    /** Free a context returned by {@link #initModel(String)}. */
    public static native void releaseModel(long contextPtr);

    /**
     * Transcribe normalized float PCM (16-bit mono, 16 kHz resampled to
     * [-1, 1]) and return the concatenated transcript text.
     *
     * @param numThreads threads to use for the decoder
     * @param language   ISO-639-1 code ("en", "ta", ...) or null / "auto"
     * @param audioData  float samples in [-1, 1]
     */
    public static native String transcribe(long contextPtr, int numThreads, String language, float[] audioData);

    /** Return a human-readable build/system info string. */
    public static native String systemInfo();
}
