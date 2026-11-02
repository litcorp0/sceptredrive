The Windows till installer, unsigned while the signing certificate is pending.

## Install

1. Download `@INSTALLER@` (the only `.exe` asset).
2. Windows SmartScreen will warn because the installer is unsigned —
   **More info → Run anyway**.
3. Enrol from the console (terminals → enrolment code) and set a staff PIN.

If this build was not baked with the API and PowerSync URLs, put `config.json` in
`%APPDATA%\Sceptre Drive POS\` before the first launch — otherwise the till opens with nothing
to connect to.

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
