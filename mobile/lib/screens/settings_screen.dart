/// Settings — language selector and ASHA worker / PHC identifiers.

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../offline/app_state.dart';

const List<({String code, String label})> kLanguages = [
  (code: 'en', label: 'English'),
  (code: 'kn', label: 'Kannada'),
  (code: 'hi', label: 'Hindi'),
  (code: 'ta', label: 'Tamil'),
  (code: 'te', label: 'Telugu'),
];

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.state});
  final AppState state;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String _language = 'en';
  String _workerId = '';
  String _phcId = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _language = prefs.getString('arroh_language') ?? 'en';
      _workerId = prefs.getString('arroh_worker_id') ?? 'ASHA-DEMO-01';
      _phcId = prefs.getString('arroh_phc_id') ?? 'PHC-LOCAL';
    });
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('arroh_language', _language);
    await prefs.setString('arroh_worker_id', _workerId);
    await prefs.setString('arroh_phc_id', _phcId);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Settings saved.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Language', style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _language,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                    items: kLanguages
                        .map((lang) => DropdownMenuItem(value: lang.code, child: Text(lang.label)))
                        .toList(),
                    onChanged: (value) => setState(() => _language = value ?? 'en'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('ASHA worker & PHC', style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: _workerId,
                    decoration: const InputDecoration(labelText: 'Worker ID', border: OutlineInputBorder()),
                    onChanged: (value) => _workerId = value,
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: _phcId,
                    decoration: const InputDecoration(labelText: 'PHC ID', border: OutlineInputBorder()),
                    onChanged: (value) => _phcId = value,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            icon: const Icon(Icons.save_outlined),
            label: const Text('Save settings'),
            onPressed: _save,
          ),
          const SizedBox(height: 24),
          const Text(
            'The mobile database is the primary source of truth. The sync queue '
            'delivers pending records to the ARROH backend whenever the backend '
            'is reachable. Failed records are retained and retried with exponential '
            'backoff until they succeed or are explicitly retried.',
          ),
        ],
      ),
    );
  }
}