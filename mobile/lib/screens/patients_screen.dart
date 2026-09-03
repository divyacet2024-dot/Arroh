/// Patient list — every record shown comes from the local SQLite database.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';

class PatientsScreen extends StatefulWidget {
  const PatientsScreen({super.key, required this.state});
  final AppState state;

  @override
  State<PatientsScreen> createState() => _PatientsScreenState();
}

class _PatientsScreenState extends State<PatientsScreen> {
  String _query = '';
  late Future<List<LocalPatient>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.state.patientRepository.list();
  }

  Future<List<LocalPatient>> _filtered() async {
    final all = await _future;
    if (_query.isEmpty) return all;
    final needle = _query.toLowerCase();
    return all.where((p) =>
        p.name.toLowerCase().contains(needle) ||
        (p.village ?? '').toLowerCase().contains(needle) ||
        (p.abhaId ?? '').contains(needle) ||
        (p.phoneNumber ?? '').contains(needle)).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Patients')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: 'Search name, ABHA, village, phone…',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                filled: true,
                fillColor: Colors.white,
              ),
              onChanged: (value) => setState(() {
                _query = value;
                _future = widget.state.patientRepository.list();
              }),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<LocalPatient>>(
              future: _filtered(),
              builder: (context, snapshot) {
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final patients = snapshot.data!;
                if (patients.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.people_outline, size: 56, color: Color(0xFF90A4AE)),
                          const SizedBox(height: 12),
                          Text(
                            _query.isEmpty ? 'No patients registered yet.' : 'No matches for "$_query".',
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            icon: const Icon(Icons.person_add_alt_1),
                            label: const Text('Register a patient'),
                            onPressed: () => Navigator.of(context).pushNamed('/register'),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 96),
                  itemCount: patients.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final p = patients[index];
                    return Card(
                      child: ListTile(
                        leading: CircleAvatar(child: Text(p.name.isNotEmpty ? p.name[0] : '?')),
                        title: Text(p.name),
                        subtitle: Text('${p.village ?? p.district} · ${p.triageStatus}'),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                              Text(p.syncedAt == null ? 'local' : 'synced',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: p.syncedAt == null ? const Color(0xFFB26A00) : const Color(0xFF1B5E20),
                                    fontWeight: FontWeight.w700,
                                  )),
                              const Icon(Icons.chevron_right),
                            ],
                        ),
                        onTap: () => Navigator.of(context).pushNamed('/triage', arguments: p.localUuid),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Register'),
        onPressed: () => Navigator.of(context).pushNamed('/register'),
      ),
    );
  }
}