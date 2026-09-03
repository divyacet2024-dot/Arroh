package in.arroh.medical;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OfflineTtsPlugin.class);
        registerPlugin(WhisperPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
