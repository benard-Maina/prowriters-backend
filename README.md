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
Invoke-RestMethod -Uri http://localhost:3000/api/ping -Method Get

# register (example)
Invoke-RestMethod -Uri http://localhost:3000/api/register -Method Post -ContentType 'application/json' -Body (ConvertTo-Json @{name='Test'; email='t@example.com'; password='secret'; role='client'; country='Nowhere'})

# list pending users
Invoke-RestMethod -Uri http://localhost:3000/api/pending-users -Method Get

# approve user (replace <id>)
Invoke-RestMethod -Uri http://localhost:3000/api/approve-user/<id> -Method Post

# login
Invoke-RestMethod -Uri http://localhost:3000/api/login -Method Post -ContentType 'application/json' -Body (ConvertTo-Json @{email='t@example.com'; password='secret'})
```
