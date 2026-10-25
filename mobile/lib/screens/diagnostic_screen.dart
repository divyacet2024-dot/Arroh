/// Step 6 — Doctor diagnostic request / result screen.
///
/// Lightweight workflow that lets the doctor:
///   * Request an investigation (test name + indication + requester).
///   * Record a verified result against a request (value, units, range).
///
/// The form is intentionally small. No lab integration; the doctor
/// enters what was observed or returned manually.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';

class DiagnosticRequestScreen extends StatefulWidget {
  const DiagnosticRequestScreen({super.key, required this.state, required this.consultationLocalUuid});

  final AppState state;
  final String consultationLocalUuid;

  @override
  State<DiagnosticRequestScreen> createState() => _DiagnosticRequestScreenState();
}

class _DiagnosticRequestScreenState extends State<DiagnosticRequestScreen> {
  final TextEditingController _nameCtrl = TextEditingController();
  final TextEditingController _indicationCtrl = TextEditingController();
  final TextEditingController _resultCtrl = TextEditingController();
  final TextEditingController _unitsCtrl = TextEditingController();
  final TextEditingController _rangeCtrl = TextEditingController();
  final TextEditingController _verifiedByCtrl = TextEditingController();
  String? _pendingInvestigationLocalUuid;
  bool _busy = false;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _indicationCtrl.dispose();
    _resultCtrl.dispose();
    _unitsCtrl.dispose();
    _rangeCtrl.dispose();
    _verifiedByCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Investigation name is required.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final investigationLocalUuid = await widget.state.consultationDraftRepository.enqueueDiagnosticRequest(
        consultationLocalUuid: widget.consultationLocalUuid,
        investigationName: name,
        indication: _indicationCtrl.text.trim().isEmpty ? null : _indicationCtrl.text.trim(),
        requestedBy: widget.state.actor.actorId,
      );
      _pendingInvestigationLocalUuid = investigationLocalUuid;
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Diagnostic request queued. Add a result below when available.'), backgroundColor: Color(0xFF1B5E20)),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveResult() async {
    if (_pendingInvestigationLocalUuid == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Queue a diagnostic request first.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    if (_resultCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Result value is required.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.state.consultationDraftRepository.enqueueDiagnosticResult(
        investigationLocalUuid: _pendingInvestigationLocalUuid!,
        resultValue: _resultCtrl.text.trim(),
        units: _unitsCtrl.text.trim().isEmpty ? null : _unitsCtrl.text.trim(),
        referenceRange: _rangeCtrl.text.trim().isEmpty ? null : _rangeCtrl.text.trim(),
        verifiedBy: _verifiedByCtrl.text.trim().isEmpty ? widget.state.actor.actorId : _verifiedByCtrl.text.trim(),
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Diagnostic result queued.'), backgroundColor: Color(0xFF1B5E20)),
      );
      Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Diagnostic')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Request an investigation', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 8),
          TextFormField(
            controller: _nameCtrl,
            decoration: const InputDecoration(labelText: 'Test name', border: OutlineInputBorder(), helperText: 'e.g. CBC, Blood glucose, Urine routine'),
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: _indicationCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Indication / notes', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          FilledButton.tonalIcon(
            icon: const Icon(Icons.science_outlined),
            label: const Text('Queue request'),
            onPressed: _busy ? null : _save,
          ),
          const SizedBox(height: 24),
          const Divider(),
          const SizedBox(height: 12),
          Text('Record result', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          TextFormField(
            controller: _resultCtrl,
            minLines: 1,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Result value', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  controller: _unitsCtrl,
                  decoration: const InputDecoration(labelText: 'Units', border: OutlineInputBorder()),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextFormField(
                  controller: _rangeCtrl,
                  decoration: const InputDecoration(labelText: 'Reference range', border: OutlineInputBorder()),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: _verifiedByCtrl,
            decoration: InputDecoration(
              labelText: 'Verified by',
              border: const OutlineInputBorder(),
              helperText: 'Defaults to ${widget.state.actor.actorId} if left blank.',
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            icon: const Icon(Icons.check),
            label: const Text('Queue result'),
            onPressed: _busy ? null : _saveResult,
          ),
        ],
      ),
    );
  }
}
