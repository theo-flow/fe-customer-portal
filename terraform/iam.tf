resource "aws_iam_role" "portal_lambda" {
  name = "${var.app_name}-${var.stage}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.portal_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "portal_permissions" {
  name = "${var.app_name}-${var.stage}-permissions"
  role = aws_iam_role.portal_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/${var.dynamodb_table}"
      },
      {
        # daai-insure-forms GSI, used by api/status/[docId] to look up
        # pipeline status by the portal's own docId -- confirmed live but
        # never committed here until now (see the array-position note on
        # the cache-bucket statement below for why order matters in this
        # jsonencode'd policy). User confirmed: preserve as-is, matching
        # current live behavior, rather than silently removing it.
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/${var.dynamodb_table_forms}/index/portal_doc_id-index"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "arn:aws:s3:::${var.s3_intake_bucket}/*"
      },
      {
        # OpenNext ISR cache bucket -- was granted out-of-band when
        # CACHE_BUCKET_NAME was wired (see PROJECT_PLAN.md KNOWN ISSUES,
        # 2026-06-30) but never committed here until now. Keep this ahead of
        # the Sign statement below: this policy is a jsonencode'd list, not a
        # map, so Terraform matches statements by array position -- a new
        # statement inserted before an existing-but-uncommitted one would
        # have overwritten it (and deleted this permission) instead of
        # adding alongside it.
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${var.cache_bucket_name}/*"
      },
      {
        # TheoFlow Sign (Module 9): publish {session_id} once the last signer
        # completes, and publish the "Generate PDF" direct-print trigger.
        Effect = "Allow"
        Action = ["sqs:SendMessage"]
        Resource = [
          "arn:aws:sqs:${var.aws_region}:${var.aws_account_id}:daai-insure-sign",
          "arn:aws:sqs:${var.aws_region}:${var.aws_account_id}:daai-insure-generate",
        ]
      },
    ]
  })
}
