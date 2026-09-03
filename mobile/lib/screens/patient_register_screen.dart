/// Patient registration — writes to the local DB immediately and queues a
/// sync operation. The UI never blocks on the backend; the success message
/// reflects the local write only.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/connectivity_monitor.dart';
import '../offline/models.dart';

class PatientRegisterScreen extends StatefulWidget {
  const PatientRegisterScreen({super.key, required this.state});
  final AppState state;

  @override
  State<PatientRegisterScreen> createState() => _PatientRegisterScreenState();
}

class _PatientRegisterScreenState extends State<PatientRegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  String _name = '';
  String _gender = 'female';
  String _birthDate = '';
  String _abhaId = '';
  String _abhaAddress = '';
  String _phoneNumber = '';
  String _village = '';
  String _district = '';
  String _state = '';
  String _phcId = 'PHC-LOCAL';
  bool _isPregnant = false;
  bool _isElderly = false;
  bool _isChild = false;
  bool _saving = false;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    _formKey.currentState!.save();
    setState(() => _saving = true);
    try {
      final patient = await widget.state.patientRepository.register(
        name: _name.trim(),
        gender: _gender,
        birthDate: _birthDate,
        district: _district.trim(),
        state: _state.trim(),
        abhaId: _abhaId.trim().isEmpty ? null : _abhaId.trim(),
        abhaAddress: _abhaAddress.trim().isEmpty ? null : _abhaAddress.trim(),
        phoneNumber: _phoneNumber.trim().isEmpty ? null : _phoneNumber.trim(),
        village: _village.trim().isEmpty ? null : _village.trim(),
        phcId: _phcId.trim().isEmpty ? null : _phcId.trim(),
        isPregnant: _isPregnant,
        isElderly: _isElderly,
        isChild: _isChild,
      );
      if (!mounted) return;
      _showSaved(patient);
      _formKey.currentState!.reset();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save: $error'), backgroundColor: const Color(0xFFB3261E)),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _showSaved(LocalPatient patient) {
    final connectivity = widget.state.connectivity.current;
    final saved = connectivity.online && connectivity.backend == BackendReachability.reachable
        ? 'Patient saved locally. Backend reachable — sync will run soon.'
        : 'Patient saved locally. Will sync when connection returns.';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(saved), backgroundColor: const Color(0xFF1B5E20)),
    );
    Navigator.of(context).pushReplacementNamed('/triage', arguments: patient.localUuid);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register patient')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Patient details',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        decoration: _decoration('Full name *'),
                        validator: (value) => (value ?? '').trim().isEmpty ? 'Name is required' : null,
                        onSaved: (value) => _name = value ?? '',
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _gender,
                        decoration: _decoration('Gender *'),
                        items: const [
                          DropdownMenuItem(value: 'female', child: Text('Female')),
                          DropdownMenuItem(value: 'male', child: Text('Male')),
                          DropdownMenuItem(value: 'other', child: Text('Other')),
                          DropdownMenuItem(value: 'unknown', child: Text('Unknown')),
                        ],
                        onChanged: (value) => setState(() => _gender = value ?? 'female'),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        decoration: _decoration('Birth date * (YYYY-MM-DD)'),
                        validator: (value) => (value ?? '').trim().length < 8 ? 'Birth date is required' : null,
                        onSaved: (value) => _birthDate = value ?? '',
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        decoration: _decoration('ABHA ID (14 digits)'),
                        keyboardType: TextInputType.number,
                        maxLength: 14,
                        onSaved: (value) => _abhaId = value ?? '',
                      ),
                      TextFormField(
                        decoration: _decoration('ABHA address'),
                        onSaved: (value) => _abhaAddress = value ?? '',
                      ),
                      TextFormField(
                        decoration: _decoration('Phone number'),
                        keyboardType: TextInputType.phone,
                        onSaved: (value) => _phoneNumber = value ?? '',
                      ),
                      TextFormField(
                        decoration: _decoration('Village'),
                        onSaved: (value) => _village = value ?? '',
                      ),
                      TextFormField(
                        decoration: _decoration('District *'),
                        validator: (value) => (value ?? '').trim().isEmpty ? 'District is required' : null,
                        onSaved: (value) => _district = value ?? '',
                      ),
                      TextFormField(
                        decoration: _decoration('State *'),
                        validator: (value) => (value ?? '').trim().isEmpty ? 'State is required' : null,
                        onSaved: (value) => _state = value ?? '',
                      ),
                      TextFormField(
                        decoration: _decoration('PHC ID'),
                        initialValue: _phcId,
                        onSaved: (value) => _phcId = value ?? _phcId,
                      ),
                      const SizedBox(height: 12),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Pregnant'),
                        value: _isPregnant,
                        onChanged: (value) => setState(() => _isPregnant = value),
                      ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Elderly (chronic follow-up)'),
                        value: _isElderly,
                        onChanged: (value) => setState(() => _isElderly = value),
                      ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Child (vaccinations)'),
                        value: _isChild,
                        onChanged: (value) => setState(() => _isChild = value),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _saving ? null : _submit,
                icon: _saving
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.save_outlined),
                label: const Text('Save patient locally'),
              ),
              const SizedBox(height: 12),
              Text(
                'Saving writes the patient to the on-device database immediately. The sync '
                'queue will deliver the record to the ARROH backend as soon as the server is reachable.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _decoration(String label) => InputDecoration(
        labelText: label,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        filled: true,
        fillColor: Colors.white,
      );
}