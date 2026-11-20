# Supabase root certificates

`supabase-ca-bundle.pem` holds Supabase's two public root CA certificates ("Supabase Root 2021 CA",
valid 2021–2031 and 2025–2035), copied from Supabase's official CLI
(`supabase/cli`, `apps/cli/src/command-internal/supabase-ca-templates/`).

They are public, not secret. In production their contents go in the `DATABASE_CA_CERT` environment
variable, so the server only talks to a database whose certificate Supabase signed.

SHA-256 fingerprints:
- 2021: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- 2025: `5F:9B:77:95:1A:7A:A1:30:3F:9B:58:EE:A9:BF:A8:9E:35:8C:FD:C1:5F:97:86:FF:10:D4:93:0A:72:2C:9A:E2`
