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
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "arn:aws:s3:::${var.s3_intake_bucket}/*"
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
