data "archive_file" "server" {
  type = "zip"
  # OpenNext's output layout has flipped between server-function/ and
  # server-functions/default/ across versions before (see KNOWN ISSUES,
  # 2026-06-27) -- confirm against the actual .open-next/ output before
  # changing this if the build ever fails here again.
  source_dir  = "${path.module}/../.open-next/server-function"
  output_path = "${path.module}/.builds/server.zip"
}

resource "aws_lambda_function" "server" {
  filename         = data.archive_file.server.output_path
  function_name    = "${var.app_name}-${var.stage}-server"
  role             = aws_iam_role.portal_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  source_code_hash = data.archive_file.server.output_base64sha256
  timeout          = 30
  memory_size      = 1024

  environment {
    variables = {
      NEXT_PUBLIC_COGNITO_USER_POOL_ID = var.cognito_user_pool_id
      NEXT_PUBLIC_COGNITO_CLIENT_ID    = var.cognito_client_id
      NEXT_PUBLIC_COGNITO_REGION       = var.aws_region
      S3_INTAKE_BUCKET                 = var.s3_intake_bucket
      DYNAMODB_TABLE_ORGS              = var.dynamodb_table
      CACHE_BUCKET_NAME                = var.cache_bucket_name
      DYNAMODB_TABLE_FORMS             = var.dynamodb_table_forms
      SQS_SIGN_URL                     = "https://sqs.${var.aws_region}.amazonaws.com/${var.aws_account_id}/daai-insure-sign"
      SQS_GENERATE_URL                 = "https://sqs.${var.aws_region}.amazonaws.com/${var.aws_account_id}/daai-insure-generate"
      # AWS_REGION is set automatically by the Lambda runtime to the deployment region
    }
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.server.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.portal.execution_arn}/*/*"
}
