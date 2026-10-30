import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AuthProvider, RequireAuth } from './lib/auth';
import { PatientAuthProvider, RequirePatient } from './lib/patientAuth';
import { ConnectivityProvider } from './lib/offline/connectivity';
import { SyncProvider } from './lib/offline/SyncContext';
import { I18nProvider } from './i18n';

// Public / auth screens
import { Welcome }      from './pages/Welcome';
import { Login }        from './pages/Login';
import { PatientLogin } from './pages/PatientLogin';

// Patient-facing screens
import { PatientHome }  from './pages/PatientHome';

// Doctor / staff screens (existing, kept intact)
import { Dashboard }        from './pages/Dashboard';
import { Patients }         from './pages/Patients';
import { RegisterPatient }  from './pages/RegisterPatient';
import { PatientDetail }    from './pages/PatientDetail';
import { Triage }           from './pages/Triage';
import { VoiceAssistant }   from './pages/VoiceAssistant';
import { Emergency }        from './pages/Emergency';
import { TeleConsult }      from './pages/TeleConsult';
import { Inventory }        from './pages/Inventory';
import { Sync }             from './pages/Sync';
import { CaseTakingPage }   from './pages/CaseTaking';
import { CaseReview }       from './pages/CaseReview';
import { Consultation } from './pages/Consultation';
import { HospitalFinder } from './pages/HospitalFinder';
import { DoctorHome }       from './pages/DoctorHome';

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <ConnectivityProvider>
          <SyncProvider>
            {/* Patient auth context — entirely separate from staff auth */}
            <PatientAuthProvider>
              <AuthProvider>
                <Routes>
                  {/* ── Public: AI welcome / role selector ── */}
                  <Route path="/"             element={<Welcome />} />

                  {/* ── Patient auth (mobile + OTP) ── */}
                  <Route path="/patient-login" element={<PatientLogin />} />

                  {/* ── Patient protected area ── */}
                  <Route
                    path="/patient"
                    element={
                      <RequirePatient>
                        <PatientHome />
                      </RequirePatient>
                    }
                  />

                  {/* ── Doctor / staff login (email + password) ── */}
                  <Route path="/login" element={<Login />} />

                  {/* ── Doctor / staff protected area ── */}
                  <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                    {/* Doctor home replaces old dashboard as the first screen */}
                    <Route path="/dashboard"    element={<Dashboard />} />
                    <Route path="/doctor"       element={<DoctorHome />} />
                    {/* Emergency is accessible from patient home so reuse existing */}
                    <Route path="/emergency"    element={<Emergency />} />
                    <Route path="/patients"     element={<Patients />} />
                    <Route path="/patients/new" element={<RegisterPatient />} />
                    <Route path="/patients/:id" element={<PatientDetail />} />
                    <Route path="/triage"       element={<Triage />} />
                    <Route path="/voice"        element={<VoiceAssistant />} />
                    <Route path="/teleconsult"  element={<TeleConsult />} />
                    <Route path="/inventory"    element={<Inventory />} />
                    <Route path="/sync"         element={<Sync />} />
                    <Route path="/case-taking"  element={<CaseTakingPage />} />
                    <Route path="/case/:caseId" element={<CaseReview />} />
                    <Route path="/consultation" element={<Consultation />} />
                  <Route path="/find-care" element={<HospitalFinder />} />
                  </Route>
                  {/* Unknown/restored startup paths should return to role selection,
                      not be captured by the protected staff route and redirected to /login. */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AuthProvider>
            </PatientAuthProvider>
          </SyncProvider>
        </ConnectivityProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
