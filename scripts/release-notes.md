The Windows till installer, unsigned while the signing certificate is pending.

## Install

1. Download `@INSTALLER@` (the only `.exe` asset).
2. Windows SmartScreen will warn because the installer is unsigned —
   **More info → Run anyway**.
3. Before the first launch, put `config.json` in `%APPDATA%\Sceptre Drive POS\`.
4. Enrol from the console (terminals → enrolment code) and set a staff PIN.

## config.json

```json
{
  "apiBaseUrl": "https://<your-api>.onrender.com",
  "powersyncUrl": "https://<your-instance>.powersync.journeyapps.com"
}
```

A packaged build refuses `localhost` unless `SCEPTRE_ALLOW_LOCAL_API=1`, so a wrong
URL fails loudly rather than selling into a development API.

`SHA256SUMS.txt` lists the checksums of every asset.

Unsigned, no auto-update. Signing, auto-update and the production cut are Phase 15.
