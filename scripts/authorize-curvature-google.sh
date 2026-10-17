#!/usr/bin/env bash
# Run once as the Google project administrator in Cloud Shell.
# Authorizes only Curvature's immutable repository ID, main branch,
# and the two named manual workflows. Does not deploy or change app traffic.
set -euo pipefail
PROJECT=elegant-racer-299721
POOL=elevate-github
PROVIDER=curvature-main
DEPLOY_SA=elevate-github-deploy@elegant-racer-299721.iam.gserviceaccount.com
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
test "$PROJECT_NUMBER" = 484736877039
CONDITION="assertion.repository_id == '1378513910' && assertion.repository_owner_id == '286334428' && assertion.ref == 'refs/heads/main' && assertion.event_name == 'workflow_dispatch' && (assertion.workflow_ref == 'elevate-for-humanity/curvature-body-sculpting/.github/workflows/check-google-connection.yml@refs/heads/main' || assertion.workflow_ref == 'elevate-for-humanity/curvature-body-sculpting/.github/workflows/deploy-google.yml@refs/heads/main')"
MAPPING='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id'
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi
# This grants Curvature's named workflows the existing deployment account's
# permissions. It does not add project roles or change the LMS provider.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project="$PROJECT" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository_id/1378513910" --condition=None >/dev/null
gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT" --format='yaml(name,state,attributeCondition)'
printf '\nCurvature repository authorized. No application was deployed.\n'
