import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus, ArrowLeft } from 'lucide-react';
import { registerPatient } from '../services/patients';
import { PageHeader } from '../components/PageHeader';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { describeError } from '../lib/format';
import { DEFAULT_PHC_ID } from '../lib/constants';
import type { Gender } from '../types';

interface FormState {
  name: string;
  gender: Gender;
  birth_date: string;
  abha_id: string;
  abha_address: string;
  phone_number: string;
  village: string;
  phc_id: string;
  district: string;
  state: string;
}

const initialForm: FormState = {
  name: '',
  gender: 'female',
  birth_date: '',
  abha_id: '',
  abha_address: '',
  phone_number: '',
  village: '',
  phc_id: DEFAULT_PHC_ID,
  district: '',
  state: '',
};

export function RegisterPatient() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function update<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) next.name = 'Name is required.';
    if (!form.birth_date) next.birth_date = 'Birth date is required.';
    if (!/^\d{14}$/.test(form.abha_id.trim())) {
      next.abha_id = 'ABHA ID must be exactly 14 digits.';
    }
    if (form.phone_number && !/^\d{10}$/.test(form.phone_number.trim())) {
      next.phone_number = 'Phone number must be exactly 10 digits.';
    }
    if (!form.district.trim()) next.district = 'District is required.';
    if (!form.state.trim()) next.state = 'State is required.';
    if (!form.phc_id.trim()) next.phc_id = 'PHC ID is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await registerPatient({
        name: form.name.trim(),
        gender: form.gender,
        birth_date: form.birth_date,
        abha_id: form.abha_id.trim(),
        abha_address: form.abha_address.trim() || null,
        phone_number: form.phone_number.trim() || null,
        village: form.village.trim() || null,
        phc_id: form.phc_id.trim(),
        district: form.district.trim(),
        state: form.state.trim(),
      });
      navigate(`/patients/${created.id}`);
    } catch (error) {
      setSubmitError(describeError(error).friendly);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        to="/patients"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to patients
      </Link>
      <PageHeader
        title="Register patient"
        description="Create a new patient record. ABHA ID is required by the backend."
      />

      <form onSubmit={onSubmit} className="max-w-2xl">
        <Card
          title="Patient details"
          subtitle="All fields marked * are required. ABHA ID must be 14 digits."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Full name *"
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                error={errors.name}
                placeholder="e.g. Lakshmi Kannan"
              />
            </div>
            <Select
              label="Gender *"
              value={form.gender}
              onChange={(event) => update('gender', event.target.value as Gender)}
              options={[
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'other', label: 'Other' },
                { value: 'unknown', label: 'Unknown' },
              ]}
            />
            <Input
              label="Birth date *"
              type="date"
              value={form.birth_date}
              onChange={(event) => update('birth_date', event.target.value)}
              error={errors.birth_date}
            />
            <Input
              label="ABHA ID *"
              value={form.abha_id}
              onChange={(event) => update('abha_id', event.target.value.replace(/\D/g, ''))}
              error={errors.abha_id}
              hint="14 digits, digits only"
              maxLength={14}
            />
            <Input
              label="ABHA Address"
              value={form.abha_address}
              onChange={(event) => update('abha_address', event.target.value)}
              placeholder="Optional"
            />
            <Input
              label="Phone number"
              value={form.phone_number}
              onChange={(event) => update('phone_number', event.target.value.replace(/\D/g, ''))}
              error={errors.phone_number}
              hint="10 digits"
              maxLength={10}
            />
            <Input
              label="Village"
              value={form.village}
              onChange={(event) => update('village', event.target.value)}
              placeholder="Optional"
            />
            <Input
              label="PHC ID *"
              value={form.phc_id}
              onChange={(event) => update('phc_id', event.target.value)}
              error={errors.phc_id}
            />
            <Input
              label="District *"
              value={form.district}
              onChange={(event) => update('district', event.target.value)}
              error={errors.district}
            />
            <Input
              label="State *"
              value={form.state}
              onChange={(event) => update('state', event.target.value)}
              error={errors.state}
            />
          </div>

          {submitError && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-priority-red">
              {submitError}
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <Link to="/patients">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" loading={submitting}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Register patient
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
