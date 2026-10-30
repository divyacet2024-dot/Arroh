# MEDORA backend development

## Run the local API on port 8000

From the repository root, start the backend with the project's virtual environment
and a dedicated local SQLite database. This avoids using or changing the existing
`arroh_dev.db`:

```powershell
Set-Location backend
$env:API_ENV = "development"
$env:DATABASE_URL = "sqlite+aiosqlite:///./medora_dev.db"
..\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Keep that terminal open while using the web app. Verify that the API is ready at
`http://127.0.0.1:8000/health`, then start the web app in another terminal:

```powershell
Set-Location web
npm run dev
```

The web development configuration points to `http://127.0.0.1:8000` by default.
Patient OTP login in development returns a visible test code in the app; no SMS
is sent. Outside development, OTP requests fail clearly until an SMS delivery
provider has been configured.

The backend runs SQLite schema initialization at startup. The command above
uses `medora_dev.db`, not the existing development database. Review and back up
any database before configuring the backend to use it.
