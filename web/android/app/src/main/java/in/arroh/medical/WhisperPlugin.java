package in.arroh.medical;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * On-device speech-to-text via whisper.cpp.
 *
 * The wiring is: JS (Capacitor) -> this plugin -> {@link WhisperLib} (JNI) ->
 * whisper.cpp (ggml). Everything runs locally on the device; there is no
 * network request in the microphone -> Whisper -> text path. The ggml model
 * file MUST already be on the device (bundled in assets and copied to app
 * files dir at first load). If it is absent, {@link #getModelStatus} reports
 * "model_unavailable" and {@link #start}/{@link #stop} reject — the plugin
 * never downloads a model behind the user's back.
 *
 * Recognition is a "push-to-talk" single utterance: start recording on
 * {@link #start}, then {@link #stop} ends capture and returns the transcript.
 */
@CapacitorPlugin(
    name = "Whisper",
    permissions = {
        @Permission(
            strings = { Manifest.permission.RECORD_AUDIO },
            alias = "microphone"
        )
    }
)
public class WhisperPlugin extends Plugin {

    private static final String TAG = "ArrohWhisperPlugin";

    // whisper.cpp requires 16 kHz mono planar float PCM.
    private static final int SAMPLE_RATE = 16000;
    private static final int CHANNEL_IN = AudioFormat.CHANNEL_IN_MONO;
    private static final int ENCODING = AudioFormat.ENCODING_PCM_16BIT;

    /** Name of the model file bundled under assets/models/. */
    private static final String MODEL_ASSET_DIR = "models";
    private static final String MODEL_FILE_NAME = "ggml-base.bin";

    private final AtomicBoolean recording = new AtomicBoolean(false);
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    /** Native whisper context (loaded once). 0 == not loaded. Guarded by this. */
    private long modelPtr = 0;
    private String modelPath = null;

    private volatile AudioRecord recorder;
    private volatile boolean cancelled = false;

    // ---------------------------------------------------------------------
    // Model status
    // ---------------------------------------------------------------------

    /**
     * Report whether the whisper model is present and loaded.
     *
     * Returns { status: "available" | "model_unavailable" | "loading", path? }
     * "model_unavailable" is returned when the ggml file is not on the device.
     */
    @PluginMethod
    public void getModelStatus(PluginCall call) {
        String path = findModelPath();
        if (path == null) {
            JSObject ret = new JSObject();
            ret.put("status", "model_unavailable");
            call.resolve(ret);
            return;
        }
        synchronized (this) {
            JSObject ret = new JSObject();
            if (modelPtr != 0) {
                ret.put("status", "available");
            } else {
                ret.put("status", "loading");
            }
            ret.put("path", path);
            call.resolve(ret);
        }
    }

    /**
     * Load the model into memory. Resolves with a status; rejects if the model
     * file is absent. Loading is done on the worker thread so it does not block
     * the UI. While the model loads (or if it already is loaded) the context is
     * kept alive for repeated transcriptions.
     */
    @PluginMethod
    public void loadModel(PluginCall call) {
        String path = findModelPath();
        if (path == null) {
            call.reject("Whisper model is not available on this device (model_unavailable)");
            return;
        }
        worker.execute(() -> {
            synchronized (this) {
                if (modelPtr != 0) {
                    // Already loaded.
                    JSObject ret = new JSObject();
                    ret.put("status", "available");
                    call.resolve(ret);
                    return;
                }
            }
            long ptr = WhisperLib.initModel(path);
            if (ptr == 0) {
                call.reject("Failed to load the whisper model");
                return;
            }
            synchronized (this) {
                modelPtr = ptr;
                modelPath = path;
            }
            Log.d(TAG, "Model loaded from " + path);
            JSObject ret = new JSObject();
            ret.put("status", "available");
            ret.put("path", path);
            call.resolve(ret);
        });
    }

    /** Unload the model, freeing memory. */
    @PluginMethod
    public void unloadModel(PluginCall call) {
        synchronized (this) {
            if (modelPtr != 0) {
                WhisperLib.releaseModel(modelPtr);
                modelPtr = 0;
                modelPath = null;
            }
        }
        call.resolve();
    }

    // ---------------------------------------------------------------------
    // Permissions (microphone)
    // ---------------------------------------------------------------------

    /**
     * Report microphone permission state.
     * Returns { state: "granted" | "denied" | "prompt" | "prompt-with-rationale" }.
     */
    @PluginMethod
    public void checkPermission(PluginCall call) {
        PermissionState state = getPermissionState("microphone");
        JSObject ret = new JSObject();
        ret.put("state", state.toString());
        call.resolve(ret);
    }

    /**
     * Request microphone permission. On the native result, {@link #permissionCallback}
     * resolves with the granted state. This never proceeds to recording unless
     * the user actually grants the permission.
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("state", "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("microphone", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        PermissionState state = getPermissionState("microphone");
        JSObject ret = new JSObject();
        ret.put("state", state.toString());
        call.resolve(ret);
    }

    // ---------------------------------------------------------------------
    // Recording + transcription
    // ---------------------------------------------------------------------

    /**
     * Start capturing from the microphone (16 kHz, mono, PCM 16-bit) and
     * accumulate samples into a buffer. Resolves once capture has started.
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission is not granted");
            return;
        }
        synchronized (this) {
            if (modelPtr == 0) {
                call.reject("Whisper model is not loaded (call loadModel first)");
                return;
            }
        }
        if (recording.get()) {
            call.reject("Already recording");
            return;
        }

        cancelled = false;
        int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_IN, ENCODING);
        if (minBuf <= 0) {
            call.reject("This device does not support 16kHz mono audio capture");
            return;
        }
        recorder = new AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            CHANNEL_IN,
            ENCODING,
            Math.max(minBuf, 2048)
        );
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            recorder = null;
            call.reject("Failed to initialize the microphone recorder");
            return;
        }
        recorder.startRecording();
        recording.set(true);
        call.resolve();
    }

    /**
     * Stop recording, then run whisper.cpp on the captured audio and return the
     * transcript. { text, language } resolved on the worker thread. If capture
     * was cancelled (see {@link #cancel}), returns { cancelled: true }.
     */
    @PluginMethod
    public void stop(PluginCall call) {
        if (!recording.get()) {
            call.reject("Not recording");
            return;
        }
        recording.set(false);
        final AudioRecord rec = recorder;
        recorder = null;
        final boolean wasCancelled = cancelled;
        worker.execute(() -> {
            int nSamples = drain(rec);
            if (wasCancelled) {
                JSObject ret = new JSObject();
                ret.put("cancelled", true);
                call.resolve(ret);
                return;
            }
            if (nSamples <= 0) {
                call.reject("No audio captured (silence or capture failure)");
                return;
            }
            String language = call.getString("language");
            String text = transcribeWithModel(nSamples, language);
            JSObject ret = new JSObject();
            ret.put("text", text);
            ret.put("language", language);
            call.resolve(ret);
        });
    }

    /** Discard the current capture without transcribing. */
    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        if (recording.getAndSet(false)) {
            AudioRecord rec = recorder;
            recorder = null;
            if (rec != null) {
                releaseQuietly(rec);
            }
        }
        call.resolve();
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /** Shared PCM float buffer, resized to the capture length as needed. */
    private float[] capturedFloats = new float[0];

    /** Read all available PCM bytes from the recorder into {@link #capturedFloats}. */
    private int drain(AudioRecord rec) {
        if (rec == null) {
            return 0;
        }
        try {
            int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_IN, ENCODING);
            int bufSize = Math.max(minBuf, 4096);
            byte[] buffer = new byte[bufSize];
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            // Cap capture duration to avoid runaway memory (e.g. 20s).
            long startMs = System.currentTimeMillis();
            final long maxMs = 20000;
            while (recording.get()) {
                int n = rec.read(buffer, 0, buffer.length);
                if (n < 0) {
                    break;
                }
                out.write(buffer, 0, n);
                if (System.currentTimeMillis() - startMs > maxMs) {
                    Log.w(TAG, "Stopping capture after " + maxMs + "ms");
                    break;
                }
            }
            rec.stop();
            rec.release();
            byte[] pcm = out.toByteArray();
            int nSamples = pcm.length / 2; // 16-bit -> mono frames
            if (nSamples <= 0) {
                return 0;
            }
            if (capturedFloats.length != nSamples) {
                capturedFloats = new float[nSamples];
            }
            for (int i = 0; i < nSamples; i++) {
                short s = (short) ((pcm[2 * i] & 0xFF) | (pcm[2 * i + 1] << 8));
                capturedFloats[i] = s / 32768.0f;
            }
            return nSamples;
        } catch (Exception e) {
            Log.e(TAG, "Capture failed", e);
            return 0;
        }
    }

    private String transcribeWithModel(int nSamples, String language) {
        synchronized (this) {
            if (modelPtr == 0 || capturedFloats.length < nSamples) {
                return "";
            }
            return WhisperLib.transcribe(modelPtr, 2, language, capturedFloats);
        }
    }

    private void releaseQuietly(AudioRecord rec) {
        try {
            rec.stop();
        } catch (Exception ignore) {
        }
        try {
            rec.release();
        } catch (Exception ignore) {
        }
    }

    /** Locate the model on the device: prefer files dir, else assets. */
    private String findModelPath() {
        // First try the app-private files dir (model copied at first run).
        File filesDir = getContext().getFilesDir();
        if (filesDir != null) {
            File f = new File(filesDir, MODEL_ASSET_DIR + "/" + MODEL_FILE_NAME);
            if (f.exists() && f.length() > 0) {
                return f.getAbsolutePath();
            }
        }
        // Fall back to assets (read-only). Note: whisper_init_from_file_with_params
        // needs a real path, so assets can only be used if we copy to files dir.
        // If the model is only in assets and not yet copied, report unavailable
        // rather than pretending it is usable from a stream.
        File assetFile = new File(getContext().getCacheDir(), MODEL_ASSET_DIR + "/" + MODEL_FILE_NAME);
        if (assetFile.exists() && assetFile.length() > 0) {
            return assetFile.getAbsolutePath();
        }
        return null;
    }

    @Override
    protected void handleOnDestroy() {
        if (recording.getAndSet(false)) {
            releaseQuietly(recorder);
            recorder = null;
        }
        synchronized (this) {
            if (modelPtr != 0) {
                WhisperLib.releaseModel(modelPtr);
                modelPtr = 0;
            }
        }
        worker.shutdown();
        super.handleOnDestroy();
    }
}
