output "url" {
  description = "Live frontend URL"
  value       = "https://${aws_cloudfront_distribution.portal.domain_name}"
}

output "lambda_function_name" {
  value = aws_lambda_function.server.function_name
}

output "assets_bucket" {
  value = aws_s3_bucket.assets.bucket
}
