data "archive_file" "server" {
  type        = "zip"
  source_dir  = "${path.module}/../.open-next/server-functions/default"
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
