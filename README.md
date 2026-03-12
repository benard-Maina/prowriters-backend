ProWriterSystem

Run the backend server (Node.js):

- Start in foreground (recommended):

```powershell
node server.js
```

- Start via npm script:

```powershell
npm start
```

- Start in a new background window (Windows PowerShell):

```powershell
Start-Process node -ArgumentList 'server.js' -WorkingDirectory $PWD
```

- Quick helper scripts (Windows):
  - `start-server.ps1` — runs the server in a new cmd window.
  - `start-server.bat` — opens a new cmd window and runs `node server.js`.

API quickchecks:

```powershell
# health
Invoke-RestMethod -Uri https://api.prowriter.me/api/ping -Method Get

# register (example)
Invoke-RestMethod -Uri https://api.prowriter.me/api/register -Method Post -ContentType 'application/json' -Body (ConvertTo-Json @{name='Test'; email='t@example.com'; password='secret'; role='client'; country='Nowhere'})

# list pending users
Invoke-RestMethod -Uri https://api.prowriter.me/api/pending-users -Method Get

# approve user (replace <id>)
Invoke-RestMethod -Uri https://api.prowriter.me/api/approve-user/<id> -Method Post

# login
Invoke-RestMethod -Uri https://api.prowriter.me/api/login -Method Post -ContentType 'application/json' -Body (ConvertTo-Json @{email='t@example.com'; password='secret'})
```

Admin verification email setup (optional):

- Configure these environment variables on the server:
  - `SMTP_HOST`
  - `SMTP_PORT` (for example `587`)
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_SECURE` (`true` for SSL, otherwise `false`)
  - `SMTP_FROM` (sender address)
  - `ADMIN_VERIFICATION_NOTIFY_EMAILS` (comma-separated extra recipients)

- Behavior:
  - When a new admin registers and is marked pending approval, the server sends a verification/approval email notification to approved admins and extra recipients.
