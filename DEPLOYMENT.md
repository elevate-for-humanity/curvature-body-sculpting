# Curvature backend

This backend belongs only in `elevate-for-humanity/curvature-body-sculpting` and a dedicated Curvature Supabase project. The code refuses the LMS, Starter, Legacy 83 and Store database URLs. No LMS files or production tables have been changed by this backend implementation.

## Current state

Implemented and locally tested: contact requests, appointment requests, career inquiries, invoice requests, duplicate protection, catalog validation, and authenticated staff request access. The combined site content is preserved in `content/combined-site-draft.json`; it has not been published. Historical services and careers remain subject to owner content review. This does not confirm job openings, pricing, appointment availability, or medical claims.

**Not live:** dedicated database creation failed through the Supabase connector. Schema has not been applied. No container image has been built or deployed. Website forms and the central Elevate dashboard are not yet connected to this service. Email notifications and PayPal/QuickBooks invoice issuance are not implemented; requests are saved as pending/unpaid, never reported as confirmed appointments or completed payments.

## Deployment requirements

1. Create the dedicated Curvature Supabase project in the owner's approved organization. Apply `db/schema.sql` there. Do not use an existing business's database as a substitute.
2. Set server-only secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never expose the service key in browser code. Set `ALLOWED_ORIGINS` to the exact website origin(s), separated by commas. Set `CURVATURE_ADMIN_USER_IDS` to explicitly approved user UUIDs in the Curvature Auth project. The admin endpoint verifies each bearer token with Supabase Auth before checking that list. Elevate sessions do not automatically become Curvature sessions; central dashboard access still needs an authenticated integration.
3. Run `npm test`, build the supplied Dockerfile, deploy the tested immutable image using the existing Google Cloud workflow, and verify `/readyz` against the real database. `/healthz` checks the process only. Do not route public traffic before configuring ingress abuse protection/rate limits and monitoring in Google Cloud.
4. Connect website forms using `src/client.mjs`. Map full name to `name`, service slug to `service_id`, requested local date/time to `preferred_date`/`preferred_time`, and role slug to `role_id`. Retain the same UUID idempotency key when retrying the same payload; use a new key after editing. Display success only after a saved request ID is returned. Retain the current invoice-request checkout; do not restore the archived Stripe route.
5. Run real browser-to-database checks for each form, duplicate retries, failed storage, unauthorized admin access, and staff follow-up. Mark the integration complete only after those pass. Remove synthetic verification records afterward.

## API

All POST bodies require `name` and `email`, and an `Idempotency-Key` UUID header. Private data is never returned to public request submitters.

| Route | Additional input |
|---|---|
| `POST /api/curvature/contact` | `message` |
| `POST /api/curvature/appointments` | `service_id`, `phone`, `preferred_date` (YYYY-MM-DD), `preferred_time` (HH:mm, Indianapolis time) |
| `POST /api/curvature/applications` | `role_id`, `message` describing experience |
| `POST /api/curvature/invoice-requests` | `items: [{product_id, quantity}]`; server derives the subtotal; no charge occurs |
| `GET /api/curvature/services` | Public service names and IDs only |
| `GET /api/admin/curvature/requests` | Curvature Auth bearer token; explicit admin UUID allowlist |
| `PATCH /api/admin/curvature/requests/:id` | Same admin authorization; `status` is pending, reviewing or closed |

The appointment endpoint records preferences for staff review. It does not reserve inventory or guarantee a time slot. Career submissions are inquiries for review, not assertions that historical positions remain open. Avoid collecting health records or sensitive identity documents in these forms.

## Verification

`npm test` exercises public handler behavior with an in-memory Supabase REST test double. It checks validation, persisted-before-success behavior, retries, nested item changes, failed storage, server pricing, unpaid state, admin authorization, origin restrictions, isolation, and client error handling. These tests do not demonstrate a live Supabase connection or deployed website behavior.
