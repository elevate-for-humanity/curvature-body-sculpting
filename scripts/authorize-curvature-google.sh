#!/usr/bin/env bash
# Run once as the Google project administrator in Cloud Shell.
# Authorizes only Curvature's immutable repository ID, main branch,
# and the two named manual workflows. Creates an isolated runtime with access
# to its one existing secret. Does not deploy or change app traffic.
set -euo pipefail
PROJECT=elegant-racer-299721
POOL=elevate-github
PROVIDER=curvature-main
DEPLOY_SA=elevate-github-deploy@elegant-racer-299721.iam.gserviceaccount.com
RUNTIME_SA=curvature-runtime@elegant-racer-299721.iam.gserviceaccount.com
SECRET=curvature-supabase-service-role-key
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
test "$PROJECT_NUMBER" = 484736877039
# Read-only preflight before changing IAM. Never read or print secret values.
gcloud iam service-accounts describe "$DEPLOY_SA" --project="$PROJECT" >/dev/null
SECRET_STATE="$(gcloud secrets versions describe latest --secret="$SECRET" --project="$PROJECT" --format='value(state)')"
test "$SECRET_STATE" = ENABLED
PROVIDERS="$(gcloud iam workload-identity-pools providers list --workload-identity-pool="$POOL" --location=global --project="$PROJECT" --format='value(name)')"
RUNTIME_FOUND="$(gcloud iam service-accounts list --project="$PROJECT" --filter="email=$RUNTIME_SA" --format='value(email)')"
if test -n "$RUNTIME_FOUND" && test "$RUNTIME_FOUND" != "$RUNTIME_SA"; then
  echo 'Unexpected runtime identity; refusing IAM changes.' >&2
  exit 1
fi
CONDITION="assertion.repository_id == '1378513910' && assertion.repository_owner_id == '286334428' && assertion.ref == 'refs/heads/main' && assertion.event_name == 'workflow_dispatch' && (assertion.workflow_ref == 'elevate-for-humanity/curvature-body-sculpting/.github/workflows/check-google-connection.yml@refs/heads/main' || assertion.workflow_ref == 'elevate-for-humanity/curvature-body-sculpting/.github/workflows/deploy-google.yml@refs/heads/main')"
MAPPING='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id'
if printf '%s\n' "$PROVIDERS" | grep -Fxq "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi
# This grants Curvature's named workflows the existing deployment account's
# permissions. It does not add project roles or change the LMS provider.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project="$PROJECT" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository_id/1378513910" --condition=None >/dev/null
if test -z "$RUNTIME_FOUND"; then
  gcloud iam service-accounts create curvature-runtime --project="$PROJECT" --display-name='Curvature backend runtime' --quiet >/dev/null
fi
# No project-level role grants. The runtime can read only its own server key;
# the deployer can attach only this runtime identity to the Curvature service.
gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor --condition=None --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project="$PROJECT" --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser --condition=None --quiet >/dev/null
test "$(gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT" --format='value(disabled)')" != True
gcloud secrets get-iam-policy "$SECRET" --project="$PROJECT" --format=json | python3 -c 'import json,sys; p=json.load(sys.stdin); assert any(b.get("role")=="roles/secretmanager.secretAccessor" and "serviceAccount:curvature-runtime@elegant-racer-299721.iam.gserviceaccount.com" in b.get("members",[]) and not b.get("condition") for b in p.get("bindings",[])), "Curvature secret access not verified"'
gcloud iam service-accounts get-iam-policy "$RUNTIME_SA" --project="$PROJECT" --format=json | python3 -c 'import json,sys; p=json.load(sys.stdin); assert any(b.get("role")=="roles/iam.serviceAccountUser" and "serviceAccount:elevate-github-deploy@elegant-racer-299721.iam.gserviceaccount.com" in b.get("members",[]) and not b.get("condition") for b in p.get("bindings",[])), "Curvature deploy identity not verified"'
gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" --format='yaml(name,state,attributeCondition)'
printf '\nCurvature repository and isolated runtime authorized; secret access and deploy identity verified. No application was deployed.\n'
