package in.arroh.medical;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Minimal offline TextToSpeech bridge.
 *
 * Wraps the Android system {@link TextToSpeech} engine. It only ever reports a
 * language as available when the engine exposes a matching {@link Voice} that
 * does not require a network connection. It never falls back to a network
 * voice. A real device test is still required to confirm audio output.
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
    private volatile String initializationError;

    @Override
    public void load() {
        Context context = getContext();
        tts = new TextToSpeech(context, status -> {
            if (status == TextToSpeech.SUCCESS) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        notifyTtsEvent("ttsStart", utteranceId, null);
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        notifyTtsEvent("ttsDone", utteranceId, null);
                    }

                    @Override
                    public void onError(String utteranceId) {
                        notifyTtsEvent("ttsError", utteranceId, "Speech synthesis failed.");
                    }

                    @Override
                    public void onError(String utteranceId, int errorCode) {
                        notifyTtsEvent("ttsError", utteranceId, "Speech synthesis failed.");
                    }

                    @Override
                    public void onStop(String utteranceId, boolean interrupted) {
                        notifyTtsEvent("ttsStop", utteranceId, null);
                    }
                });
                ready.set(true);
            } else {
                initializationError = "Android TextToSpeech initialization failed.";
            }
        });
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ready", ready.get());
        if (initializationError != null) {
            result.put("error", initializationError);
        }
        call.resolve(result);
    }

    /**
     * Enumerate the six ARROH locales and report which ones have genuinely
     * available (offline-capable) voice data on this device.
     *
     * @return { voices: [{ language, label, available }] }
     */
    @PluginMethod
    public void getVoices(PluginCall call) {
        if (!requireReady(call)) return;
        JSArray voices = new JSArray();
        for (int i = 0; i < SUPPORTED_LOCALES.length; i++) {
            Locale locale = SUPPORTED_LOCALES[i];
            List<Voice> matchingVoices = getMatchingVoices(locale);
            Voice offlineVoice = getOfflineVoice(matchingVoices, locale);
            boolean networkOnly = !matchingVoices.isEmpty() && offlineVoice == null;
            JSObject voice = new JSObject();
            voice.put("language", locale.toLanguageTag());
            voice.put("label", SUPPORTED_LABELS[i]);
            voice.put("available", offlineVoice != null);
            voice.put("requiresNetworkConnection", networkOnly);
            voice.put("voiceName", offlineVoice != null ? offlineVoice.getName() : null);
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
        if (!requireReady(call)) return;
        String tag = call.getString("language");
        if (tag == null || tag.isEmpty()) {
            call.reject("language is required");
            return;
        }
        Locale locale = Locale.forLanguageTag(tag);
        List<Voice> matchingVoices = getMatchingVoices(locale);
        Voice offlineVoice = getOfflineVoice(matchingVoices, locale);
        boolean networkOnly = !matchingVoices.isEmpty() && offlineVoice == null;
        JSObject ret = new JSObject();
        ret.put("language", tag);
        ret.put("available", offlineVoice != null);
        ret.put("requiresNetworkConnection", networkOnly);
        ret.put("voiceName", offlineVoice != null ? offlineVoice.getName() : null);
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
        if (!requireReady(call)) return;
        String text = call.getString("text");
        String tag = call.getString("language");
        String utteranceId = call.getString("utteranceId");
        Float rate = call.getFloat("rate", 1.0f);

        if (text == null || text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        if (tag == null || tag.isEmpty()) {
            call.reject("language is required");
            return;
        }
        if (utteranceId == null || utteranceId.isEmpty()) {
            call.reject("utteranceId is required");
            return;
        }

        Locale locale = Locale.forLanguageTag(tag);
        List<Voice> matchingVoices = getMatchingVoices(locale);
        Voice voice = getOfflineVoice(matchingVoices, locale);
        if (voice == null) {
            call.reject(matchingVoices.isEmpty()
                ? "No installed voice is available for '" + tag + "'"
                : "The installed voice for '" + tag + "' requires a network connection");
            return;
        }

        tts.setVoice(voice);
        tts.setSpeechRate(rate);
        Bundle params = new Bundle();
        int speakResult = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
        if (speakResult == TextToSpeech.ERROR) {
            call.reject("TextToSpeech failed to start the utterance");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("utteranceId", utteranceId);
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

    private boolean requireReady(PluginCall call) {
        if (ready.get() && tts != null) return true;
        call.reject(initializationError != null
            ? initializationError
            : "Android TextToSpeech engine is still initializing");
        return false;
    }

    private List<Voice> getMatchingVoices(Locale requestedLocale) {
        List<Voice> matches = new ArrayList<>();
        if (tts == null || tts.getVoices() == null) return matches;
        Set<Voice> voices = tts.getVoices();
        for (Voice voice : voices) {
            Locale voiceLocale = voice.getLocale();
            if (!voiceLocale.getLanguage().equalsIgnoreCase(requestedLocale.getLanguage())) continue;
            String requestedCountry = requestedLocale.getCountry();
            String voiceCountry = voiceLocale.getCountry();
            if (requestedCountry.isEmpty() || voiceCountry.isEmpty()
                || voiceCountry.equalsIgnoreCase(requestedCountry)) {
                matches.add(voice);
            }
        }
        return matches;
    }

    private Voice getOfflineVoice(List<Voice> voices, Locale requestedLocale) {
        Voice best = null;
        for (Voice voice : voices) {
            if (voice.isNetworkConnectionRequired()) continue;
            if (best == null
                || voice.getLocale().getCountry().equalsIgnoreCase(requestedLocale.getCountry())) {
                best = voice;
            }
        }
        return best;
    }

    private void notifyTtsEvent(String eventName, String utteranceId, String message) {
        JSObject event = new JSObject();
        event.put("utteranceId", utteranceId);
        if (message != null) event.put("message", message);
        notifyListeners(eventName, event);
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
