import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ConnectivityProvider } from './lib/offline/connectivity';
import { SyncProvider } from './lib/offline/SyncContext';
import { I18nProvider } from './i18n';
import { Dashboard } from './pages/Dashboard';
import { Patients } from './pages/Patients';
import { RegisterPatient } from './pages/RegisterPatient';
import { PatientDetail } from './pages/PatientDetail';
import { Triage } from './pages/Triage';
import { VoiceAssistant } from './pages/VoiceAssistant';
import { Emergency } from './pages/Emergency';
import { TeleConsult } from './pages/TeleConsult';
import { Inventory } from './pages/Inventory';
import { Sync } from './pages/Sync';
import { CaseTakingPage } from './pages/CaseTaking';
import { CaseReview } from './pages/CaseReview';
import { Consultation } from './pages/Consultation';
import { Button } from './components/ui/Button';
import { SearchX } from 'lucide-react';

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <span className="rounded-full bg-slate-100 p-4 text-slate-400">
        <SearchX className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-bold text-slate-900">Page not found</h1>
      <p className="max-w-sm text-sm text-slate-500">
        The route you requested does not exist. Return to the dashboard to continue.
      </p>
      <Link to="/">
        <Button variant="outline">Back to dashboard</Button>
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ConnectivityProvider>
        <SyncProvider>
        <I18nProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/patients" element={<Patients />} />
                <Route path="/patients/new" element={<RegisterPatient />} />
                <Route path="/patients/:id" element={<PatientDetail />} />
                <Route path="/triage" element={<Triage />} />
                <Route path="/voice" element={<VoiceAssistant />} />
                <Route path="/emergency" element={<Emergency />} />
                <Route path="/teleconsult" element={<TeleConsult />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/sync" element={<Sync />} />
                <Route path="/case-taking" element={<CaseTakingPage />} />
                <Route path="/case/:caseId" element={<CaseReview />} />
                <Route path="/consultation" element={<Consultation />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
        </I18nProvider>
        </SyncProvider>
      </ConnectivityProvider>
    </BrowserRouter>
  );
}
