package in.arroh.medical;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Minimal offline TextToSpeech bridge.
 *
 * Wraps the Android system {@link TextToSpeech} engine. It only ever reports a
 * language as available when the engine confirms the locale (and its offline
 * voice data) is present via {@link TextToSpeech#isLanguageAvailable}. It never
 * falls back to a network/cloud voice and never pretends a language is
 * available offline just because the locale "exists".
 *
 * The six ARROH application locales are en-IN, hi-IN, ta-IN, kn-IN, te-IN,
 * ml-IN. Availability per language is queried truthfully on the device.
 */
@CapacitorPlugin(name = "Tts")
public class OfflineTtsPlugin extends Plugin {

    /** Application locales the product cares about. Label is for UI display only. */
    private static final Locale[] SUPPORTED_LOCALES = new Locale[] {
        new Locale("en", "IN"),
        new Locale("hi", "IN"),
        new Locale("ta", "IN"),
        new Locale("kn", "IN"),
        new Locale("te", "IN"),
        new Locale("ml", "IN"),
    };
    private static final String[] SUPPORTED_LABELS = new String[] {
        "English (India)", "Hindi (India)", "Tamil (India)",
        "Kannada (India)", "Telugu (India)", "Malayalam (India)",
    };

    private TextToSpeech tts;
    private final AtomicBoolean ready = new AtomicBoolean(false);

    @Override
    public void load() {
        Context context = getContext();
        tts = new TextToSpeech(context, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ready.set(true);
            }
        });
    }

    /**
     * Enumerate the six ARROH locales and report which ones have genuinely
     * available (offline-capable) voice data on this device.
     *
     * @return { voices: [{ language, label, available }] }
     */
    @PluginMethod
    public void getVoices(PluginCall call) {
        JSArray voices = new JSArray();
        for (int i = 0; i < SUPPORTED_LOCALES.length; i++) {
            Locale locale = SUPPORTED_LOCALES[i];
            JSObject voice = new JSObject();
            voice.put("language", locale.toLanguageTag());
            voice.put("label", SUPPORTED_LABELS[i]);
            voice.put("available", isLanguageAvailable(locale));
            voices.put(voice);
        }
        JSObject ret = new JSObject();
        ret.put("voices", voices);
        call.resolve(ret);
    }

    /**
     * Truthfully report whether a single language has offline voice data.
     * Never returns true for data that would have to stream over the network.
     *
     * @param call { language } — an IETF BCP-47 tag (e.g. "ta-IN").
     */
    @PluginMethod
    public void checkLanguage(PluginCall call) {
        String tag = call.getString("language");
        if (tag == null || tag.isEmpty()) {
            call.reject("language is required");
            return;
        }
        Locale locale = Locale.forLanguageTag(tag);
        boolean available = isLanguageAvailable(locale);
        JSObject ret = new JSObject();
        ret.put("language", tag);
        ret.put("available", available);
        ret.put("label", locale.getDisplayLanguage() + " (" + locale.getCountry() + ")");
        call.resolve(ret);
    }

    /**
     * Speak text offline. Resolves after the utterance is queued; rejects when
     * the requested language has no usable offline voice data or the engine is
     * not ready — it never silently switches to a network voice.
     *
     * @param call { text, language, rate? }
     */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        String tag = call.getString("language");
        Float rate = call.getFloat("rate", 1.0f);

        if (text == null || text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        if (tag == null || tag.isEmpty()) {
            call.reject("language is required");
            return;
        }
        if (!ready.get() || tts == null) {
            call.reject("TextToSpeech engine is not ready");
            return;
        }

        Locale locale = Locale.forLanguageTag(tag);
        if (!isLanguageAvailable(locale)) {
            call.reject("Offline voice for '" + tag + "' is not installed on this device");
            return;
        }

        int setResult = tts.setLanguage(locale);
        if (setResult == TextToSpeech.LANG_MISSING_DATA || setResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            call.reject("Offline voice data for '" + tag + "' is missing on this device");
            return;
        }

        tts.setSpeechRate(rate);
        Bundle params = new Bundle();
        int speakResult = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "arroh-" + System.nanoTime());
        if (speakResult == TextToSpeech.ERROR) {
            call.reject("TextToSpeech failed to start the utterance");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("message", "queued");
        call.resolve(ret);
    }

    /** Stop any in-progress utterance. */
    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) {
            tts.stop();
        }
        call.resolve();
    }

    /**
     * Map the engine's language-availability result to a boolean that is only
     * true when voice data is present for offline synthesis.
     */
    private boolean isLanguageAvailable(Locale locale) {
        if (tts == null || !ready.get()) {
            return false;
        }
        int result = tts.isLanguageAvailable(locale);
        return result == TextToSpeech.LANG_AVAILABLE
            || result == TextToSpeech.LANG_COUNTRY_AVAILABLE
            || result == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE;
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
            ready.set(false);
        }
        super.handleOnDestroy();
    }
}
