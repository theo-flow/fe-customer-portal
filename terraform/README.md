# This directory does not own any live infrastructure

All portal infrastructure (CloudFront, API Gateway, S3 assets/cache buckets, the
Lambda function, its IAM role/policy, the custom domain, ACM certificate, Route 53,
SES) is managed by **`daai-insure-platform/infrastructure/terraform/frontend`**.
That is the sole authoritative Terraform config — apply changes there.

## Why this directory is empty

Until 2026-07-08 this directory independently defined the *same* live AWS
resources (by name) as `infrastructure/terraform/frontend`, under separate,
never-reconciled state — a split-brain that had already drifted (this config was
missing the custom domain, ACM cert, and several IAM/tag changes that were only
ever applied on the `frontend` side). Fixed by making `frontend` the single owner
and removing every duplicate resource from this directory's state and config.

## Lambda code deploys

Code changes to the portal Lambda go via `aws lambda update-function-code`
directly (same pattern the Python Lambda functions use via
`scripts/build-test-deploy.ps1`), **not** `terraform apply` — `frontend`'s
`aws_lambda_function.ssr_server` resource has `lifecycle { ignore_changes =
[filename, source_code_hash, last_modified] }` specifically so code pushes and
Terraform-managed config (IAM, env vars, memory/timeout) don't fight each other.

```bash
npx next build && npx open-next build
cd terraform  # infrastructure/terraform/frontend, not this directory
# (env var / IAM changes only, if any: terraform plan / apply here)
cd ../../../../fe-customer-portal
aws lambda update-function-code \
  --function-name theoflow-portal-production-server \
  --zip-file fileb://.open-next/server-function.zip \
  --region af-south-1 --profile Sithembiso
aws s3 sync .open-next/assets s3://theoflow-portal-production-assets \
  --profile Sithembiso --region af-south-1 --delete
aws cloudfront create-invalidation --distribution-id E3QSZIPBC6OQTC \
  --paths "/*" --profile Sithembiso
```

`main.tf`/`variables.tf` are kept here only so `aws_profile`/`aws_region` remain
available if this directory is ever repurposed — there is nothing to `terraform
apply` in this directory today.
